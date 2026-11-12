import { createFileRoute } from "@tanstack/react-router";
import { authEnv, bindings } from "@/server/env";
import { bootstrapOwner, getSession } from "@/server/auth";
import {
  activateTelegramEnv,
  connectTelegram,
  createLinkCode,
  disconnectDiscord,
  disconnectTelegram,
  linkChannel,
  listChannels,
  listDiscordChannels,
  listIntegrations,
  registerDiscordIntegration,
  unlinkChannel,
  verifyDiscordToken,
} from "@/server/integrations";

const discordCommands = [
  {
    name: "catat",
    description: "Catat pengeluaran",
    options: [
      {
        type: 3,
        name: "data",
        description: "Contoh: 30.000, nasi, makan",
        required: true,
      },
    ],
  },
  {
    name: "laporan",
    description: "Laporan pengeluaran",
    options: [
      {
        type: 3,
        name: "periode",
        description: "Pilih periode laporan",
        required: false,
        choices: [
          { name: "Harian", value: "harian" },
          { name: "Mingguan", value: "mingguan" },
          { name: "Bulanan", value: "bulanan" },
        ],
      },
    ],
  },
  { name: "bantuan", description: "Panduan Rekap" },
];

const bad = (message: string, status = 400) => Response.json({ error: message }, { status });

async function handle(request: Request) {
  await bootstrapOwner(authEnv);
  if (!(await getSession(authEnv, request.headers))) return new Response("Unauthorized", { status: 401 });
  if (
    request.method !== "GET" &&
    request.headers.get("Origin") !== new URL(bindings.APP_URL).origin
  )
    return new Response("Forbidden", { status: 403 });

  if (request.method === "GET") {
    const response = Response.json({
      integrations: await listIntegrations(bindings.DB, bindings),
      channels: await listChannels(bindings.DB),
    });
    response.headers.set("Cache-Control", "no-store");
    return response;
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return bad("Permintaan tidak valid.");
  }
  const action = typeof body.action === "string" ? body.action : "";
  const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
  try {
    if (action === "connectTelegram") {
      const integration = await connectTelegram(bindings.DB, bindings, text(body.token));
      return Response.json({ integration }, { headers: { "Cache-Control": "no-store" } });
    }
    if (action === "activateTelegram") {
      const integration = await activateTelegramEnv(bindings.DB, bindings);
      return Response.json({ integration }, { headers: { "Cache-Control": "no-store" } });
    }
    if (action === "disconnectTelegram") {
      await disconnectTelegram(bindings.DB, bindings);
      return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
    }
    if (action === "connectDiscord") {
      const token = text(body.token);
      const verified = await verifyDiscordToken(token);
      const integration = await registerDiscordIntegration(bindings.DB, bindings, {
        token,
        applicationId: verified.applicationId,
        publicKey: verified.publicKey,
        botName: verified.botName,
        interactionsEndpoint: `${new URL(bindings.APP_URL).origin}/api/discord`,
        commands: discordCommands,
      });
      return Response.json({ integration }, { headers: { "Cache-Control": "no-store" } });
    }
    if (action === "disconnectDiscord") {
      await disconnectDiscord(bindings.DB);
      return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
    }
    if (action === "listDiscordChannels") {
      const channels = await listDiscordChannels(bindings.DB, bindings);
      return Response.json({ channels }, { headers: { "Cache-Control": "no-store" } });
    }
    if (action === "linkChannel") {
      await linkChannel(
        bindings.DB,
        text(body.profileId),
        text(body.integrationId),
        text(body.externalId),
        text(body.externalName) || null,
      );
      return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
    }
    if (action === "unlinkChannel") {
      await unlinkChannel(bindings.DB, text(body.profileId), text(body.channelId));
      return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
    }
    if (action === "createLinkCode") {
      const result = await createLinkCode(
        bindings.DB,
        text(body.profileId),
        text(body.integrationId),
      );
      return Response.json(result, { headers: { "Cache-Control": "no-store" } });
    }
    return bad("Tindakan tidak dikenal.");
  } catch (error) {
    return bad(error instanceof Error ? error.message : "Perubahan tidak dapat disimpan.");
  }
}

export const Route = createFileRoute("/api/channels")({
  server: {
    handlers: { GET: ({ request }) => handle(request), POST: ({ request }) => handle(request) },
  },
});
