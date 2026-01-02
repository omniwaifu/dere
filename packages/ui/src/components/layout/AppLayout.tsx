import type { ReactNode } from "react";
import { SessionSidebar } from "./SessionSidebar";
import { RightPanel } from "./RightPanel";

interface AppLayoutProps {
  children: ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  return (
    <div className="flex h-screen flex-col bg-background">
      <div className="flex flex-1 overflow-hidden">
        <SessionSidebar />

        <main className="flex flex-1 flex-col overflow-hidden border-x border-border">
          {children}
        </main>

        <RightPanel />
      </div>
    </div>
  );
}
