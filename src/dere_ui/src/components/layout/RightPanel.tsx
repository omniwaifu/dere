import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  CheckSquare,
  Terminal,
  Heart,
  Radio,
} from "lucide-react";

export function RightPanel() {
  return (
    <aside className="flex w-80 flex-col bg-muted/30">
      <Tabs defaultValue="tasks" className="flex h-full flex-col">
        <TabsList className="mx-4 mt-4 grid grid-cols-4">
          <TabsTrigger value="tasks" className="gap-1 text-xs">
            <CheckSquare className="h-3 w-3" />
          </TabsTrigger>
          <TabsTrigger value="tools" className="gap-1 text-xs">
            <Terminal className="h-3 w-3" />
          </TabsTrigger>
          <TabsTrigger value="emotion" className="gap-1 text-xs">
            <Heart className="h-3 w-3" />
          </TabsTrigger>
          <TabsTrigger value="ambient" className="gap-1 text-xs">
            <Radio className="h-3 w-3" />
          </TabsTrigger>
        </TabsList>

        <ScrollArea className="flex-1 p-4">
          <TabsContent value="tasks" className="mt-0">
            <TasksPanel />
          </TabsContent>

          <TabsContent value="tools" className="mt-0">
            <ToolsPanel />
          </TabsContent>

          <TabsContent value="emotion" className="mt-0">
            <EmotionPanel />
          </TabsContent>

          <TabsContent value="ambient" className="mt-0">
            <AmbientPanel />
          </TabsContent>
        </ScrollArea>
      </Tabs>
    </aside>
  );
}

function TasksPanel() {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium">Tasks</h3>
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Skeleton className="h-4 w-4 rounded" />
          <Skeleton className="h-4 flex-1" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-4 w-4 rounded" />
          <Skeleton className="h-4 flex-1" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-4 w-4 rounded" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">Coming soon</p>
    </div>
  );
}

function ToolsPanel() {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium">Tool Activity</h3>
      <div className="space-y-2">
        <div className="rounded-md border border-border p-2">
          <div className="flex items-center justify-between">
            <Skeleton className="h-3 w-16" />
            <Badge variant="secondary" className="h-5">
              <Skeleton className="h-2 w-8" />
            </Badge>
          </div>
          <Skeleton className="mt-2 h-8 w-full" />
        </div>
        <div className="rounded-md border border-border p-2">
          <div className="flex items-center justify-between">
            <Skeleton className="h-3 w-12" />
            <Badge variant="secondary" className="h-5">
              <Skeleton className="h-2 w-8" />
            </Badge>
          </div>
          <Skeleton className="mt-2 h-8 w-full" />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">Coming soon</p>
    </div>
  );
}

function EmotionPanel() {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium">Emotion State</h3>
      <div className="flex items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-2xl">
          <Skeleton className="h-8 w-8 rounded-full" />
        </div>
        <div className="flex-1">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="mt-1 h-3 w-32" />
        </div>
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-2 w-24" />
        </div>
        <div className="flex items-center justify-between text-sm">
          <Skeleton className="h-3 w-12" />
          <Skeleton className="h-2 w-20" />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">Coming soon</p>
    </div>
  );
}

function AmbientPanel() {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium">Ambient Monitor</h3>
      <div className="rounded-md border border-border p-3">
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-green-500" />
          <Skeleton className="h-4 w-24" />
        </div>
        <Skeleton className="mt-2 h-3 w-full" />
        <Skeleton className="mt-1 h-3 w-3/4" />
      </div>
      <div className="space-y-1 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">State</span>
          <Skeleton className="h-4 w-16" />
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Last Check</span>
          <Skeleton className="h-4 w-20" />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">Coming soon</p>
    </div>
  );
}
