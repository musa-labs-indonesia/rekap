import { createFileRoute } from "@tanstack/react-router";
import { bindings } from "@/server/env";
import { handleDiscordInteraction } from "@/server/discord";

export const Route = createFileRoute("/api/discord")({
  server: {
    handlers: {
      POST: ({ request }) => handleDiscordInteraction(request, bindings),
    },
  },
});
