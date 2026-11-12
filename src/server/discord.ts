import {
  buildReport,
  deleteExpense,
  getExpenseForAction,
  parseAmount,
  recordExpense,
  rupiah,
  updateExpense,
  type Period,
} from "./channel-commands";
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
type DiscordComponent = {
  type: number;
  custom_id?: string;
  value?: string;
  components?: DiscordComponent[];
};
type DiscordInteraction = {
  id: string;
  type: number;
  channel_id?: string;
  guild_id?: string;
  data?: {
    name?: string;
    options?: DiscordOption[];
    custom_id?: string;
    component_type?: number;
    components?: DiscordComponent[];
  };
  member?: { user?: DiscordUser };
  user?: DiscordUser;
};

const encoder = new TextEncoder();
const actionWindow = 15 * 60 * 1000;

function actionRow(expenseId: string) {
  return [
    {
      type: 1,
      components: [
        {
          type: 2,
          style: 2,
          label: "Batalkan",
          custom_id: `undo_${expenseId}`,
        },
        {
          type: 2,
          style: 1,
          label: "Edit",
          custom_id: `edit_${expenseId}`,
        },
      ],
    },
  ];
}

function componentValue(components: DiscordComponent[] | undefined, id: string): string {
  for (const component of components ?? []) {
    if (component.custom_id === id && typeof component.value === "string")
      return component.value.trim();
    const nested = componentValue(component.components, id);
    if (nested) return nested;
  }
  return "";
}


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

function reply(content: string, ephemeral = false, components?: object[]) {
  return Response.json({
    type: 4,
    data: {
      content: content.slice(0, 2000),
      ...(ephemeral ? { flags: 64 } : {}),
      ...(components?.length ? { components } : {}),
    },
  });
}

function updateMessage(content: string) {
  return Response.json({ type: 7, data: { content, components: [] } });
}

function helpText() {
  return [
    "Perintah Rekap:",
    "/catat data:30.000, nasi, makan — catat pengeluaran",
    "/laporan periode:harian|mingguan|bulanan — laporan",
    "/bantuan — tampilkan panduan ini",
    "Balasan /catat punya tombol Batalkan dan Edit. Hanya pencatat yang dapat memakainya.",
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

export async function sendDiscordMessage(
  token: string,
  channelId: string,
  content: string,
): Promise<void> {
  const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ content: content.slice(0, 2000), allowed_mentions: { parse: [] } }),
  });
  if (!response.ok) throw new Error("Discord sendMessage failed");
}

async function actionExpense(
  interaction: DiscordInteraction,
  env: IntegrationEnv,
  integration: { integrationId: string },
  expenseId: string,
): Promise<
  | { ok: true; expense: NonNullable<Awaited<ReturnType<typeof getExpenseForAction>>> }
  | { ok: false; message: string }
> {
  const user = interaction.member?.user ?? interaction.user;
  if (!user || user.bot) return { ok: false, message: "Perintah ini hanya untuk pengguna." };
  if (!interaction.channel_id)
    return { ok: false, message: "Channel Discord tidak dikenali." };
  const linked = await findProfileForChannel(
    env.DB,
    integration.integrationId,
    interaction.channel_id,
  );
  const expense = await getExpenseForAction(env.DB, expenseId);
  if (!linked || !expense || expense.channel_id !== linked.channelId)
    return { ok: false, message: "Transaksi ini tidak ditemukan di channel ini." };
  if (expense.reporter_id !== user.id)
    return { ok: false, message: "Hanya pencatat transaksi ini yang dapat mengubahnya." };
  if (Date.now() - expense.created_at > actionWindow)
    return { ok: false, message: "Batas waktu ubah sudah lewat. Gunakan situs web." };
  return { ok: true, expense };
}

async function handleDiscordComponent(
  interaction: DiscordInteraction,
  env: IntegrationEnv,
  integration: { integrationId: string },
): Promise<Response> {
  const customId = interaction.data?.custom_id ?? "";
  const match = customId.match(/^(undo|edit)_([0-9a-f-]{36})$/i);
  if (!match) return reply("Tombol tidak dikenal.", true);
  const [, action, expenseId] = match;
  const result = await actionExpense(interaction, env, integration, expenseId);
  if (!result.ok) return reply(result.message, true);
  if (action === "undo") {
    await deleteExpense(env.DB, result.expense.id);
    return updateMessage(`Pengeluaran dibatalkan: ${rupiah(result.expense.amount)} · ${result.expense.item}.`);
  }
  return Response.json({
    type: 9,
    data: {
      custom_id: `editmodal_${result.expense.id}`,
      title: "Edit pengeluaran",
      components: [
        {
          type: 1,
          components: [
            {
              type: 4,
              custom_id: "data",
              label: "Jumlah, item, kategori",
              style: 2,
              value: `${result.expense.amount}, ${result.expense.item}, ${result.expense.category}`,
              required: true,
              max_length: 350,
            },
          ],
        },
      ],
    },
  });
}

async function handleDiscordModal(
  interaction: DiscordInteraction,
  env: IntegrationEnv,
  integration: { integrationId: string },
): Promise<Response> {
  const customId = interaction.data?.custom_id ?? "";
  const match = customId.match(/^editmodal_([0-9a-f-]{36})$/i);
  if (!match) return reply("Form edit tidak dikenal.", true);
  const expenseId = match[1];
  const result = await actionExpense(interaction, env, integration, expenseId);
  if (!result.ok) return reply(result.message, true);
  const value = componentValue(interaction.data?.components, "data");
  const parts = value.split(",").map((part) => part.trim());
  const amount = parts.length === 3 ? parseAmount(parts[0]) : null;
  if (!amount || !parts[1] || parts[1].length > 200 || !parts[2] || parts[2].length > 100)
    return reply("Format edit: jumlah, item, kategori.", true);
  const updated = await updateExpense(env.DB, {
    expenseId: result.expense.id,
    profileId: result.expense.profile_id,
    amount,
    item: parts[1],
    categoryName: parts[2],
  });
  if (!updated.ok) {
    if (updated.error === "category") {
      const names = updated.categories.join(", ") || "belum ada";
      return reply(`Kategori "${parts[2]}" tidak ditemukan. Kategori tersedia: ${names}.`, true);
    }
    if (updated.error === "limit")
      return reply("Total profil melebihi batas jumlah yang didukung.", true);
    return reply("Transaksi ini sudah tidak ada.", true);
  }
  return reply(`Diperbarui: ${rupiah(amount)} · ${updated.categoryName} · ${parts[1]}.`, true);
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
  if (interaction.type === 3) return handleDiscordComponent(interaction, env, integration);
  if (interaction.type === 5) return handleDiscordModal(interaction, env, integration);
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
    false,
    actionRow(result.expenseId),
  );
}
