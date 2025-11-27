import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useChatStore } from "@/stores/chat";
import { ChatHeader } from "./ChatHeader";
import { MessageList } from "./MessageList";
import { ChatInput } from "./ChatInput";
import { NewSessionForm } from "./NewSessionForm";

interface ChatViewProps {
  sessionId: string;
}

export function ChatView({ sessionId }: ChatViewProps) {
  const navigate = useNavigate();
  const status = useChatStore((s) => s.status);
  const currentSessionId = useChatStore((s) => s.sessionId);
  const resumeSession = useChatStore((s) => s.resumeSession);
  const lastSeq = useChatStore((s) => s.lastSeq);

  const isNewSession = sessionId === "new";
  const numericSessionId = isNewSession ? null : Number(sessionId);

  useEffect(() => {
    if (status !== "connected") return;

    if (numericSessionId && numericSessionId !== currentSessionId) {
      resumeSession(numericSessionId, lastSeq);
    }
  }, [status, numericSessionId, currentSessionId, resumeSession, lastSeq]);

  useEffect(() => {
    if (isNewSession && currentSessionId && status === "connected") {
      navigate({
        to: "/chat/$sessionId",
        params: { sessionId: String(currentSessionId) },
      });
    }
  }, [isNewSession, currentSessionId, status, navigate]);

  if (isNewSession && !currentSessionId) {
    return <NewSessionForm />;
  }

  return (
    <div className="flex h-full flex-col">
      <ChatHeader />
      <MessageList />
      <ChatInput />
    </div>
  );
}
