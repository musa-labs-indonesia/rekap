import { createFileRoute } from "@tanstack/react-router";
import { authEnv, bindings } from "@/server/env";
import { bootstrapOwner, getSession } from "@/server/auth";
import { spending } from "@/server/spending";

async function handle(request: Request) {
  await bootstrapOwner(authEnv);
  if (!(await getSession(authEnv, request.headers)))
    return new Response("Unauthorized", { status: 401 });
  if (
    request.method !== "GET" &&
    request.headers.get("Origin") !== new URL(bindings.APP_URL).origin
  )
    return new Response("Forbidden", { status: 403 });
  const response = await spending(request, bindings.DB);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export const Route = createFileRoute("/api/data")({
  server: {
    handlers: { GET: ({ request }) => handle(request), POST: ({ request }) => handle(request) },
  },
});
