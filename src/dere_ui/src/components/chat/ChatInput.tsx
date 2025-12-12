import { useState, useRef, useEffect } from "react";
import { ArrowUp, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useChatInputState, useChatActions, useChatHeaderState } from "@/stores/selectors";
import { usePersonalities } from "@/hooks/queries";
import { cn } from "@/lib/utils";
import { darkenHex, isHexColor } from "@/lib/color";

export function ChatInput() {
  const [input, setInput] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { status, sessionId, isQueryInProgress, isLocked } = useChatInputState();
  const { sessionConfig } = useChatHeaderState();
  const { sendQuery, cancelQuery } = useChatActions();
  const { data: personalities } = usePersonalities();

  const canSend = status === "connected" && sessionId && input.trim() && !isQueryInProgress && !isLocked;

  const personalityKey = (() => {
    const p = sessionConfig?.personality;
    if (Array.isArray(p)) return p[0] || "";
    return p || "";
  })();
  const personalityInfo = personalities?.personalities.find((p) => p.name === personalityKey);
  const personalityColor = personalityInfo?.color;
  const sendBg = isHexColor(personalityColor) ? darkenHex(personalityColor, 0.25) : "#f97316";

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
    <div className="p-4">
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
            "absolute bottom-2 right-2 h-9 w-9 rounded-full transition-all duration-200 hover:brightness-110",
            isQueryInProgress
              ? "bg-white/90 text-black hover:bg-white animate-pulse"
              : canSend
                ? "text-white"
                : "bg-muted text-muted-foreground"
          )}
          style={!isQueryInProgress && canSend ? { backgroundColor: sendBg } : undefined}
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
