import { homedir } from "node:os";
import { join, dirname } from "node:path";

import { getConfigPath } from "@dere/shared-config";

export function getConfigDir(): string {
  return dirname(getConfigPath());
}

export function getDataDir(): string {
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support", "dere");
  }
  if (process.platform === "win32") {
    return join(process.env.LOCALAPPDATA ?? homedir(), "dere");
  }
  return join(homedir(), ".local", "share", "dere");
}
