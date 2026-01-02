import type { paths } from "./openapi.js";
import type {
  HeadersFor,
  HttpMethod,
  MethodKeys,
  PathKeys,
  PathParamsFor,
  QueryParamsFor,
  RequestBodyFor,
  ResponseJson,
} from "./types.js";

export interface DaemonClientOptions {
  baseUrl: string;
  fetcher?: typeof fetch;
  headers?: HeadersInit;
}

export interface RequestOptions {
  query?: Record<string, unknown>;
  pathParams?: Record<string, string | number>;
  headers?: HeadersInit;
  body?: unknown;
}

export type RequestOptionsFor<P extends PathKeys, M extends MethodKeys<P>> = {
  query?: QueryParamsFor<P, M>;
  pathParams?: PathParamsFor<P, M>;
  headers?: HeadersFor<P, M>;
  body?: RequestBodyFor<P, M>;
};

function applyPathParams(path: string, params?: RequestOptions["pathParams"]): string {
  if (!params) {
    return path;
  }

  let resolved = path;
  for (const [key, value] of Object.entries(params)) {
    resolved = resolved.replace(`{${key}}`, encodeURIComponent(String(value)));
  }
  return resolved;
}

function appendQuery(url: URL, query?: Record<string, unknown>): void {
  if (!query) {
    return;
  }

  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) {
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item === undefined || item === null) {
          continue;
        }
        url.searchParams.append(key, String(item));
      }
      continue;
    }
    url.searchParams.set(key, String(value));
  }
}

function buildUrl(
  baseUrl: string,
  path: string,
  query?: Record<string, unknown>,
  pathParams?: RequestOptions["pathParams"],
): string {
  const resolvedPath = applyPathParams(path, pathParams);
  const url = new URL(resolvedPath, baseUrl);
  appendQuery(url, query);
  return url.toString();
}

export function createDaemonClient(options: DaemonClientOptions) {
  const baseUrl = options.baseUrl.endsWith("/") ? options.baseUrl : `${options.baseUrl}/`;
  const fetcher = options.fetcher ?? fetch;
  const baseHeaders = options.headers;

  async function rawRequest(
    path: string,
    method: HttpMethod,
    requestOptions: RequestOptions = {},
  ): Promise<unknown> {
    const url = buildUrl(baseUrl, path, requestOptions.query, requestOptions.pathParams);
    const init: RequestInit = {
      method: method.toUpperCase(),
      headers: {
        "Content-Type": "application/json",
        ...baseHeaders,
        ...requestOptions.headers,
      },
    };
    if (requestOptions.body !== undefined) {
      init.body = JSON.stringify(requestOptions.body);
    }
    const response = await fetcher(url, init);

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Daemon request failed (${response.status}): ${text}`);
    }

    if (response.status === 204) {
      return null;
    }

    return response.json() as Promise<unknown>;
  }

  async function request<P extends PathKeys, M extends MethodKeys<P>>(
    path: P,
    method: M,
    requestOptions: RequestOptionsFor<P, M> = {},
  ): Promise<ResponseJson<paths[P][M]>> {
    const normalized: RequestOptions = {};
    if (requestOptions.query !== undefined) {
      normalized.query = requestOptions.query as Record<string, unknown>;
    }
    if (requestOptions.pathParams !== undefined) {
      normalized.pathParams = requestOptions.pathParams as Record<string, string | number>;
    }
    if (requestOptions.headers !== undefined) {
      normalized.headers = requestOptions.headers;
    }
    if (requestOptions.body !== undefined) {
      normalized.body = requestOptions.body;
    }
    const result = await rawRequest(path as string, method, normalized);
    return result as ResponseJson<paths[P][M]>;
  }

  return {
    request,
    rawRequest,
  };
}
