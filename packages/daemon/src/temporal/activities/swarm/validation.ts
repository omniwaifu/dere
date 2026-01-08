/**
 * Validation activity for swarm workflows.
 *
 * Runs validation commands (lint, test, build) and returns structured results.
 */

import { spawn } from "node:child_process";

export interface RunValidationInput {
  workingDir: string;
  command: string;
  timeoutSeconds?: number;
}

export interface ValidationResult {
  passed: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  errors: string[];
  durationSeconds: number;
}

/**
 * Run a validation command and return structured results.
 *
 * Parses common output formats to extract error messages.
 */
export async function runValidation(input: RunValidationInput): Promise<ValidationResult> {
  const { workingDir, command, timeoutSeconds = 300 } = input;
  const startTime = Date.now();

  return new Promise((resolve) => {
    const [cmd, ...args] = command.split(" ");
    if (!cmd) {
      resolve({
        passed: false,
        exitCode: 1,
        stdout: "",
        stderr: "Empty command",
        errors: ["Empty command"],
        durationSeconds: 0,
      });
      return;
    }

    const proc = spawn(cmd, args, {
      cwd: workingDir,
      shell: true,
      timeout: timeoutSeconds * 1000,
    });

    let stdout = "";
    let stderr = "";

    proc.stdout?.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on("error", (error) => {
      const durationSeconds = (Date.now() - startTime) / 1000;
      resolve({
        passed: false,
        exitCode: 1,
        stdout,
        stderr: stderr || error.message,
        errors: [error.message],
        durationSeconds,
      });
    });

    proc.on("close", (code) => {
      const durationSeconds = (Date.now() - startTime) / 1000;
      const exitCode = code ?? 1;
      const passed = exitCode === 0;

      // Extract errors from output
      const errors = parseErrors(stdout, stderr);

      resolve({
        passed,
        exitCode,
        stdout: truncate(stdout, 10000),
        stderr: truncate(stderr, 10000),
        errors,
        durationSeconds,
      });
    });
  });
}

/**
 * Parse common error formats from command output.
 */
function parseErrors(stdout: string, stderr: string): string[] {
  const errors: string[] = [];
  const combined = stdout + "\n" + stderr;

  // TypeScript errors: src/file.ts(10,5): error TS2322: ...
  const tsErrors = combined.match(/^.+\(\d+,\d+\): error TS\d+:.+$/gm);
  if (tsErrors) {
    errors.push(...tsErrors.slice(0, 10));
  }

  // ESLint/oxlint errors: /path/file.ts:10:5 - error ...
  const lintErrors = combined.match(/^.+:\d+:\d+.*error.+$/gim);
  if (lintErrors) {
    errors.push(...lintErrors.slice(0, 10));
  }

  // Jest/Vitest failures: FAIL src/file.test.ts
  const testFailures = combined.match(/^FAIL.+$/gm);
  if (testFailures) {
    errors.push(...testFailures.slice(0, 10));
  }

  // Generic error lines
  if (errors.length === 0) {
    const genericErrors = combined.match(/^.*error.*$/gim);
    if (genericErrors) {
      errors.push(...genericErrors.slice(0, 10));
    }
  }

  return errors;
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + "\n[truncated]";
}
