import { loadConfig } from "@dere/shared-config";
import { DEFAULT_ACTIVITYWATCH_URL, DEFAULT_DAEMON_URL } from "@dere/shared-runtime";

export async function readConfig(): Promise<Record<string, unknown>> {
  return (await loadConfig()) as Record<string, unknown>;
}

export async function getDaemonUrl(): Promise<string> {
  const config = (await loadConfig()) as {
    ambient?: { daemon_url?: string | null };
  };
  return config.ambient?.daemon_url ?? DEFAULT_DAEMON_URL;
}

export async function getActivitywatchUrl(): Promise<string> {
  const config = (await loadConfig()) as {
    activitywatch?: { url?: string | null };
  };
  return config.activitywatch?.url ?? DEFAULT_ACTIVITYWATCH_URL;
}

async function main(): Promise<void> {
  const key = process.argv[2];
  if (!key) {
    console.error("Usage: config_reader.ts <daemon_url|activitywatch_url>");
    process.exit(1);
  }

  switch (key) {
    case "daemon_url": {
      console.log(await getDaemonUrl());
      return;
    }
    case "activitywatch_url": {
      console.log(await getActivitywatchUrl());
      return;
    }
    default: {
      console.error(`Unknown config key: ${key}`);
      process.exit(1);
    }
  }
}

if (import.meta.main) {
  void main();
}
