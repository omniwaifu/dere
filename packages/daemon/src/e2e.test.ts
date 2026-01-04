import { describe, expect, test } from "bun:test";

const baseUrl = process.env.DERE_DAEMON_TEST_URL;
const e2eTest = baseUrl ? test : test.skip;

function buildUrl(path: string): URL {
  return new URL(path, baseUrl);
}

async function requestJson(path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  if (!headers.has("content-type") && init?.body) {
    headers.set("content-type", "application/json");
  }
  return fetch(buildUrl(path), { ...init, headers });
}

describe("daemon e2e", () => {
  e2eTest("mission execution can be triggered", async () => {
    const payload = {
      name: `e2e-mission-${Date.now()}`,
      prompt: "E2E mission test prompt.",
      schedule: "0 0 * * *",
      run_once: true,
    };

    const createResponse = await requestJson("/missions", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    expect(createResponse.status).toBe(200);

    const created = (await createResponse.json()) as { id?: number };
    expect(typeof created.id).toBe("number");

    const executeResponse = await requestJson(`/missions/${created.id}/execute`, {
      method: "POST",
    });
    expect(executeResponse.status).toBe(200);

    const executePayload = (await executeResponse.json()) as { status?: string };
    expect(executePayload.status).toBe("triggered");

    const waitMs = Number(process.env.DERE_E2E_WAIT_EXECUTION_MS ?? 0);
    if (waitMs > 0) {
      const deadline = Date.now() + waitMs;
      let found = false;
      while (Date.now() < deadline) {
        const execResponse = await requestJson(`/missions/${created.id}/executions?limit=1`);
        if (execResponse.ok) {
          const executions = (await execResponse.json()) as unknown[];
          if (Array.isArray(executions) && executions.length > 0) {
            found = true;
            break;
          }
        }
        await Bun.sleep(250);
      }
      expect(found).toBe(true);
    }

    await requestJson(`/missions/${created.id}`, { method: "DELETE" });
  });

  e2eTest("ambient dashboard responds", async () => {
    const response = await requestJson("/ambient/dashboard");
    expect(response.status).toBe(200);
    const payload = (await response.json()) as Record<string, unknown>;
    expect(payload).toEqual(
      expect.objectContaining({
        summary: expect.any(Object),
        config: expect.any(Object),
        recent_runs: expect.any(Array),
        recent_notifications: expect.any(Array),
        timestamp: expect.any(String),
      }),
    );
  });
});
