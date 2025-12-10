import { createFileRoute } from "@tanstack/react-router";
import { Brain, Search, Clock, BarChart3 } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useKGStats } from "@/hooks/queries";
import { EntitiesBrowser } from "@/components/knowledge/EntitiesBrowser";
import { SearchPanel } from "@/components/knowledge/SearchPanel";
import { FactsTimeline } from "@/components/knowledge/FactsTimeline";
import { AnalyticsDashboard } from "@/components/knowledge/AnalyticsDashboard";

export const Route = createFileRoute("/knowledge")({
  component: KnowledgePage,
});

function KnowledgePage() {
  const { data: stats } = useKGStats();

  return (
    <div className="flex flex-1 flex-col p-6">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Brain className="h-6 w-6" />
          <h1 className="text-2xl font-semibold">Knowledge</h1>
        </div>
        {stats && (
          <div className="text-sm text-muted-foreground">
            {stats.total_entities} entities, {stats.total_edges} facts
          </div>
        )}
      </div>

      <Tabs defaultValue="entities" className="flex-1">
        <TabsList>
          <TabsTrigger value="entities" className="gap-1.5">
            <Brain className="h-4 w-4" />
            Entities
          </TabsTrigger>
          <TabsTrigger value="search" className="gap-1.5">
            <Search className="h-4 w-4" />
            Search
          </TabsTrigger>
          <TabsTrigger value="timeline" className="gap-1.5">
            <Clock className="h-4 w-4" />
            Timeline
          </TabsTrigger>
          <TabsTrigger value="analytics" className="gap-1.5">
            <BarChart3 className="h-4 w-4" />
            Analytics
          </TabsTrigger>
        </TabsList>

        <TabsContent value="entities" className="mt-4">
          <EntitiesBrowser />
        </TabsContent>

        <TabsContent value="search" className="mt-4">
          <SearchPanel />
        </TabsContent>

        <TabsContent value="timeline" className="mt-4">
          <FactsTimeline />
        </TabsContent>

        <TabsContent value="analytics" className="mt-4">
          <AnalyticsDashboard />
        </TabsContent>
      </Tabs>
    </div>
  );
}
