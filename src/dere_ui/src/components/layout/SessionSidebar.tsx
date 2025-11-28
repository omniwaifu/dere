import { Link, useParams, useNavigate } from "@tanstack/react-router";
import { Plus, MessageSquare, Trash2, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useSessions, useDeleteSession } from "@/hooks/queries";
import { cn } from "@/lib/utils";

export function SessionSidebar() {
  const navigate = useNavigate();
  const { sessionId } = useParams({ strict: false });
  const { data, isLoading, isError, refetch } = useSessions();
  const deleteSession = useDeleteSession();

  const currentSessionId = sessionId === "new" ? null : Number(sessionId);

  const handleNewChat = () => {
    // Just navigate - ChatView handles clearing when it sees /chat/new
    navigate({ to: "/chat/$sessionId", params: { sessionId: "new" } });
  };

  return (
    <aside className="flex w-64 flex-col bg-muted/30">
      <div className="p-4">
        <Button className="w-full gap-2" onClick={handleNewChat}>
          <Plus className="h-4 w-4" />
          New Chat
        </Button>
      </div>

      <Separator />

      <ScrollArea className="flex-1">
        <div className="p-2">
          {isLoading && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )}

          {isError && !isLoading && (
            <div className="flex flex-col items-center gap-2 py-8">
              <p className="text-sm text-muted-foreground">
                Failed to load sessions
              </p>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => refetch()}
                className="gap-1"
              >
                <RefreshCw className="h-3 w-3" />
                Retry
              </Button>
            </div>
          )}

          {!isError && data?.sessions.length === 0 && !isLoading && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No sessions yet
            </p>
          )}

          {data?.sessions.map((session) => (
            <div
              key={session.session_id}
              className={cn(
                "group flex items-center gap-2 rounded-md px-2 py-2 hover:bg-accent",
                currentSessionId === session.session_id && "bg-accent"
              )}
            >
              <Link
                to="/chat/$sessionId"
                params={{ sessionId: String(session.session_id) }}
                className="flex flex-1 items-center gap-2 overflow-hidden"
              >
                <MessageSquare className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="truncate text-sm">
                  {session.name ||
                    session.config.working_dir.split("/").pop() ||
                    session.config.working_dir}
                </span>
              </Link>

              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 opacity-0 group-hover:opacity-100"
                onClick={(e) => {
                  e.preventDefault();
                  if (confirm("Delete this session?")) {
                    deleteSession.mutate(session.session_id);
                  }
                }}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          ))}
        </div>
      </ScrollArea>
    </aside>
  );
}
