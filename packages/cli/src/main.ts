#!/usr/bin/env bun
import { runSubcommand } from "./subcommands.js";
import { runClaude } from "./wrapper.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length > 0) {
    const first = args[0];
    if (
      first === "daemon" ||
      first === "config" ||
      first === "version" ||
      first === "-h" ||
      first === "--help"
    ) {
      await runSubcommand(args);
      return;
    }
  }

  await runClaude(args);
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
    process.exit(1);
  });
}
