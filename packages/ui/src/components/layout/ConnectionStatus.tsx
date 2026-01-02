import { useState, useEffect } from "react";
import { useConnectionState, useChatActions } from "@/stores/selectors";
import { cn } from "@/lib/utils";

const SHOW_DISCONNECTED_DELAY_MS = 3000;

export function ConnectionStatus() {
  const { status, error, reconnectAttempts, disconnectedAt } = useConnectionState();
  const { connect } = useChatActions();
  const [showDisconnected, setShowDisconnected] = useState(false);

  // Only show disconnected state after delay
  useEffect(() => {
    let timer: number | undefined;
    if (status === "disconnected" && disconnectedAt) {
      const elapsed = Date.now() - disconnectedAt;
      const remaining = SHOW_DISCONNECTED_DELAY_MS - elapsed;

      const delay = Math.max(0, remaining);
      timer = window.setTimeout(() => setShowDisconnected(true), delay);
    } else {
      timer = window.setTimeout(() => setShowDisconnected(false), 0);
    }
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [status, disconnectedAt]);

  // Determine visual state
  const isConnected = status === "connected";
  const isConnecting = status === "connecting";
  const isReconnecting = isConnecting && reconnectAttempts > 0;
  const hasError = status === "error";
  const isDisconnected = status === "disconnected" && showDisconnected;

  // Connected or briefly disconnected - just show green dot
  if (isConnected || (status === "disconnected" && !showDisconnected)) {
    return (
      <div className="flex items-center px-2" title="Connected to daemon">
        <div className="h-2 w-2 rounded-full bg-green-500" />
      </div>
    );
  }

  // Status text for title
  let statusText = "Connecting...";
  if (isReconnecting) {
    statusText = `Reconnecting (attempt ${reconnectAttempts}/10)...`;
  } else if (hasError) {
    statusText = error || "Connection error";
  } else if (isDisconnected) {
    statusText = "Disconnected - click to reconnect";
  }

  return (
    <button
      type="button"
      onClick={isDisconnected || hasError ? connect : undefined}
      title={statusText}
      className={cn(
        "flex items-center gap-1.5 rounded px-2 py-1 text-xs transition-colors",
        (isDisconnected || hasError) && "cursor-pointer hover:bg-muted",
        isConnecting && "cursor-default",
      )}
    >
      <div
        className={cn(
          "h-2 w-2 rounded-full",
          isConnecting && "animate-pulse bg-yellow-500",
          hasError && "bg-red-500",
          isDisconnected && "bg-orange-500",
        )}
      />
      {(hasError || isDisconnected) && (
        <span className="text-muted-foreground">{hasError ? "Error" : "Offline"}</span>
      )}
      {isReconnecting && <span className="text-muted-foreground">{reconnectAttempts}/10</span>}
    </button>
  );
}
