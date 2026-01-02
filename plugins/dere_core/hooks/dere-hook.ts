import { RPCClient } from "./rpc_client.js";

type HookArgs = {
  sessionId: number;
  personality: string;
  projectPath: string;
  prompt: string;
};

async function parseStdinArgs(): Promise<HookArgs | null> {
  try {
    const stdin = await Bun.stdin.text();
    if (!stdin) {
      return {
        sessionId: 0,
        personality: "",
        projectPath: "",
        prompt: "",
      };
    }

    const data = JSON.parse(stdin) as Record<string, unknown>;

    const personality = process.env.DERE_PERSONALITY;
    if (!personality) {
      return null;
    }

    const sessionId = Number.parseInt(process.env.DERE_SESSION_ID ?? "0", 10);
    const projectPath = typeof data.cwd === "string" ? data.cwd : "";
    const prompt = typeof data.prompt === "string" ? data.prompt : "";

    return { sessionId, personality, projectPath, prompt };
  } catch {
    process.exit(1);
  }
}

function parseCliArgs(): HookArgs {
  if (process.argv.length < 6) {
    console.error("Usage: dere-hook.ts <session_id> <personality> <project_path> <prompt>");
    process.exit(1);
  }

  return {
    sessionId: Number.parseInt(process.argv[2] ?? "0", 10),
    personality: process.argv[3] ?? "",
    projectPath: process.argv[4] ?? "",
    prompt: process.argv[5] ?? "",
  };
}

async function parseArgs(): Promise<HookArgs | null> {
  if (process.argv.length === 2) {
    return parseStdinArgs();
  }
  return parseCliArgs();
}

async function main(): Promise<void> {
  const args = await parseArgs();
  if (!args) {
    return;
  }

  const rpc = new RPCClient();
  const result = await rpc.captureConversation(
    args.sessionId,
    args.personality,
    args.projectPath,
    args.prompt,
  );

  console.log(JSON.stringify({ suppressOutput: true }));

  if (!result) {
    process.exit(1);
  }
}

if (import.meta.main) {
  main();
}
