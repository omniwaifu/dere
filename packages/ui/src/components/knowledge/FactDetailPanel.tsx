import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { KGFactSummary } from "@/types/api";

interface FactDetailPanelProps {
  fact: KGFactSummary | null;
  onClose: () => void;
}

export function FactDetailPanel({ fact, onClose }: FactDetailPanelProps) {
  const open = !!fact;

  return (
    <div
      className={cn(
        "fixed inset-0 z-40 transition-opacity",
        open ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0",
      )}
    >
      <div
        className={cn(
          "absolute inset-0 bg-black/30 transition-opacity",
          open ? "opacity-100" : "opacity-0",
        )}
        onClick={onClose}
      />
      <aside
        className={cn(
          "absolute right-0 top-0 h-full w-full max-w-md bg-background shadow-xl transition-transform",
          open ? "translate-x-0" : "translate-x-full",
        )}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <h3 className="text-sm font-semibold">Fact details</h3>
            <p className="text-xs text-muted-foreground">Hyper-edge fact</p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        {fact ? (
          <div className="flex h-full flex-col gap-4 overflow-y-auto px-4 py-4 text-sm">
            <div className="space-y-2">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Fact</p>
              <p className="text-base font-medium">{fact.fact}</p>
            </div>
            <div className="space-y-2">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Roles</p>
              {fact.roles.length === 0 ? (
                <p className="text-sm text-muted-foreground">No roles captured.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {fact.roles.map((role) => (
                    <div
                      key={`${fact.uuid}-${role.entity_uuid}-${role.role}`}
                      className="rounded-lg border border-border px-2 py-1"
                    >
                      <div className="text-xs font-semibold">{role.role}</div>
                      <div className="text-xs text-muted-foreground">{role.entity_name}</div>
                      {role.role_description && (
                        <div className="text-xs text-muted-foreground">{role.role_description}</div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="space-y-2">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Timing</p>
              <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                {fact.valid_at && (
                  <Badge variant="outline">
                    Valid from {new Date(fact.valid_at).toLocaleString()}
                  </Badge>
                )}
                {fact.invalid_at && (
                  <Badge variant="outline">
                    Invalid at {new Date(fact.invalid_at).toLocaleString()}
                  </Badge>
                )}
                <Badge variant="secondary">
                  Created {new Date(fact.created_at).toLocaleString()}
                </Badge>
              </div>
            </div>
            {fact.attributes && Object.keys(fact.attributes).length > 0 && (
              <div className="space-y-2">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Attributes</p>
                <div className="space-y-2">
                  {Object.entries(fact.attributes).map(([key, value]) => (
                    <div key={key} className="text-xs text-muted-foreground">
                      <span className="font-semibold text-foreground">{key}:</span> {String(value)}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : null}
      </aside>
    </div>
  );
}
