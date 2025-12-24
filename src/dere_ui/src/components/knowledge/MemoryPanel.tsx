import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  Archive,
  Clock,
  FileText,
  History,
  Loader2,
  Search,
  UserRound,
} from "lucide-react";
import {
  useConfig,
  useSessions,
  useCoreMemoryBlocks,
  useCoreMemoryHistory,
  useUpdateCoreMemory,
  useRollbackCoreMemory,
  useArchivalFactInsert,
  useConsolidationRuns,
  useKGFactSearch,
  useRecallSearch,
} from "@/hooks/queries";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { FactDetailPanel } from "@/components/knowledge/FactDetailPanel";
import type {
  CoreMemoryBlock,
  CoreMemoryBlockType,
  CoreMemoryHistoryEntry,
  CoreMemoryScope,
  KGFactSummary,
  ConsolidationRun,
  RecallSearchResult,
  SessionResponse,
} from "@/types/api";

const CORE_BLOCKS: Array<{ type: CoreMemoryBlockType; title: string; description: string }> = [
  {
    type: "persona",
    title: "Persona",
    description: "How the assistant should show up, tone, and working style.",
  },
  {
    type: "human",
    title: "Human",
    description: "Important facts and preferences about the user.",
  },
  {
    type: "task",
    title: "Task",
    description: "Current objectives, constraints, and focus areas.",
  },
];

const DEFAULT_CHAR_LIMIT = 8192;

function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debouncedValue;
}

