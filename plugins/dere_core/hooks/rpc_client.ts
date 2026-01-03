import { daemonRequest } from "../lib/daemon-client.ts";

type JsonRecord = Record<string, unknown>;

const REQUEST_TIMEOUT_MS = 2_000;

export class RPCClient {
  private async call(endpoint: string, params?: JsonRecord): Promise<JsonRecord | null> {
    const { status, data } = await daemonRequest<JsonRecord>({
      path: endpoint,
      method: "POST",
      body: params ?? {},
      timeoutMs: REQUEST_TIMEOUT_MS,
    });

    if (status < 200 || status >= 300) {
      return null;
    }

    return data;
  }

  async callMethod(method: string, params?: JsonRecord): Promise<JsonRecord | null> {
    return this.call(`/rpc/${method}`, params);
  }

  async captureConversation(
    sessionId: number,
    personality: string,
    projectPath: string,
    prompt: string,
    messageType: "user" | "assistant" = "user",
  ): Promise<JsonRecord | null> {
    return this.call("/conversation/capture", {
      session_id: sessionId,
      personality,
      project_path: projectPath,
      prompt,
      message_type: messageType,
      is_command: false,
    });
  }

  async captureClaudeResponse(
    sessionId: number,
    personality: string,
    projectPath: string,
    response: string,
  ): Promise<JsonRecord | null> {
    return this.captureConversation(sessionId, personality, projectPath, response, "assistant");
  }

  async endSession(sessionId: number, exitReason = "normal"): Promise<JsonRecord | null> {
    return this.call("/sessions/end", { session_id: sessionId, exit_reason: exitReason });
  }

  async getStatus(args: {
    personality?: string;
    mcp_servers?: string[];
    context?: boolean;
  }): Promise<JsonRecord | null> {
    const params: JsonRecord = {};
    if (args.personality) {
      params.personality = args.personality;
    }
    if (args.mcp_servers?.length) {
      params.mcp_servers = args.mcp_servers;
    }
    if (args.context) {
      params.context = true;
    }
    return this.call("/status/get", params);
  }
}
