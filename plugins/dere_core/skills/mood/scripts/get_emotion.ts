import { getDaemonUrl } from "../../../scripts/config_reader.js";

async function getEmotionState(): Promise<Record<string, unknown> | null> {
  const daemonUrl = await getDaemonUrl();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2_000);
  try {
    const response = await fetch(`${daemonUrl}/emotion/state`, {
      method: "GET",
      signal: controller.signal,
    });
    if (!response.ok) {
      return null;
    }
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function main(): Promise<void> {
  const state = await getEmotionState();
  if (state) {
    console.log(JSON.stringify(state, null, 2));
    return;
  }
  process.exit(1);
}

if (import.meta.main) {
  void main();
}
