import { useMemo, useState } from "react";
import { Clock, ArrowRight, ChevronLeft, ChevronRight, Calendar, CheckCircle, XCircle, Clock4, FileText } from "lucide-react";
import { useKGFactsTimeline, useKGFactsAtTime } from "@/hooks/queries";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FactDetailPanel } from "@/components/knowledge/FactDetailPanel";
import type { KGFactSummary, KGTimelineFact } from "@/types/api";

const PAGE_SIZE = 30;

const TEMPORAL_STATUS_CONFIG: Record<
  string,
  { icon: React.ElementType; color: string; label: string }
> = {
  valid: { icon: CheckCircle, color: "text-green-500", label: "Valid" },
  expired: { icon: XCircle, color: "text-muted-foreground", label: "Expired" },
  future: { icon: Clock4, color: "text-blue-500", label: "Future" },
};

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "Unknown";
  const date = new Date(dateStr);
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function getTimelineDateKey(item: KGTimelineFact): string {
  const timestamp =
    item.kind === "edge"
      ? item.edge?.valid_at || item.edge?.created_at
      : item.fact?.valid_at || item.fact?.created_at;

  if (!timestamp) return "undated";
  return new Date(timestamp).toISOString().split("T")[0];
}

function groupFactsByDate(facts: KGTimelineFact[]): Map<string, KGTimelineFact[]> {
  const groups = new Map<string, KGTimelineFact[]>();

  for (const fact of facts) {
    const dateKey = getTimelineDateKey(fact);

    if (!groups.has(dateKey)) {
      groups.set(dateKey, []);
    }
    groups.get(dateKey)!.push(fact);
  }

  return groups;
}

function FactCard({
  fact,
  onSelectFact,
}: {
  fact: KGTimelineFact;
  onSelectFact?: (fact: KGFactSummary) => void;
}) {
  const statusConfig =
    TEMPORAL_STATUS_CONFIG[fact.temporal_status] ?? TEMPORAL_STATUS_CONFIG.valid;
  const StatusIcon = statusConfig.icon;

  return (
    <button
      type="button"
      onClick={() => {
        if (fact.kind === "fact" && fact.fact) {
          onSelectFact?.(fact.fact);
        }
      }}
      className="w-full rounded-lg border border-border bg-card p-3 text-left hover:bg-accent/50 transition-colors"
    >
      <div className="flex items-start gap-2">
        <StatusIcon className={`h-4 w-4 mt-0.5 shrink-0 ${statusConfig.color}`} />
        <div className="flex-1 min-w-0">
          {fact.kind === "edge" && fact.edge ? (
            <>
              <div className="flex flex-wrap items-center gap-1.5 text-sm">
                <span className="font-medium">{fact.edge.source_name}</span>
                <ArrowRight className="h-3 w-3 text-muted-foreground" />
                <Badge variant="secondary" className="text-xs">{fact.edge.relation}</Badge>
                <ArrowRight className="h-3 w-3 text-muted-foreground" />
                <span className="font-medium">{fact.edge.target_name}</span>
              </div>
              <p className="mt-1.5 text-sm text-muted-foreground line-clamp-2">
                {fact.edge.fact}
              </p>
              <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
                {fact.edge.valid_at && (
                  <span>From: {formatDate(fact.edge.valid_at)}</span>
                )}
                {fact.edge.invalid_at && (
                  <span>Until: {formatDate(fact.edge.invalid_at)}</span>
                )}
                {fact.edge.strength !== null && (
                  <span>Strength: {fact.edge.strength.toFixed(2)}</span>
                )}
              </div>
            </>
          ) : fact.fact ? (
            <>
              <div className="flex items-center gap-2 text-sm">
                <Badge variant="secondary" className="text-xs">Fact</Badge>
              </div>
              <p className="mt-1.5 text-sm text-muted-foreground line-clamp-3">
                {fact.fact.fact}
              </p>
              {fact.fact.roles.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {fact.fact.roles.slice(0, 4).map((role) => (
                    <Badge
                      key={`${fact.fact?.uuid}-${role.entity_uuid}-${role.role}`}
                      variant="outline"
                      className="text-xs"
                    >
                      {role.role}: {role.entity_name}
                    </Badge>
                  ))}
                  {fact.fact.roles.length > 4 && (
                    <Badge variant="secondary" className="text-xs">
                      +{fact.fact.roles.length - 4} more
                    </Badge>
                  )}
                </div>
              )}
              <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
                {fact.fact.valid_at && (
                  <span>From: {formatDate(fact.fact.valid_at)}</span>
                )}
                {fact.fact.invalid_at && (
                  <span>Until: {formatDate(fact.fact.invalid_at)}</span>
                )}
              </div>
            </>
          ) : null}
        </div>
      </div>
    </button>
  );
}

function DateGroup({
  dateKey,
  facts,
  onSelectFact,
}: {
  dateKey: string;
  facts: KGTimelineFact[];
  onSelectFact?: (fact: KGFactSummary) => void;
}) {
  const displayDate = dateKey === "undated"
    ? "Undated"
    : new Date(dateKey).toLocaleDateString(undefined, {
        weekday: "short",
        year: "numeric",
        month: "short",
        day: "numeric",
      });

  return (
    <div className="space-y-2">
      <div className="sticky top-0 z-10 flex items-center gap-2 bg-background py-2">
        <Calendar className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">{displayDate}</span>
        <Badge variant="outline" className="text-xs">{facts.length}</Badge>
      </div>
      <div className="space-y-2 pl-6 border-l border-border">
        {facts.map((fact, index) => (
          <FactCard
            key={fact.kind === "edge" ? fact.edge?.uuid : fact.fact?.uuid || `${dateKey}-${index}`}
            fact={fact}
            onSelectFact={onSelectFact}
          />
        ))}
      </div>
    </div>
  );
}

