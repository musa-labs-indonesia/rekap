import { buildReport, parseAmount, recordExpense, rupiah, type Period } from "./channel-commands";
import {
  discordIntegrationConfig,
  findProfileForChannel,
  type IntegrationEnv,
} from "./integrations";

type DiscordUser = {
  id: string;
  username?: string;
  global_name?: string | null;
  bot?: boolean;
};

type DiscordOption = { name: string; value?: string };
type DiscordInteraction = {
  id: string;
  type: number;
  channel_id?: string;
  guild_id?: string;
  data?: { name?: string; options?: DiscordOption[] };
  member?: { user?: DiscordUser };
  user?: DiscordUser;
};

const encoder = new TextEncoder();

function hexBytes(value: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[0-9a-f]+$/i.test(value) || value.length % 2 !== 0) return null;
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1)
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  return bytes;
}

async function verifySignature(
  publicKey: string,
  signature: string,
  timestamp: string,
  body: string,
): Promise<boolean> {
  if (!/^\d{1,20}$/.test(timestamp)) return false;
  const keyBytes = hexBytes(publicKey);
  const signatureBytes = hexBytes(signature);
  if (!keyBytes || !signatureBytes) return false;
  const data = new Uint8Array(encoder.encode(timestamp + body));
  try {
    const key = await crypto.subtle.importKey("raw", keyBytes, { name: "Ed25519" }, false, [
      "verify",
    ]);
    return await crypto.subtle.verify({ name: "Ed25519" }, key, signatureBytes, data);
  } catch {
    try {
      const key = await crypto.subtle.importKey(
        "raw",
        keyBytes,
        { name: "NODE-ED25519", namedCurve: "NODE-ED25519" },
        false,
        ["verify"],
      );
      return await crypto.subtle.verify(
        { name: "NODE-ED25519" },
        key,
        signatureBytes,
        data,
      );
    } catch {
      return false;
    }
  }
}

function optionValue(interaction: DiscordInteraction, name: string): string {
  const value = interaction.data?.options?.find((option) => option.name === name)?.value;
  return typeof value === "string" ? value.trim() : "";
}

function reply(content: string, ephemeral = false) {
  return Response.json({
    type: 4,
    data: { content: content.slice(0, 2000), ...(ephemeral ? { flags: 64 } : {}) },
  });
}

function helpText() {
  return [
    "Perintah Rekap:",
    "/catat data:30.000, nasi, makan — catat pengeluaran",
    "/laporan periode:harian|mingguan|bulanan — laporan",
    "/bantuan — tampilkan panduan ini",
  ].join("\n");
}

function reportPeriod(value: string): Period | null {
  const normalized = value.toLowerCase();
  if (normalized === "harian" || normalized === "daily" || normalized === "hari") return "daily";
  if (normalized === "mingguan" || normalized === "weekly" || normalized === "minggu")
    return "weekly";
  if (normalized === "bulanan" || normalized === "monthly" || normalized === "bulan")
    return "monthly";
  return null;
}

export async function handleDiscordInteraction(
  request: Request,
  env: IntegrationEnv,
): Promise<Response> {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const integration = await discordIntegrationConfig(env.DB, env);
  if (!integration) return new Response("Unauthorized", { status: 401 });
  const signature = request.headers.get("X-Signature-Ed25519") ?? "";
  const timestamp = request.headers.get("X-Signature-Timestamp") ?? "";
  const body = await request.text();
  if (!(await verifySignature(integration.publicKey, signature, timestamp, body)))
    return new Response("Unauthorized", { status: 401 });
  let interaction: DiscordInteraction;
  try {
    interaction = JSON.parse(body) as DiscordInteraction;
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }
  if (interaction.type === 1) return Response.json({ type: 1 });
  if (interaction.type !== 2 || !interaction.data?.name) return new Response("OK");

  const name = interaction.data.name;
  if (name === "bantuan") return reply(helpText());
  const user = interaction.member?.user ?? interaction.user;
  if (!user || user.bot) return reply("Perintah ini hanya untuk pengguna.", true);
  if (!interaction.channel_id) return reply("Channel Discord tidak dikenali.", true);

  const linked = await findProfileForChannel(
    env.DB,
    integration.integrationId,
    interaction.channel_id,
  );
  if (!linked) return reply("Channel ini belum terhubung ke profil Rekap.", true);
  const profile = await env.DB.prepare(
    "SELECT id, name FROM profiles WHERE id = ? AND archived = 0 LIMIT 1",
  )
    .bind(linked.profileId)
    .first<{ id: string; name: string }>();
  if (!profile) return reply("Profil untuk channel ini sudah diarsipkan.", true);

  if (name === "laporan") {
    const period = reportPeriod(optionValue(interaction, "periode") || "harian");
    if (!period) return reply("Periode harus harian, mingguan, atau bulanan.", true);
    return reply(await buildReport(env.DB, profile, period, Date.now()));
  }

  if (name !== "catat") return reply("Perintah tidak dikenal.", true);
  const data = optionValue(interaction, "data");
  const parts = data.split(",").map((part) => part.trim());
  const amount = parts.length === 3 ? parseAmount(parts[0]) : null;
  if (!amount || !parts[1] || parts[1].length > 200 || !parts[2] || parts[2].length > 100)
    return reply("Format: /catat 30.000, nasi, makan", true);

  const now = Date.now();
  const reporterName = user.global_name?.trim() || user.username?.trim() || null;
  const result = await recordExpense(env.DB, {
    profileId: profile.id,
    amount,
    item: parts[1],
    categoryName: parts[2],
    occurredAt: now,
    createdAt: now,
    reporter: {
      id: user.id,
      name: reporterName,
      username: user.username?.trim() || null,
    },
    channel: {
      channelId: linked.channelId,
      externalMessageId: interaction.id,
      source: "discord",
    },
  });
  if (!result.ok) {
    if (result.error === "duplicate") return reply("Pengeluaran ini sudah dicatat.", true);
    if (result.error === "limit")
      return reply("Total profil melebihi batas jumlah yang didukung.", true);
    const names = result.categories.join(", ") || "belum ada";
    return reply(
      `Kategori "${parts[2]}" tidak ditemukan. Kategori tersedia: ${names}.`,
      true,
    );
  }
  const date = new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    day: "numeric",
    month: "short",
  }).format(now);
  const month = new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    month: "long",
  }).format(now);
  return reply(
    `Tercatat: ${rupiah(amount)} · ${result.categoryName} · ${parts[1]}, ${date}.\n\nTotal ${month}: ${rupiah(result.monthTotal)} dari ${result.monthCount} transaksi.`,
  );
}
