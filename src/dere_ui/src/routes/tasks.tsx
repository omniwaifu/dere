import { createFileRoute } from "@tanstack/react-router";
import { CheckSquare } from "lucide-react";

export const Route = createFileRoute("/tasks")({
  component: TasksPage,
});

function TasksPage() {
  return (
    <div className="flex flex-1 flex-col p-6">
      <div className="mb-6 flex items-center gap-3">
        <CheckSquare className="h-6 w-6" />
        <h1 className="text-2xl font-semibold">Tasks</h1>
      </div>
      <div className="flex flex-1 items-center justify-center text-muted-foreground">
        <p>Task management coming soon</p>
      </div>
    </div>
  );
}
