import { createFileRoute } from "@tanstack/react-router";
import {
  Heart,
  Smile,
  Frown,
  Meh,
  Star,
  ThumbsUp,
  AlertTriangle,
  CloudRain,
  Zap,
  HelpCircle,
  Target,
  Scale,
  ThumbsDown,
  Clock,
  FileEdit,
} from "lucide-react";
import { useEmotionState, useEmotionHistory, useEmotionProfile } from "@/hooks/queries";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { EmotionEvent, OCCGoal, OCCStandard, OCCAttitude } from "@/types/api";

export const Route = createFileRoute("/emotion")({
  component: EmotionPage,
});

// Reuse emotion config from RightPanel
const EMOTION_CONFIG: Record<
  string,
  { icon: React.ElementType; color: string; valence: "positive" | "negative" | "neutral" }
> = {
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
  NEUTRAL: { icon: Meh, color: "#6b7280", valence: "neutral" },
};

function getEmotionConfig(emotionType: string) {
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

function formatTimestamp(ts: number): string {
  const date = new Date(ts);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`;
  return date.toLocaleDateString();
}

function CurrentStateSection() {
  const { data, isLoading, isError } = useEmotionState();

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4">
        <p className="text-destructive">Failed to load emotion state</p>
      </div>
    );
  }

  if (!data?.has_emotion || !data.dominant_emotion) {
    return (
      <div className="rounded-lg border border-border bg-card p-6">
        <div className="flex flex-col items-center gap-4">
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-muted">
            <Meh className="h-10 w-10 text-muted-foreground" />
          </div>
          <div className="text-center">
            <h3 className="text-lg font-semibold">Neutral State</h3>
            <p className="text-sm text-muted-foreground">No strong emotions detected</p>
          </div>
        </div>
      </div>
    );
  }

  const config = getEmotionConfig(data.dominant_emotion);
  const Icon = config.icon;
  const intensity = data.intensity ?? 0;
  const activeEmotions = data.active_emotions ?? {};

  return (
    <div className="space-y-4">
      {/* Dominant emotion display */}
      <div className="rounded-lg border border-border bg-card p-6">
        <div className="flex items-center gap-6">
          <div
            className="flex h-24 w-24 items-center justify-center rounded-full"
            style={{ backgroundColor: `${config.color}20` }}
          >
            <Icon className="h-12 w-12" style={{ color: config.color }} />
          </div>
          <div className="flex-1">
            <h3 className="text-2xl font-bold">{formatEmotionName(data.dominant_emotion)}</h3>
            <div className="mt-2 flex items-center gap-4">
              <Badge
                variant={config.valence === "positive" ? "default" : config.valence === "negative" ? "destructive" : "secondary"}
              >
                {config.valence}
              </Badge>
              <span className="text-sm text-muted-foreground">
                Last updated: {data.last_updated ? formatTimestamp(data.last_updated) : "unknown"}
              </span>
            </div>
            {/* Intensity gauge */}
            <div className="mt-4">
              <div className="flex items-center justify-between text-sm">
                <span>Intensity</span>
                <span className="font-medium">{intensity.toFixed(0)}%</span>
              </div>
              <div className="mt-1 h-3 w-full rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${Math.min(100, intensity)}%`,
                    backgroundColor: config.color,
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* All active emotions */}
      {Object.keys(activeEmotions).length > 0 && (
        <div className="rounded-lg border border-border bg-card p-4">
          <h4 className="mb-3 text-sm font-medium text-muted-foreground">All Active Emotions</h4>
          <div className="space-y-2">
            {Object.entries(activeEmotions)
              .sort((a, b) => b[1].intensity - a[1].intensity)
              .map(([type, { intensity: int }]) => {
                const cfg = getEmotionConfig(type);
                const Ic = cfg.icon;
                return (
                  <div key={type} className="flex items-center gap-3">
                    <Ic className="h-4 w-4" style={{ color: cfg.color }} />
                    <span className="flex-1 text-sm">{formatEmotionName(type)}</span>
                    <div className="w-24 h-2 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.min(100, int)}%`,
                          backgroundColor: cfg.color,
                        }}
                      />
                    </div>
                    <span className="w-12 text-right text-xs text-muted-foreground">
                      {int.toFixed(0)}%
                    </span>
                  </div>
                );
              })}
          </div>
        </div>
      )}
    </div>
  );
}

