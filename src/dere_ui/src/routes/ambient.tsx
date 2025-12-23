import { createFileRoute } from "@tanstack/react-router";
import { Activity, Bell, Clock, Radio, RefreshCw } from "lucide-react";
import { useAmbientDashboard } from "@/hooks/queries";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { AmbientRunSummary, AmbientNotificationSummary } from "@/types/api";

export const Route = createFileRoute("/ambient")({
  component: AmbientPage,
});

function AmbientPage() {
  const { data, isLoading, isError, refetch, isFetching } = useAmbientDashboard();

  const formatTime = (value: string | null) => {
    if (!value) return "-";
    const date = new Date(value);
    return date.toLocaleString();
  };

  const formatInterval = (value: number | [number, number]) => {
    if (Array.isArray(value)) {
      return `${value[0]}-${value[1]}m`;
    }
    return `${value}m`;
  };

  const renderStatusBadge = (status: string) => {
    const variant =
      status === "completed" ? "secondary" : status === "failed" ? "destructive" : "outline";
    return (
      <Badge variant={variant} className="capitalize">
        {status}
      </Badge>
    );
  };

  const renderRun = (run: AmbientRunSummary) => {
    const sentBadge =
      run.send === null ? (
        <Badge variant="outline">unknown</Badge>
      ) : run.send ? (
        <Badge>sent</Badge>
      ) : (
        <Badge variant="outline">no send</Badge>
      );

    return (
      <div
        key={run.execution_id}
        className="rounded-lg border border-border bg-card p-3"
      >
        <div className="flex flex-wrap items-center gap-2">
          {renderStatusBadge(run.status)}
          {sentBadge}
          {run.priority && (
            <Badge variant="outline" className="uppercase">
              {run.priority}
            </Badge>
          )}
          {run.confidence !== null && (
            <Badge variant="outline">{Math.round(run.confidence * 100)}%</Badge>
          )}
        </div>
        <p className="mt-2 text-sm text-foreground/90">
          {run.message_preview || "No message returned."}
        </p>
        <div className="mt-2 text-xs text-muted-foreground">
          {formatTime(run.started_at)}
        </div>
      </div>
    );
  };

  const renderNotification = (notification: AmbientNotificationSummary) => {
    const contextSnapshot = notification.context_snapshot as
      | { activity?: { app?: string; player?: string; title?: string }; minutes_idle?: number }
      | null;
    const activity = contextSnapshot?.activity;
    const activityLabel = activity ? activity.app || activity.player : null;
    const minutesIdle =
      typeof contextSnapshot?.minutes_idle === "number"
        ? `${contextSnapshot.minutes_idle}m idle`
        : null;

    return (
      <div
        key={notification.notification_id}
        className="rounded-lg border border-border bg-card p-3"
      >
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="uppercase">
            {notification.priority}
          </Badge>
          <Badge variant={notification.status === "delivered" ? "secondary" : "outline"}>
            {notification.status}
          </Badge>
          {notification.acknowledged && <Badge variant="secondary">acknowledged</Badge>}
        </div>
        <p className="mt-2 text-sm text-foreground/90">{notification.message}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>{formatTime(notification.created_at)}</span>
          <span>
            {notification.target_medium}:{notification.target_location}
          </span>
          {activityLabel && <span>{activityLabel}</span>}
          {minutesIdle && <span>{minutesIdle}</span>}
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Radio className="h-6 w-6" />
          <div>
            <h1 className="text-2xl font-semibold">Ambient Monitor</h1>
            <p className="text-sm text-muted-foreground">
              Live status, recent runs, and notification history.
            </p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
          className="gap-2"
        >
          <RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {isLoading && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-32 w-full" />
          ))}
        </div>
      )}

      {isError && (
        <Card>
          <CardContent className="p-6 text-sm text-destructive">
            Failed to load ambient dashboard data.
          </CardContent>
        </Card>
      )}

      {!isLoading && data && (
        <>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">FSM State</CardTitle>
                <Activity className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-semibold capitalize">
                  {data.summary.fsm_state}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Ambient is {data.summary.is_enabled ? "enabled" : "disabled"}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Last Run</CardTitle>
                <Clock className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-lg font-semibold">
                  {formatTime(data.summary.last_run_at)}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {data.recent_runs[0]?.status
                    ? `Status: ${data.recent_runs[0].status}`
                    : "No runs yet"}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Last Notification</CardTitle>
                <Bell className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-lg font-semibold">
                  {formatTime(data.summary.last_notification_at)}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {data.recent_notifications[0]?.status
                    ? `Status: ${data.recent_notifications[0].status}`
                    : "No notifications yet"}
                </p>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Recent Runs</CardTitle>
                <CardDescription>Latest ambient mission decisions.</CardDescription>
              </CardHeader>
              <CardContent>
                {data.recent_runs.length === 0 ? (
                  <div className="text-sm text-muted-foreground">No runs recorded yet.</div>
                ) : (
                  <ScrollArea className="h-[320px] pr-4">
                    <div className="space-y-3">
                      {data.recent_runs.map(renderRun)}
                    </div>
                  </ScrollArea>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Recent Notifications</CardTitle>
                <CardDescription>Ambient messages routed to you.</CardDescription>
              </CardHeader>
              <CardContent>
                {data.recent_notifications.length === 0 ? (
                  <div className="text-sm text-muted-foreground">
                    No notifications yet.
                  </div>
                ) : (
                  <ScrollArea className="h-[320px] pr-4">
                    <div className="space-y-3">
                      {data.recent_notifications.map(renderNotification)}
                    </div>
                  </ScrollArea>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Configuration</CardTitle>
              <CardDescription>Key ambient settings currently in effect.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 text-sm">
              <div className="space-y-1">
                <div className="text-xs uppercase text-muted-foreground">Persona</div>
                <div className="font-medium">{data.config.personality}</div>
              </div>
              <div className="space-y-1">
                <div className="text-xs uppercase text-muted-foreground">Notify</div>
                <div className="font-medium">{data.config.notification_method}</div>
              </div>
              <div className="space-y-1">
                <div className="text-xs uppercase text-muted-foreground">Idle Threshold</div>
                <div className="font-medium">{data.config.idle_threshold_minutes}m</div>
              </div>
              <div className="space-y-1">
                <div className="text-xs uppercase text-muted-foreground">Min Interval</div>
                <div className="font-medium">
                  {data.config.min_notification_interval_minutes}m
                </div>
              </div>
              <div className="space-y-1">
                <div className="text-xs uppercase text-muted-foreground">Activity Lookback</div>
                <div className="font-medium">{data.config.activity_lookback_hours}h</div>
              </div>
              <div className="space-y-1">
                <div className="text-xs uppercase text-muted-foreground">Escalation</div>
                <div className="font-medium">
                  {data.config.escalation_enabled
                    ? `${data.config.escalation_lookback_hours}h`
                    : "off"}
                </div>
              </div>
              <div className="space-y-1 md:col-span-2 lg:col-span-3">
                <div className="text-xs uppercase text-muted-foreground">FSM Intervals</div>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(data.config.fsm_intervals).map(([key, value]) => (
                    <Badge key={key} variant="outline" className="capitalize">
                      {key}: {formatInterval(value)}
                    </Badge>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
