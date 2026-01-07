// Swarm git operations

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const execFileAsync = promisify(execFile);

export async function runGitCommand(
  workingDir: string,
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync("git", args, { cwd: workingDir });
    return { code: 0, stdout: stdout?.toString() ?? "", stderr: stderr?.toString() ?? "" };
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; code?: number };
    return {
      code: err.code ?? 1,
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? String(error),
    };
  }
}

export async function getCurrentBranch(workingDir: string): Promise<string> {
  const result = await runGitCommand(workingDir, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (result.code !== 0) {
    throw new Error(result.stderr || "Failed to get current branch");
  }
  return result.stdout.trim();
}

export async function createBranch(workingDir: string, branchName: string, base: string) {
  const exists = await runGitCommand(workingDir, [
    "show-ref",
    "--verify",
    "--quiet",
    `refs/heads/${branchName}`,
  ]);
  if (exists.code === 0) {
    throw new Error(`Branch '${branchName}' already exists`);
  }
  const result = await runGitCommand(workingDir, ["branch", branchName, base]);
  if (result.code !== 0) {
    throw new Error(result.stderr || "Failed to create branch");
  }
}

export async function mergeBranch(
  workingDir: string,
  source: string,
  target: string,
  noFf = true,
  message?: string,
): Promise<{ success: boolean; error: string | null }> {
  await runGitCommand(workingDir, ["checkout", target]);
  const args = ["merge", source];
  if (noFf) {
    args.push("--no-ff");
  }
  if (message) {
    args.push("-m", message);
  }
  const result = await runGitCommand(workingDir, args);
  if (result.code !== 0) {
    if (result.stdout.includes("CONFLICT") || result.stderr.includes("CONFLICT")) {
      await runGitCommand(workingDir, ["merge", "--abort"]);
      return { success: false, error: `Merge conflict: ${result.stderr || result.stdout}` };
    }
    return { success: false, error: result.stderr || result.stdout };
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
