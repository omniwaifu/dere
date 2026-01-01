import { loadConfig } from "@dere/shared-config";
import { ClaudeAgentTransport, StructuredOutputClient } from "@dere/shared-llm";

let graphClientPromise: Promise<StructuredOutputClient> | null = null;

export async function getGraphStructuredClient(): Promise<StructuredOutputClient> {
  if (graphClientPromise) {
    return graphClientPromise;
  }

  graphClientPromise = (async () => {
    const config = await loadConfig();
    const graphConfig = (config.dere_graph ?? {}) as Record<string, unknown>;
    const model =
      (typeof graphConfig.claude_model === "string" && graphConfig.claude_model) ||
      process.env.DERE_GRAPH_MODEL ||
      "claude-haiku-4-5";
    const transport = new ClaudeAgentTransport({
      workingDirectory: process.env.DERE_TS_LLM_CWD ?? "/tmp/dere-llm-sessions",
      defaultSchemaName: "dere_graph",
    });
    return new StructuredOutputClient({ transport, model });
  })();

  return graphClientPromise;
}
