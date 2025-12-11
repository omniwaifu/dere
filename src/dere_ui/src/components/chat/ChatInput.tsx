import { useState, useRef, useEffect } from "react";
import { ArrowUp, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useChatStore } from "@/stores/chat";
import { cn } from "@/lib/utils";

export function ChatInput() {
  const [input, setInput] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const status = useChatStore((s) => s.status);
  const sessionId = useChatStore((s) => s.sessionId);
  const isQueryInProgress = useChatStore((s) => s.isQueryInProgress);
  const isLocked = useChatStore((s) => s.isLocked);
  const sendQuery = useChatStore((s) => s.sendQuery);
  const cancelQuery = useChatStore((s) => s.cancelQuery);

  const canSend = status === "connected" && sessionId && input.trim() && !isQueryInProgress && !isLocked;

  const handleSubmit = () => {
    if (!canSend) return;
    sendQuery(input.trim());
    setInput("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  useEffect(() => {
    if (!isQueryInProgress && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [isQueryInProgress]);

  return (
    <div className="border-t border-border p-4">
      <div className="relative mx-auto max-w-3xl">
        <Textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            status !== "connected"
              ? "Connecting..."
              : !sessionId
                ? "Select or create a session"
                : isLocked
                  ? "Session locked (sandbox container stopped)"
                  : "Send a message... (Enter to send, Shift+Enter for newline)"
          }
          disabled={status !== "connected" || !sessionId || isLocked}
          className="min-h-[80px] resize-none pr-14"
        />

        <Button
          size="icon"
          onClick={isQueryInProgress ? cancelQuery : handleSubmit}
          disabled={!isQueryInProgress && !canSend}
          className={cn(
            "absolute bottom-2 right-2 h-9 w-9 rounded-full transition-all duration-200",
            isQueryInProgress
              ? "bg-white/90 text-black hover:bg-white animate-pulse"
              : canSend
                ? "bg-orange-500 text-white hover:bg-orange-600"
                : "bg-muted text-muted-foreground"
          )}
        >
          {isQueryInProgress ? (
            <Square className="h-4 w-4 fill-current" />
          ) : (
            <ArrowUp className="h-5 w-5" />
          )}
        </Button>
      </div>
    </div>
  );
}
