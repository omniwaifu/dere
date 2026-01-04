import { spawnSync } from "node:child_process";
import { basename, resolve } from "node:path";

type TaskRecord = {
  id?: number;
  description?: string;
  status?: string;
  urgency?: number;
  due?: string;
  priority?: string;
};

function getNextTasks(args: {
  project?: string | null;
  tags?: string[] | null;
  limit: number;
}): TaskRecord[] {
  const cmd = ["task", "export"];
  if (args.project) {
    cmd.push(`project:${args.project}`);
  }
  if (args.tags) {
    for (const tag of args.tags) {
      cmd.push(`+${tag}`);
    }
  }

  try {
    const [command, ...commandArgs] = cmd;
    if (!command) {
      return [];
    }
    const result = spawnSync(command, commandArgs, {
      encoding: "utf-8",
      timeout: 2000,
    });
    if (result.status !== 0 || !result.stdout) {
      return [];
    }
    const tasks = JSON.parse(result.stdout) as TaskRecord[];
    const pending = tasks.filter((task) => task.status === "pending");
    pending.sort((a, b) => (b.urgency ?? 0) - (a.urgency ?? 0));
    return pending.slice(0, args.limit);
  } catch {
    return [];
  }
}

function detectProjectFromDir(workingDir: string): string | null {
  try {
    const result = spawnSync("git", ["-C", workingDir, "remote", "get-url", "origin"], {
      encoding: "utf-8",
      timeout: 2000,
    });
    if (result.status === 0 && result.stdout) {
      let remoteUrl = result.stdout.trim();
      if (remoteUrl.endsWith(".git")) {
        remoteUrl = remoteUrl.slice(0, -4);
      }
      let repoName = remoteUrl.split("/").pop() ?? "";
      if (repoName.includes(":") && repoName.includes("/")) {
        repoName = repoName.split("/").pop() ?? repoName;
      }
      if (repoName) {
        return repoName;
      }
    }
  } catch {
    // ignore
  }

  try {
    return basename(resolve(workingDir));
  } catch {
    return null;
  }
}

function parseDueTimestamp(due?: string): number | null {
  if (!due) {
    return null;
  }
  try {
    const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(due);
    if (!match) {
      return null;
    }
    const [year, month, day, hour, minute, second] = match.slice(1).map(Number);
    if (!year || !month || !day) {
      return null;
    }
    return Date.UTC(year, month - 1, day, hour ?? 0, minute ?? 0, second ?? 0) / 1000;
  } catch {
    return null;
  }
}

function formatTask(task: TaskRecord): string {
  const id = task.id ?? "?";
  const description = (task.description ?? "").slice(0, 50);
  return `#${id}: ${description}`;
}

export function getTaskContext(
  args: {
    limit?: number;
    workingDir?: string | null;
    includeOverdue?: boolean;
    includeDueSoon?: boolean;
  } = {},
): string | null {
  const limit = args.limit ?? 5;
  const includeOverdue = args.includeOverdue ?? true;
  const includeDueSoon = args.includeDueSoon ?? true;

  const project = args.workingDir ? detectProjectFromDir(args.workingDir) : null;
  const tasks = getNextTasks({ project, limit: limit * 2 });
  if (tasks.length === 0) {
    return null;
  }

  const overdue: TaskRecord[] = [];
  const dueToday: TaskRecord[] = [];
  const dueSoon: TaskRecord[] = [];
  const highPriority: TaskRecord[] = [];
  const other: TaskRecord[] = [];

  const now = Date.now() / 1000;
  const nowDate = new Date();
  const todayEnd =
    new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate(), 23, 59, 59).getTime() /
    1000;
  const tomorrowEnd =
    new Date(
      nowDate.getFullYear(),
      nowDate.getMonth(),
      nowDate.getDate() + 1,
      23,
      59,
      59,
    ).getTime() / 1000;

  for (const task of tasks) {
    const due = parseDueTimestamp(task.due);
    const priority = task.priority ?? "";
    const urgency = task.urgency ?? 0;

    if (due !== null) {
      if (due < now) {
        overdue.push(task);
      } else if (due <= todayEnd) {
        dueToday.push(task);
      } else if (due <= tomorrowEnd) {
        dueSoon.push(task);
      } else if (priority === "H" || urgency >= 10) {
        highPriority.push(task);
      } else {
        other.push(task);
      }
    } else if (priority === "H" || urgency >= 10) {
      highPriority.push(task);
    } else {
      other.push(task);
    }
  }

  const parts: string[] = [];

  if (overdue.length > 0 && includeOverdue) {
    parts.push(`Overdue: ${overdue.slice(0, 3).map(formatTask).join(", ")}`);
  }
  if (dueToday.length > 0) {
    parts.push(`Due today: ${dueToday.slice(0, 3).map(formatTask).join(", ")}`);
  }
  if (dueSoon.length > 0 && includeDueSoon) {
    parts.push(`Due soon: ${dueSoon.slice(0, 2).map(formatTask).join(", ")}`);
  }
  if (highPriority.length > 0) {
    parts.push(`High priority: ${highPriority.slice(0, 2).map(formatTask).join(", ")}`);
  }

  const used =
    Math.min(overdue.length, 3) +
    Math.min(dueToday.length, 3) +
    Math.min(dueSoon.length, 2) +
    Math.min(highPriority.length, 2);
  const remaining = limit - used;
  if (remaining > 0 && other.length > 0) {
    parts.push(`Other: ${other.slice(0, remaining).map(formatTask).join(", ")}`);
  }

  if (parts.length === 0) {
    return null;
  }
  return `Tasks: ${parts.join(" | ")}`;
}
