import { useState, useRef, useEffect } from "react";
import { Link, useParams, useNavigate } from "@tanstack/react-router";
import {
  Trash2,
  Loader2,
  RefreshCw,
  SquarePen,
  Search,
  PanelLeft,
  PanelLeftClose,
  X,
  User,
  Settings,
  MoreHorizontal,
  Share,
  Pencil,
  Lock,
  Rocket,
  Palette,
} from "lucide-react";
import logoImg from "@/assets/logo.png";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSessions, useDeleteSession, useRenameSession, useUserInfo } from "@/hooks/queries";
import { cn } from "@/lib/utils";

export function SessionSidebar() {
  const navigate = useNavigate();
  const { sessionId } = useParams({ strict: false });
  const { data, isLoading, isError, refetch } = useSessions();
  const deleteSession = useDeleteSession();
  const renameSession = useRenameSession();
  const { data: userInfo } = useUserInfo();

  const [isCollapsed, setIsCollapsed] = useState(() =>
    localStorage.getItem("sidebar-collapsed") === "true"
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [renamingSessionId, setRenamingSessionId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  const currentSessionId = sessionId === "new" ? null : Number(sessionId);

  // Persist collapse state
  useEffect(() => {
    localStorage.setItem("sidebar-collapsed", String(isCollapsed));
  }, [isCollapsed]);

  // Focus search input when opening
  useEffect(() => {
    if (isSearching && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [isSearching]);

  // Handle escape to close search or cancel rename
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (isSearching) {
          setIsSearching(false);
          setSearchQuery("");
        }
        if (renamingSessionId !== null) {
          setRenamingSessionId(null);
          setRenameValue("");
        }
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isSearching, renamingSessionId]);

  // Focus rename input when renaming
  useEffect(() => {
    if (renamingSessionId !== null && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingSessionId]);

  const handleNewChat = () => {
    navigate({ to: "/chat/$sessionId", params: { sessionId: "new" } });
  };

  const handleSearchClick = () => {
    if (isCollapsed) {
      setIsCollapsed(false);
    }
    setIsSearching(true);
  };

  const filteredSessions = data?.sessions.filter((session) => {
    const name = session.name || session.config.working_dir;
    const isSwarmRun = name.toLowerCase().startsWith("swarm:");
    if (isSwarmRun) return false;
    if (!searchQuery) return true;
    return name.toLowerCase().includes(searchQuery.toLowerCase());
  });

  const handleStartRename = (sessionId: number, currentName: string) => {
    setRenamingSessionId(sessionId);
    setRenameValue(currentName);
  };

  const handleSubmitRename = () => {
    if (renamingSessionId !== null && renameValue.trim()) {
      renameSession.mutate({ id: renamingSessionId, name: renameValue.trim() });
    }
    setRenamingSessionId(null);
    setRenameValue("");
  };

  return (
    <aside
      className={cn(
        "flex flex-col bg-muted/30 transition-all duration-200",
        isCollapsed ? "w-14" : "w-64"
      )}
    >
      {/* Header with logo and collapse toggle */}
      <div className="flex h-12 items-center justify-between px-3">
        {isCollapsed ? (
          /* Collapsed: logo that turns into expand icon on hover */
          <button
            onClick={() => setIsCollapsed(false)}
            className="group flex h-8 w-8 cursor-pointer items-center justify-center rounded-md hover:bg-accent"
            title="Expand sidebar"
          >
            <img src={logoImg} alt="dere" className="h-5 w-5 transition-opacity group-hover:opacity-0" />
            <PanelLeft className="absolute h-4 w-4 opacity-0 transition-opacity group-hover:opacity-100" />
          </button>
        ) : (
          /* Expanded: logo + name on left (clickable for new chat), collapse button on right */
          <>
            <button
              onClick={handleNewChat}
              className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1 hover:bg-accent"
              title="New chat"
            >
              <img src={logoImg} alt="dere" className="h-5 w-5" />
              <span className="text-sm font-medium text-foreground/80">dere</span>
            </button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => setIsCollapsed(true)}
              title="Collapse sidebar"
            >
              <PanelLeftClose className="h-4 w-4" />
            </Button>
          </>
        )}
      </div>

      {/* Action buttons */}
      <div className="space-y-1 px-2">
        {/* New chat button */}
        <Button
          variant="ghost"
          className={cn(
            "w-full justify-start gap-2",
            isCollapsed && "justify-center px-0"
          )}
          onClick={handleNewChat}
          title="New chat"
        >
          <SquarePen className="h-4 w-4" />
          {!isCollapsed && <span>New chat</span>}
        </Button>

        {/* Search button */}
        <Button
          variant="ghost"
          className={cn(
            "w-full justify-start gap-2",
            isCollapsed && "justify-center px-0"
          )}
          onClick={handleSearchClick}
          title="Search chats"
        >
          <Search className="h-4 w-4" />
          {!isCollapsed && <span>Search chats</span>}
        </Button>

        {/* Missions link */}
        <Button
          variant="ghost"
          className={cn(
            "w-full justify-start gap-2",
            isCollapsed && "justify-center px-0"
          )}
          onClick={() => navigate({ to: "/missions" })}
          title="Missions"
        >
          <Rocket className="h-4 w-4" />
          {!isCollapsed && <span>Missions</span>}
        </Button>
      </div>

      {/* Search input (shown when searching) */}
      {isSearching && !isCollapsed && (
        <div className="px-2 py-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search..."
              className="w-full rounded-md border border-input bg-background py-1.5 pl-8 pr-8 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Session list (hidden when collapsed) */}
      {!isCollapsed && (
        <ScrollArea className="flex-1" viewportClassName="pr-3">
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

            {!isError && filteredSessions?.length === 0 && !isLoading && (
              <p className="py-8 text-center text-sm text-muted-foreground">
                {searchQuery ? "No matches" : "No sessions yet"}
              </p>
            )}

            {filteredSessions?.map((session) => {
              const displayName =
                session.name ||
                session.config.working_dir.split("/").pop() ||
                session.config.working_dir;
              const isRenaming = renamingSessionId === session.session_id;

              return (
                <div
                  key={session.session_id}
                  className={cn(
                    "group flex items-center gap-2 rounded-md px-2 py-2 hover:bg-accent",
                    currentSessionId === session.session_id && "bg-accent"
                  )}
                >
                  {isRenaming ? (
                    <input
                      ref={renameInputRef}
                      type="text"
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleSubmitRename();
                      }}
                      onBlur={handleSubmitRename}
                      className="flex-1 truncate bg-transparent text-sm outline-none"
                    />
                  ) : (
                    <>
                      {session.mission_id && (
                        <span title="Mission-spawned session">
                          <Rocket className="h-3.5 w-3.5 shrink-0 text-primary/70" />
                        </span>
                      )}
                      {session.is_locked && (
                        <span title="Session locked (sandbox container stopped)">
                          <Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        </span>
                      )}
                      <Link
                        to="/chat/$sessionId"
                        params={{ sessionId: String(session.session_id) }}
                        className={cn(
                          "flex flex-1 items-center overflow-hidden",
                          session.is_locked && "text-muted-foreground"
                        )}
                        onDoubleClick={(e) => {
                          e.preventDefault();
                          handleStartRename(session.session_id, displayName);
                        }}
                      >
                        <span className="truncate text-sm">{displayName}</span>
                      </Link>

                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 shrink-0 cursor-pointer opacity-0 group-hover:opacity-100"
                            onClick={(e) => e.preventDefault()}
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-32">
                          <DropdownMenuItem disabled>
                            <Share className="mr-2 h-4 w-4" />
                            Share
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => handleStartRename(session.session_id, displayName)}
                          >
                            <Pencil className="mr-2 h-4 w-4" />
                            Rename
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => {
                              if (confirm("Delete this session?")) {
                                const isCurrentSession = currentSessionId === session.session_id;
                                deleteSession.mutate(session.session_id, {
                                  onSuccess: () => {
                                    if (isCurrentSession) {
                                      navigate({ to: "/" });
                                    }
                                  },
                                });
                              }
                            }}
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </ScrollArea>
      )}

      {/* User profile section */}
      <div className="mt-auto border-t border-border p-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2 py-2 hover:bg-accent",
                isCollapsed && "justify-center"
              )}
            >
              <User className="h-4 w-4 shrink-0" />
              {!isCollapsed && (
                <span className="truncate text-sm">
                  {userInfo?.name || "User"}
                </span>
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="w-48">
            <DropdownMenuItem onClick={() => navigate({ to: "/personalities" })}>
              <Palette className="mr-2 h-4 w-4" />
              Personalities
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => navigate({ to: "/settings" })}>
              <Settings className="mr-2 h-4 w-4" />
              Settings
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </aside>
  );
}
