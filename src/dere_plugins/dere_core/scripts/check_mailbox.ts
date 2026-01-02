import { daemonRequest } from "@dere/shared-runtime";

const SWARM_ID = process.env.DERE_SWARM_ID;
const AGENT_NAME = process.env.DERE_SWARM_AGENT_NAME;

type ScratchpadEntry = {
  key?: string;
  value?: {
    from?: string;
    text?: string;
    priority?: string;
  };
};

async function checkMailbox(): Promise<void> {
  if (!SWARM_ID || !AGENT_NAME) {
    return;
  }

  try {
    const { status, data } = await daemonRequest<unknown>({
      path: `/swarm/${SWARM_ID}/scratchpad`,
      method: "GET",
      query: { prefix: `messages/to-${AGENT_NAME}/` },
      timeoutMs: 5_000,
    });

    if (status !== 200 || !Array.isArray(data) || data.length === 0) {
      return;
    }

    console.log("\nYou have messages from other agents:\n");

    for (const entry of data as ScratchpadEntry[]) {
      const key = entry.key ?? "";
      const value = entry.value ?? {};
      const sender = value.from ?? "unknown";
      const text = value.text ?? "";
      const priority = value.priority ?? "normal";
      const priorityMarker = priority === "urgent" ? "[URGENT] " : "";

      console.log(`${priorityMarker}From '${sender}':`);
      console.log(`  ${text}\n`);

      if (!key) {
        continue;
      }

      try {
        await daemonRequest({
          path: `/swarm/${SWARM_ID}/scratchpad/${key}`,
          method: "DELETE",
          timeoutMs: 5_000,
        });
      } catch {
        // best effort deletion
      }
    }
  } catch {
    // silently fail
  }
}

if (import.meta.main) {
  void checkMailbox();
}
