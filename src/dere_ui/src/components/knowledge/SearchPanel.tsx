import { useState, useMemo } from "react";
import { Search, Network, ArrowRight, Filter } from "lucide-react";
import { useKGSearch, useKGLabels } from "@/hooks/queries";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { KGEntitySummary, KGEdgeSummary } from "@/types/api";

function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useMemo(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debouncedValue;
}

function EntityResult({ entity }: { entity: KGEntitySummary }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3 hover:bg-accent/50 transition-colors">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <h3 className="font-medium truncate">{entity.name}</h3>
          <div className="flex flex-wrap items-center gap-1 mt-1">
            {entity.labels.map((label) => (
              <Badge key={label} variant="outline" className="text-xs">
                {label}
              </Badge>
            ))}
          </div>
        </div>
        <Badge variant="secondary" className="shrink-0">
          {entity.mention_count} mentions
        </Badge>
      </div>
      {entity.summary && (
        <p className="mt-2 text-sm text-muted-foreground line-clamp-2">
          {entity.summary}
        </p>
      )}
    </div>
  );
}

function EdgeResult({ edge }: { edge: KGEdgeSummary }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3 hover:bg-accent/50 transition-colors">
      <div className="flex items-center gap-2 text-sm">
        <span className="font-medium truncate">{edge.source_name}</span>
        <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
        <Badge variant="secondary" className="shrink-0">{edge.relation}</Badge>
        <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
        <span className="font-medium truncate">{edge.target_name}</span>
      </div>
      <p className="mt-2 text-sm text-muted-foreground line-clamp-2">
        {edge.fact}
      </p>
      {edge.valid_at && (
        <div className="mt-2 text-xs text-muted-foreground">
          Valid: {new Date(edge.valid_at).toLocaleDateString()}
          {edge.invalid_at && (
            <span> - {new Date(edge.invalid_at).toLocaleDateString()}</span>
          )}
        </div>
      )}
    </div>
  );
}

export function SearchPanel() {
  const [query, setQuery] = useState("");
  const [includeEdges, setIncludeEdges] = useState(true);
  const [selectedLabels, setSelectedLabels] = useState<string[]>([]);

  const debouncedQuery = useDebounce(query, 300);

  const { data: labelsData } = useKGLabels();
  const { data, isLoading, isFetching } = useKGSearch(
    debouncedQuery,
    {
      include_edges: includeEdges,
      labels: selectedLabels.length > 0 ? selectedLabels : undefined,
      limit: 30,
    },
    { enabled: debouncedQuery.length >= 2 }
  );

  const handleLabelToggle = (label: string) => {
    setSelectedLabels((prev) =>
      prev.includes(label)
        ? prev.filter((l) => l !== label)
        : [...prev, label]
    );
  };

  const showLoading = isLoading || (isFetching && query !== debouncedQuery);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search entities and facts..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
          />
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Switch
              id="include-edges"
              checked={includeEdges}
              onCheckedChange={setIncludeEdges}
            />
            <Label htmlFor="include-edges" className="text-sm">
              Show relationships
            </Label>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5">
                <Filter className="h-4 w-4" />
                Labels
                {selectedLabels.length > 0 && (
                  <Badge variant="secondary" className="ml-1 px-1.5">
                    {selectedLabels.length}
                  </Badge>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-48">
              {labelsData?.labels?.map((label) => (
                <DropdownMenuCheckboxItem
                  key={label}
                  checked={selectedLabels.includes(label)}
                  onCheckedChange={() => handleLabelToggle(label)}
                >
                  {label}
                </DropdownMenuCheckboxItem>
              ))}
              {(!labelsData?.labels || labelsData.labels.length === 0) && (
                <div className="px-2 py-1.5 text-sm text-muted-foreground">
                  No labels found
                </div>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {query.length < 2 ? (
        <div className="flex flex-col items-center justify-center py-16">
          <Search className="h-12 w-12 text-muted-foreground/50" />
          <p className="mt-4 text-muted-foreground">
            Enter at least 2 characters to search
          </p>
        </div>
      ) : showLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : (
        <>
          {data?.entities && data.entities.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Search className="h-4 w-4" />
                Entities ({data.entities.length})
              </h2>
              <ScrollArea className={includeEdges && data.edges?.length ? "h-[calc(50vh-12rem)]" : "h-[calc(100vh-18rem)]"}>
                <div className="space-y-2 pr-4">
                  {data.entities.map((entity) => (
                    <EntityResult key={entity.uuid} entity={entity} />
                  ))}
                </div>
              </ScrollArea>
            </div>
          )}

          {includeEdges && data?.edges && data.edges.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Network className="h-4 w-4" />
                Relationships ({data.edges.length})
              </h2>
              <ScrollArea className={data.entities?.length ? "h-[calc(50vh-12rem)]" : "h-[calc(100vh-18rem)]"}>
                <div className="space-y-2 pr-4">
                  {data.edges.map((edge) => (
                    <EdgeResult key={edge.uuid} edge={edge} />
                  ))}
                </div>
              </ScrollArea>
            </div>
          )}

          {(!data?.entities || data.entities.length === 0) &&
            (!data?.edges || data.edges.length === 0) && (
              <div className="flex flex-col items-center justify-center py-16">
                <Search className="h-12 w-12 text-muted-foreground/50" />
                <p className="mt-4 text-muted-foreground">
                  No results found for "{query}"
                </p>
                {selectedLabels.length > 0 && (
                  <Button
                    variant="link"
                    className="mt-2"
                    onClick={() => setSelectedLabels([])}
                  >
                    Clear label filter
                  </Button>
                )}
              </div>
            )}
        </>
      )}
    </div>
  );
}
