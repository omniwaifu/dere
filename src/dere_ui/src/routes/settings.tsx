import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useRef } from "react";
import { Settings, User, Layers, Cloud, Cog, Database, Bot, Activity } from "lucide-react";
import { useConfig, useUpdateConfig } from "@/hooks/queries";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { DereConfig } from "@/types/api";

export const Route = createFileRoute("/settings")({
  component: SettingsPage,
});

type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

const SECTIONS = [
  { id: "user", label: "User", icon: User },
  { id: "context", label: "Context", icon: Layers },
  { id: "weather", label: "Weather", icon: Cloud },
  { id: "plugins", label: "Plugins", icon: Cog },
  { id: "advanced", label: "Advanced", icon: Activity },
  { id: "sensitive", label: "Connections", icon: Database },
] as const;

function SettingsPage() {
  const { data: config, isLoading, isError } = useConfig();
  const updateConfig = useUpdateConfig();
  const [activeSection, setActiveSection] = useState("user");
  const [pendingChanges, setPendingChanges] = useState<DeepPartial<DereConfig>>({});
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});

  // Scroll spy to update active section
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setActiveSection(entry.target.id);
          }
        });
      },
      { rootMargin: "-20% 0px -70% 0px" }
    );

    Object.values(sectionRefs.current).forEach((ref) => {
      if (ref) observer.observe(ref);
    });

    return () => observer.disconnect();
  }, [config]);

  const scrollToSection = (sectionId: string) => {
    sectionRefs.current[sectionId]?.scrollIntoView({ behavior: "smooth" });
  };

  const updateField = <K extends keyof DereConfig>(
    section: K,
    field: keyof DereConfig[K],
    value: DereConfig[K][typeof field]
  ) => {
    setPendingChanges((prev) => ({
      ...prev,
      [section]: {
        ...(prev[section] as object || {}),
        [field]: value,
      },
    }));
  };

  const saveChanges = () => {
    if (Object.keys(pendingChanges).length > 0) {
      updateConfig.mutate(pendingChanges as Partial<DereConfig>, {
        onSuccess: () => setPendingChanges({}),
      });
    }
  };

  const hasChanges = Object.keys(pendingChanges).length > 0;

  // Merge pending changes with current config for display
  const displayConfig: DereConfig | null = config
    ? {
        ...config,
        ...Object.fromEntries(
          Object.entries(pendingChanges).map(([k, v]) => {
            const base = config[k as keyof DereConfig];
            if (typeof base === "object" && base !== null && typeof v === "object" && v !== null) {
              return [k, { ...base, ...v }];
            }
            return [k, v ?? base];
          })
        ),
      } as DereConfig
    : null;

  if (isLoading) {
    return (
      <div className="flex flex-1 flex-col p-6">
        <div className="mb-6 flex items-center gap-3">
          <Settings className="h-6 w-6" />
          <h1 className="text-2xl font-semibold">Settings</h1>
        </div>
        <div className="space-y-4">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      </div>
    );
  }

  if (isError || !displayConfig) {
    return (
      <div className="flex flex-1 flex-col p-6">
        <div className="mb-6 flex items-center gap-3">
          <Settings className="h-6 w-6" />
          <h1 className="text-2xl font-semibold">Settings</h1>
        </div>
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4">
          <p className="text-destructive">Failed to load configuration</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header with save button - fixed, not sticky */}
      <div className="shrink-0 border-b border-border bg-background px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Settings className="h-6 w-6" />
            <h1 className="text-2xl font-semibold">Settings</h1>
          </div>
          <Button
            onClick={saveChanges}
            disabled={!hasChanges || updateConfig.isPending}
          >
            {updateConfig.isPending ? "Saving..." : "Save Changes"}
          </Button>
        </div>

        {/* Section navigation */}
        <nav className="mt-4 flex gap-1 overflow-x-auto">
          {SECTIONS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => scrollToSection(id)}
              className={cn(
                "flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                activeSection === id
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground"
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </nav>
      </div>

      {/* Scrollable content */}
      <ScrollArea className="flex-1">
        <div className="p-6 space-y-8">
        {/* User Section */}
        <section
          id="user"
          ref={(el) => { sectionRefs.current.user = el; }}
        >
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <User className="h-5 w-5" />
                User
              </CardTitle>
              <CardDescription>Your display name and identity settings</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-2">
                <Label htmlFor="user-name">Display Name</Label>
                <Input
                  id="user-name"
                  value={(displayConfig.user as { name: string }).name}
                  onChange={(e) => updateField("user", "name", e.target.value)}
                  placeholder="Your name"
                />
              </div>
            </CardContent>
          </Card>
        </section>

        {/* Context Section */}
        <section
          id="context"
          ref={(el) => { sectionRefs.current.context = el; }}
        >
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Layers className="h-5 w-5" />
                Context
              </CardTitle>
              <CardDescription>Configure what context information is included in conversations</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                {([
                  { key: "time", label: "Time Context", desc: "Include current time" },
                  { key: "weather", label: "Weather", desc: "Include weather info" },
                  { key: "recent_files", label: "Recent Files", desc: "Show recently modified files" },
                  { key: "knowledge_graph", label: "Knowledge Graph", desc: "Use knowledge graph context" },
                  { key: "activity", label: "Activity", desc: "Include ActivityWatch data" },
                  { key: "media_player", label: "Media Player", desc: "Show currently playing media" },
                  { key: "tasks", label: "Tasks", desc: "Include Taskwarrior tasks" },
                  { key: "calendar", label: "Calendar", desc: "Include calendar events" },
                ] as const).map(({ key, label, desc }) => (
                  <div key={key} className="flex items-center justify-between rounded-lg border p-3">
                    <div>
                      <Label htmlFor={`context-${key}`} className="font-medium">{label}</Label>
                      <p className="text-xs text-muted-foreground">{desc}</p>
                    </div>
                    <Switch
                      id={`context-${key}`}
                      checked={displayConfig.context[key as keyof typeof displayConfig.context] as boolean}
                      onCheckedChange={(checked) => updateField("context", key, checked)}
                    />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </section>

        {/* Weather Section */}
        <section
          id="weather"
          ref={(el) => { sectionRefs.current.weather = el; }}
        >
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Cloud className="h-5 w-5" />
                Weather
              </CardTitle>
              <CardDescription>Configure weather data source</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <Label htmlFor="weather-enabled" className="font-medium">Enable Weather</Label>
                  <p className="text-xs text-muted-foreground">Fetch weather data for context</p>
                </div>
                <Switch
                  id="weather-enabled"
                  checked={(displayConfig.weather as { enabled: boolean }).enabled}
                  onCheckedChange={(checked) => updateField("weather", "enabled", checked)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="weather-city">City</Label>
                <Input
                  id="weather-city"
                  value={(displayConfig.weather as { city: string | null }).city || ""}
                  onChange={(e) => updateField("weather", "city", e.target.value || null)}
                  placeholder="e.g., Cincinnati, OH"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="weather-units">Units</Label>
                <Select
                  value={(displayConfig.weather as { units: string }).units}
                  onValueChange={(value) => updateField("weather", "units", value)}
                >
                  <SelectTrigger id="weather-units">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="metric">Metric (Celsius)</SelectItem>
                    <SelectItem value="imperial">Imperial (Fahrenheit)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>
        </section>

        {/* Plugins Section */}
        <section
          id="plugins"
          ref={(el) => { sectionRefs.current.plugins = el; }}
        >
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Cog className="h-5 w-5" />
                Plugins
              </CardTitle>
              <CardDescription>Configure plugin activation modes</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {([
                { key: "dere_core", label: "Dere Core", desc: "Core personality features" },
                { key: "dere_productivity", label: "Dere Productivity", desc: "Taskwarrior and calendar integration" },
                { key: "dere_code", label: "Dere Code", desc: "Code-related tools and context" },
                { key: "dere_vault", label: "Dere Vault", desc: "Zotero and document management" },
              ] as const).map(({ key, label, desc }) => (
                <div key={key} className="flex items-center justify-between rounded-lg border p-3">
                  <div>
                    <Label className="font-medium">{label}</Label>
                    <p className="text-xs text-muted-foreground">{desc}</p>
                  </div>
                  <Select
                    value={displayConfig.plugins[key as keyof typeof displayConfig.plugins].mode}
                    onValueChange={(value) => {
                      setPendingChanges((prev) => ({
                        ...prev,
                        plugins: {
                          ...(prev.plugins || {}),
                          [key]: {
                            ...((prev.plugins as Record<string, object>)?.[key] || {}),
                            mode: value,
                          },
                        },
                      }));
                    }}
                  >
                    <SelectTrigger className="w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="always">Always</SelectItem>
                      <SelectItem value="auto">Auto</SelectItem>
                      <SelectItem value="never">Never</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </CardContent>
          </Card>
        </section>

        {/* Advanced Section */}
        <section
          id="advanced"
          ref={(el) => { sectionRefs.current.advanced = el; }}
        >
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Activity className="h-5 w-5" />
                Advanced
              </CardTitle>
              <CardDescription>ActivityWatch and other integrations</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <Label htmlFor="aw-enabled" className="font-medium">ActivityWatch</Label>
                  <p className="text-xs text-muted-foreground">Enable activity tracking integration</p>
                </div>
                <Switch
                  id="aw-enabled"
                  checked={(displayConfig.activitywatch as { enabled: boolean }).enabled}
                  onCheckedChange={(checked) => updateField("activitywatch", "enabled", checked)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="aw-url">ActivityWatch URL</Label>
                <Input
                  id="aw-url"
                  value={(displayConfig.activitywatch as { url: string }).url}
                  onChange={(e) => updateField("activitywatch", "url", e.target.value)}
                  placeholder="http://localhost:5600"
                />
              </div>
            </CardContent>
          </Card>
        </section>

        {/* Sensitive/Connections Section */}
        <section
          id="sensitive"
          ref={(el) => { sectionRefs.current.sensitive = el; }}
        >
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Database className="h-5 w-5" />
                Connections
              </CardTitle>
              <CardDescription>Database and external service configurations (read-only)</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-lg border p-3">
                <div className="flex items-center gap-2">
                  <Database className="h-4 w-4 text-muted-foreground" />
                  <Label className="font-medium">Database</Label>
                </div>
                <p className="mt-1 text-sm text-muted-foreground font-mono">
                  {(displayConfig.database as { url: string }).url.replace(/:[^:@]+@/, ":***@")}
                </p>
              </div>
              <div className="rounded-lg border p-3">
                <div className="flex items-center gap-2">
                  <Bot className="h-4 w-4 text-muted-foreground" />
                  <Label className="font-medium">Discord Bot</Label>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {(displayConfig.discord as { token: string }).token ? "Configured" : "Not configured"}
                </p>
              </div>
            </CardContent>
          </Card>
        </section>
        </div>
      </ScrollArea>
    </div>
  );
}
