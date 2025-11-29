import { useState, useEffect, useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CheckSquare,
  Heart,
  Radio,
  ExternalLink,
  PanelRight,
  PanelRightClose,
} from "lucide-react";
import { useTasks } from "@/hooks/queries";
import { LineChart, Line, ResponsiveContainer } from "recharts";

interface WidgetProps {
  title: string;
  icon: React.ReactNode;
  href: string;
  children: React.ReactNode;
}

function Widget({ title, icon, href, children }: WidgetProps) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {icon}
          <h3 className="text-sm font-medium">{title}</h3>
        </div>
        <Link to={href}>
          <Button variant="ghost" size="icon" className="h-6 w-6">
            <ExternalLink className="h-3 w-3" />
          </Button>
        </Link>
      </div>
      {children}
    </div>
  );
}

export function RightPanel() {
  const [isCollapsed, setIsCollapsed] = useState(() =>
    localStorage.getItem("right-panel-collapsed") === "true"
  );

  useEffect(() => {
    localStorage.setItem("right-panel-collapsed", String(isCollapsed));
  }, [isCollapsed]);

  if (isCollapsed) {
    return (
      <aside className="flex w-12 flex-col border-l border-border bg-muted/30">
        <div className="flex h-12 items-center justify-center">
          <button
            onClick={() => setIsCollapsed(false)}
            className="group flex h-8 w-8 cursor-pointer items-center justify-center rounded-md hover:bg-accent"
            title="Expand panel"
          >
            <PanelRight className="h-4 w-4" />
          </button>
        </div>
        <div className="flex flex-1 flex-col items-center gap-2 pt-2">
          <Link to="/tasks" className="rounded-md p-2 hover:bg-accent" title="Tasks">
            <CheckSquare className="h-4 w-4 text-muted-foreground" />
          </Link>
          <Link to="/emotion" className="rounded-md p-2 hover:bg-accent" title="Emotion">
            <Heart className="h-4 w-4 text-muted-foreground" />
          </Link>
          <Link to="/ambient" className="rounded-md p-2 hover:bg-accent" title="Ambient">
            <Radio className="h-4 w-4 text-muted-foreground" />
          </Link>
        </div>
      </aside>
    );
  }

  return (
    <aside className="flex w-72 flex-col border-l border-border bg-muted/30">
      <div className="flex h-12 items-center justify-between px-3">
        <span className="text-sm font-medium text-foreground/80">Cockpit</span>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => setIsCollapsed(true)}
          title="Collapse panel"
        >
          <PanelRightClose className="h-4 w-4" />
        </Button>
      </div>

      <ScrollArea className="flex-1 px-3 pb-3">
        <div className="space-y-3">
          <Widget
            title="Tasks"
            icon={<CheckSquare className="h-4 w-4 text-muted-foreground" />}
            href="/tasks"
          >
            <TasksPreview />
          </Widget>

          <Widget
            title="Emotion"
            icon={<Heart className="h-4 w-4 text-muted-foreground" />}
            href="/emotion"
          >
            <EmotionPreview />
          </Widget>

          <Widget
            title="Ambient"
            icon={<Radio className="h-4 w-4 text-muted-foreground" />}
            href="/ambient"
          >
            <AmbientPreview />
          </Widget>
        </div>
      </ScrollArea>
    </aside>
  );
}

function TasksPreview() {
  const { data, isLoading, isError } = useTasks({ include_completed: true });

  const completionData = useMemo(() => {
    if (!data?.tasks) return [];

    const now = new Date();
    const days: { date: string; count: number }[] = [];

    for (let i = 6; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split("T")[0];
      days.push({ date: dateStr, count: 0 });
    }

    for (const task of data.tasks) {
      if (task.end) {
        const endDate = task.end.slice(0, 8);
        const formatted = `${endDate.slice(0, 4)}-${endDate.slice(4, 6)}-${endDate.slice(6, 8)}`;
        const day = days.find((d) => d.date === formatted);
        if (day) day.count++;
      }
    }

    return days;
  }, [data?.tasks]);

  if (isLoading) {
    return (
      <div className="space-y-1.5">
        <Skeleton className="h-8 w-12" />
        <Skeleton className="h-3 w-24" />
      </div>
    );
  }

  if (isError) {
    return (
      <p className="text-xs text-destructive">Failed to load tasks</p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-bold">{data?.pending_count ?? 0}</span>
        <span className="text-xs text-muted-foreground">pending</span>
      </div>
      {completionData.length > 0 && (
        <div className="h-8">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={completionData}>
              <Line
                type="monotone"
                dataKey="count"
                stroke="hsl(var(--primary))"
                strokeWidth={1.5}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        {data?.completed_count ?? 0} completed
      </p>
    </div>
  );
}

function EmotionPreview() {
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
        <Skeleton className="h-6 w-6 rounded-full" />
      </div>
      <div className="flex-1">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="mt-1 h-2 w-24" />
      </div>
    </div>
  );
}

function AmbientPreview() {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <div className="h-2 w-2 rounded-full bg-green-500" />
        <span className="text-xs">Monitoring</span>
      </div>
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>State</span>
        <Skeleton className="h-3 w-12" />
      </div>
    </div>
  );
}
