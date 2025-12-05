import { createRootRoute, Outlet } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { useChatStore } from "@/stores/chat";
import { queryKeys } from "@/hooks/queries";
import { api } from "@/lib/api";

export const Route = createRootRoute({
  component: RootLayout,
});

function RootLayout() {
  const queryClient = useQueryClient();
  const connect = useChatStore((s) => s.connect);
  const addOnSessionCreated = useChatStore((s) => s.addOnSessionCreated);
  const addOnFirstResponse = useChatStore((s) => s.addOnFirstResponse);

  useEffect(() => {
    connect();

    // When a session is created via WebSocket, invalidate the sessions list
    const removeSessionCreated = addOnSessionCreated(() => {
      queryClient.invalidateQueries({ queryKey: queryKeys.sessions });
    });

    // When first response completes, generate session name
    const removeFirstResponse = addOnFirstResponse(async (sessionId) => {
      try {
        await api.sessions.generateName(sessionId);
        queryClient.invalidateQueries({ queryKey: queryKeys.sessions });
      } catch (error) {
        console.error("Failed to generate session name:", error);
      }
    });

    return () => {
      removeSessionCreated();
      removeFirstResponse();
    };
  }, [connect, addOnSessionCreated, addOnFirstResponse, queryClient]);

  return (
    <AppLayout>
      <Outlet />
    </AppLayout>
  );
}
