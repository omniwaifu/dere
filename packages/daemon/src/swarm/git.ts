// Swarm git operations

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readdir, readFile, access } from "node:fs/promises";
import { join } from "node:path";
import { constants } from "node:fs";

const execFileAsync = promisify(execFile);

/** Maximum time to wait for a git command in milliseconds */
const GIT_TIMEOUT_MS = 30_000;

export type GitCommandResult = {
  code: number;
  stdout: string;
  stderr: string;
};

export class GitError extends Error {
  readonly code: number;
  readonly stderr: string;
  readonly command: string[];
  readonly workingDir: string;

  constructor(
    message: string,
    options: { code: number; stderr: string; command: string[]; workingDir: string },
  ) {
    super(message);
    this.name = "GitError";
    this.code = options.code;
    this.stderr = options.stderr;
    this.command = options.command;
    this.workingDir = options.workingDir;
  }

  toLogContext(): Record<string, unknown> {
    return {
      error: this.message,
      errorType: this.name,
      code: this.code,
      stderr: this.stderr,
      command: this.command.join(" "),
      workingDir: this.workingDir,
    };
  }
}

/**
 * Validates that the working directory exists and is accessible.
 */
async function validateWorkingDir(workingDir: string): Promise<void> {
  try {
    await access(workingDir, constants.R_OK | constants.X_OK);
  } catch {
    throw new GitError(`Working directory does not exist or is not accessible: ${workingDir}`, {
      code: -1,
      stderr: "ENOENT",
      command: [],
      workingDir,
    });
  }
}

export async function runGitCommand(
  workingDir: string,
  args: string[],
): Promise<GitCommandResult> {
  // Validate inputs
  if (!workingDir || typeof workingDir !== "string") {
    throw new GitError("Working directory is required", {
      code: -1,
      stderr: "Invalid workingDir argument",
      command: args,
      workingDir: workingDir ?? "",
    });
  }

  if (!Array.isArray(args) || args.length === 0) {
    throw new GitError("Git command arguments are required", {
      code: -1,
      stderr: "Invalid args argument",
      command: args ?? [],
      workingDir,
    });
  }

  try {
    const { stdout, stderr } = await execFileAsync("git", args, {
      cwd: workingDir,
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer for large outputs
    });
    return { code: 0, stdout: stdout?.toString() ?? "", stderr: stderr?.toString() ?? "" };
  } catch (error) {
    const err = error as {
      stdout?: string | Buffer;
      stderr?: string | Buffer;
      code?: number;
      killed?: boolean;
      signal?: string;
    };

    // Handle timeout
    if (err.killed && err.signal === "SIGTERM") {
      return {
        code: 124, // Standard timeout exit code
        stdout: err.stdout?.toString() ?? "",
        stderr: `Git command timed out after ${GIT_TIMEOUT_MS}ms: git ${args.join(" ")}`,
      };
    }

    return {
      code: typeof err.code === "number" ? err.code : 1,
      stdout: err.stdout?.toString() ?? "",
      stderr: err.stderr?.toString() ?? String(error),
    };
  }
}