function HistorySection() {
  const { data, isLoading, isError } = useEmotionHistory(50);

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4">
        <p className="text-destructive">Failed to load emotion history</p>
      </div>
    );
  }

  if (!data?.events || data.events.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <Clock className="h-12 w-12 text-muted-foreground/50" />
        <p className="mt-4 text-muted-foreground">No emotion history yet</p>
        <p className="text-sm text-muted-foreground">Stimulus events will appear here</p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-[calc(100vh-20rem)]">
      <div className="space-y-2 pr-4">
        {data.events.map((event: EmotionEvent, idx: number) => (
          <div
            key={`${event.timestamp}-${idx}`}
            className="flex items-center gap-3 rounded-lg border border-border bg-card p-3"
          >
            <div
              className={`h-3 w-3 rounded-full ${
                event.valence > 0 ? "bg-green-500" : event.valence < 0 ? "bg-red-500" : "bg-gray-500"
              }`}
            />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{event.stimulus_type}</p>
              <p className="text-xs text-muted-foreground">
                Valence: {event.valence > 0 ? "+" : ""}{event.valence.toFixed(1)} | Intensity: {event.intensity.toFixed(0)}
              </p>
            </div>
            <span className="text-xs text-muted-foreground shrink-0">
              {formatTimestamp(event.timestamp)}
            </span>
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}

function ProfileSection() {
  const { data, isLoading, isError } = useEmotionProfile();

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4">
        <p className="text-destructive">Failed to load emotion profile</p>
      </div>
    );
  }

  const openProfileFile = () => {
    if (data?.profile_path) {
      navigator.clipboard.writeText(data.profile_path);
    }
  };

  return (
    <div className="space-y-4">
      {/* Profile status */}
      <div className="flex items-center justify-between rounded-lg border border-border bg-card p-4">
        <div>
          <p className="font-medium">
            {data?.has_profile ? "Custom Profile" : "Default Profile"}
          </p>
          <p className="text-sm text-muted-foreground">
            {data?.profile_path}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={openProfileFile}>
          <FileEdit className="mr-2 h-4 w-4" />
          Copy Path
        </Button>
      </div>

      {/* Goals */}
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="mb-3 flex items-center gap-2">
          <Target className="h-5 w-5 text-muted-foreground" />
          <h4 className="font-medium">Goals</h4>
        </div>
        <div className="space-y-2">
          {data?.goals.map((goal: OCCGoal) => (
            <div key={goal.id} className="flex items-center justify-between p-2 rounded bg-muted/50">
              <div>
                <p className="text-sm font-medium">{goal.id.replace(/_/g, " ")}</p>
                <p className="text-xs text-muted-foreground">{goal.description}</p>
              </div>
              <Badge variant={goal.active ? "default" : "secondary"}>
                {goal.importance}/10
              </Badge>
            </div>
          ))}
        </div>
      </div>

      {/* Standards */}
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="mb-3 flex items-center gap-2">
          <Scale className="h-5 w-5 text-muted-foreground" />
          <h4 className="font-medium">Standards</h4>
        </div>
        <div className="space-y-2">
          {data?.standards.map((standard: OCCStandard) => (
            <div key={standard.id} className="flex items-center justify-between p-2 rounded bg-muted/50">
              <div>
                <p className="text-sm font-medium">{standard.id.replace(/_/g, " ")}</p>
                <p className="text-xs text-muted-foreground">{standard.description}</p>
              </div>
              <Badge>{standard.importance}/10</Badge>
            </div>
          ))}
        </div>
      </div>

      {/* Attitudes */}
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="mb-3 flex items-center gap-2">
          {data?.attitudes.some((a: OCCAttitude) => a.appealingness > 0) ? (
            <ThumbsUp className="h-5 w-5 text-muted-foreground" />
          ) : (
            <ThumbsDown className="h-5 w-5 text-muted-foreground" />
          )}
          <h4 className="font-medium">Attitudes</h4>
        </div>
        <div className="space-y-2">
          {data?.attitudes.map((attitude: OCCAttitude) => (
            <div key={attitude.id} className="flex items-center justify-between p-2 rounded bg-muted/50">
              <div>
                <p className="text-sm font-medium">{attitude.target_object.replace(/_/g, " ")}</p>
                <p className="text-xs text-muted-foreground">{attitude.description}</p>
              </div>
              <Badge variant={attitude.appealingness > 0 ? "default" : attitude.appealingness < 0 ? "destructive" : "secondary"}>
                {attitude.appealingness > 0 ? "+" : ""}{attitude.appealingness}
              </Badge>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function EmotionPage() {
  return (
    <div className="flex flex-1 flex-col p-6">
      <div className="mb-6 flex items-center gap-3">
        <Heart className="h-6 w-6" />
        <h1 className="text-2xl font-semibold">Emotion State</h1>
      </div>

      <Tabs defaultValue="current" className="flex-1">
        <TabsList>
          <TabsTrigger value="current">Current State</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
          <TabsTrigger value="profile">OCC Profile</TabsTrigger>
        </TabsList>

        <TabsContent value="current" className="mt-4">
          <CurrentStateSection />
        </TabsContent>

        <TabsContent value="history" className="mt-4">
          <HistorySection />
        </TabsContent>

        <TabsContent value="profile" className="mt-4">
          <ProfileSection />
        </TabsContent>
      </Tabs>
    </div>
  );
}
