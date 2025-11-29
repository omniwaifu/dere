import { createFileRoute } from "@tanstack/react-router";
import { Heart } from "lucide-react";

export const Route = createFileRoute("/emotion")({
  component: EmotionPage,
});

function EmotionPage() {
  return (
    <div className="flex flex-1 flex-col p-6">
      <div className="mb-6 flex items-center gap-3">
        <Heart className="h-6 w-6" />
        <h1 className="text-2xl font-semibold">Emotion State</h1>
      </div>
      <div className="flex flex-1 items-center justify-center text-muted-foreground">
        <p>Emotion visualization coming soon</p>
      </div>
    </div>
  );
}
