export interface TaskwarriorTask {
  uuid?: string;
  description?: string;
  status?: string;
  project?: string | null;
  tags?: string[];
  entry?: string;
  modified?: string | null;
  end?: string | null;
  due?: string | null;
  urgency?: number;
}

function parseTaskwarriorDate(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(value);
  if (!match) {
    return null;
  }
  const [, year, month, day, hour, minute, second] = match;
  return Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  );
}

function taskLabel(task: TaskwarriorTask): string {
  const id = task.uuid ? task.uuid.slice(0, 8) : "task";
  const description = task.description ?? "";
  return `#${id}: ${description.slice(0, 50)}`;
}

export function buildTaskContext(
  tasks: TaskwarriorTask[],
  limit: number,
  includeOverdue: boolean,
  includeDueSoon: boolean,
): string | null {
  const pending = tasks.filter((task) => (task.status ?? "pending") === "pending");
  if (pending.length === 0) {
    return null;
  }

  const overdueTasks: TaskwarriorTask[] = [];
  const dueTodayTasks: TaskwarriorTask[] = [];
  const dueSoonTasks: TaskwarriorTask[] = [];
  const highPriorityTasks: TaskwarriorTask[] = [];
  const otherTasks: TaskwarriorTask[] = [];

  const now = Date.now();
  const today = new Date();
  const todayEnd = Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate(),
    23,
    59,
    59,
  );
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const tomorrowEnd = Date.UTC(
    tomorrow.getUTCFullYear(),
    tomorrow.getUTCMonth(),
    tomorrow.getUTCDate(),
    23,
    59,
    59,
  );

  for (const task of pending) {
    const dueTimestamp = parseTaskwarriorDate(task.due ?? null);
    const urgency = Number(task.urgency ?? 0);
    const priorityHigh = urgency >= 10;

    if (dueTimestamp) {
      if (dueTimestamp < now) {
        overdueTasks.push(task);
      } else if (dueTimestamp <= todayEnd) {
        dueTodayTasks.push(task);
      } else if (dueTimestamp <= tomorrowEnd) {
        dueSoonTasks.push(task);
      } else if (priorityHigh) {
        highPriorityTasks.push(task);
      } else {
        otherTasks.push(task);
      }
    } else if (priorityHigh) {
      highPriorityTasks.push(task);
    } else {
      otherTasks.push(task);
    }
  }

  const parts: string[] = [];

  if (includeOverdue && overdueTasks.length > 0) {
    parts.push(`Overdue: ${overdueTasks.slice(0, 3).map(taskLabel).join(", ")}`);
  }

  if (dueTodayTasks.length > 0) {
    parts.push(`Due today: ${dueTodayTasks.slice(0, 3).map(taskLabel).join(", ")}`);
  }

  if (includeDueSoon && dueSoonTasks.length > 0) {
    parts.push(`Due soon: ${dueSoonTasks.slice(0, 2).map(taskLabel).join(", ")}`);
  }

  if (highPriorityTasks.length > 0) {
    parts.push(`High priority: ${highPriorityTasks.slice(0, 2).map(taskLabel).join(", ")}`);
  }

  const used =
    overdueTasks.slice(0, 3).length +
    dueTodayTasks.slice(0, 3).length +
    dueSoonTasks.slice(0, 2).length +
    highPriorityTasks.slice(0, 2).length;

  const remainingSlots = Math.max(limit - used, 0);
  if (remainingSlots > 0 && otherTasks.length > 0) {
    const remaining = otherTasks.slice(0, remainingSlots).map(taskLabel).join(", ");
    parts.push(`Tasks: ${remaining}`);
  }

  return parts.length > 0 ? parts.join("\n") : null;
}
