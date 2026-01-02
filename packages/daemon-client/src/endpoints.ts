import type { DaemonClientOptions } from "./client.js";
import type { QueryParamsFor, RequestBodyFor } from "./types.js";
import { createDaemonClient } from "./client.js";

export function createDaemonApi(options: DaemonClientOptions) {
  const client = createDaemonClient(options);

  const agent = {
    listSessions: () => client.request("/agent/sessions", "get"),
    getSession: (sessionId: number) =>
      client.request("/agent/sessions/{session_id}", "get", {
        pathParams: { session_id: sessionId },
      }),
    updateSession: (
      sessionId: number,
      body: RequestBodyFor<"/agent/sessions/{session_id}", "patch">,
    ) =>
      client.request("/agent/sessions/{session_id}", "patch", {
        pathParams: { session_id: sessionId },
        body,
      }),
    deleteSession: (sessionId: number) =>
      client.request("/agent/sessions/{session_id}", "delete", {
        pathParams: { session_id: sessionId },
      }),
    getSessionMessages: (sessionId: number) =>
      client.request("/agent/sessions/{session_id}/messages", "get", {
        pathParams: { session_id: sessionId },
      }),
    getSessionMetrics: (sessionId: number) =>
      client.request("/agent/sessions/{session_id}/metrics", "get", {
        pathParams: { session_id: sessionId },
      }),
    generateSessionName: (sessionId: number) =>
      client.request("/agent/sessions/{session_id}/generate-name", "post", {
        pathParams: { session_id: sessionId },
      }),
    renameSession: (sessionId: number, name: string) =>
      client.request("/agent/sessions/{session_id}/name", "patch", {
        pathParams: { session_id: sessionId },
        body: { name },
      }),
  };

  const workQueue = {
    createTask: (body: RequestBodyFor<"/work-queue/tasks", "post">) =>
      client.request("/work-queue/tasks", "post", { body }),
    listTasks: (query?: QueryParamsFor<"/work-queue/tasks", "get">) =>
      query === undefined
        ? client.request("/work-queue/tasks", "get")
        : client.request("/work-queue/tasks", "get", { query }),
    readyTasks: (query?: QueryParamsFor<"/work-queue/tasks/ready", "get">) =>
      query === undefined
        ? client.request("/work-queue/tasks/ready", "get")
        : client.request("/work-queue/tasks/ready", "get", { query }),
    getTask: (taskId: number) =>
      client.request("/work-queue/tasks/{task_id}", "get", { pathParams: { task_id: taskId } }),
    claimTask: (
      taskId: number,
      body: RequestBodyFor<"/work-queue/tasks/{task_id}/claim", "post">,
    ) =>
      client.request("/work-queue/tasks/{task_id}/claim", "post", {
        pathParams: { task_id: taskId },
        body,
      }),
    releaseTask: (
      taskId: number,
      body: RequestBodyFor<"/work-queue/tasks/{task_id}/release", "post">,
    ) =>
      client.request("/work-queue/tasks/{task_id}/release", "post", {
        pathParams: { task_id: taskId },
        body,
      }),
    updateTask: (
      taskId: number,
      body: RequestBodyFor<"/work-queue/tasks/{task_id}", "patch">,
    ) =>
      client.request("/work-queue/tasks/{task_id}", "patch", {
        pathParams: { task_id: taskId },
        body,
      }),
    deleteTask: (taskId: number) =>
      client.request("/work-queue/tasks/{task_id}", "delete", { pathParams: { task_id: taskId } }),
  };

  const notifications = {
    create: (body: RequestBodyFor<"/notifications/create", "post">) =>
      client.request("/notifications/create", "post", { body }),
    recent: (query?: QueryParamsFor<"/notifications/recent", "get">) =>
      query === undefined
        ? client.request("/notifications/recent", "get")
        : client.request("/notifications/recent", "get", { query }),
    pending: (query?: QueryParamsFor<"/notifications/pending", "get">) =>
      query === undefined
        ? client.request("/notifications/pending", "get")
        : client.request("/notifications/pending", "get", { query }),
    recentUnacknowledged: (body: RequestBodyFor<"/notifications/recent_unacknowledged", "post">) =>
      client.request("/notifications/recent_unacknowledged", "post", { body }),
    markDelivered: (notificationId: number) =>
      client.request("/notifications/{notification_id}/delivered", "post", {
        pathParams: { notification_id: notificationId },
      }),
    acknowledge: (notificationId: number) =>
      client.request("/notifications/{notification_id}/acknowledge", "post", {
        pathParams: { notification_id: notificationId },
      }),
    markFailed: (
      notificationId: number,
      body: RequestBodyFor<"/notifications/{notification_id}/failed", "post">,
    ) =>
      client.request("/notifications/{notification_id}/failed", "post", {
        pathParams: { notification_id: notificationId },
        body,
      }),
  };

  const presence = {
    register: (body: RequestBodyFor<"/presence/register", "post">) =>
      client.request("/presence/register", "post", { body }),
    heartbeat: (body: RequestBodyFor<"/presence/heartbeat", "post">) =>
      client.request("/presence/heartbeat", "post", { body }),
    unregister: (body: RequestBodyFor<"/presence/unregister", "post">) =>
      client.request("/presence/unregister", "post", { body }),
    available: (query?: QueryParamsFor<"/presence/available", "get">) =>
      query === undefined
        ? client.request("/presence/available", "get")
        : client.request("/presence/available", "get", { query }),
  };

  const ambient = {
    dashboard: (query?: QueryParamsFor<"/ambient/dashboard", "get">) =>
      query === undefined
        ? client.request("/ambient/dashboard", "get")
        : client.request("/ambient/dashboard", "get", { query }),
  };

  const routing = {
    decide: (body: RequestBodyFor<"/routing/decide", "post">) =>
      client.request("/routing/decide", "post", { body }),
  };

  const activity = {
    state: (query?: QueryParamsFor<"/activity/state", "get">) =>
      query === undefined
        ? client.request("/activity/state", "get")
        : client.request("/activity/state", "get", { query }),
  };

  const taskwarrior = {
    tasks: (query?: QueryParamsFor<"/taskwarrior/tasks", "get">) =>
      query === undefined
        ? client.request("/taskwarrior/tasks", "get")
        : client.request("/taskwarrior/tasks", "get", { query }),
  };

  const emotion = {
    state: () => client.request("/emotion/state", "get"),
    summary: () => client.request("/emotion/summary", "get"),
    history: (query?: QueryParamsFor<"/emotion/history", "get">) =>
      query === undefined
        ? client.request("/emotion/history", "get")
        : client.request("/emotion/history", "get", { query }),
    historyDb: (query?: QueryParamsFor<"/emotion/history/db", "get">) =>
      query === undefined
        ? client.request("/emotion/history/db", "get")
        : client.request("/emotion/history/db", "get", { query }),
    profile: () => client.request("/emotion/profile", "get"),
  };

  const exploration = {
    queue: (body: RequestBodyFor<"/exploration/queue", "post">) =>
      client.request("/exploration/queue", "post", { body }),
  };

  const metrics = {
    exploration: (query?: QueryParamsFor<"/metrics/exploration", "get">) =>
      query === undefined
        ? client.request("/metrics/exploration", "get")
        : client.request("/metrics/exploration", "get", { query }),
  };

  const recall = {
    search: (query?: QueryParamsFor<"/recall/search", "get">) =>
      query === undefined
        ? client.request("/recall/search", "get")
        : client.request("/recall/search", "get", { query }),
    markFindingSurfaced: (body: RequestBodyFor<"/recall/findings/surface", "post">) =>
      client.request("/recall/findings/surface", "post", { body }),
  };

  const dashboard = {
    state: () => client.request("/dashboard/state", "get"),
  };

  const coreMemory = {
    list: (query?: QueryParamsFor<"/memory/core", "get">) =>
      query === undefined
        ? client.request("/memory/core", "get")
        : client.request("/memory/core", "get", { query }),
    edit: (body: RequestBodyFor<"/memory/core/edit", "post">) =>
      client.request("/memory/core/edit", "post", { body }),
    history: (query?: QueryParamsFor<"/memory/core/history", "get">) =>
      query === undefined
        ? client.request("/memory/core/history", "get")
        : client.request("/memory/core/history", "get", { query }),
    rollback: (body: RequestBodyFor<"/memory/core/rollback", "post">) =>
      client.request("/memory/core/rollback", "post", { body }),
    consolidationRuns: (query?: QueryParamsFor<"/memory/consolidation/runs", "get">) =>
      query === undefined
        ? client.request("/memory/consolidation/runs", "get")
        : client.request("/memory/consolidation/runs", "get", { query }),
  };

  const missions = {
    create: (body: RequestBodyFor<"/missions", "post">) =>
      client.request("/missions", "post", { body }),
    list: (query?: QueryParamsFor<"/missions", "get">) =>
      query === undefined
        ? client.request("/missions", "get")
        : client.request("/missions", "get", { query }),
    get: (missionId: number) =>
      client.request("/missions/{mission_id}", "get", { pathParams: { mission_id: missionId } }),
    update: (
      missionId: number,
      body: RequestBodyFor<"/missions/{mission_id}", "patch">,
    ) =>
      client.request("/missions/{mission_id}", "patch", {
        pathParams: { mission_id: missionId },
        body,
      }),
    delete: (missionId: number) =>
      client.request("/missions/{mission_id}", "delete", { pathParams: { mission_id: missionId } }),
    pause: (missionId: number) =>
      client.request("/missions/{mission_id}/pause", "post", {
        pathParams: { mission_id: missionId },
      }),
    resume: (missionId: number) =>
      client.request("/missions/{mission_id}/resume", "post", {
        pathParams: { mission_id: missionId },
      }),
    execute: (missionId: number) =>
      client.request("/missions/{mission_id}/execute", "post", {
        pathParams: { mission_id: missionId },
      }),
    executions: (
      missionId: number,
      query?: QueryParamsFor<"/missions/{mission_id}/executions", "get">,
    ) =>
      query === undefined
        ? client.request("/missions/{mission_id}/executions", "get", {
            pathParams: { mission_id: missionId },
          })
        : client.request("/missions/{mission_id}/executions", "get", {
            pathParams: { mission_id: missionId },
            query,
          }),
    execution: (missionId: number, executionId: number) =>
      client.request("/missions/{mission_id}/executions/{execution_id}", "get", {
        pathParams: { mission_id: missionId, execution_id: executionId },
      }),
  };

  const memory = {
    consolidate: (query?: QueryParamsFor<"/api/consolidate/memory", "post">) =>
      query === undefined
        ? client.request("/api/consolidate/memory", "post")
        : client.request("/api/consolidate/memory", "post", { query }),
  };

  return {
    client,
    getConfig: () => client.request("/config", "get"),
    updateConfig: (body: RequestBodyFor<"/config", "post">) =>
      client.request("/config", "post", { body }),
    getConfigSchema: () => client.request("/config/schema", "get"),

    listModels: () => client.request("/agent/models", "get"),
    listOutputStyles: () => client.request("/agent/output-styles", "get"),
    listPersonalities: () => client.request("/agent/personalities", "get"),
    listRecentDirectories: () => client.request("/agent/recent-directories", "get"),

    agent,
    workQueue,
    notifications,
    presence,
    ambient,
    routing,
    activity,
    taskwarrior,
    emotion,
    exploration,
    metrics,
    recall,
    dashboard,
    coreMemory,
    missions,
    memory,
  };
}
