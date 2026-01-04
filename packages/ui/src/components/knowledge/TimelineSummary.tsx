import { useMemo, useState } from "react";
import { Calendar, Clock, FileText, Network, TrendingUp } from "lucide-react";
import { useKGFactsTimeline } from "@/hooks/queries";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import type { KGTimelineFact } from "@/types/api";

const DEFAULT_DAYS = 7;

function toDateInput(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function parseIso(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getItemStatus(item: KGTimelineFact, windowStart: Date, windowEnd: Date) {
  const validAt =
    item.kind === "edge" ? parseIso(item.edge?.valid_at) : parseIso(item.fact?.valid_at);
  const invalidAt =
    item.kind === "edge" ? parseIso(item.edge?.invalid_at) : parseIso(item.fact?.invalid_at);
  const createdAt =
    item.kind === "edge" ? parseIso(item.edge?.created_at) : parseIso(item.fact?.created_at);

  if (invalidAt && invalidAt >= windowStart && invalidAt <= windowEnd) return "expired";
  if (createdAt && createdAt >= windowStart && createdAt <= windowEnd) return "new";
  if (validAt && validAt > windowEnd) return "future";
  return "active";
}

function aggregateTimeline(items: KGTimelineFact[], windowStart: Date, windowEnd: Date) {
  const summary = {
    newFacts: 0,
    newEdges: 0,
    expired: 0,
    future: 0,
    topEntities: new Map<string, number>(),
    topRoles: new Map<string, number>(),
    topRelations: new Map<string, number>(),
  };

  items.forEach((item) => {
    const status = getItemStatus(item, windowStart, windowEnd);
    if (status === "expired") summary.expired += 1;
    if (status === "future") summary.future += 1;

    if (status === "new") {
      if (item.kind === "edge") summary.newEdges += 1;
      if (item.kind === "fact") summary.newFacts += 1;
    }

    if (item.kind === "edge" && item.edge) {
      const relation = item.edge.relation || "related";
      summary.topRelations.set(relation, (summary.topRelations.get(relation) || 0) + 1);
      const src = item.edge.source_name;
      const tgt = item.edge.target_name;
      if (src) summary.topEntities.set(src, (summary.topEntities.get(src) || 0) + 1);
      if (tgt) summary.topEntities.set(tgt, (summary.topEntities.get(tgt) || 0) + 1);
    }

    if (item.kind === "fact" && item.fact) {
      item.fact.roles.forEach((role) => {
        summary.topRoles.set(role.role, (summary.topRoles.get(role.role) || 0) + 1);
        summary.topEntities.set(
          role.entity_name,
          (summary.topEntities.get(role.entity_name) || 0) + 1,
        );
      });
    }
  });

  const topEntities = [...summary.topEntities.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const topRoles = [...summary.topRoles.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const topRelations = [...summary.topRelations.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);

  return { ...summary, topEntities, topRoles, topRelations };
}

export function TimelineSummary() {
  const [endDate, setEndDate] = useState(() => toDateInput(new Date()));
  const [startDate, setStartDate] = useState(() => {
    const start = new Date();
    start.setDate(start.getDate() - DEFAULT_DAYS);
    return toDateInput(start);
  });

  const { data, isLoading } = useKGFactsTimeline({
    start_date: startDate,
    end_date: endDate,
    limit: 500,
    offset: 0,
  });

  const windowStart = useMemo(() => new Date(startDate), [startDate]);
  const windowEnd = useMemo(() => {
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);
    return end;
  }, [endDate]);

  const summary = useMemo(
    () => aggregateTimeline(data?.facts ?? [], windowStart, windowEnd),
    [data?.facts, windowStart, windowEnd],
  );

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4" />
            Weekly Memory Summary
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Snapshot of memory changes in the selected window
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="summary-start" className="text-xs">
              From
            </Label>
            <Input
              id="summary-start"
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
              className="w-36"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="summary-end" className="text-xs">
              To
            </Label>
            <Input
              id="summary-end"
              type="date"
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
              className="w-36"
            />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <Badge variant="secondary" className="gap-1">
                <FileText className="h-3 w-3" />
                {summary.newFacts} new facts
              </Badge>
              <Badge variant="secondary" className="gap-1">
                <Network className="h-3 w-3" />
                {summary.newEdges} new edges
              </Badge>
              <Badge variant="outline" className="gap-1">
                <Clock className="h-3 w-3" />
                {summary.expired} invalidations
              </Badge>
              <Badge variant="outline" className="gap-1">
                <Calendar className="h-3 w-3" />
                {summary.future} future-dated
              </Badge>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <p className="text-xs uppercase text-muted-foreground">Top entities</p>
                {summary.topEntities.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No entity activity.</p>
                ) : (
                  <div className="space-y-1">
                    {summary.topEntities.map(([name, count]) => (
                      <div key={name} className="flex items-center justify-between text-sm">
                        <span className="truncate">{name}</span>
                        <span className="text-xs text-muted-foreground">{count}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="space-y-2">
                <p className="text-xs uppercase text-muted-foreground">Top roles</p>
                {summary.topRoles.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No roles in window.</p>
                ) : (
                  <div className="space-y-1">
                    {summary.topRoles.map(([role, count]) => (
                      <div key={role} className="flex items-center justify-between text-sm">
                        <span className="truncate">{role}</span>
                        <span className="text-xs text-muted-foreground">{count}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="space-y-2">
                <p className="text-xs uppercase text-muted-foreground">Top relations</p>
                {summary.topRelations.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No edges in window.</p>
                ) : (
                  <div className="space-y-1">
                    {summary.topRelations.map(([relation, count]) => (
                      <div key={relation} className="flex items-center justify-between text-sm">
                        <span className="truncate">{relation}</span>
                        <span className="text-xs text-muted-foreground">{count}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
