const DAEMON_URL = process.env.DERE_DAEMON_URL ?? "http://localhost:8787";

export async function daemonRequest<T = Record<string, unknown>>(args: {
  path: string;
  method?: string;
  query?: Record<string, string | number | boolean | null | undefined>;
  body?: unknown;
  timeoutMs?: number;
}): Promise<{ status: number; data: T | null; text: string }> {
  const method = args.method ?? (args.body ? "POST" : "GET");
  const timeoutMs = args.timeoutMs ?? 30_000;
  let url = `${DAEMON_URL}${args.path}`;
  if (args.query) {
    const params = new URLSearchParams(
      Object.entries(args.query)
        .filter(([, v]) => v != null)
        .map(([k, v]) => [k, String(v)]),
    );
    if (params.toString()) url += `?${params}`;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      signal: controller.signal,
      headers: args.body ? { "content-type": "application/json" } : undefined,
      body: args.body ? JSON.stringify(args.body) : undefined,
    });
    const text = await res.text();
    let data: T | null = null;
    try {
      data = JSON.parse(text);
    } catch {}
    return { status: res.status, data, text };
  } finally {
    clearTimeout(timeout);
  }
}
