import { appendFileSync } from "node:fs";

import { loadConfig } from "@dere/shared-config";
import { getActivityContext, getTaskContext } from "@dere/shared-runtime";

function logError(message: string): void {
  try {
    const timestamp = new Date().toISOString().replace("T", " ").replace("Z", "");
    appendFileSync("/tmp/dere_productivity_hook.log", `[${timestamp}] ${message}\n`);
  } catch {
    // ignore logging failures
  }
}

async function main(): Promise<void> {
  if (process.env.DERE_PRODUCTIVITY !== "true") {
    return;
  }

  try {
    const stdin = await Bun.stdin.text();
    if (!stdin) {
      return;
    }
    JSON.parse(stdin);
  } catch (error) {
    logError(`Error reading input: ${String(error)}`);
    return;
  }

  try {
    const config = await loadConfig();
    const contextParts: string[] = [];

    try {
      if (config.context?.tasks) {
        const taskCtx = getTaskContext({
          limit: 5,
          workingDir: null,
          includeOverdue: true,
          includeDueSoon: true,
        });
        if (taskCtx) {
          contextParts.push(taskCtx);
          contextParts.push("Tool: taskwarrior available via MCP");
        } else {
          logError("Task context: No tasks returned from getTaskContext()");
        }
      }
    } catch (error) {
      logError(`Task context error: ${String(error)}`);
    }

    try {
      if (config.context?.activity || config.context?.media_player) {
        const activityCtx = await getActivityContext(config);
        if (activityCtx) {
          if (Array.isArray(activityCtx.recent_apps)) {
            contextParts.push(`Recent activity: ${activityCtx.recent_apps.join(", ")}`);
          } else if (activityCtx.status) {
            contextParts.push(`User status: ${String(activityCtx.status)}`);
          }
        }
      }
    } catch (error) {
      logError(`Activity context error: ${String(error)}`);
    }

    const output =
      contextParts.length > 0
        ? {
            hookSpecificOutput: {
              hookEventName: "UserPromptSubmit",
              additionalContext: `\n[Productivity Context]\n${contextParts.join("\n")}\n`,
            },
            suppressOutput: true,
          }
        : { suppressOutput: true };

    console.log(JSON.stringify(output));
  } catch (error) {
    logError(`Productivity context gathering error: ${String(error)}`);
    console.log(JSON.stringify({ suppressOutput: true }));
  }
}

if (import.meta.main) {
  main().catch((error) => {
    logError(`Fatal productivity context hook error: ${String(error)}`);
  });
}
