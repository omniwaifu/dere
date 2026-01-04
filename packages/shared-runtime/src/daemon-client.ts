import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { URL } from "node:url";

import { loadConfig, getDaemonUrlFromConfig } from "@dere/shared-config";

export type JsonRecord = Record<string, unknown>;

export async function getDaemonUrl(): Promise<string> {
  const config = await loadConfig();
  return getDaemonUrlFromConfig(config);
}

export function parseDaemonUrl(url: string): { baseUrl: string; socketPath?: string } {
  if (url.startsWith("http+unix://")) {
    const socketPath = url.replace("http+unix://", "");
    return { baseUrl: "http://daemon", socketPath };
  }
  return { baseUrl: url };
}

function buildUrl(baseUrl: string, path: string, params?: URLSearchParams): string {
  const url = new URL(path, baseUrl);
  if (params) {
    url.search = params.toString();
  }
  return url.toString();
}

async function requestViaSocket(args: {
  socketPath: string;
  method: string;
  url: URL;
  body?: string;
  timeoutMs: number;
}): Promise<{ status: number; body: string }> {
  const isHttps = args.url.protocol === "https:";
  const requestFn = isHttps ? httpsRequest : httpRequest;

  return new Promise((resolve, reject) => {
    const req = requestFn(
      {
        method: args.method,
        socketPath: args.socketPath,
        path: `${args.url.pathname}${args.url.search}`,
        headers: {
          "content-type": "application/json",
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 500,
            body: Buffer.concat(chunks).toString("utf-8"),
          });
        });
      },
    );

    req.on("error", reject);
    req.setTimeout(args.timeoutMs, () => {
      req.destroy(new Error("Request timed out"));
    });
    if (args.body) {
      req.write(args.body);
    }
    req.end();
  });
}

export async function daemonRequest<T = JsonRecord>(args: {
  path: string;
  method?: string;
  query?: Record<string, string | number | boolean | null | undefined>;
  body?: unknown;
  timeoutMs?: number;
}): Promise<{ status: number; data: T | null; text: string }> {
  const url = await getDaemonUrl();
  const { baseUrl, socketPath } = parseDaemonUrl(url);
  const params = args.query
    ? new URLSearchParams(
        Object.entries(args.query)
          .filter(([, value]) => value !== undefined && value !== null)
          .map(([key, value]) => [key, String(value)]),
      )
    : undefined;
  const target = new URL(buildUrl(baseUrl, args.path, params));
  const method = args.method ?? (args.body ? "POST" : "GET");
  const timeoutMs = args.timeoutMs ?? 30_000;
  const body = args.body === undefined ? undefined : JSON.stringify(args.body);

  let status: number;
  let text: string;

  if (socketPath) {
    const socketArgs: {
      socketPath: string;
      method: string;
      url: URL;
      timeoutMs: number;
      body?: string;
    } = {
      socketPath,
      method,
      url: target,
      timeoutMs,
    };
    if (body !== undefined) {
      socketArgs.body = body;
    }
    const response = await requestViaSocket(socketArgs);
    status = response.status;
    text = response.body;
  } else {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const requestInit: RequestInit = {
        method,
        signal: controller.signal,
      };
      if (body !== undefined) {
        requestInit.body = body;
        requestInit.headers = { "content-type": "application/json" };
      }
      const response = await fetch(target.toString(), requestInit);
      status = response.status;
      text = await response.text();
    } finally {
      clearTimeout(timeout);
    }
  }

  let data: T | null = null;
  if (text) {
    try {
      data = JSON.parse(text) as T;
    } catch {
      data = null;
    }
  }

  return { status, data, text };
}
