import { dirname } from "node:path";
import { getConfigPath } from "@dere/shared-config";

export function getConfigDir(): string {
  return dirname(getConfigPath());
}

export function formatProjectPath(args: {
  guildId: string | null;
  channelId: string;
  userId?: string | null;
}): string {
  const { guildId, channelId, userId } = args;
  if (guildId === null) {
    return `discord://dm/${userId ?? channelId}`;
  }
  return `discord://guild/${guildId}/channel/${channelId}`;
}
