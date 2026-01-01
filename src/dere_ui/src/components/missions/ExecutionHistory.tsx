import { useState } from "react";
import { CheckCircle, XCircle, Clock, Loader2, ChevronDown, ChevronUp, Wrench } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useMissionExecutions } from "@/hooks/queries";
import type { MissionExecution } from "@/types/api";

interface ExecutionHistoryProps {
  missionId: number;
}

function formatDuration(start: string | null, end: string | null): string {
  if (!start) return "-";
  const startDate = new Date(start);
  const endDate = end ? new Date(end) : new Date();
  const diffMs = endDate.getTime() - startDate.getTime();
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function formatTime(dateStr: string | null): string {
  if (!dateStr) return "-";
  const date = new Date(dateStr);
  return date.toLocaleString();
}

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case "completed":
      return <CheckCircle className="h-4 w-4 text-green-500" />;
    case "failed":
      return <XCircle className="h-4 w-4 text-destructive" />;
    case "running":
      return <Loader2 className="h-4 w-4 animate-spin text-blue-500" />;
    default:
      return <Clock className="h-4 w-4 text-muted-foreground" />;
  }
}

function ExecutionRow({ execution }: { execution: MissionExecution }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border-b border-border last:border-0">
      <button
        className="flex w-full items-center gap-3 p-3 text-left hover:bg-accent/50"
        onClick={() => setExpanded(!expanded)}
      >
        <StatusIcon status={execution.status} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{formatTime(execution.started_at)}</span>
            <Badge variant="outline" className="text-xs">
              {execution.trigger_type}
            </Badge>
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
            <span>Duration: {formatDuration(execution.started_at, execution.completed_at)}</span>
            <span className="flex items-center gap-1">
              <Wrench className="h-3 w-3" />
              {execution.tool_count} tools
            </span>
          </div>
        </div>
        {expanded ? (
          <ChevronUp className="h-4 w-4 shrink-0" />
        ) : (
          <ChevronDown className="h-4 w-4 shrink-0" />
        )}
      </button>

      {expanded && (
        <div className="px-3 pb-3">
          {execution.error_message && (
            <div className="mb-2 rounded bg-destructive/10 p-2 text-sm text-destructive">
              {execution.error_message}
            </div>
          )}
          {execution.output_summary && (
            <div className="mb-2">
              <div className="text-xs font-medium text-muted-foreground mb-1">Summary</div>
              <p className="text-sm">{execution.output_summary}</p>
            </div>
          )}
          {execution.output_text && (
            <div>
              <div className="text-xs font-medium text-muted-foreground mb-1">Output</div>
              <ScrollArea className="h-48">
                <pre className="whitespace-pre-wrap text-xs bg-muted/50 p-2 rounded">
                  {execution.output_text}
                </pre>
              </ScrollArea>
            </div>
          )}
          {!execution.output_text && !execution.error_message && execution.status === "running" && (
            <p className="text-sm text-muted-foreground italic">Execution in progress...</p>
          )}
        </div>
      )}
    </div>
  );
}

export function ExecutionHistory({ missionId }: ExecutionHistoryProps) {
  const { data: executions, isLoading, isError } = useMissionExecutions(missionId);

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="py-8 text-center text-destructive">Failed to load execution history</div>
    );
  }

  if (!executions || executions.length === 0) {
    return <div className="py-8 text-center text-muted-foreground">No executions yet</div>;
  }

  return (
    <div className="rounded-lg border border-border bg-card">
      {executions.map((execution) => (
        <ExecutionRow key={execution.id} execution={execution} />
      ))}
    </div>
  );
}
