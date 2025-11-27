import { createRootRoute, Outlet } from "@tanstack/react-router";
import { useEffect } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { useChatStore } from "@/stores/chat";

export const Route = createRootRoute({
  component: RootLayout,
});

function RootLayout() {
  const connect = useChatStore((s) => s.connect);

  useEffect(() => {
    connect();
  }, [connect]);

  return (
    <AppLayout>
      <Outlet />
    </AppLayout>
  );
}
