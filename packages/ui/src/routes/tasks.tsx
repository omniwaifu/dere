import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { CheckSquare, ArrowUpDown, Calendar, Tag, Folder } from "lucide-react";
import { useTasks } from "@/hooks/queries";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { TaskAnalytics } from "@/components/charts/TaskAnalytics";
import type { Task } from "@/types/api";

export const Route = createFileRoute("/tasks")({
  component: TasksPage,
});

type SortField = "urgency" | "due" | "entry" | "project";
type SortOrder = "asc" | "desc";

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "";
  const year = dateStr.slice(0, 4);
  const month = dateStr.slice(4, 6);
  const day = dateStr.slice(6, 8);
  return `${year}-${month}-${day}`;
}

function formatRelativeDate(dateStr: string | null): string {
  if (!dateStr) return "";
  const year = parseInt(dateStr.slice(0, 4));
  const month = parseInt(dateStr.slice(4, 6)) - 1;
  const day = parseInt(dateStr.slice(6, 8));
  const date = new Date(year, month, day);
  const now = new Date();
  const diffDays = Math.ceil((date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays < -7) return formatDate(dateStr);
  if (diffDays < -1) return `${Math.abs(diffDays)}d ago`;
  if (diffDays === -1) return "yesterday";
  if (diffDays === 0) return "today";
  if (diffDays === 1) return "tomorrow";
  if (diffDays < 7) return `in ${diffDays}d`;
  return formatDate(dateStr);
}

function TaskRow({ task }: { task: Task }) {
  const isOverdue = task.due && new Date(formatDate(task.due)) < new Date();

  return (
    <div className="flex items-center gap-4 rounded-lg border border-border bg-card p-3 hover:bg-accent/50">
      <div className="flex-1 min-w-0">
        <p className="font-medium truncate">{task.description}</p>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {task.project && (
            <span className="flex items-center gap-1">
              <Folder className="h-3 w-3" />
              {task.project}
            </span>
          )}
          {task.due && (
            <span className={`flex items-center gap-1 ${isOverdue ? "text-destructive" : ""}`}>
              <Calendar className="h-3 w-3" />
              {formatRelativeDate(task.due)}
            </span>
          )}
          {task.tags.length > 0 && (
            <span className="flex items-center gap-1">
              <Tag className="h-3 w-3" />
              {task.tags.join(", ")}
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Badge
          variant={task.urgency > 10 ? "destructive" : task.urgency > 5 ? "default" : "secondary"}
        >
          {task.urgency.toFixed(1)}
        </Badge>
      </div>
    </div>
  );
}

function TaskList() {
  const { data, isLoading, isError } = useTasks({ status: "pending" });
  const [sortField, setSortField] = useState<SortField>("urgency");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");

  const sortedTasks = useMemo(() => {
    const tasks = data?.tasks ?? [];
    if (tasks.length === 0) return [];
    return [...tasks].sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "urgency":
          cmp = a.urgency - b.urgency;
          break;
        case "due":
          cmp = (a.due || "9999").localeCompare(b.due || "9999");
          break;
        case "entry":
          cmp = a.entry.localeCompare(b.entry);
          break;
        case "project":
          cmp = (a.project || "").localeCompare(b.project || "");
          break;
      }
      return sortOrder === "desc" ? -cmp : cmp;
    });
  }, [data, sortField, sortOrder]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortOrder("desc");
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <p className="text-destructive">Failed to load tasks</p>
        <p className="text-sm text-muted-foreground mt-1">
          Make sure Taskwarrior is installed and the daemon is running
        </p>
      </div>
    );
  }

  if (sortedTasks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <CheckSquare className="h-12 w-12 text-muted-foreground/50" />
        <p className="mt-4 text-muted-foreground">No pending tasks</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">Sort by:</span>
        <Button
          variant={sortField === "urgency" ? "secondary" : "ghost"}
          size="sm"
          onClick={() => toggleSort("urgency")}
          className="gap-1"
        >
          Urgency
          {sortField === "urgency" && <ArrowUpDown className="h-3 w-3" />}
        </Button>
        <Button
          variant={sortField === "due" ? "secondary" : "ghost"}
          size="sm"
          onClick={() => toggleSort("due")}
          className="gap-1"
        >
          Due
          {sortField === "due" && <ArrowUpDown className="h-3 w-3" />}
        </Button>
        <Button
          variant={sortField === "project" ? "secondary" : "ghost"}
          size="sm"
          onClick={() => toggleSort("project")}
          className="gap-1"
        >
          Project
          {sortField === "project" && <ArrowUpDown className="h-3 w-3" />}
        </Button>
      </div>

      <ScrollArea className="h-[calc(100vh-16rem)]">
        <div className="space-y-2 pr-4">
          {sortedTasks.map((task) => (
            <TaskRow key={task.uuid} task={task} />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

function TasksPage() {
  const { data: pendingData } = useTasks({ status: "pending" });
  const { data: allData, isLoading: allLoading } = useTasks({ include_completed: true });

  return (
    <div className="flex flex-1 flex-col p-6">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <CheckSquare className="h-6 w-6" />
          <h1 className="text-2xl font-semibold">Tasks</h1>
        </div>
        {pendingData && (
          <div className="text-sm text-muted-foreground">{pendingData.pending_count} pending</div>
        )}
      </div>

      <Tabs defaultValue="list" className="flex-1">
        <TabsList>
          <TabsTrigger value="list">List</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
        </TabsList>

        <TabsContent value="list" className="mt-4">
          <TaskList />
        </TabsContent>

        <TabsContent value="analytics" className="mt-4">
          {allLoading ? (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-56 w-full" />
              ))}
            </div>
          ) : allData ? (
            <TaskAnalytics tasks={allData.tasks} />
          ) : null}
        </TabsContent>
      </Tabs>
    </div>
  );
}
