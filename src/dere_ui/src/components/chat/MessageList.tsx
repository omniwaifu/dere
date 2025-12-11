import { useEffect, useRef } from "react";
import { useMessageListState, useChatActions } from "@/stores/selectors";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MessageBubble } from "./MessageBubble";
import { ThinkingIndicator } from "./ThinkingIndicator";
import { ErrorDisplay } from "./ErrorDisplay";
import { MessageSquare, Loader2 } from "lucide-react";

export function MessageList() {
  const {
    messages,
    streamingMessage,
    isQueryInProgress,
    isLoadingMessages,
    loadError,
  } = useMessageListState();
  const { retryLoad } = useChatActions();
  const viewportRef = useRef<HTMLDivElement>(null);

  const isWaitingForResponse = isQueryInProgress && !streamingMessage;

  const allMessages = streamingMessage
    ? [...messages, streamingMessage]
    : messages;

  useEffect(() => {
    if (viewportRef.current) {
      viewportRef.current.scrollTop = viewportRef.current.scrollHeight;
    }
  }, [allMessages.length, streamingMessage?.content]);

  if (loadError) {
    return <ErrorDisplay message={loadError} onRetry={retryLoad} />;
  }

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
    <ScrollArea className="flex-1" viewportRef={viewportRef}>
      <div className="mx-auto max-w-3xl space-y-2 p-3">
        {allMessages.map((message, index) => (
          <MessageBubble
            key={message.id}
            message={message}
            isLatest={index === allMessages.length - 1}
          />
        ))}
        {isWaitingForResponse && (
          <div className="flex justify-start">
            <div className="max-w-[85%]">
              <ThinkingIndicator isStreaming />
            </div>
          </div>
        )}
      </div>
    </ScrollArea>
  );
}
