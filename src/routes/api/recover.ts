import { createFileRoute } from "@tanstack/react-router";
import { authEnv } from "@/server/env";
import { consumeRecoveryToken } from "@/server/auth";
import { rateLimit } from "@/server/rate-limit";

export const Route = createFileRoute("/api/recover")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (
          request.headers.get("Origin") !== new URL(authEnv.BETTER_AUTH_URL).origin ||
          !request.headers.get("content-type")?.startsWith("application/json")
        )
          return new Response("Forbidden", { status: 403 });
        if (!(await rateLimit(authEnv.DB, request, "recovery")))
          return new Response("Too many attempts", { status: 429 });
        try {
          const { token, password } = (await request.json()) as { token: string; password: string };
          const ok =
            typeof token === "string" &&
            typeof password === "string" &&
            (await consumeRecoveryToken(authEnv, token, password));
          return Response.json(
            { ok },
            { status: ok ? 200 : 400, headers: { "Cache-Control": "no-store" } },
          );
        } catch {
          return new Response("Invalid request", { status: 400 });
        }
      },
    },
  },
});
