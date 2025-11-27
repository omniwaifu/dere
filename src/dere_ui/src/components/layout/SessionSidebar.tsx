import { Link, useParams } from "@tanstack/react-router";
import { Plus, MessageSquare, Trash2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useSessions, useDeleteSession } from "@/hooks/queries";
import { cn } from "@/lib/utils";

export function SessionSidebar() {
  const { sessionId } = useParams({ strict: false });
  const { data, isLoading } = useSessions();
  const deleteSession = useDeleteSession();

  const currentSessionId = sessionId === "new" ? null : Number(sessionId);

  return (
    <aside className="flex w-64 flex-col bg-muted/30">
      <div className="p-4">
        <Link to="/chat/$sessionId" params={{ sessionId: "new" }}>
          <Button className="w-full gap-2">
            <Plus className="h-4 w-4" />
            New Chat
          </Button>
        </Link>
      </div>

      <Separator />

      <ScrollArea className="flex-1">
        <div className="p-2">
          {isLoading && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )}

          {data?.sessions.length === 0 && !isLoading && (
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
                  {session.config.working_dir.split("/").pop() ||
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
