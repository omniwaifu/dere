import type { paths } from "./openapi.js";

export type HttpMethod = "get" | "post" | "put" | "patch" | "delete";

type PathKey = keyof paths;

type MethodForPath<P extends PathKey> = keyof paths[P] & HttpMethod;

type RequestParams<Spec> = Spec extends { parameters: infer Params } ? Params : never;

type ParamFromKey<Params, Key extends string> =
  Params extends Record<string, unknown> ? (Key extends keyof Params ? Params[Key] : never) : never;

type JsonContent<Content> =
  Content extends Record<string, unknown>
    ? "application/json" extends keyof Content
      ? Content["application/json"]
      : unknown
    : unknown;

export type QueryParamsFor<P extends PathKey, M extends MethodForPath<P>> = ParamFromKey<
  RequestParams<paths[P][M]>,
  "query"
>;

export type PathParamsFor<P extends PathKey, M extends MethodForPath<P>> = ParamFromKey<
  RequestParams<paths[P][M]>,
  "path"
>;

export type HeaderParamsFor<P extends PathKey, M extends MethodForPath<P>> = ParamFromKey<
  RequestParams<paths[P][M]>,
  "header"
>;

export type HeadersFor<P extends PathKey, M extends MethodForPath<P>> =
  HeaderParamsFor<P, M> extends never ? HeadersInit : HeadersInit & HeaderParamsFor<P, M>;

export type RequestBodyFor<P extends PathKey, M extends MethodForPath<P>> = paths[P][M] extends {
  requestBody: infer Body;
}
  ? Body extends { content: infer Content }
    ? JsonContent<Content>
    : unknown
  : unknown;

type ResponseContent<ResponseMap> =
  ResponseMap extends Record<string, unknown>
    ? "200" extends keyof ResponseMap
      ? ResponseMap["200"]
      : "201" extends keyof ResponseMap
        ? ResponseMap["201"]
        : ResponseMap[keyof ResponseMap]
    : unknown;

type JsonBody<ResponseSpec> = ResponseSpec extends { content: infer Content }
  ? JsonContent<Content>
  : unknown;

export type ResponseJson<Spec> = Spec extends { responses: infer Responses }
  ? JsonBody<ResponseContent<Responses>>
  : unknown;

export type PathKeys = PathKey;
export type MethodKeys<P extends PathKey> = MethodForPath<P>;
