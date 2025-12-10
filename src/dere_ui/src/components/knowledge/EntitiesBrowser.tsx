import { useState } from "react";
import { Brain, ArrowUpDown, ChevronLeft, ChevronRight, Filter } from "lucide-react";
import { useKGEntities, useKGLabels } from "@/hooks/queries";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { KGEntitySummary } from "@/types/api";

type SortField = "mention_count" | "retrieval_quality" | "last_mentioned" | "created_at";

const SORT_OPTIONS: { value: SortField; label: string }[] = [
  { value: "mention_count", label: "Mentions" },
  { value: "retrieval_quality", label: "Quality" },
  { value: "last_mentioned", label: "Last Mentioned" },
  { value: "created_at", label: "Created" },
];

const PAGE_SIZE = 20;

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "Never";
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

function EntityCard({ entity }: { entity: KGEntitySummary }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 hover:bg-accent/50 transition-colors">
      <div className="flex items-start justify-between gap-3">
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
        <div className="text-right shrink-0">
          <div className="text-sm font-medium">{entity.mention_count}</div>
          <div className="text-xs text-muted-foreground">mentions</div>
        </div>
      </div>

      {entity.summary && (
        <p className="mt-2 text-sm text-muted-foreground line-clamp-2">
          {entity.summary}
        </p>
      )}

      <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
        <span>Quality: {entity.retrieval_quality.toFixed(2)}</span>
        <span>Last: {formatDate(entity.last_mentioned)}</span>
      </div>
    </div>
  );
}

export function EntitiesBrowser() {
  const [sortBy, setSortBy] = useState<SortField>("mention_count");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [selectedLabels, setSelectedLabels] = useState<string[]>([]);
  const [offset, setOffset] = useState(0);

  const { data: labelsData } = useKGLabels();
  const { data, isLoading, isError } = useKGEntities({
    labels: selectedLabels.length > 0 ? selectedLabels : undefined,
    sort_by: sortBy,
    sort_order: sortOrder,
    limit: PAGE_SIZE,
    offset,
  });

  const totalPages = Math.ceil((data?.total ?? 0) / PAGE_SIZE);
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  const handleLabelToggle = (label: string) => {
    setSelectedLabels((prev) =>
      prev.includes(label)
        ? prev.filter((l) => l !== label)
        : [...prev, label]
    );
    setOffset(0);
  };

  const toggleSortOrder = () => {
    setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
    setOffset(0);
  };

  if (isLoading && offset === 0) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Skeleton className="h-9 w-32" />
          <Skeleton className="h-9 w-32" />
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-32 w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <p className="text-destructive">Failed to load entities</p>
        <p className="text-sm text-muted-foreground mt-1">
          Make sure the daemon is running and FalkorDB is connected
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={sortBy}
          onValueChange={(v) => {
            setSortBy(v as SortField);
            setOffset(0);
          }}
        >
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Sort by" />
          </SelectTrigger>
          <SelectContent>
            {SORT_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button variant="outline" size="icon" onClick={toggleSortOrder}>
          <ArrowUpDown className="h-4 w-4" />
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="gap-1.5">
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

        <div className="flex-1" />

        <span className="text-sm text-muted-foreground">
          {data?.total ?? 0} entities
        </span>
      </div>

      {data?.entities && data.entities.length > 0 ? (
        <>
          <ScrollArea className="h-[calc(100vh-18rem)]">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3 pr-4">
              {data.entities.map((entity) => (
                <EntityCard key={entity.uuid} entity={entity} />
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
          <Brain className="h-12 w-12 text-muted-foreground/50" />
          <p className="mt-4 text-muted-foreground">No entities found</p>
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
    </div>
  );
}
