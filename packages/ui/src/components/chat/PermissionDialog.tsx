import { useChatStore } from "@/stores/chat";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Shield, ShieldAlert } from "lucide-react";

export function PermissionDialog() {
  const pendingPermission = useChatStore((s) => s.pendingPermissionQueue[0] ?? null);
  const respondToPermission = useChatStore((s) => s.respondToPermission);
  const permissionSendError = useChatStore((s) => s.permissionSendError);

  if (!pendingPermission) return null;

  const handleAllow = () => {
    respondToPermission(true);
  };

  const handleDeny = () => {
    respondToPermission(false, "User denied permission");
  };

  return (
    <AlertDialog open={!!pendingPermission}>
      <AlertDialogContent className="max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-yellow-500" />
            Permission Request
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3">
              <p>
                Claude wants to use the{" "}
                <span className="font-semibold text-foreground">{pendingPermission.toolName}</span>{" "}
                tool:
              </p>
              <pre className="max-h-48 overflow-auto rounded-md bg-muted p-3 text-xs">
                {JSON.stringify(pendingPermission.toolInput, null, 2)}
              </pre>
              {permissionSendError && (
                <p className="text-sm text-destructive">{permissionSendError}</p>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button variant="outline" onClick={handleDeny}>
            <Shield className="mr-2 h-4 w-4" />
            Deny
          </Button>
          <Button onClick={handleAllow}>Allow</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
