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
const ROLE_BADGE_LIMIT = 4;

function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useMemo(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debouncedValue;
}

function FactCard({ fact }: { fact: KGFactSummary }) {
  const visibleRoles = fact.roles.slice(0, ROLE_BADGE_LIMIT);
  const extraRoles = fact.roles.length - visibleRoles.length;

  return (
    <div className="rounded-lg border border-border bg-card p-3 hover:bg-accent/50 transition-colors">
      <div className="flex items-start gap-2">
        <FileText className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-sm text-foreground line-clamp-3">{fact.fact}</p>
          {visibleRoles.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {visibleRoles.map((role) => (
                <Badge
                  key={`${fact.uuid}-${role.entity_uuid}-${role.role}`}
                  variant="outline"
                  className="text-xs"
                  title={role.role_description || role.role}
                >
                  {role.role}: {role.entity_name}
                </Badge>
              ))}
              {extraRoles > 0 && (
                <Badge variant="secondary" className="text-xs">
                  +{extraRoles} more
                </Badge>
              )}
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
  emptyHint,
}: {
  facts: KGFactSummary[] | undefined;
  isLoading: boolean;
  emptyLabel: string;
  emptyHint?: string;
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
        {emptyHint && (
          <p className="mt-1 text-sm text-muted-foreground">{emptyHint}</p>
        )}
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
  const [roleFilter, setRoleFilter] = useState("");
  const [entityFilter, setEntityFilter] = useState("");
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

  const filteredSearchFacts = useMemo(() => {
    const facts = searchData?.facts ?? [];
    const roleNeedle = roleFilter.trim().toLowerCase();
    const entityNeedle = entityFilter.trim().toLowerCase();

    if (!roleNeedle && !entityNeedle) return facts;

    return facts.filter((fact) => {
      if (!fact.roles || fact.roles.length === 0) return false;
      return fact.roles.some((role) => {
        const roleMatch = !roleNeedle || role.role.toLowerCase().includes(roleNeedle);
        const entityMatch = !entityNeedle || role.entity_name.toLowerCase().includes(entityNeedle);
        return roleMatch && entityMatch;
      });
    });
  }, [searchData?.facts, roleFilter, entityFilter]);

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
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="role-filter" className="text-xs">
                Filter roles
              </Label>
              <Input
                id="role-filter"
                placeholder="e.g., owner, blocker"
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="entity-filter" className="text-xs">
                Filter entities
              </Label>
              <Input
                id="entity-filter"
                placeholder="e.g., Apollo, login handler"
                value={entityFilter}
                onChange={(e) => setEntityFilter(e.target.value)}
              />
            </div>
          </div>
          {(roleFilter || entityFilter) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setRoleFilter("");
                setEntityFilter("");
              }}
            >
              Clear filters
            </Button>
          )}

          {query.length < 2 ? (
            <div className="flex flex-col items-center justify-center py-16">
              <Search className="h-12 w-12 text-muted-foreground/50" />
              <p className="mt-4 text-muted-foreground">
                Enter at least 2 characters to search
              </p>
            </div>
          ) : (
            <FactsList
              facts={filteredSearchFacts}
              isLoading={showSearchLoading}
              emptyLabel={`No facts found for "${query}"`}
              emptyHint={roleFilter || entityFilter ? "Try clearing the role/entity filters." : undefined}
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
