import { existsSync } from "node:fs";
import { dirname, resolve, join } from "node:path";

export function isVault(path?: string): boolean {
  let current = resolve(path ?? process.cwd());

  while (true) {
    if (existsSync(join(current, ".obsidian"))) {
      return true;
    }
    const parent = dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }

  return false;
}

export function findVaultRoot(path?: string): string | null {
  let current = resolve(path ?? process.cwd());

  while (true) {
    if (existsSync(join(current, ".obsidian"))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }

  return null;
}

async function main(): Promise<void> {
  if (isVault()) {
    const vaultRoot = findVaultRoot();
    console.log(`Vault detected: ${vaultRoot}`);
    process.exit(0);
  }
  console.log("Not in a vault");
  process.exit(1);
}

if (import.meta.main) {
  void main();
}
