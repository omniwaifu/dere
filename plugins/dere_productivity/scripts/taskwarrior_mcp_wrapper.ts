import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";

function main(): void {
  const packageRoot = resolve(import.meta.dir ?? ".", "..");
  const mcpServer = join(packageRoot, "mcp-server", "dist", "index.js");

  if (!existsSync(mcpServer)) {
    console.error(`Error: MCP server not found at ${mcpServer}`);
    console.error("Run 'just build-mcp' to build it");
    process.exit(1);
  }

  const result = spawnSync("node", [mcpServer, ...process.argv.slice(2)], {
    stdio: "inherit",
  });
  process.exit(result.status ?? 1);
}

if (import.meta.main) {
  main();
}
