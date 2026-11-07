import { createFileRoute } from "@tanstack/react-router";
import { authEnv } from "@/server/env";
import { bootstrapOwner, createAuth } from "@/server/auth";
import { rateLimit } from "@/server/rate-limit";

async function handle(request: Request) {
  await bootstrapOwner(authEnv);
  const signIn =
    request.method === "POST" &&
    ["/api/auth/sign-in/username", "/api/auth/sign-in/email"].includes(
      new URL(request.url).pathname,
    );
  if (signIn && !(await rateLimit(authEnv.DB, request, "sign-in")))
    return new Response("Too many attempts", { status: 429 });
  const credential = signIn
    ? await authEnv.DB.prepare(
        "SELECT password FROM auth_account WHERE provider_id = 'credential' LIMIT 1",
      ).first<{ password: string }>()
    : null;
  const response = await createAuth(authEnv).handler(request);
  if (signIn && credential) {
    const current = await authEnv.DB.prepare(
      "SELECT password FROM auth_account WHERE provider_id = 'credential' LIMIT 1",
    ).first<{ password: string }>();
    if (current?.password !== credential.password) {
      await authEnv.DB.prepare(
        "DELETE FROM auth_session WHERE user_id = (SELECT user_id FROM auth_owner_bootstrap WHERE id = 1)",
      ).run();
      return new Response("Please sign in again", { status: 401 });
    }
  }
  return response;
}

export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: { GET: ({ request }) => handle(request), POST: ({ request }) => handle(request) },
  },
});
