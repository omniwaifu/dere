import { createFileRoute, Link } from "@tanstack/react-router";
import { Palette, Plus, RotateCcw, Trash2 } from "lucide-react";
import { usePersonalitiesEditor, useDeletePersonality } from "@/hooks/queries";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import type { PersonalityEditorInfo, PersonalitySource } from "@/types/api";

export const Route = createFileRoute("/personalities")({
  component: PersonalitiesPage,
});

function getSourceBadge(source: PersonalitySource) {
  switch (source) {
    case "embedded":
      return <Badge variant="secondary">Built-in</Badge>;
    case "user":
      return <Badge variant="default">Custom</Badge>;
    case "override":
      return (
        <Badge variant="secondary" className="bg-primary/10 text-primary">
          Customized
        </Badge>
      );
    default:
      return null;
  }
}

function PersonalityCard({ personality }: { personality: PersonalityEditorInfo }) {
  const deletePersonality = useDeletePersonality();
  const isDeleteable = personality.source === "user" || personality.source === "override";
  const deleteAction = personality.source === "override" ? "reset" : "delete";

  return (
    <Card className="group relative hover:border-primary/50 transition-colors">
      <Link
        to="/personality/$name"
        params={{ name: personality.short_name }}
        className="absolute inset-0 z-10"
      />
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span
              className="flex h-10 w-10 items-center justify-center rounded-lg text-lg font-semibold"
              style={{ backgroundColor: personality.color + "20", color: personality.color }}
            >
              {personality.icon}
            </span>
            <div>
              <CardTitle className="text-lg">{personality.name}</CardTitle>
              <CardDescription className="text-xs">{personality.short_name}</CardDescription>
            </div>
          </div>
          {getSourceBadge(personality.source)}
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <div className="h-3 w-3 rounded-full" style={{ backgroundColor: personality.color }} />
          <span>{personality.color}</span>
        </div>
      </CardContent>

      {isDeleteable && (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-3 top-3 z-20 h-8 w-8 opacity-0 transition-opacity group-hover:opacity-100"
              onClick={(e) => e.preventDefault()}
            >
              {deleteAction === "reset" ? (
                <RotateCcw className="h-4 w-4" />
              ) : (
                <Trash2 className="h-4 w-4 text-destructive" />
              )}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {deleteAction === "reset"
                  ? `Reset ${personality.name} to default?`
                  : `Delete ${personality.name}?`}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {deleteAction === "reset"
                  ? "This will remove your customizations and restore the built-in version."
                  : "This action cannot be undone. The personality will be permanently deleted."}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => deletePersonality.mutate(personality.short_name)}
                className={
                  deleteAction === "delete"
                    ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    : ""
                }
              >
                {deleteAction === "reset" ? "Reset" : "Delete"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </Card>
  );
}

function PersonalitiesPage() {
  const { data, isLoading, isError } = usePersonalitiesEditor();

  if (isLoading) {
    return (
      <div className="flex flex-1 flex-col p-6">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Palette className="h-6 w-6" />
            <h1 className="text-2xl font-semibold">Personalities</h1>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-32 w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-1 flex-col p-6">
        <div className="mb-6 flex items-center gap-3">
          <Palette className="h-6 w-6" />
          <h1 className="text-2xl font-semibold">Personalities</h1>
        </div>
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4">
          <p className="text-destructive">Failed to load personalities</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col p-6">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Palette className="h-6 w-6" />
          <h1 className="text-2xl font-semibold">Personalities</h1>
        </div>
        <Button asChild>
          <Link to="/personality/$name" params={{ name: "new" }}>
            <Plus className="mr-2 h-4 w-4" />
            New Personality
          </Link>
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {data?.personalities.map((personality) => (
          <PersonalityCard key={personality.short_name} personality={personality} />
        ))}
      </div>
    </div>
  );
}
