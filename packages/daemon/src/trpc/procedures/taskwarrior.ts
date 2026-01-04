import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure } from "../init.js";

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

export const taskwarriorRouter = router({
  tasks: publicProcedure
    .input(
      z
        .object({
          status: z.string().optional(),
          project: z.string().optional(),
          include_completed: z.boolean().optional().default(true),
        })
        .optional()
    )
    .query(async ({ input }) => {
      const status = input?.status;
      const project = input?.project;
      const includeCompleted = input?.include_completed ?? true;

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
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: `Taskwarrior error: ${stderr.trim()}`,
          });
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

        return {
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
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Taskwarrior failure: ${String(error)}`,
        });
      }
    }),
});
