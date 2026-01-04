import {
  Play,
  Pause,
  Trash2,
  MoreHorizontal,
  Clock,
  Calendar,
  Loader2,
  PlayCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  useMissions,
  useDeleteMission,
  usePauseMission,
  useResumeMission,
  useExecuteMission,
} from "@/hooks/queries";
import type { Mission } from "@/types/api";

interface MissionListProps {
  onSelect?: (mission: Mission) => void;
  selectedId?: number;
}

function formatNextRun(dateStr: string | null): string {
  if (!dateStr) return "Not scheduled";
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 0) return "Overdue";
  if (diffMins < 60) return `in ${diffMins}m`;
  if (diffHours < 24) return `in ${diffHours}h`;
  if (diffDays < 7) return `in ${diffDays}d`;
  return date.toLocaleDateString();
}

function MissionRow({
  mission,
  isSelected,
  onSelect,
}: {
  mission: Mission;
  isSelected: boolean;
  onSelect?: (mission: Mission) => void;
}) {
  const deleteMission = useDeleteMission();
  const pauseMission = usePauseMission();
  const resumeMission = useResumeMission();
  const executeMission = useExecuteMission();

  const isPaused = mission.status === "paused";
  const isExecuting = executeMission.isPending;

  const handleToggleStatus = () => {
    if (isPaused) {
      resumeMission.mutate(mission.id);
    } else {
      pauseMission.mutate(mission.id);
    }
  };

  const handleExecute = () => {
    executeMission.mutate(mission.id);
  };

  const handleDelete = () => {
    if (confirm(`Delete mission "${mission.name}"?`)) {
      deleteMission.mutate(mission.id);
    }
  };

  return (
    <div
      className={`flex items-center gap-4 rounded-lg border p-4 transition-colors cursor-pointer hover:bg-accent/50 ${
        isSelected ? "border-primary bg-accent" : "border-border bg-card"
      }`}
      onClick={() => onSelect?.(mission)}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium truncate">{mission.name}</span>
          <Badge variant={isPaused ? "secondary" : "default"} className="shrink-0">
            {mission.status}
          </Badge>
        </div>
        {mission.description && (
          <p className="mt-1 text-sm text-muted-foreground truncate">{mission.description}</p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {mission.natural_language_schedule || mission.cron_expression}
          </span>
          <span className="flex items-center gap-1">
            <Calendar className="h-3 w-3" />
            Next: {formatNextRun(mission.next_execution_at)}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
        <Button
          variant="ghost"
          size="icon"
          onClick={handleExecute}
          disabled={isExecuting}
          title="Run now"
        >
          {isExecuting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <PlayCircle className="h-4 w-4" />
          )}
        </Button>

        <Button
          variant="ghost"
          size="icon"
          onClick={handleToggleStatus}
          title={isPaused ? "Resume" : "Pause"}
        >
          {isPaused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={handleDelete} className="text-destructive">
              <Trash2 className="mr-2 h-4 w-4" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

export function MissionList({ onSelect, selectedId }: MissionListProps) {
  const { data: missions, isLoading, isError } = useMissions();

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <p className="text-destructive">Failed to load missions</p>
      </div>
    );
  }

  if (!missions || missions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <Clock className="h-12 w-12 text-muted-foreground/50" />
        <p className="mt-4 text-muted-foreground">No missions yet</p>
        <p className="text-sm text-muted-foreground">
          Create one to schedule autonomous agent tasks
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {missions.map((mission) => (
        <MissionRow
          key={mission.id}
          mission={mission}
          isSelected={selectedId === mission.id}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}
