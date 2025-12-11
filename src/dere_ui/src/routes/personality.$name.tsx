import { useState, useEffect } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Save, RotateCcw, X, Plus } from "lucide-react";
import { usePersonalityEditor, useSavePersonality, useDeletePersonality } from "@/hooks/queries";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import type { PersonalityData } from "@/types/api";

export const Route = createFileRoute("/personality/$name")({
  component: PersonalityEditPage,
});

function createEmptyPersonality(): PersonalityData {
  return {
    metadata: {
      name: "",
      short_name: "",
      aliases: [],
    },
    display: {
      color: "#6366f1",
      icon: "●",
      announcement: "",
    },
    prompt: {
      content: "",
    },
  };
}

function PersonalityEditPage() {
  const { name } = Route.useParams();
  const navigate = useNavigate();
  const isNew = name === "new";

  const { data, isLoading, isError } = usePersonalityEditor(isNew ? "" : name);
  const savePersonality = useSavePersonality();
  const deletePersonality = useDeletePersonality();

  const [formData, setFormData] = useState<PersonalityData>(createEmptyPersonality());
  const [aliasInput, setAliasInput] = useState("");
  const [hasChanges, setHasChanges] = useState(false);

  // Load data into form when fetched
  useEffect(() => {
    if (data?.data) {
      setFormData({
        metadata: {
          name: data.data.metadata?.name || "",
          short_name: data.data.metadata?.short_name || "",
          aliases: data.data.metadata?.aliases || [],
        },
        display: {
          color: data.data.display?.color || "#6366f1",
          icon: data.data.display?.icon || "●",
          announcement: data.data.display?.announcement || "",
        },
        prompt: {
          content: data.data.prompt?.content || "",
        },
      });
      setHasChanges(false);
    }
  }, [data]);

  const updateMetadata = (field: keyof PersonalityData["metadata"], value: string | string[]) => {
    setFormData((prev) => ({
      ...prev,
      metadata: { ...prev.metadata, [field]: value },
    }));
    setHasChanges(true);
  };

  const updateDisplay = (field: keyof PersonalityData["display"], value: string) => {
    setFormData((prev) => ({
      ...prev,
      display: { ...prev.display, [field]: value },
    }));
    setHasChanges(true);
  };

  const updatePrompt = (content: string) => {
    setFormData((prev) => ({
      ...prev,
      prompt: { content },
    }));
    setHasChanges(true);
  };

  const addAlias = () => {
    if (aliasInput.trim() && !formData.metadata.aliases?.includes(aliasInput.trim())) {
      updateMetadata("aliases", [...(formData.metadata.aliases || []), aliasInput.trim()]);
      setAliasInput("");
    }
  };

  const removeAlias = (alias: string) => {
    updateMetadata(
      "aliases",
      (formData.metadata.aliases || []).filter((a) => a !== alias)
    );
  };

  const handleSave = () => {
    const saveName = isNew ? formData.metadata.short_name : name;
    if (!saveName) return;

    savePersonality.mutate(
      { name: saveName, data: formData },
      {
        onSuccess: () => {
          setHasChanges(false);
          if (isNew) {
            navigate({ to: "/personality/$name", params: { name: saveName } });
          }
        },
      }
    );
  };

  const handleReset = () => {
    deletePersonality.mutate(name, {
      onSuccess: (result) => {
        if (result.has_embedded) {
          // Reload to get embedded version
          window.location.reload();
        } else {
          navigate({ to: "/personalities" });
        }
      },
    });
  };

  if (isLoading && !isNew) {
    return (
      <div className="flex flex-1 flex-col p-6">
        <div className="mb-6 flex items-center gap-3">
          <Skeleton className="h-6 w-6" />
          <Skeleton className="h-8 w-48" />
        </div>
        <div className="space-y-4">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    );
  }

  if (isError && !isNew) {
    return (
      <div className="flex flex-1 flex-col p-6">
        <div className="mb-6">
          <Button variant="ghost" onClick={() => navigate({ to: "/personalities" })}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
        </div>
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4">
          <p className="text-destructive">Personality not found</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="shrink-0 border-b border-border bg-background px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => navigate({ to: "/personalities" })}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="flex items-center gap-3">
              <span
                className="flex h-10 w-10 items-center justify-center rounded-lg text-lg"
                style={{
                  backgroundColor: formData.display.color + "20",
                  color: formData.display.color,
                }}
              >
                {formData.display.icon}
              </span>
              <div>
                <h1 className="text-xl font-semibold">
                  {isNew ? "New Personality" : formData.metadata.name || name}
                </h1>
                {!isNew && data?.is_override && (
                  <Badge variant="outline" className="border-amber-500 text-amber-500">
                    Modified
                  </Badge>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {!isNew && data?.is_override && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline">
                    <RotateCcw className="mr-2 h-4 w-4" />
                    Reset to Default
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Reset to default?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will remove your customizations and restore the built-in version.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleReset}>Reset</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
            <Button
              onClick={handleSave}
              disabled={!hasChanges || savePersonality.isPending || (isNew && !formData.metadata.short_name)}
            >
              <Save className="mr-2 h-4 w-4" />
              {savePersonality.isPending ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>
      </div>

      {/* Form Content */}
      <div className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-3xl space-y-6">
          {/* Metadata Section */}
          <Card>
            <CardHeader>
              <CardTitle>Metadata</CardTitle>
              <CardDescription>Basic information about the personality</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="name">Name</Label>
                  <Input
                    id="name"
                    value={formData.metadata.name}
                    onChange={(e) => updateMetadata("name", e.target.value)}
                    placeholder="e.g., Tsundere"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="short_name">Short Name</Label>
                  <Input
                    id="short_name"
                    value={formData.metadata.short_name}
                    onChange={(e) => updateMetadata("short_name", e.target.value)}
                    placeholder="e.g., tsun"
                    disabled={!isNew}
                  />
                  {isNew && (
                    <p className="text-xs text-muted-foreground">
                      Used as the identifier. Cannot be changed after creation.
                    </p>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <Label>Aliases</Label>
                <div className="flex flex-wrap gap-2 mb-2">
                  {formData.metadata.aliases?.map((alias) => (
                    <Badge key={alias} variant="secondary" className="gap-1">
                      {alias}
                      <button
                        onClick={() => removeAlias(alias)}
                        className="ml-1 rounded-full hover:bg-muted"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Input
                    value={aliasInput}
                    onChange={(e) => setAliasInput(e.target.value)}
                    placeholder="Add alias"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addAlias();
                      }
                    }}
                  />
                  <Button variant="outline" onClick={addAlias}>
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Display Section */}
          <Card>
            <CardHeader>
              <CardTitle>Display</CardTitle>
              <CardDescription>Visual appearance settings</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="color">Color</Label>
                  <div className="flex gap-2">
                    <Input
                      id="color"
                      type="color"
                      value={formData.display.color}
                      onChange={(e) => updateDisplay("color", e.target.value)}
                      className="h-10 w-14 p-1"
                    />
                    <Input
                      value={formData.display.color}
                      onChange={(e) => updateDisplay("color", e.target.value)}
                      placeholder="#6366f1"
                      className="flex-1"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="icon">Icon</Label>
                  <Input
                    id="icon"
                    value={formData.display.icon}
                    onChange={(e) => updateDisplay("icon", e.target.value)}
                    placeholder="e.g., ● or any emoji"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="announcement">Announcement</Label>
                <Input
                  id="announcement"
                  value={formData.display.announcement || ""}
                  onChange={(e) => updateDisplay("announcement", e.target.value)}
                  placeholder="Optional announcement message"
                />
                <p className="text-xs text-muted-foreground">
                  Shown when this personality is activated
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Prompt Section */}
          <Card>
            <CardHeader>
              <CardTitle>Prompt</CardTitle>
              <CardDescription>The system prompt that defines this personality</CardDescription>
            </CardHeader>
            <CardContent>
              <Textarea
                value={formData.prompt.content}
                onChange={(e) => updatePrompt(e.target.value)}
                placeholder="Enter the personality's system prompt..."
                className="min-h-[300px] font-mono text-sm"
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
