import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useRef, useMemo } from "react";
import { Settings, User, Layers, Cloud, Cog, Database, Bot, Activity, Network } from "lucide-react";
import { useConfig, useConfigSchema, useUpdateConfig } from "@/hooks/queries";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SchemaFormSection } from "@/components/settings/SchemaForm";
import type { DereConfig, ConfigSchemaProperty } from "@/types/api";

export const Route = createFileRoute("/settings")({
  component: SettingsPage,
});

type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  User,
  Layers,
  Cloud,
  Cog,
  Database,
  Bot,
  Activity,
  Network,
};

interface SectionInfo {
  id: string;
  configKey: string;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  order: number;
  schema: ConfigSchemaProperty;
}

function SettingsPage() {
  const { data: config, isLoading: configLoading, isError: configError } = useConfig();
  const { data: schema, isLoading: schemaLoading } = useConfigSchema();
  const updateConfig = useUpdateConfig();
  const [activeSection, setActiveSection] = useState("");
  const [pendingChanges, setPendingChanges] = useState<DeepPartial<DereConfig>>({});
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});

  // Build sections from schema
  const sections = useMemo<SectionInfo[]>(() => {
    if (!schema?.properties) return [];

    const result: SectionInfo[] = [];

    for (const [key, prop] of Object.entries(schema.properties)) {
      const section = prop.ui_section;
      if (!section || section === "hidden") continue;

      const iconName = prop.ui_icon || "Cog";
      const IconComponent = ICON_MAP[iconName] || Cog;

      result.push({
        id: section,
        configKey: key,
        label: prop.title || key,
        description: prop.description || "",
        icon: IconComponent,
        order: prop.ui_order ?? 99,
        schema: prop,
      });
    }

    // Sort by order and dedupe by section id (take first)
    result.sort((a, b) => a.order - b.order);

    // Group by section id
    const bySection = new Map<string, SectionInfo[]>();
    for (const s of result) {
      const existing = bySection.get(s.id) || [];
      existing.push(s);
      bySection.set(s.id, existing);
    }

    // Return unique sections (first of each id)
    return Array.from(bySection.entries()).map(([, items]) => items[0]);
  }, [schema]);

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
      { rootMargin: "-20% 0px -70% 0px" },
    );

    Object.values(sectionRefs.current).forEach((ref) => {
      if (ref) observer.observe(ref);
    });

    return () => observer.disconnect();
  }, [config, sections]);

  const resolvedActiveSection = activeSection || sections[0]?.id || "";

  const scrollToSection = (sectionId: string) => {
    sectionRefs.current[sectionId]?.scrollIntoView({ behavior: "smooth" });
  };

  const updateSectionField = (sectionKey: string, field: string, value: unknown) => {
    setPendingChanges((prev) => ({
      ...prev,
      [sectionKey]: {
        ...(prev[sectionKey as keyof DereConfig] as object),
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
  const displayConfig = useMemo((): DereConfig | null => {
    if (!config) return null;
    const merged: Record<string, unknown> = { ...config };
    for (const [key, changes] of Object.entries(pendingChanges)) {
      const base = config[key as keyof DereConfig];
      if (
        typeof base === "object" &&
        base !== null &&
        typeof changes === "object" &&
        changes !== null
      ) {
        merged[key] = { ...base, ...changes };
      } else if (changes !== undefined) {
        merged[key] = changes;
      }
    }
    return merged as unknown as DereConfig;
  }, [config, pendingChanges]);

  // Get all config keys that belong to each section - must be before early returns
  const sectionConfigKeys = useMemo(() => {
    const result = new Map<string, string[]>();
    if (!schema?.properties) return result;

    for (const [key, prop] of Object.entries(schema.properties)) {
      const section = prop.ui_section;
      if (!section || section === "hidden") continue;
      const existing = result.get(section) || [];
      existing.push(key);
      result.set(section, existing);
    }
    return result;
  }, [schema]);

  const isLoading = configLoading || schemaLoading;

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

  if (configError || !displayConfig || !schema) {
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
      {/* Header with save button */}
      <div className="shrink-0 border-b border-border bg-background px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Settings className="h-6 w-6" />
            <h1 className="text-2xl font-semibold">Settings</h1>
          </div>
          <Button onClick={saveChanges} disabled={!hasChanges || updateConfig.isPending}>
            {updateConfig.isPending ? "Saving..." : "Save Changes"}
          </Button>
        </div>

        {/* Section navigation */}
        <nav className="mt-4 flex gap-1 overflow-x-auto">
          {sections.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => scrollToSection(id)}
              className={cn(
                "flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                resolvedActiveSection === id
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground",
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
          {sections.map((section) => {
            const configKeys = sectionConfigKeys.get(section.id) || [];
            const Icon = section.icon;

            return (
              <section
                key={section.id}
                id={section.id}
                ref={(el) => {
                  sectionRefs.current[section.id] = el;
                }}
              >
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Icon className="h-5 w-5" />
                      {section.label}
                    </CardTitle>
                    <CardDescription>{section.description}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    {configKeys.map((configKey) => {
                      const prop = schema.properties[configKey];
                      if (!prop) return null;

                      const values = displayConfig[configKey as keyof DereConfig];
                      if (typeof values !== "object" || values === null) return null;

                      return (
                        <SchemaFormSection
                          key={configKey}
                          sectionKey={configKey}
                          sectionSchema={prop}
                          values={values as unknown as Record<string, unknown>}
                          onChange={(field, value) => updateSectionField(configKey, field, value)}
                          defs={schema.$defs}
                        />
                      );
                    })}
                  </CardContent>
                </Card>
              </section>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