export async function getCurrentBranch(workingDir: string): Promise<string> {
  await validateWorkingDir(workingDir);

  const result = await runGitCommand(workingDir, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (result.code !== 0) {
    throw new GitError(
      `Failed to get current branch: ${result.stderr || "Unknown error"}`,
      { code: result.code, stderr: result.stderr, command: ["rev-parse", "--abbrev-ref", "HEAD"], workingDir },
    );
  }
  return result.stdout.trim();
}

export async function createBranch(workingDir: string, branchName: string, base: string): Promise<void> {
  await validateWorkingDir(workingDir);

  // Validate branch name (basic sanity check)
  if (!branchName || typeof branchName !== "string" || branchName.includes("..")) {
    throw new GitError(`Invalid branch name: ${branchName}`, {
      code: -1,
      stderr: "Invalid branch name",
      command: ["branch", branchName, base],
      workingDir,
    });
  }

  const exists = await runGitCommand(workingDir, [
    "show-ref",
    "--verify",
    "--quiet",
    `refs/heads/${branchName}`,
  ]);
  if (exists.code === 0) {
    throw new GitError(`Branch '${branchName}' already exists in ${workingDir}`, {
      code: 1,
      stderr: "Branch already exists",
      command: ["branch", branchName, base],
      workingDir,
    });
  }

  const result = await runGitCommand(workingDir, ["branch", branchName, base]);
  if (result.code !== 0) {
    throw new GitError(
      `Failed to create branch '${branchName}' from '${base}': ${result.stderr || "Unknown error"}`,
      { code: result.code, stderr: result.stderr, command: ["branch", branchName, base], workingDir },
    );
  }
}

export type MergeResult = {
  success: boolean;
  error: string | null;
  conflictFiles?: string[];
};

export async function mergeBranch(
  workingDir: string,
  source: string,
  target: string,
  noFf = true,
  message?: string,
): Promise<MergeResult> {
  await validateWorkingDir(workingDir);

  // First, checkout the target branch
  const checkoutResult = await runGitCommand(workingDir, ["checkout", target]);
  if (checkoutResult.code !== 0) {
    return {
      success: false,
      error: `Failed to checkout target branch '${target}': ${checkoutResult.stderr || checkoutResult.stdout}`,
    };
  }

  // Build merge command
  const args = ["merge", source];
  if (noFf) {
    args.push("--no-ff");
  }
  if (message) {
    args.push("-m", message);
  }

  const result = await runGitCommand(workingDir, args);
  if (result.code !== 0) {
    const output = result.stdout + result.stderr;
    const isConflict = output.includes("CONFLICT") || output.includes("Merge conflict");

    if (isConflict) {
      // Try to extract conflict file names
      const conflictMatches = output.match(/CONFLICT.*?: (.+)/g) ?? [];
      const conflictFiles = conflictMatches.map((m) => m.replace(/CONFLICT.*?: /, "").trim());

      // Abort the failed merge to restore clean state
      const abortResult = await runGitCommand(workingDir, ["merge", "--abort"]);
      if (abortResult.code !== 0) {
        return {
          success: false,
          error: `Merge conflict in ${conflictFiles.join(", ") || "files"}, and failed to abort: ${abortResult.stderr}`,
          conflictFiles,
        };
      }

      return {
        success: false,
        error: `Merge conflict between '${source}' and '${target}': ${conflictFiles.join(", ") || output.slice(0, 200)}`,
        conflictFiles,
      };
    }

    return {
      success: false,
      error: `Failed to merge '${source}' into '${target}': ${result.stderr || result.stdout}`,
    };
  }

  return { success: true, error: null };
}

export async function listPlugins(): Promise<Array<{
  name: string;
  version: string;
  description: string;
  has_mcp_servers: boolean;
  mcp_servers: string[];
}>> {
  const pluginsDir = join(process.cwd(), "plugins");
  try {
    const entries = await readdir(pluginsDir, { withFileTypes: true });
    const plugins: Array<{
      name: string;
      version: string;
      description: string;
      has_mcp_servers: boolean;
      mcp_servers: string[];
    }> = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith("_")) {
        continue;
      }
      const pluginJson = join(pluginsDir, entry.name, ".claude-plugin", "plugin.json");
      try {
        const raw = await readFile(pluginJson, "utf-8");
        const data = JSON.parse(raw) as Record<string, unknown>;
        const mcpServers =
          data.mcpServers && typeof data.mcpServers === "object"
            ? Object.keys(data.mcpServers as Record<string, unknown>)
            : [];
        plugins.push({
          name: entry.name,
          version: typeof data.version === "string" ? data.version : "0.0.0",
          description: typeof data.description === "string" ? data.description : "",
          has_mcp_servers: mcpServers.length > 0,
          mcp_servers: mcpServers,
        });
      } catch {
        continue;
      }
    }
    return plugins;
  } catch {
    return [];
  }
}
