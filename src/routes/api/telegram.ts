import { createFileRoute } from "@tanstack/react-router";
import { authEnv, bindings } from "@/server/env";
import { bootstrapOwner, issueTelegramRecoveryLink } from "@/server/auth";
import { handleTelegramWebhook } from "@/server/telegram";

export const Route = createFileRoute("/api/telegram")({
  server: {
    handlers: {
      POST: ({ request }) =>
        handleTelegramWebhook(request, bindings, async ({ userId, chatId }) => {
          await bootstrapOwner(authEnv);
          const url = await issueTelegramRecoveryLink(authEnv, userId, chatId, "private");
          return `Atur ulang kata sandi melalui tautan ini dalam 10 menit: ${url}`;
        }),
    },
  },
});
