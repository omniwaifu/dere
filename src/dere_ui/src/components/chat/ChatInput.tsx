import { useState, useRef, useEffect } from "react";
import { Send, Square, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useChatStore } from "@/stores/chat";

export function ChatInput() {
  const [input, setInput] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const status = useChatStore((s) => s.status);
  const sessionId = useChatStore((s) => s.sessionId);
  const isQueryInProgress = useChatStore((s) => s.isQueryInProgress);
  const sendQuery = useChatStore((s) => s.sendQuery);
  const cancelQuery = useChatStore((s) => s.cancelQuery);

  const canSend = status === "connected" && sessionId && input.trim() && !isQueryInProgress;

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
      <div className="flex gap-2">
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
                : "Send a message... (Enter to send, Shift+Enter for newline)"
          }
          disabled={status !== "connected" || !sessionId}
          className="min-h-[80px] resize-none"
        />

        <div className="flex flex-col gap-2">
          {isQueryInProgress ? (
            <Button
              variant="destructive"
              size="icon"
              onClick={cancelQuery}
              className="h-10 w-10"
            >
              <Square className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              size="icon"
              onClick={handleSubmit}
              disabled={!canSend}
              className="h-10 w-10"
            >
              <Send className="h-4 w-4" />
            </Button>
          )}

          {isQueryInProgress && (
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          )}
        </div>
      </div>
    </div>
  );
}
