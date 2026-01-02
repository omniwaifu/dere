import { useEffect, useRef } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useChatStore } from "@/stores/chat";
import { useChatViewState, useChatActions } from "@/stores/selectors";
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
  const { status, sessionId: currentSessionId, isCreatingNewSession, lastSeq } = useChatViewState();
  const { resumeSession } = useChatActions();
  const clearSession = useChatStore((s) => s.clearSession);

  const isNewSessionRoute = sessionId === "new";
  const numericSessionId = isNewSessionRoute ? null : Number(sessionId);

  // Track if we've already navigated to prevent double navigation
  const hasNavigatedRef = useRef(false);

  // Clear session state when arriving at /chat/new
  // Also clear isCreatingNewSession when leaving to prevent stale navigation
  useEffect(() => {
    if (isNewSessionRoute) {
      hasNavigatedRef.current = false;
      clearSession();
    }
    return () => {
      // When leaving /chat/new (or unmounting), clear the creating flag
      // to prevent navigation to a session we abandoned
      if (isNewSessionRoute) {
        useChatStore.setState({ isCreatingNewSession: false });
      }
    };
  }, [isNewSessionRoute, clearSession]);

  // Auto-resume session when navigating to an existing session
  useEffect(() => {
    if (status !== "connected") return;
    if (isNewSessionRoute) return;

    if (numericSessionId && numericSessionId !== currentSessionId) {
      resumeSession(numericSessionId, lastSeq);
    }
  }, [status, isNewSessionRoute, numericSessionId, currentSessionId, resumeSession, lastSeq]);

  // Navigate to real session URL when a new session is created.
  // Only navigate if we explicitly called newSession() (isCreatingNewSession flag).
  // This prevents navigating when a background resume completes.
  useEffect(() => {
    if (
      isNewSessionRoute &&
      currentSessionId &&
      isCreatingNewSession && // Only when we explicitly created a new session
      status === "connected" &&
      !hasNavigatedRef.current
    ) {
      hasNavigatedRef.current = true;
      navigate({
        to: "/chat/$sessionId",
        params: { sessionId: String(currentSessionId) },
      });
    }
  }, [isNewSessionRoute, currentSessionId, isCreatingNewSession, status, navigate]);

  // Always show form when on /chat/new
  if (isNewSessionRoute) {
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
