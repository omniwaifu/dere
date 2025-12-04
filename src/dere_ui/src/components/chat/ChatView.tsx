import { useEffect, useRef } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useChatStore } from "@/stores/chat";
import { ChatHeader } from "./ChatHeader";
import { MessageList } from "./MessageList";
import { ChatInput } from "./ChatInput";
import { NewSessionForm } from "./NewSessionForm";
import { PermissionDialog } from "./PermissionDialog";

interface ChatViewProps {
  sessionId: string;
}

export function ChatView({ sessionId }: ChatViewProps) {
  const navigate = useNavigate();
  const status = useChatStore((s) => s.status);
  const currentSessionId = useChatStore((s) => s.sessionId);
  const resumeSession = useChatStore((s) => s.resumeSession);
  const clearSession = useChatStore((s) => s.clearSession);
  const lastSeq = useChatStore((s) => s.lastSeq);

  const isNewSession = sessionId === "new";
  const numericSessionId = isNewSession ? null : Number(sessionId);

  // Track the session ID we had before navigating to /chat/new
  // This prevents redirecting back to the old session
  const previousSessionIdRef = useRef<number | null>(null);
  const hasClearedRef = useRef(false);

  // Clear session state when navigating to /chat/new
  useEffect(() => {
    if (isNewSession && !hasClearedRef.current) {
      // Remember what session we came from so we don't redirect back to it
      previousSessionIdRef.current = currentSessionId;
      hasClearedRef.current = true;
      clearSession();
    } else if (!isNewSession) {
      hasClearedRef.current = false;
      previousSessionIdRef.current = null;
    }
  }, [isNewSession, clearSession, currentSessionId]);

  // Auto-resume session when navigating to an existing session
  useEffect(() => {
    if (status !== "connected") return;
    if (isNewSession) return;

    if (numericSessionId && numericSessionId !== currentSessionId) {
      resumeSession(numericSessionId, lastSeq);
    }
  }, [status, isNewSession, numericSessionId, currentSessionId, resumeSession, lastSeq]);

  // Navigate to real session URL when a new session is created.
  // We navigate when we're on /chat/new and a NEW session ID is assigned.
  useEffect(() => {
    if (
      isNewSession &&
      currentSessionId &&
      currentSessionId !== previousSessionIdRef.current && // Must be a NEW session, not the old one
      status === "connected" &&
      hasClearedRef.current
    ) {
      navigate({
        to: "/chat/$sessionId",
        params: { sessionId: String(currentSessionId) },
      });
    }
  }, [isNewSession, currentSessionId, status, navigate]);

  // Always show form when on /chat/new
  if (isNewSession) {
    return <NewSessionForm />;
  }

  return (
    <div className="flex h-full flex-col">
      <ChatHeader />
      <MessageList />
      <ChatInput />
      <PermissionDialog />
    </div>
  );
}
