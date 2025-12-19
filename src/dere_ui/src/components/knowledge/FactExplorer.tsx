import { useMemo, useState } from "react";
import { Search, FileText, Clock } from "lucide-react";
import { useKGFactSearch, useKGFactsAtTime } from "@/hooks/queries";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { KGFactSummary } from "@/types/api";

const PAGE_SIZE = 30;

function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useMemo(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debouncedValue;
}

function FactCard({ fact }: { fact: KGFactSummary }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3 hover:bg-accent/50 transition-colors">
      <div className="flex items-start gap-2">
        <FileText className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-sm text-foreground line-clamp-3">{fact.fact}</p>
          {fact.roles.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {fact.roles.map((role) => (
                <Badge
                  key={`${fact.uuid}-${role.entity_uuid}-${role.role}`}
                  variant="outline"
                  className="text-xs"
                >
                  {role.role}: {role.entity_name}
                </Badge>
              ))}
            </div>
          )}
          {(fact.valid_at || fact.invalid_at) && (
            <div className="mt-2 text-xs text-muted-foreground">
              {fact.valid_at && (
                <span>From: {new Date(fact.valid_at).toLocaleDateString()}</span>
              )}
              {fact.invalid_at && (
                <span> - {new Date(fact.invalid_at).toLocaleDateString()}</span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function FactsList({
  facts,
  isLoading,
  emptyLabel,
}: {
  facts: KGFactSummary[] | undefined;
  isLoading: boolean;
  emptyLabel: string;
}) {
  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
    );
  }

  if (!facts || facts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <FileText className="h-12 w-12 text-muted-foreground/50" />
        <p className="mt-4 text-muted-foreground">{emptyLabel}</p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-[calc(100vh-22rem)]">
      <div className="space-y-2 pr-4">
        {facts.map((fact) => (
          <FactCard key={fact.uuid} fact={fact} />
        ))}
      </div>
    </ScrollArea>
  );
}

export function FactExplorer() {
  const [query, setQuery] = useState("");
  const [snapshotTime, setSnapshotTime] = useState("");
  const [includeRoles, setIncludeRoles] = useState(true);

  const debouncedQuery = useDebounce(query, 300);
  const snapshotIso = useMemo(() => {
    if (!snapshotTime) return "";
    const parsed = new Date(snapshotTime);
    if (Number.isNaN(parsed.getTime())) return "";
    return parsed.toISOString();
  }, [snapshotTime]);

  const searchEnabled = debouncedQuery.length >= 2;
  const snapshotEnabled = snapshotIso.length > 0;

  const {
    data: searchData,
    isLoading: searchLoading,
    isFetching: searchFetching,
  } = useKGFactSearch(
    debouncedQuery,
    { include_roles: includeRoles, limit: PAGE_SIZE },
    { enabled: searchEnabled }
  );

  const {
    data: snapshotData,
    isLoading: snapshotLoading,
  } = useKGFactsAtTime(
    snapshotIso,
    { include_roles: includeRoles, limit: PAGE_SIZE },
    { enabled: snapshotEnabled }
  );

  const showSearchLoading = searchLoading || (searchFetching && query !== debouncedQuery);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Switch
            id="include-roles"
            checked={includeRoles}
            onCheckedChange={setIncludeRoles}
          />
          <Label htmlFor="include-roles" className="text-sm">
            Show roles
          </Label>
        </div>
      </div>

      <Tabs defaultValue="search">
        <TabsList>
          <TabsTrigger value="search" className="gap-1.5">
            <Search className="h-4 w-4" />
            Search
          </TabsTrigger>
          <TabsTrigger value="snapshot" className="gap-1.5">
            <Clock className="h-4 w-4" />
            Snapshot
          </TabsTrigger>
        </TabsList>

        <TabsContent value="search" className="mt-4 space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search fact statements..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-9"
            />
          </div>

          {query.length < 2 ? (
            <div className="flex flex-col items-center justify-center py-16">
              <Search className="h-12 w-12 text-muted-foreground/50" />
              <p className="mt-4 text-muted-foreground">
                Enter at least 2 characters to search
              </p>
            </div>
          ) : (
            <FactsList
              facts={searchData?.facts}
              isLoading={showSearchLoading}
              emptyLabel={`No facts found for "${query}"`}
            />
          )}
        </TabsContent>

        <TabsContent value="snapshot" className="mt-4 space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="snapshot-time" className="text-xs">
                Point in time
              </Label>
              <Input
                id="snapshot-time"
                type="datetime-local"
                value={snapshotTime}
                onChange={(e) => setSnapshotTime(e.target.value)}
                className="w-60"
              />
            </div>
            {snapshotTime && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSnapshotTime("")}
              >
                Clear
              </Button>
            )}
            <div className="flex-1" />
            <span className="text-sm text-muted-foreground">
              {snapshotData?.facts?.length ?? 0} facts
            </span>
          </div>

          <FactsList
            facts={snapshotData?.facts}
            isLoading={snapshotLoading}
            emptyLabel="Pick a time to load facts"
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
