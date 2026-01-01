import { Brain, Network, Users, Hash, TrendingUp, Star, FileText, Target } from "lucide-react";
import { useKGStats, useKGCommunities } from "@/hooks/queries";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";

function StatCard({
  title,
  value,
  icon,
  description,
}: {
  title: string;
  value: number | string;
  icon: React.ReactNode;
  description?: string;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <span className="text-muted-foreground">{icon}</span>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {description && <p className="text-xs text-muted-foreground mt-1">{description}</p>}
      </CardContent>
    </Card>
  );
}

function LabelDistribution({ distribution }: { distribution: Record<string, number> }) {
  const sorted = Object.entries(distribution).sort(([, a], [, b]) => b - a);
  const total = Object.values(distribution).reduce((a, b) => a + b, 0);

  if (sorted.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
        No labels found
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {sorted.slice(0, 8).map(([label, count]) => {
        const percentage = total > 0 ? (count / total) * 100 : 0;
        return (
          <div key={label} className="space-y-1">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">{label}</span>
              <span className="text-muted-foreground">{count}</span>
            </div>
            <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${percentage}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TopEntitiesList({
  entities,
  metric,
}: {
  entities: {
    uuid: string;
    name: string;
    labels: string[];
    mention_count: number;
    retrieval_quality: number;
  }[];
  metric: "mentions" | "quality";
}) {
  if (entities.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
        No entities found
      </div>
    );
  }

  return (
    <ScrollArea className="h-[200px]">
      <div className="space-y-2 pr-4">
        {entities.map((entity, index) => (
          <div
            key={entity.uuid}
            className="flex items-center gap-3 rounded-lg border border-border bg-card p-2"
          >
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-xs font-medium">
              {index + 1}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-medium truncate text-sm">{entity.name}</p>
              <div className="flex items-center gap-1 mt-0.5">
                {entity.labels.slice(0, 2).map((label) => (
                  <Badge key={label} variant="outline" className="text-xs py-0 px-1.5">
                    {label}
                  </Badge>
                ))}
              </div>
            </div>
            <div className="text-sm font-medium text-muted-foreground">
              {metric === "mentions" ? entity.mention_count : entity.retrieval_quality.toFixed(2)}
            </div>
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}

function TopFactRolesList({ roles }: { roles: { role: string; count: number }[] }) {
  if (roles.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
        No fact roles found
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {roles.map((role, index) => (
        <div
          key={`${role.role}-${index}`}
          className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2 text-sm"
        >
          <span className="font-medium">{role.role}</span>
          <span className="text-muted-foreground">{role.count}</span>
        </div>
      ))}
    </div>
  );
}

function TopFactEntitiesList({
  entities,
}: {
  entities: { uuid: string; name: string; labels: string[]; count: number }[];
}) {
  if (entities.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
        No fact entities found
      </div>
    );
  }

  return (
    <ScrollArea className="h-[200px]">
      <div className="space-y-2 pr-4">
        {entities.map((entity, index) => (
          <div
            key={entity.uuid}
            className="flex items-center gap-3 rounded-lg border border-border bg-card p-2"
          >
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-xs font-medium">
              {index + 1}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-medium truncate text-sm">{entity.name}</p>
              <div className="flex items-center gap-1 mt-0.5">
                {entity.labels.slice(0, 2).map((label) => (
                  <Badge key={label} variant="outline" className="text-xs py-0 px-1.5">
                    {label}
                  </Badge>
                ))}
              </div>
            </div>
            <div className="text-sm font-medium text-muted-foreground">{entity.count}</div>
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}

function CommunitiesList() {
  const { data, isLoading } = useKGCommunities(10);

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    );
  }

  if (!data?.communities || data.communities.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
        No communities found
      </div>
    );
  }

  return (
    <ScrollArea className="h-[200px]">
      <div className="space-y-2 pr-4">
        {data.communities.map((community) => (
          <div key={community.name} className="rounded-lg border border-border bg-card p-3">
            <div className="flex items-center justify-between">
              <p className="font-medium text-sm">{community.name}</p>
              <Badge variant="secondary" className="text-xs">
                {community.member_count} members
              </Badge>
            </div>
            {community.summary && (
              <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{community.summary}</p>
            )}
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}

export function AnalyticsDashboard() {
  const { data: stats, isLoading, isError } = useKGStats();

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-28 w-full" />
        ))}
        <Skeleton className="h-64 w-full md:col-span-2" />
        <Skeleton className="h-64 w-full md:col-span-2" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <p className="text-destructive">Failed to load knowledge stats</p>
        <p className="text-sm text-muted-foreground mt-1">
          Make sure the daemon is running and FalkorDB is connected
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-5">
        <StatCard
          title="Entities"
          value={stats?.total_entities ?? 0}
          icon={<Brain className="h-4 w-4" />}
          description="Total knowledge entities"
        />
        <StatCard
          title="Facts"
          value={stats?.total_facts ?? 0}
          icon={<FileText className="h-4 w-4" />}
          description="Hyper-edge fact nodes"
        />
        <StatCard
          title="Relationships"
          value={stats?.total_edges ?? 0}
          icon={<Network className="h-4 w-4" />}
          description="Edges between entities"
        />
        <StatCard
          title="Communities"
          value={stats?.total_communities ?? 0}
          icon={<Users className="h-4 w-4" />}
          description="Clustered entity groups"
        />
        <StatCard
          title="Labels"
          value={Object.keys(stats?.label_distribution ?? {}).length}
          icon={<Hash className="h-4 w-4" />}
          description="Entity type categories"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              Top by Mentions
            </CardTitle>
            <CardDescription>Most frequently referenced entities</CardDescription>
          </CardHeader>
          <CardContent>
            <TopEntitiesList entities={stats?.top_mentioned ?? []} metric="mentions" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Target className="h-4 w-4" />
              Top Fact Roles
            </CardTitle>
            <CardDescription>Most common roles in facts</CardDescription>
          </CardHeader>
          <CardContent>
            <TopFactRolesList roles={stats?.top_fact_roles ?? []} />
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Star className="h-4 w-4" />
              Top by Quality
            </CardTitle>
            <CardDescription>Highest retrieval quality scores</CardDescription>
          </CardHeader>
          <CardContent>
            <TopEntitiesList entities={stats?.top_quality ?? []} metric="quality" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Top Fact Entities
            </CardTitle>
            <CardDescription>Entities most referenced in facts</CardDescription>
          </CardHeader>
          <CardContent>
            <TopFactEntitiesList entities={stats?.top_fact_entities ?? []} />
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Hash className="h-4 w-4" />
              Label Distribution
            </CardTitle>
            <CardDescription>Entity categorization breakdown</CardDescription>
          </CardHeader>
          <CardContent>
            <LabelDistribution distribution={stats?.label_distribution ?? {}} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              Communities
            </CardTitle>
            <CardDescription>Discovered entity clusters</CardDescription>
          </CardHeader>
          <CardContent>
            <CommunitiesList />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