function FactSnapshotCard({ fact }: { fact: KGFactSummary }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3 hover:bg-accent/50 transition-colors">
      <div className="flex items-start gap-2">
        <FileText className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-sm text-foreground line-clamp-3">{fact.fact}</p>
          {fact.roles.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {fact.roles.slice(0, 4).map((role) => (
                <Badge
                  key={`${fact.uuid}-${role.entity_uuid}-${role.role}`}
                  variant="outline"
                  className="text-xs"
                >
                  {role.role}: {role.entity_name}
                </Badge>
              ))}
              {fact.roles.length > 4 && (
                <Badge variant="secondary" className="text-xs">
                  +{fact.roles.length - 4} more
                </Badge>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function FactsTimeline() {
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [offset, setOffset] = useState(0);
  const [snapshotTime, setSnapshotTime] = useState("");
  const [selectedFact, setSelectedFact] = useState<KGFactSummary | null>(null);

  const snapshotIso = useMemo(() => {
    if (!snapshotTime) return "";
    const parsed = new Date(snapshotTime);
    if (Number.isNaN(parsed.getTime())) return "";
    return parsed.toISOString();
  }, [snapshotTime]);

  const { data, isLoading, isError } = useKGFactsTimeline({
    start_date: startDate || undefined,
    end_date: endDate || undefined,
    limit: PAGE_SIZE,
    offset,
  });

  const {
    data: snapshotData,
    isLoading: snapshotLoading,
  } = useKGFactsAtTime(
    snapshotIso,
    { include_roles: true, limit: 20 },
    { enabled: snapshotIso.length > 0 }
  );

  const totalPages = Math.ceil((data?.total ?? 0) / PAGE_SIZE);
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  const groupedFacts = data?.facts ? groupFactsByDate(data.facts) : new Map();
  const sortedDateKeys = Array.from(groupedFacts.keys()).sort((a, b) => {
    if (a === "undated") return 1;
    if (b === "undated") return -1;
    return b.localeCompare(a);
  });

  const handleDateChange = (type: "start" | "end", value: string) => {
    if (type === "start") {
      setStartDate(value);
    } else {
      setEndDate(value);
    }
    setOffset(0);
  };

  if (isLoading && offset === 0) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-4">
          <Skeleton className="h-9 w-36" />
          <Skeleton className="h-9 w-36" />
        </div>
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <p className="text-destructive">Failed to load facts timeline</p>
        <p className="text-sm text-muted-foreground mt-1">
          Make sure the daemon is running and FalkorDB is connected
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="start-date" className="text-xs">From</Label>
          <Input
            id="start-date"
            type="date"
            value={startDate}
            onChange={(e) => handleDateChange("start", e.target.value)}
            className="w-36"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="end-date" className="text-xs">To</Label>
          <Input
            id="end-date"
            type="date"
            value={endDate}
            onChange={(e) => handleDateChange("end", e.target.value)}
            className="w-36"
          />
        </div>
        {(startDate || endDate) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setStartDate("");
              setEndDate("");
              setOffset(0);
            }}
          >
            Clear dates
          </Button>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="snapshot-time" className="text-xs">Snapshot</Label>
          <Input
            id="snapshot-time"
            type="datetime-local"
            value={snapshotTime}
            onChange={(e) => setSnapshotTime(e.target.value)}
            className="w-52"
          />
        </div>
        {snapshotTime && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSnapshotTime("")}
          >
            Clear snapshot
          </Button>
        )}
        <div className="flex-1" />
        <span className="text-sm text-muted-foreground">
          {data?.total ?? 0} facts
        </span>
      </div>

      {snapshotIso && (
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Clock className="h-4 w-4 text-muted-foreground" />
              Fact snapshot at {new Date(snapshotIso).toLocaleString()}
            </div>
            <span className="text-xs text-muted-foreground">
              {snapshotData?.facts?.length ?? 0} facts
            </span>
          </div>
          <div className="mt-3 space-y-2">
            {snapshotLoading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-20 w-full" />
              ))
            ) : snapshotData?.facts?.length ? (
              snapshotData.facts.map((fact) => (
                <FactSnapshotCard key={fact.uuid} fact={fact} />
              ))
            ) : (
              <p className="text-sm text-muted-foreground">
                No facts found at this time.
              </p>
            )}
          </div>
        </div>
      )}

      {sortedDateKeys.length > 0 ? (
        <>
          <ScrollArea className="h-[calc(100vh-18rem)]">
            <div className="space-y-6 pr-4">
              {sortedDateKeys.map((dateKey) => (
                <DateGroup
                  key={dateKey}
                  dateKey={dateKey}
                  facts={groupedFacts.get(dateKey)!}
                  onSelectFact={setSelectedFact}
                />
              ))}
            </div>
          </ScrollArea>

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-sm text-muted-foreground">
                Page {currentPage} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={offset + PAGE_SIZE >= (data?.total ?? 0)}
                onClick={() => setOffset(offset + PAGE_SIZE)}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </>
      ) : (
        <div className="flex flex-col items-center justify-center py-12">
          <Clock className="h-12 w-12 text-muted-foreground/50" />
          <p className="mt-4 text-muted-foreground">No facts in timeline</p>
          {(startDate || endDate) && (
            <Button
              variant="link"
              className="mt-2"
              onClick={() => {
                setStartDate("");
                setEndDate("");
              }}
            >
              Clear date filter
            </Button>
          )}
        </div>
      )}

      <FactDetailPanel
        fact={selectedFact}
        onClose={() => setSelectedFact(null)}
      />
    </div>
  );
}
