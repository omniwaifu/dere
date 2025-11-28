import { useEffect, useRef } from "react";
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
  const messages = useChatStore((s) => s.messages);
  const resumeSession = useChatStore((s) => s.resumeSession);
  const clearSession = useChatStore((s) => s.clearSession);
  const lastSeq = useChatStore((s) => s.lastSeq);

  const isNewSession = sessionId === "new";
  const numericSessionId = isNewSession ? null : Number(sessionId);

  // Track if we've cleared for this "new" navigation
  const hasClearedRef = useRef(false);

  // Clear session state when navigating to /chat/new
  useEffect(() => {
    if (isNewSession && !hasClearedRef.current) {
      hasClearedRef.current = true;
      clearSession();
    } else if (!isNewSession) {
      hasClearedRef.current = false;
    }
  }, [isNewSession, clearSession]);

  // Auto-resume session when navigating to an existing session
  useEffect(() => {
    if (status !== "connected") return;
    if (isNewSession) return;

    if (numericSessionId && numericSessionId !== currentSessionId) {
      resumeSession(numericSessionId, lastSeq);
    }
  }, [status, isNewSession, numericSessionId, currentSessionId, resumeSession, lastSeq]);

  // Navigate to real session URL when a new session is created.
  // Key insight: a just-created session has no messages yet, while an old session
  // we're navigating away from still has messages until clearSession() runs.
  useEffect(() => {
    if (
      isNewSession &&
      currentSessionId &&
      messages.length === 0 &&
      status === "connected" &&
      hasClearedRef.current // Only after we've cleared (prevents race on initial mount)
    ) {
      navigate({
        to: "/chat/$sessionId",
        params: { sessionId: String(currentSessionId) },
      });
    }
  }, [isNewSession, currentSessionId, messages.length, status, navigate]);

  // Always show form when on /chat/new
  if (isNewSession) {
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
