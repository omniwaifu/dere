import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Rocket, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MissionList } from "@/components/missions/MissionList";
import { MissionForm } from "@/components/missions/MissionForm";
import { ExecutionHistory } from "@/components/missions/ExecutionHistory";
import type { Mission } from "@/types/api";

export const Route = createFileRoute("/missions")({
  component: MissionsPage,
});

function MissionsPage() {
  const [showForm, setShowForm] = useState(false);
  const [selectedMission, setSelectedMission] = useState<Mission | null>(null);
  const [editingMission, setEditingMission] = useState<Mission | null>(null);

  const handleSelect = (mission: Mission) => {
    setSelectedMission(mission);
    setShowForm(false);
    setEditingMission(null);
  };

  const handleCreateSuccess = () => {
    setShowForm(false);
  };

  const handleEditSuccess = () => {
    setEditingMission(null);
  };

  return (
    <div className="flex flex-1 flex-col p-6">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Rocket className="h-6 w-6" />
          <h1 className="text-2xl font-semibold">Missions</h1>
        </div>
        <Button onClick={() => { setShowForm(true); setSelectedMission(null); }}>
          <Plus className="mr-2 h-4 w-4" />
          New Mission
        </Button>
      </div>

      {/* Main content */}
      <div className="flex flex-1 gap-6 min-h-0">
        {/* Left panel: list */}
        <div className="w-1/2 flex flex-col min-h-0">
          <ScrollArea className="flex-1">
            <MissionList
              onSelect={handleSelect}
              selectedId={selectedMission?.id}
            />
          </ScrollArea>
        </div>

        {/* Right panel: detail/form */}
        <div className="w-1/2 flex flex-col min-h-0 rounded-lg border border-border bg-card">
          {showForm ? (
            <div className="flex flex-col h-full">
              <div className="flex items-center justify-between border-b border-border p-4">
                <h2 className="font-semibold">New Mission</h2>
                <Button variant="ghost" size="icon" onClick={() => setShowForm(false)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <ScrollArea className="flex-1 p-4">
                <MissionForm onSuccess={handleCreateSuccess} onCancel={() => setShowForm(false)} />
              </ScrollArea>
            </div>
          ) : editingMission ? (
            <div className="flex flex-col h-full">
              <div className="flex items-center justify-between border-b border-border p-4">
                <h2 className="font-semibold">Edit Mission</h2>
                <Button variant="ghost" size="icon" onClick={() => setEditingMission(null)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <ScrollArea className="flex-1 p-4">
                <MissionForm
                  mission={editingMission}
                  onSuccess={handleEditSuccess}
                  onCancel={() => setEditingMission(null)}
                />
              </ScrollArea>
            </div>
          ) : selectedMission ? (
            <div className="flex flex-col h-full">
              <div className="flex items-center justify-between border-b border-border p-4">
                <div>
                  <h2 className="font-semibold">{selectedMission.name}</h2>
                  {selectedMission.description && (
                    <p className="text-sm text-muted-foreground">{selectedMission.description}</p>
                  )}
                </div>
                <Button variant="outline" size="sm" onClick={() => setEditingMission(selectedMission)}>
                  Edit
                </Button>
              </div>

              <Tabs defaultValue="details" className="flex-1 flex flex-col">
                <TabsList className="mx-4 mt-4">
                  <TabsTrigger value="details">Details</TabsTrigger>
                  <TabsTrigger value="history">History</TabsTrigger>
                </TabsList>

                <TabsContent value="details" className="flex-1 m-0">
                  <ScrollArea className="h-full p-4">
                    <div className="space-y-4">
                      <div>
                        <div className="text-xs font-medium text-muted-foreground mb-1">Prompt</div>
                        <p className="text-sm whitespace-pre-wrap bg-muted/50 p-3 rounded">
                          {selectedMission.prompt}
                        </p>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <div className="text-xs font-medium text-muted-foreground mb-1">Schedule</div>
                          <p className="text-sm">
                            {selectedMission.natural_language_schedule || selectedMission.cron_expression}
                          </p>
                        </div>
                        <div>
                          <div className="text-xs font-medium text-muted-foreground mb-1">Timezone</div>
                          <p className="text-sm">{selectedMission.timezone}</p>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <div className="text-xs font-medium text-muted-foreground mb-1">Model</div>
                          <p className="text-sm">{selectedMission.model}</p>
                        </div>
                        <div>
                          <div className="text-xs font-medium text-muted-foreground mb-1">Personality</div>
                          <p className="text-sm">{selectedMission.personality || "Default"}</p>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <div className="text-xs font-medium text-muted-foreground mb-1">Sandbox</div>
                          <p className="text-sm">
                            {selectedMission.sandbox_mode
                              ? `Yes (${selectedMission.sandbox_mount_type})`
                              : "No"}
                          </p>
                        </div>
                        <div>
                          <div className="text-xs font-medium text-muted-foreground mb-1">Web</div>
                          <p className="text-sm">
                            {selectedMission.allowed_tools
                            ? (selectedMission.allowed_tools.includes("WebFetch") || selectedMission.allowed_tools.includes("WebSearch") ? "Yes" : "No")
                            : "Yes"}
                          </p>
                        </div>
                        <div>
                          <div className="text-xs font-medium text-muted-foreground mb-1">Working Dir</div>
                          <p className="text-sm truncate">{selectedMission.working_dir}</p>
                        </div>
                      </div>
                    </div>
                  </ScrollArea>
                </TabsContent>

                <TabsContent value="history" className="flex-1 m-0">
                  <ScrollArea className="h-full p-4">
                    <ExecutionHistory missionId={selectedMission.id} />
                  </ScrollArea>
                </TabsContent>
              </Tabs>
            </div>
          ) : (
            <div className="flex flex-1 items-center justify-center text-muted-foreground">
              Select a mission to view details
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
