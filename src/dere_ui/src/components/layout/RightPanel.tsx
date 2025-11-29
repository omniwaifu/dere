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
  Smile,
  Frown,
  Meh,
  Star,
  ThumbsUp,
  AlertTriangle,
  CloudRain,
  Zap,
  HelpCircle,
} from "lucide-react";
import { useTasks, useEmotionState } from "@/hooks/queries";
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

// Emotion icon and color mappings based on OCC emotion characteristics
const EMOTION_CONFIG: Record<
  string,
  { icon: React.ElementType; color: string; valence: "positive" | "negative" | "neutral" }
> = {
  // Positive emotions
  JOY: { icon: Smile, color: "#22c55e", valence: "positive" },
  HOPE: { icon: Star, color: "#3b82f6", valence: "positive" },
  RELIEF: { icon: ThumbsUp, color: "#22c55e", valence: "positive" },
  PRIDE: { icon: Star, color: "#f59e0b", valence: "positive" },
  ADMIRATION: { icon: Heart, color: "#ec4899", valence: "positive" },
  LOVE: { icon: Heart, color: "#ec4899", valence: "positive" },
  LIKING: { icon: ThumbsUp, color: "#3b82f6", valence: "positive" },
  GRATIFICATION: { icon: Smile, color: "#22c55e", valence: "positive" },
  GRATITUDE: { icon: Heart, color: "#22c55e", valence: "positive" },
  SATISFACTION: { icon: Smile, color: "#22c55e", valence: "positive" },
  HAPPY_FOR: { icon: Smile, color: "#22c55e", valence: "positive" },
  GLOATING: { icon: Smile, color: "#f59e0b", valence: "positive" },
  INTEREST: { icon: Zap, color: "#8b5cf6", valence: "positive" },
  // Negative emotions
  DISTRESS: { icon: Frown, color: "#ef4444", valence: "negative" },
  FEAR: { icon: AlertTriangle, color: "#f59e0b", valence: "negative" },
  DISAPPOINTMENT: { icon: Frown, color: "#6b7280", valence: "negative" },
  SHAME: { icon: Frown, color: "#ef4444", valence: "negative" },
  REPROACH: { icon: AlertTriangle, color: "#ef4444", valence: "negative" },
  DISLIKING: { icon: Frown, color: "#6b7280", valence: "negative" },
  REMORSE: { icon: CloudRain, color: "#6b7280", valence: "negative" },
  ANGER: { icon: AlertTriangle, color: "#ef4444", valence: "negative" },
  RESENTMENT: { icon: Frown, color: "#ef4444", valence: "negative" },
  FEAR_CONFIRMED: { icon: AlertTriangle, color: "#ef4444", valence: "negative" },
  PITY: { icon: Frown, color: "#6b7280", valence: "negative" },
  // Neutral
  NEUTRAL: { icon: Meh, color: "#6b7280", valence: "neutral" },
};

function getEmotionConfig(emotionType: string) {
  // Handle both "JOY" and "OCCEmotionType.JOY" formats
  const key = emotionType.replace("OCCEmotionType.", "").toUpperCase();
  return EMOTION_CONFIG[key] || { icon: HelpCircle, color: "#6b7280", valence: "neutral" as const };
}

function formatEmotionName(emotionType: string): string {
  const key = emotionType.replace("OCCEmotionType.", "");
  return key
    .split("_")
    .map((word) => word.charAt(0) + word.slice(1).toLowerCase())
    .join(" ");
}

function EmotionPreview() {
  const { data, isLoading, isError } = useEmotionState();

  if (isLoading) {
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

  if (isError) {
    return (
      <p className="text-xs text-destructive">Failed to load emotion state</p>
    );
  }

  if (!data?.has_emotion || !data.dominant_emotion) {
    return (
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
          <Meh className="h-5 w-5 text-muted-foreground" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-medium">Neutral</p>
          <p className="text-xs text-muted-foreground">No strong emotions</p>
        </div>
      </div>
    );
  }

  const config = getEmotionConfig(data.dominant_emotion);
  const Icon = config.icon;
  const intensity = data.intensity ?? 0;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <div
          className="flex h-10 w-10 items-center justify-center rounded-full"
          style={{ backgroundColor: `${config.color}20` }}
        >
          <Icon className="h-5 w-5" style={{ color: config.color }} />
        </div>
        <div className="flex-1">
          <p className="text-sm font-medium">{formatEmotionName(data.dominant_emotion)}</p>
          <p className="text-xs text-muted-foreground">
            Intensity: {intensity.toFixed(0)}%
          </p>
        </div>
      </div>
      <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${Math.min(100, intensity)}%`,
            backgroundColor: config.color,
          }}
        />
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
