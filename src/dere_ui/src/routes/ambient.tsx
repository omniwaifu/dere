import { createFileRoute } from "@tanstack/react-router";
import { Radio } from "lucide-react";

export const Route = createFileRoute("/ambient")({
  component: AmbientPage,
});

function AmbientPage() {
  return (
    <div className="flex flex-1 flex-col p-6">
      <div className="mb-6 flex items-center gap-3">
        <Radio className="h-6 w-6" />
        <h1 className="text-2xl font-semibold">Ambient Monitor</h1>
      </div>
      <div className="flex flex-1 items-center justify-center text-muted-foreground">
        <p>Ambient monitoring dashboard coming soon</p>
      </div>
    </div>
  );
}