function formatRelativeTime(value?: string | null): string {
  if (!value) return "unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const diffMs = Date.now() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

function formatEpoch(seconds: number): string {
  const date = new Date(seconds * 1000);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString();
}

function formatDuration(start?: string | null, end?: string | null): string {
  if (!start || !end) return "";
  const startDate = new Date(start);
  const endDate = new Date(end);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return "";
  const seconds = Math.max(0, Math.floor((endDate.getTime() - startDate.getTime()) / 1000));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  if (minutes > 0) return `${minutes}m ${remainder}s`;
  return `${remainder}s`;
}

function sessionLabel(session: SessionResponse): string {
  return session.name || session.config.working_dir.split("/").pop() || session.config.working_dir;
}

function MemoryScopePicker({
  scope,
  sessionId,
  sessions,
  userId,
  onScopeChange,
  onSessionChange,
}: {
  scope: CoreMemoryScope;
  sessionId: number | null;
  sessions: SessionResponse[];
  userId?: string;
  onScopeChange: (value: CoreMemoryScope) => void;
  onSessionChange: (value: number | null) => void;
}) {
  const sessionValue = sessionId ? String(sessionId) : "none";
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Archive className="h-4 w-4" />
          Memory Scope
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Label className="text-xs">Scope</Label>
          <Select value={scope} onValueChange={(value) => onScopeChange(value as CoreMemoryScope)}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="user">User</SelectItem>
              <SelectItem value="session">Session</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {scope === "session" ? (
          <div className="flex items-center gap-2">
            <Label className="text-xs">Session</Label>
            <Select
              value={sessionValue}
              onValueChange={(value) => onSessionChange(value === "none" ? null : Number(value))}
            >
              <SelectTrigger className="min-w-[220px]">
                <SelectValue placeholder="Select session" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none" disabled>
                  {sessions.length === 0 ? "No sessions found" : "Select session"}
                </SelectItem>
                {sessions.map((session) => (
                  <SelectItem key={session.session_id} value={String(session.session_id)}>
                    {sessionLabel(session)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : (
          <Badge variant="secondary" className="gap-1">
            <UserRound className="h-3 w-3" />
            {userId || "unknown user"}
          </Badge>
        )}
      </CardContent>
    </Card>
  );
}

function CoreMemoryCard({
  block,
  blockType,
  scope,
  sessionId,
  userId,
}: {
  block: CoreMemoryBlock | null;
  blockType: CoreMemoryBlockType;
  scope: CoreMemoryScope;
  sessionId: number | null;
  userId?: string;
}) {
  const updateMemory = useUpdateCoreMemory();
  const [draft, setDraft] = useState(block?.content ?? "");
  const [reason, setReason] = useState("");

  useEffect(() => {
    setDraft(block?.content ?? "");
  }, [block?.content]);

  const meta = CORE_BLOCKS.find((entry) => entry.type === blockType);
  const charLimit = block?.char_limit ?? DEFAULT_CHAR_LIMIT;
  const charCount = draft.length;
  const isDirty = draft !== (block?.content ?? "");
  const exceedsLimit = charCount > charLimit;
  const canSave =
    !exceedsLimit &&
    (scope === "user" ? Boolean(userId) : Boolean(sessionId)) &&
    isDirty;
  const isSaving =
    updateMemory.isPending && updateMemory.variables?.block_type === blockType;

  const handleReset = () => {
    setDraft(block?.content ?? "");
    setReason("");
  };

  const handleSave = () => {
    if (!canSave) return;
    const trimmedReason = reason.trim();
    updateMemory.mutate({
      block_type: blockType,
      content: draft,
      reason: trimmedReason ? trimmedReason : undefined,
      scope,
      session_id: scope === "session" ? sessionId ?? undefined : undefined,
      user_id: scope === "user" ? userId : undefined,
    });
    setReason("");
  };

  return (
    <Card className="flex h-full flex-col">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">{meta?.title ?? blockType}</CardTitle>
            <p className="text-xs text-muted-foreground">{meta?.description}</p>
          </div>
          <Badge variant="outline" className="text-xs">
            v{block?.version ?? 0}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3">
        <Textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="No memory captured yet."
          className="min-h-[160px] resize-none"
        />
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span className={exceedsLimit ? "text-destructive" : undefined}>
            {charCount} / {charLimit} chars
          </span>
          <span>
            Updated {block?.updated_at ? formatRelativeTime(block.updated_at) : "never"}
          </span>
        </div>
        <Input
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Reason for change (optional)"
        />
        <div className="mt-auto flex flex-wrap items-center gap-2">
          <Button onClick={handleSave} disabled={!canSave || isSaving}>
            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save
          </Button>
          {isDirty && (
            <Button variant="ghost" onClick={handleReset}>
              Reset
            </Button>
          )}
          {updateMemory.isError && (
            <span className="text-xs text-destructive">Failed to update</span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function CoreMemoryHistory({
  entries,
  isLoading,
  isError,
  onRollback,
}: {
  entries: CoreMemoryHistoryEntry[] | undefined;
  isLoading: boolean;
  isError: boolean;
  onRollback: (entry: CoreMemoryHistoryEntry) => void;
}) {
  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, idx) => (
          <Skeleton key={idx} className="h-20 w-full" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <p className="text-sm text-muted-foreground">
        No history yet for this block.
      </p>
    );
  }

  if (!entries || entries.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No memory edits yet.</p>
    );
  }

  return (
    <div className="space-y-3">
      {entries.map((entry) => (
        <div
          key={`${entry.block_id}-${entry.version}`}
          className="rounded-lg border border-border bg-card/60 p-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Badge variant="secondary">v{entry.version}</Badge>
              <span className="text-xs text-muted-foreground">
                {formatRelativeTime(entry.created_at)}
              </span>
            </div>
            <Button variant="outline" size="sm" onClick={() => onRollback(entry)}>
              Rollback
            </Button>
          </div>
          {entry.reason && (
            <p className="mt-2 text-xs text-muted-foreground">
              Reason: {entry.reason}
            </p>
          )}
          <p className="mt-2 text-sm whitespace-pre-wrap text-muted-foreground">
            {entry.content}
          </p>
        </div>
      ))}
    </div>
  );
}

function RecallResultCard({ result }: { result: RecallSearchResult }) {
  const messageType = result.message_type ?? result.result_type;
  const messageVariant =
    messageType === "user"
      ? "default"
      : messageType === "assistant"
        ? "secondary"
        : "outline";
  const badgeLabel =
    result.result_type === "exploration_finding" ? "exploration" : messageType;

  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge variant={messageVariant} className="capitalize">
            {badgeLabel}
          </Badge>
          <span className="text-xs text-muted-foreground">
            {formatEpoch(result.timestamp)}
          </span>
        </div>
        <Badge variant="outline" className="text-xs">
          {result.score.toFixed(3)}
        </Badge>
      </div>
      <p className="mt-2 text-sm text-muted-foreground whitespace-pre-wrap">
        {result.text}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        {result.session_id !== undefined && result.session_id !== null && (
          <span>Session {result.session_id}</span>
        )}
        {result.task_id && <span>Task {result.task_id}</span>}
        {result.medium && <span>Medium: {result.medium}</span>}
        {result.user_id && <span>User: {result.user_id}</span>}
        {typeof result.confidence === "number" && (
          <span>Confidence: {result.confidence.toFixed(2)}</span>
        )}
        {result.session_id !== undefined && result.session_id !== null && (
          <Link
            to="/chat/$sessionId"
            params={{ sessionId: String(result.session_id) }}
            className="ml-auto"
          >
            <Button variant="ghost" size="sm">
              Open session
            </Button>
          </Link>
        )}
      </div>
    </div>
  );
}

const RUN_STAT_LABELS: Array<{ key: string; label: string }> = [
  { key: "summary_blocks", label: "summaries" },
  { key: "merged_entities", label: "merges" },
  { key: "pruned_edges", label: "edges pruned" },
  { key: "pruned_facts", label: "facts pruned" },
  { key: "pruned_low_quality_facts", label: "low-quality facts" },
  { key: "core_memory_updates", label: "core updates" },
  { key: "communities", label: "communities" },
];

function ConsolidationRunCard({ run }: { run: ConsolidationRun }) {
  const duration = formatDuration(run.started_at, run.finished_at);
  const statusVariant =
    run.status === "completed"
      ? "secondary"
      : run.status === "failed"
        ? "destructive"
        : "outline";

  const stats = run.stats ?? {};
  const statChips = RUN_STAT_LABELS.map(({ key, label }) => {
    const value = stats[key];
    if (typeof value !== "number" || value <= 0) return null;
    return (
      <Badge key={`${run.id}-${key}`} variant="outline" className="text-xs">
        {value} {label}
      </Badge>
    );
  }).filter(Boolean);

  return (
    <div className="rounded-lg border border-border bg-card/60 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge variant={statusVariant} className="capitalize">
            {run.status}
          </Badge>
          <span className="text-xs text-muted-foreground">
            {run.started_at ? formatRelativeTime(run.started_at) : "unknown"}
          </span>
          {duration && (
            <span className="text-xs text-muted-foreground">({duration})</span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {run.triggered_by && (
            <Badge variant="outline" className="text-xs capitalize">
              {run.triggered_by}
            </Badge>
          )}
          {run.recency_days !== null && run.recency_days !== undefined && (
            <Badge variant="outline" className="text-xs">
              {run.recency_days}d window
            </Badge>
          )}
        </div>
      </div>
      {run.update_core_memory && (
        <div className="mt-2">
          <Badge variant="secondary" className="text-xs">
            core memory update enabled
          </Badge>
        </div>
      )}
      {statChips.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">{statChips}</div>
      )}
      {run.error_message && (
        <p className="mt-2 text-xs text-destructive line-clamp-3">
          {run.error_message}
        </p>
      )}
    </div>
  );
}

function normalizeStringList(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry)).filter(Boolean);
  }
  return [String(value)].filter(Boolean);
}

function ArchivalFactCard({
  fact,
  onSelect,
}: {
  fact: KGFactSummary;
  onSelect: (fact: KGFactSummary) => void;
}) {
  const tags = normalizeStringList(fact.attributes?.tags);
  const sources = normalizeStringList(fact.attributes?.sources);

  return (
    <button
      type="button"
      onClick={() => onSelect(fact)}
      className="w-full rounded-lg border border-border bg-card p-3 text-left hover:bg-accent/50 transition-colors"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-foreground/90 line-clamp-2">{fact.fact}</p>
        <Badge variant="outline" className="text-xs">
          {fact.roles.length} roles
        </Badge>
      </div>
      {(tags.length > 0 || sources.length > 0) && (
        <div className="mt-2 flex flex-wrap gap-1">
          {tags.map((tag) => (
            <Badge key={`tag-${fact.uuid}-${tag}`} variant="secondary" className="text-xs">
              #{tag}
            </Badge>
          ))}
          {sources.map((source) => (
            <Badge key={`src-${fact.uuid}-${source}`} variant="outline" className="text-xs">
              {source}
            </Badge>
          ))}
        </div>
      )}
      <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
        {fact.valid_at && <span>Valid {new Date(fact.valid_at).toLocaleDateString()}</span>}
        {fact.invalid_at && <span>Invalid {new Date(fact.invalid_at).toLocaleDateString()}</span>}
        <span>Created {new Date(fact.created_at).toLocaleDateString()}</span>
      </div>
    </button>
  );
}

export function MemoryPanel() {
  const { data: config } = useConfig();
  const { data: sessionsData, isLoading: sessionsLoading } = useSessions();
  const [scope, setScope] = useState<CoreMemoryScope>("user");
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [historyBlockType, setHistoryBlockType] = useState<CoreMemoryBlockType>(
    "persona"
  );
  const [historyLimit, setHistoryLimit] = useState("12");

  const [recallQuery, setRecallQuery] = useState("");
  const [recallDays, setRecallDays] = useState("30");
  const [recallSessionId, setRecallSessionId] = useState<string>("all");

  const [archivalFact, setArchivalFact] = useState("");
  const [archivalSource, setArchivalSource] = useState("");
  const [archivalTags, setArchivalTags] = useState("");
  const [archivalValidAt, setArchivalValidAt] = useState("");
  const [archivalInvalidAt, setArchivalInvalidAt] = useState("");
  const [archivalQuery, setArchivalQuery] = useState("");
  const [archivalStartDate, setArchivalStartDate] = useState("");
  const [archivalEndDate, setArchivalEndDate] = useState("");
  const [archivalLimit, setArchivalLimit] = useState("25");
  const [archivalIncludeExpired, setArchivalIncludeExpired] = useState(false);
  const [selectedArchivalFact, setSelectedArchivalFact] = useState<KGFactSummary | null>(null);
  const [lastInsert, setLastInsert] = useState<{ created: boolean; fact: KGFactSummary } | null>(null);

  useEffect(() => {
    if (scope === "session" && !sessionId && sessionsData?.sessions?.length) {
      setSessionId(sessionsData.sessions[0].session_id);
    }
  }, [scope, sessionId, sessionsData]);

  const userId = config?.user_id;
  const sessions = useMemo(() => sessionsData?.sessions ?? [], [sessionsData]);

  const blocksEnabled = scope === "user" ? Boolean(userId) : Boolean(sessionId);
  const historyEnabled = blocksEnabled;

  const { data: blocks, isLoading: blocksLoading, isError: blocksError } =
    useCoreMemoryBlocks(
      {
        user_id: scope === "user" ? userId : undefined,
        session_id: scope === "session" ? sessionId ?? undefined : undefined,
      },
      { enabled: blocksEnabled }
    );

  const { data: history, isLoading: historyLoading, isError: historyError } =
    useCoreMemoryHistory(
      {
        block_type: historyBlockType,
        limit: Number(historyLimit) || 12,
        scope,
        session_id: scope === "session" ? sessionId ?? undefined : undefined,
        user_id: scope === "user" ? userId : undefined,
      },
      { enabled: historyEnabled }
    );

  const rollbackMemory = useRollbackCoreMemory();

  const recallSessions = useMemo(
    () => [{ label: "All sessions", value: "all" }].concat(
      sessions.map((session) => ({
        label: sessionLabel(session),
        value: String(session.session_id),
      }))
    ),
    [sessions]
  );

  const debouncedQuery = useDebounce(recallQuery, 300);
  const recallDaysValue = Number(recallDays);
  const recallSessionValue = recallSessionId !== "all" ? Number(recallSessionId) : undefined;

  const {
    data: recallResults,
    isLoading: recallLoading,
    isFetching: recallFetching,
    isError: recallError,
  } = useRecallSearch(
    debouncedQuery,
    {
      limit: 25,
      days_back: Number.isFinite(recallDaysValue) ? recallDaysValue : undefined,
      session_id: recallSessionValue,
      user_id: userId,
    },
    { enabled: debouncedQuery.length >= 2 }
  );

  const archivalInsert = useArchivalFactInsert();
  const debouncedArchivalQuery = useDebounce(archivalQuery, 300);
  const archivalLimitValue = Number(archivalLimit) || 25;
  const {
    data: archivalResults,
    isLoading: archivalLoading,
    isFetching: archivalFetching,
    isError: archivalError,
  } = useKGFactSearch(
    debouncedArchivalQuery,
    {
      limit: archivalLimitValue,
      include_roles: true,
      include_expired: archivalIncludeExpired,
      start_date: archivalStartDate || undefined,
      end_date: archivalEndDate || undefined,
      archival_only: true,
      user_id: userId,
    },
    { enabled: debouncedArchivalQuery.length >= 2 }
  );

  const {
    data: consolidationRuns,
    isLoading: consolidationLoading,
    isError: consolidationError,
  } = useConsolidationRuns({
    user_id: userId,
    limit: 8,
    offset: 0,
  });

  const blockMap = useMemo(() => {
    const map = new Map<CoreMemoryBlockType, CoreMemoryBlock>();
    blocks?.forEach((block) => {
      map.set(block.block_type, block);
    });
    return map;
  }, [blocks]);

  const handleRollback = (entry: CoreMemoryHistoryEntry) => {
    if (!confirm(`Rollback to version ${entry.version}?`)) return;
    rollbackMemory.mutate({
      block_type: historyBlockType,
      target_version: entry.version,
      scope,
      session_id: scope === "session" ? sessionId ?? undefined : undefined,
      user_id: scope === "user" ? userId : undefined,
    });
  };

  const handleArchivalInsert = () => {
    const factText = archivalFact.trim();
    if (!factText) return;
    const tags = archivalTags
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
    archivalInsert.mutate(
      {
        fact: factText,
        source: archivalSource.trim() || undefined,
        tags: tags.length ? tags : undefined,
        valid_at: archivalValidAt || undefined,
        invalid_at: archivalInvalidAt || undefined,
        user_id: userId,
      },
      {
        onSuccess: (data) => {
          setLastInsert(data);
          setArchivalFact("");
          setArchivalSource("");
          setArchivalTags("");
          setArchivalValidAt("");
          setArchivalInvalidAt("");
        },
      }
    );
  };

  return (
    <div className="space-y-6">
      <MemoryScopePicker
        scope={scope}
        sessionId={sessionId}
        sessions={sessions}
        userId={userId}
        onScopeChange={setScope}
        onSessionChange={setSessionId}
      />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Core Memory Blocks
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              These blocks are always injected into the system prompt.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            {sessionsLoading && scope === "session" && (
              <div className="space-y-2">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-32 w-full" />
              </div>
            )}
            {!blocksEnabled && (
              <p className="text-sm text-muted-foreground">
                Select a session to load session-scoped memory.
              </p>
            )}
            {blocksLoading && blocksEnabled ? (
              <div className="space-y-4">
                {CORE_BLOCKS.map((block) => (
                  <Skeleton key={block.type} className="h-48 w-full" />
                ))}
              </div>
            ) : blocksError ? (
              <p className="text-sm text-destructive">Failed to load core memory.</p>
            ) : (
              <div className="space-y-4">
                {CORE_BLOCKS.map((block) => (
                  <CoreMemoryCard
                    key={block.type}
                    blockType={block.type}
                    block={blockMap.get(block.type) ?? null}
                    scope={scope}
                    sessionId={sessionId}
                    userId={userId}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2">
              <History className="h-4 w-4" />
              Memory History
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Review edits and roll back if a block drifts.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="history-block" className="text-xs">
                  Block
                </Label>
                <Select
                  value={historyBlockType}
                  onValueChange={(value) => setHistoryBlockType(value as CoreMemoryBlockType)}
                >
                  <SelectTrigger id="history-block" className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CORE_BLOCKS.map((block) => (
                      <SelectItem key={block.type} value={block.type}>
                        {block.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="history-limit" className="text-xs">
                  Limit
                </Label>
                <Input
                  id="history-limit"
                  type="number"
                  min={1}
                  max={50}
                  value={historyLimit}
                  onChange={(event) => setHistoryLimit(event.target.value)}
                  className="w-24"
                />
              </div>
              {rollbackMemory.isPending && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Rolling back...
                </div>
              )}
            </div>
            <ScrollArea className="h-[360px] pr-4">
              <CoreMemoryHistory
                entries={history}
                isLoading={historyLoading}
                isError={historyError}
                onRollback={handleRollback}
              />
            </ScrollArea>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2">
            <Search className="h-4 w-4" />
            Recall Search
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Search past conversation turns and exploration findings with hybrid recall.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-[2fr_1fr_1fr]">
            <div className="space-y-1.5">
              <Label htmlFor="recall-query" className="text-xs">
                Query
              </Label>
              <Input
                id="recall-query"
                value={recallQuery}
                onChange={(event) => setRecallQuery(event.target.value)}
                placeholder="What did we say about embeddings?"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="recall-days" className="text-xs">
                Days back
              </Label>
              <Input
                id="recall-days"
                type="number"
                min={1}
                value={recallDays}
                onChange={(event) => setRecallDays(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="recall-session" className="text-xs">
                Session filter
              </Label>
              <Select value={recallSessionId} onValueChange={setRecallSessionId}>
                <SelectTrigger id="recall-session">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {recallSessions.map((session) => (
                    <SelectItem key={session.value} value={session.value}>
                      {session.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {recallLoading || (recallFetching && recallQuery !== debouncedQuery) ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, idx) => (
                <Skeleton key={idx} className="h-24 w-full" />
              ))}
            </div>
          ) : recallError ? (
            <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-destructive">
              Failed to search recall memory.
            </div>
          ) : debouncedQuery.length < 2 ? (
            <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              Type at least 2 characters to search recall memory.
            </div>
          ) : recallResults?.results?.length ? (
            <div className="space-y-3">
              {recallResults.results.map((result) => (
                <RecallResultCard key={result.result_id} result={result} />
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              No recall matches found for this query.
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2">
            <Archive className="h-4 w-4" />
            Archival Memory
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Store deliberate long-term facts and retrieve them on demand.
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-6 xl:grid-cols-[1.1fr_1.4fr]">
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="archival-fact" className="text-xs">
                  Fact
                </Label>
                <Textarea
                  id="archival-fact"
                  value={archivalFact}
                  onChange={(event) => setArchivalFact(event.target.value)}
                  placeholder="E.g. User prefers terse summaries in the morning."
                  className="min-h-[120px]"
                />
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="archival-source" className="text-xs">
                    Source
                  </Label>
                  <Input
                    id="archival-source"
                    value={archivalSource}
                    onChange={(event) => setArchivalSource(event.target.value)}
                    placeholder="meeting notes"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="archival-tags" className="text-xs">
                    Tags
                  </Label>
                  <Input
                    id="archival-tags"
                    value={archivalTags}
                    onChange={(event) => setArchivalTags(event.target.value)}
                    placeholder="preferences, workflow"
                  />
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="archival-valid" className="text-xs">
                    Valid from
                  </Label>
                  <Input
                    id="archival-valid"
                    type="datetime-local"
                    value={archivalValidAt}
                    onChange={(event) => setArchivalValidAt(event.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="archival-invalid" className="text-xs">
                    Invalid after
                  </Label>
                  <Input
                    id="archival-invalid"
                    type="datetime-local"
                    value={archivalInvalidAt}
                    onChange={(event) => setArchivalInvalidAt(event.target.value)}
                  />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  onClick={handleArchivalInsert}
                  disabled={!archivalFact.trim() || archivalInsert.isPending}
                >
                  {archivalInsert.isPending && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  Save to archival memory
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setArchivalFact("");
                    setArchivalSource("");
                    setArchivalTags("");
                    setArchivalValidAt("");
                    setArchivalInvalidAt("");
                  }}
                >
                  Clear
                </Button>
                {archivalInsert.isError && (
                  <span className="text-xs text-destructive">Failed to save fact.</span>
                )}
              </div>
              {lastInsert && (
                <div className="rounded-lg border border-border bg-card/60 p-3 text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground">
                    {lastInsert.created ? "Created" : "Updated"}
                  </span>{" "}
                  archival fact: {lastInsert.fact.fact}
                </div>
              )}
            </div>

            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-[2fr_1fr]">
                <div className="space-y-1.5">
                  <Label htmlFor="archival-query" className="text-xs">
                    Search query
                  </Label>
                  <Input
                    id="archival-query"
                    value={archivalQuery}
                    onChange={(event) => setArchivalQuery(event.target.value)}
                    placeholder="Find facts about preferences or projects"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="archival-limit" className="text-xs">
                    Limit
                  </Label>
                  <Input
                    id="archival-limit"
                    type="number"
                    min={5}
                    max={100}
                    value={archivalLimit}
                    onChange={(event) => setArchivalLimit(event.target.value)}
                  />
                </div>
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="archival-start" className="text-xs">
                    Start date
                  </Label>
                  <Input
                    id="archival-start"
                    type="date"
                    value={archivalStartDate}
                    onChange={(event) => setArchivalStartDate(event.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="archival-end" className="text-xs">
                    End date
                  </Label>
                  <Input
                    id="archival-end"
                    type="date"
                    value={archivalEndDate}
                    onChange={(event) => setArchivalEndDate(event.target.value)}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={archivalIncludeExpired}
                    onCheckedChange={setArchivalIncludeExpired}
                    id="archival-expired"
                  />
                  <Label htmlFor="archival-expired" className="text-xs">
                    Include expired
                  </Label>
                </div>
              </div>

              {archivalLoading || (archivalFetching && archivalQuery !== debouncedArchivalQuery) ? (
                <div className="space-y-3">
                  {Array.from({ length: 3 }).map((_, idx) => (
                    <Skeleton key={idx} className="h-24 w-full" />
                  ))}
                </div>
              ) : archivalError ? (
                <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-destructive">
                  Failed to search archival memory.
                </div>
              ) : debouncedArchivalQuery.length < 2 ? (
                <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                  Type at least 2 characters to search archival memory.
                </div>
              ) : archivalResults?.facts?.length ? (
                <div className="space-y-3">
                  {archivalResults.facts.map((fact) => (
                    <ArchivalFactCard
                      key={fact.uuid}
                      fact={fact}
                      onSelect={setSelectedArchivalFact}
                    />
                  ))}
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                  No archival facts matched this query.
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-4 w-4" />
            Consolidation Runs
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Track sleeptime consolidation tasks and their outcomes.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {consolidationLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, idx) => (
                <Skeleton key={idx} className="h-20 w-full" />
              ))}
            </div>
          ) : consolidationError ? (
            <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-destructive">
              Failed to load consolidation runs.
            </div>
          ) : consolidationRuns?.runs?.length ? (
            <div className="space-y-3">
              {consolidationRuns.runs.map((run) => (
                <ConsolidationRunCard key={run.id} run={run} />
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              No consolidation runs recorded yet.
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Clock className="h-3.5 w-3.5" />
        Core memory updates are applied immediately; history is stored for rollback.
      </div>

      <FactDetailPanel
        fact={selectedArchivalFact}
        onClose={() => setSelectedArchivalFact(null)}
      />
    </div>
  );
}
