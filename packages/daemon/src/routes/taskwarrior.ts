import type { Hono } from "hono";

type TaskwarriorTask = {
  uuid: string;
  description: string;
  status: string;
  project?: string | null;
  tags?: string[];
  entry: string;
  modified?: string | null;
  end?: string | null;
  due?: string | null;
  urgency?: number;
};

export function registerTaskwarriorRoutes(app: Hono): void {
  app.get("/taskwarrior/tasks", async (c) => {
    const status = c.req.query("status");
    const project = c.req.query("project");
    const includeCompleted = c.req.query("include_completed") !== "false";

    const cmd: string[] = ["task"];
    if (status) {
      cmd.push(`status:${status}`);
    }
    if (project) {
      cmd.push(`project:${project}`);
    }
    cmd.push("export");

    try {
      const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);
      const exitCode = await proc.exited;

      if (exitCode !== 0) {
        return c.json({ error: `Taskwarrior error: ${stderr.trim()}` }, 500);
      }

      const raw = stdout.trim();
      const parsed = raw ? (JSON.parse(raw) as TaskwarriorTask[]) : [];
      let tasks = Array.isArray(parsed) ? parsed : [];

      let pendingCount = 0;
      let completedCount = 0;
      for (const task of tasks) {
        if (task.status === "pending") {
          pendingCount += 1;
        } else if (task.status === "completed") {
          completedCount += 1;
        }
      }

      if (!includeCompleted) {
        tasks = tasks.filter((task) => task.status !== "completed");
      }

      return c.json({
        tasks: tasks.map((task) => ({
          uuid: task.uuid ?? "",
          description: task.description ?? "",
          status: task.status ?? "pending",
          project: task.project ?? null,
          tags: task.tags ?? [],
          entry: task.entry ?? "",
          modified: task.modified ?? null,
          end: task.end ?? null,
          due: task.due ?? null,
          urgency: typeof task.urgency === "number" ? task.urgency : 0,
        })),
        pending_count: pendingCount,
        completed_count: completedCount,
      });
    } catch (error) {
      return c.json({ error: `Taskwarrior failure: ${String(error)}` }, 503);
    }
  });
}
