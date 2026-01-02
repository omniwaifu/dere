function formatEmotion(state: Record<string, unknown>): string {
  const lines: string[] = [];

  const primary = state.primary as Record<string, unknown> | undefined;
  if (primary && typeof primary === "object") {
    const name = (primary.name as string | undefined) ?? "unknown";
    const intensity = (primary.intensity as number | undefined) ?? 0;
    lines.push(`Primary: ${name} (${intensity}% intensity)`);
  }

  const secondary = state.secondary as Record<string, unknown> | undefined;
  if (secondary && typeof secondary === "object") {
    const name = (secondary.name as string | undefined) ?? "unknown";
    const intensity = (secondary.intensity as number | undefined) ?? 0;
    lines.push(`Secondary: ${name} (${intensity}% intensity)`);
  }

  const trust = typeof state.trust_level === "number" ? state.trust_level : 0;
  lines.push(`Trust: ${(trust * 100).toFixed(0)}%`);

  return lines.join("\n");
}

async function main(): Promise<void> {
  try {
    const input = await Bun.stdin.text();
    const state = JSON.parse(input) as Record<string, unknown>;
    console.log(formatEmotion(state));
  } catch {
    console.error("Error: Invalid JSON input");
    process.exit(1);
  }
}

if (import.meta.main) {
  void main();
}
