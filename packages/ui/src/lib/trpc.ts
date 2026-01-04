import { createTRPCReact, httpBatchLink } from "@trpc/react-query";
import { createTRPCClient as createClient } from "@trpc/client";
import superjson from "superjson";
import type { AppRouter } from "@dere/daemon-client/trpc";

export const trpc = createTRPCReact<AppRouter>();

export function createTRPCClient() {
  return trpc.createClient({
    links: [
      httpBatchLink({
        url: "/api/trpc",
        transformer: superjson,
      }),
    ],
  });
}

// Vanilla client for use outside React (stores, utilities)
export const trpcClient = createClient<AppRouter>({
  links: [
    httpBatchLink({
      url: "/api/trpc",
      transformer: superjson,
    }),
  ],
});
