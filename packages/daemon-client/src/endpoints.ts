import type { DaemonClientOptions } from "./client.js";
import { createDaemonClient } from "./client.js";

export function createDaemonApi(options: DaemonClientOptions) {
  const client = createDaemonClient(options);

  const agent = {
    listSessions: () => client.request("/agent/sessions", "get"),
    getSession: (sessionId: number) =>
      client.request("/agent/sessions/{session_id}", "get", {
        pathParams: { session_id: sessionId },
      }),
    updateSession: (sessionId: number, body: unknown) =>
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
    createTask: (body: unknown) => client.request("/work-queue/tasks", "post", { body }),
    listTasks: (query?: Record<string, unknown>) =>
      client.request("/work-queue/tasks", "get", { query }),
    readyTasks: (query?: Record<string, unknown>) =>
      client.request("/work-queue/tasks/ready", "get", { query }),
    getTask: (taskId: number) =>
      client.request("/work-queue/tasks/{task_id}", "get", { pathParams: { task_id: taskId } }),
    claimTask: (taskId: number, body: unknown) =>
      client.request("/work-queue/tasks/{task_id}/claim", "post", {
        pathParams: { task_id: taskId },
        body,
      }),
    releaseTask: (taskId: number, body: unknown) =>
      client.request("/work-queue/tasks/{task_id}/release", "post", {
        pathParams: { task_id: taskId },
        body,
      }),
    updateTask: (taskId: number, body: unknown) =>
      client.request("/work-queue/tasks/{task_id}", "patch", {
        pathParams: { task_id: taskId },
        body,
      }),
    deleteTask: (taskId: number) =>
      client.request("/work-queue/tasks/{task_id}", "delete", { pathParams: { task_id: taskId } }),
  };

  const notifications = {
    create: (body: unknown) => client.request("/notifications/create", "post", { body }),
    recent: (query?: Record<string, unknown>) =>
      client.request("/notifications/recent", "get", { query }),
    pending: (query?: Record<string, unknown>) =>
      client.request("/notifications/pending", "get", { query }),
    recentUnacknowledged: (body: unknown) =>
      client.request("/notifications/recent_unacknowledged", "post", { body }),
    markDelivered: (notificationId: number) =>
      client.request("/notifications/{notification_id}/delivered", "post", {
        pathParams: { notification_id: notificationId },
      }),
    acknowledge: (notificationId: number) =>
      client.request("/notifications/{notification_id}/acknowledge", "post", {
        pathParams: { notification_id: notificationId },
      }),
    markFailed: (notificationId: number, body: unknown) =>
      client.request("/notifications/{notification_id}/failed", "post", {
        pathParams: { notification_id: notificationId },
        body,
      }),
  };

  const presence = {
    register: (body: unknown) => client.request("/presence/register", "post", { body }),
    heartbeat: (body: unknown) => client.request("/presence/heartbeat", "post", { body }),
    unregister: (body: unknown) => client.request("/presence/unregister", "post", { body }),
    available: (query?: Record<string, unknown>) =>
      client.request("/presence/available", "get", { query }),
  };

  const ambient = {
    dashboard: (query?: Record<string, unknown>) =>
      client.request("/ambient/dashboard", "get", { query }),
  };

  const routing = {
    decide: (body: unknown) => client.request("/routing/decide", "post", { body }),
  };

  const activity = {
    state: (query?: Record<string, unknown>) => client.request("/activity/state", "get", { query }),
  };

  const taskwarrior = {
    tasks: (query?: Record<string, unknown>) =>
      client.request("/taskwarrior/tasks", "get", { query }),
  };

  const emotion = {
    state: () => client.request("/emotion/state", "get"),
    summary: () => client.request("/emotion/summary", "get"),
    history: (query?: Record<string, unknown>) =>
      client.request("/emotion/history", "get", { query }),
    historyDb: (query?: Record<string, unknown>) =>
      client.request("/emotion/history/db", "get", { query }),
    profile: () => client.request("/emotion/profile", "get"),
  };

  const exploration = {
    queue: (body: unknown) => client.request("/exploration/queue", "post", { body }),
  };

  const metrics = {
    exploration: (query?: Record<string, unknown>) =>
      client.request("/metrics/exploration", "get", { query }),
  };

  const recall = {
    search: (query?: Record<string, unknown>) => client.request("/recall/search", "get", { query }),
    markFindingSurfaced: (body: unknown) =>
      client.request("/recall/findings/surface", "post", { body }),
  };

  const dashboard = {
    state: () => client.request("/dashboard/state", "get"),
  };

  const coreMemory = {
    list: (query?: Record<string, unknown>) => client.request("/memory/core", "get", { query }),
    edit: (body: unknown) => client.request("/memory/core/edit", "post", { body }),
    history: (query?: Record<string, unknown>) =>
      client.request("/memory/core/history", "get", { query }),
    rollback: (body: unknown) => client.request("/memory/core/rollback", "post", { body }),
    consolidationRuns: (query?: Record<string, unknown>) =>
      client.request("/memory/consolidation/runs", "get", { query }),
  };

  const missions = {
    create: (body: unknown) => client.request("/missions", "post", { body }),
    list: (query?: Record<string, unknown>) => client.request("/missions", "get", { query }),
    get: (missionId: number) =>
      client.request("/missions/{mission_id}", "get", { pathParams: { mission_id: missionId } }),
    update: (missionId: number, body: unknown) =>
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
    executions: (missionId: number, query?: Record<string, unknown>) =>
      client.request("/missions/{mission_id}/executions", "get", {
        pathParams: { mission_id: missionId },
        query,
      }),
    execution: (missionId: number, executionId: number) =>
      client.request("/missions/{mission_id}/executions/{execution_id}", "get", {
        pathParams: { mission_id: missionId, execution_id: executionId },
      }),
  };

  const memory = {
    consolidate: (query?: Record<string, unknown>) =>
      client.request("/api/consolidate/memory", "post", { query }),
  };

  return {
    client,
    getConfig: () => client.request("/config", "get"),
    updateConfig: (body: unknown) => client.request("/config", "post", { body }),
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
