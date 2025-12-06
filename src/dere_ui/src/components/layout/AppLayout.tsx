import type { ReactNode } from "react";
import { SessionSidebar } from "./SessionSidebar";
import { RightPanel } from "./RightPanel";
import { RareEventToast } from "@/components/RareEventToast";
import { useChatStore } from "@/stores/chat";
import { AlertCircle } from "lucide-react";

interface AppLayoutProps {
  children: ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  const status = useChatStore((s) => s.status);
  const error = useChatStore((s) => s.error);

  return (
    <div className="flex h-screen flex-col bg-background">
      {status !== "connected" && (
        <div className="flex items-center justify-center gap-2 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4" />
          {status === "connecting" && "Connecting to daemon..."}
          {status === "disconnected" && "Disconnected from daemon"}
          {status === "error" && (error || "Connection error")}
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        <SessionSidebar />

        <main className="flex flex-1 flex-col overflow-hidden border-x border-border">
          {children}
        </main>

        <RightPanel />
      </div>

      <RareEventToast />
    </div>
  );
}
