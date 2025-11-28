import { useEffect, useRef } from "react";
import { useChatStore } from "@/stores/chat";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MessageBubble } from "./MessageBubble";
import { MessageSquare, Loader2 } from "lucide-react";

export function MessageList() {
  const messages = useChatStore((s) => s.messages);
  const streamingMessage = useChatStore((s) => s.streamingMessage);
  const isQueryInProgress = useChatStore((s) => s.isQueryInProgress);
  const isLoadingMessages = useChatStore((s) => s.isLoadingMessages);
  const scrollRef = useRef<HTMLDivElement>(null);

  const isWaitingForResponse = isQueryInProgress && !streamingMessage;

  const allMessages = streamingMessage
    ? [...messages, streamingMessage]
    : messages;

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [allMessages.length, streamingMessage?.content]);

  if (isLoadingMessages) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center text-muted-foreground">
          <Loader2 className="mx-auto h-8 w-8 animate-spin" />
          <p className="mt-4">Loading conversation...</p>
        </div>
      </div>
    );
  }

  if (allMessages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center text-muted-foreground">
          <MessageSquare className="mx-auto h-12 w-12 opacity-50" />
          <p className="mt-4">Start a conversation</p>
        </div>
      </div>
    );
  }

  return (
    <ScrollArea className="flex-1" ref={scrollRef}>
      <div className="space-y-4 p-4">
        {allMessages.map((message) => (
          <MessageBubble key={message.id} message={message} />
        ))}
        {isWaitingForResponse && (
          <div className="flex items-center gap-2 px-4 py-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Thinking...</span>
          </div>
        )}
      </div>
    </ScrollArea>
  );
}
