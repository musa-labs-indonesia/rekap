import type { D1Database } from "@cloudflare/workers-types/index";
import { decryptConfig, encryptConfig, randomCode, secureEqual, sha256Hex } from "./channel-crypto";

export type IntegrationType = "telegram" | "discord";
export type IntegrationStatus = "connected" | "connecting" | "disabled" | "error";

export type IntegrationRow = {
  id: string;
  type: IntegrationType;
  name: string;
  source: "env" | "db";
  config: string | null;
  public_config: string;
  webhook_secret_hash: string | null;
  status: IntegrationStatus;
  last_error: string | null;
  created_at: number;
  updated_at: number;
};

export type PublicIntegration = {
  id: string;
  type: IntegrationType;
  name: string;
  source: "env" | "db";
  status: IntegrationStatus;
  lastError: string | null;
  publicConfig: Record<string, unknown>;
};

export type ChannelRow = {
  id: string;
  profile_id: string;
  integration_id: string;
  external_id: string;
  external_name: string | null;
  active: number;
  created_at: number;
  type: IntegrationType;
  integration_name: string;
  integration_status: IntegrationStatus;
};

export type IntegrationEnv = {
  DB: D1Database;
  BETTER_AUTH_SECRET: string;
  APP_URL: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_BOT_USERNAME?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  TRUSTED_TELEGRAM_USER_ID?: string;
};

const now = () => Date.now();

function parsePublicConfig(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function publicIntegration(row: IntegrationRow): PublicIntegration {
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    source: row.source,
    status: row.status,
    lastError: row.last_error,
    publicConfig: parsePublicConfig(row.public_config),
  };
}

async function getIntegration(db: D1Database, type: IntegrationType): Promise<IntegrationRow | null> {
  return db.prepare("SELECT * FROM integrations WHERE type = ?").bind(type).first<IntegrationRow>();
}

export async function ensureIntegrations(db: D1Database, env: IntegrationEnv): Promise<IntegrationRow[]> {
  const timestamp = now();
  await db
    .prepare(
      "INSERT INTO integrations (id, type, name, source, public_config, status, created_at, updated_at) VALUES (?, 'telegram', 'Telegram', 'env', '{}', 'connected', ?, ?) ON CONFLICT(type) DO NOTHING",
    )
    .bind("telegram", timestamp, timestamp)
    .run();
  const telegram = await getIntegration(db, "telegram");
  if (telegram?.source === "env") {
    const publicConfig = {
      ...parsePublicConfig(telegram.public_config),
      ...(env.TELEGRAM_BOT_USERNAME ? { botUsername: env.TELEGRAM_BOT_USERNAME } : {}),
      ...(env.TRUSTED_TELEGRAM_USER_ID
        ? { trustedTelegramUserId: env.TRUSTED_TELEGRAM_USER_ID }
        : {}),
    };
    await db
      .prepare("UPDATE integrations SET public_config = ?, updated_at = ? WHERE id = ? AND source = 'env'")
      .bind(JSON.stringify(publicConfig), timestamp, telegram.id)
      .run();
  }
  return (await db.prepare("SELECT * FROM integrations ORDER BY type").all<IntegrationRow>()).results;
}

export async function listIntegrations(db: D1Database, env: IntegrationEnv): Promise<PublicIntegration[]> {
  return (await ensureIntegrations(db, env)).map(publicIntegration);
}

export async function getIntegrationById(db: D1Database, id: string): Promise<IntegrationRow | null> {
  return db.prepare("SELECT * FROM integrations WHERE id = ?").bind(id).first<IntegrationRow>();
}

export async function getTelegramIntegration(db: D1Database): Promise<IntegrationRow | null> {
  return getIntegration(db, "telegram");
}

export async function getDiscordIntegration(db: D1Database): Promise<IntegrationRow | null> {
  return getIntegration(db, "discord");
}

async function telegramApi<T>(token: string, method: string, body?: object): Promise<T> {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = (await response.json()) as { ok?: boolean; result?: T; description?: string };
  if (!response.ok || !data.ok || data.result === undefined)
    throw new Error(data.description || "Telegram request failed");
  return data.result;
}

const telegramCommands = [
  { command: "help", description: "Tampilkan panduan perintah" },
  { command: "chatid", description: "Tampilkan ID chat" },
  { command: "connect", description: "Hubungkan chat ke profil" },
  { command: "addcategory", description: "Tambah kategori" },
  { command: "report_daily", description: "Laporan hari ini" },
  { command: "report_weekly", description: "Laporan minggu ini" },
  { command: "report_monthly", description: "Laporan bulan ini" },
  { command: "forgot_password", description: "Pulihkan kata sandi" },
];

export async function connectTelegram(
  db: D1Database,
  env: IntegrationEnv,
  token: string,
): Promise<PublicIntegration> {
  const trimmed = token.trim();
  if (!/^\d{1,20}:[a-zA-Z0-9_-]{20,128}$/.test(trimmed))
    throw new Error("Token bot Telegram tidak valid.");
  const bot = await telegramApi<{ is_bot?: boolean; username?: string }>(trimmed, "getMe");
  if (!bot.is_bot || !bot.username) throw new Error("Token bukan milik bot Telegram.");
  const webhook = await telegramApi<{ url?: string }>(trimmed, "getWebhookInfo");
  const webhookUrl = `${new URL(env.APP_URL).origin}/api/telegram`;
  if (typeof webhook.url !== "string") throw new Error("Status webhook Telegram tidak dapat dibaca.");
  if (webhook.url && webhook.url !== webhookUrl)
    throw new Error("Bot ini sudah memakai webhook lain. Hapus webhook lama terlebih dahulu.");

  const integration = await getIntegration(db, "telegram");
  if (!integration) throw new Error("Integrasi Telegram tidak ditemukan.");
  const secretBytes = crypto.getRandomValues(new Uint8Array(32));
  const webhookSecret = Array.from(secretBytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  const config = await encryptConfig(env.BETTER_AUTH_SECRET, integration.id, { token: trimmed });
  const publicConfig = {
    ...parsePublicConfig(integration.public_config),
    botUsername: bot.username,
  };
  const timestamp = now();
  await db
    .prepare(
      "UPDATE integrations SET source = 'db', config = ?, public_config = ?, webhook_secret_hash = ?, status = 'connecting', last_error = NULL, updated_at = ? WHERE id = ?",
    )
    .bind(config, JSON.stringify(publicConfig), await sha256Hex(webhookSecret), timestamp, integration.id)
    .run();

  try {
    await telegramApi(trimmed, "setWebhook", {
      url: webhookUrl,
      secret_token: webhookSecret,
      allowed_updates: ["message"],
      drop_pending_updates: false,
    });
    await telegramApi(trimmed, "setMyCommands", { commands: telegramCommands });
    await db
      .prepare("UPDATE integrations SET status = 'connected', updated_at = ? WHERE id = ?")
      .bind(now(), integration.id)
      .run();
    await db
      .prepare("UPDATE profile_channels SET active = 1 WHERE integration_id = ?")
      .bind(integration.id)
      .run();
  } catch (error) {
    await db
      .prepare("UPDATE integrations SET status = 'error', last_error = ?, updated_at = ? WHERE id = ?")
      .bind(error instanceof Error ? error.message : "Telegram request failed", now(), integration.id)
      .run();
    throw error;
  }
  return publicIntegration((await getIntegrationById(db, integration.id))!);
}

export async function activateTelegramEnv(
  db: D1Database,
  env: IntegrationEnv,
): Promise<PublicIntegration> {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_WEBHOOK_SECRET)
    throw new Error("Instalasi ini tidak memiliki token bot Telegram.");
  const integration = await getIntegration(db, "telegram");
  if (!integration) throw new Error("Integrasi Telegram tidak ditemukan.");
  const webhookUrl = `${new URL(env.APP_URL).origin}/api/telegram`;
  await telegramApi(env.TELEGRAM_BOT_TOKEN, "setWebhook", {
    url: webhookUrl,
    secret_token: env.TELEGRAM_WEBHOOK_SECRET,
    allowed_updates: ["message"],
    drop_pending_updates: false,
  });
  await db
    .prepare(
      "UPDATE integrations SET source = 'env', config = NULL, webhook_secret_hash = NULL, status = 'connected', last_error = NULL, public_config = ?, updated_at = ? WHERE id = ?",
    )
    .bind(
      JSON.stringify({
        ...(env.TELEGRAM_BOT_USERNAME ? { botUsername: env.TELEGRAM_BOT_USERNAME } : {}),
        ...(env.TRUSTED_TELEGRAM_USER_ID
          ? { trustedTelegramUserId: env.TRUSTED_TELEGRAM_USER_ID }
          : {}),
      }),
      now(),
      integration.id,
    )
    .run();
  await db
    .prepare("UPDATE profile_channels SET active = 1 WHERE integration_id = ?")
    .bind(integration.id)
    .run();
  return publicIntegration((await getIntegrationById(db, integration.id))!);
}

export async function disconnectTelegram(db: D1Database, env: IntegrationEnv): Promise<void> {
  const integration = await getIntegration(db, "telegram");
  if (!integration) return;
  const config = await decryptConfig<{ token?: string }>(
    env.BETTER_AUTH_SECRET,
    integration.id,
    integration.config,
  );
  const token = config?.token || env.TELEGRAM_BOT_TOKEN;
  if (token) {
    try {
      await telegramApi(token, "deleteWebhook", { drop_pending_updates: false });
    } catch {}
  }
  await db.batch([
    db
      .prepare("UPDATE integrations SET status = 'disabled', last_error = NULL, updated_at = ? WHERE id = ?")
      .bind(now(), integration.id),
    db.prepare("UPDATE profile_channels SET active = 0 WHERE integration_id = ?").bind(integration.id),
  ]);
}

export async function telegramWebhook(
  db: D1Database,
  env: IntegrationEnv,
  providedSecret: string,
): Promise<{
  token: string;
  botUsername: string | null;
  trustedTelegramUserId: string | null;
  integrationId: string;
} | null> {
  const integration = await getIntegration(db, "telegram");
  if (!integration || integration.status !== "connected") return null;
  const publicConfig = parsePublicConfig(integration.public_config);
  if (integration.source === "env") {
    if (
      !env.TELEGRAM_BOT_TOKEN ||
      !env.TELEGRAM_WEBHOOK_SECRET ||
      !/^[A-Za-z0-9_-]{32,256}$/.test(env.TELEGRAM_WEBHOOK_SECRET)
    )
      return null;
    if (!secureEqual(providedSecret, env.TELEGRAM_WEBHOOK_SECRET)) return null;
    return {
      token: env.TELEGRAM_BOT_TOKEN,
      botUsername:
        typeof publicConfig.botUsername === "string"
          ? publicConfig.botUsername
          : env.TELEGRAM_BOT_USERNAME ?? null,
      trustedTelegramUserId:
        typeof publicConfig.trustedTelegramUserId === "string"
          ? publicConfig.trustedTelegramUserId
          : env.TRUSTED_TELEGRAM_USER_ID ?? null,
      integrationId: integration.id,
    };
  }
  const config = await decryptConfig<{ token?: string }>(
    env.BETTER_AUTH_SECRET,
    integration.id,
    integration.config,
  );
  if (!config?.token || !integration.webhook_secret_hash) return null;
  if (!secureEqual(await sha256Hex(providedSecret), integration.webhook_secret_hash)) return null;
  return {
    token: config.token,
    botUsername: typeof publicConfig.botUsername === "string" ? publicConfig.botUsername : null,
    trustedTelegramUserId:
      typeof publicConfig.trustedTelegramUserId === "string"
        ? publicConfig.trustedTelegramUserId
        : null,
    integrationId: integration.id,
  };
}

export async function listChannels(db: D1Database, profileId?: string): Promise<ChannelRow[]> {
  const query = profileId
    ? "SELECT pc.*, i.type, i.name AS integration_name, i.status AS integration_status FROM profile_channels pc JOIN integrations i ON i.id = pc.integration_id WHERE pc.profile_id = ? ORDER BY pc.created_at"
    : "SELECT pc.*, i.type, i.name AS integration_name, i.status AS integration_status FROM profile_channels pc JOIN integrations i ON i.id = pc.integration_id ORDER BY pc.created_at";
  const statement = db.prepare(query);
  return profileId
    ? (await statement.bind(profileId).all<ChannelRow>()).results
    : (await statement.all<ChannelRow>()).results;
}

export async function findProfileForChannel(
  db: D1Database,
  integrationId: string,
  externalId: string,
): Promise<{ profileId: string; channelId: string } | null> {
  const row = await db
    .prepare(
      "SELECT pc.id AS channelId, pc.profile_id AS profileId FROM profile_channels pc JOIN profiles p ON p.id = pc.profile_id WHERE pc.integration_id = ? AND pc.external_id = ? AND pc.active = 1 AND p.archived = 0 LIMIT 1",
    )
    .bind(integrationId, externalId)
    .first<{ channelId: string; profileId: string }>();
  return row ?? null;
}

export async function findLegacyTelegramProfile(
  db: D1Database,
  chatId: string,
): Promise<{ profileId: string; channelId: string | null } | null> {
  const profile = await db
    .prepare("SELECT id FROM profiles WHERE chat_id = ? AND archived = 0 LIMIT 1")
    .bind(chatId)
    .first<{ id: string }>();
  if (!profile) return null;
  const channel = await db
    .prepare("SELECT id FROM profile_channels WHERE integration_id = 'telegram' AND external_id = ? LIMIT 1")
    .bind(chatId)
    .first<{ id: string }>();
  return { profileId: profile.id, channelId: channel?.id ?? null };
}

export async function linkChannel(
  db: D1Database,
  profileId: string,
  integrationId: string,
  externalId: string,
  externalName: string | null,
): Promise<void> {
  if (!profileId || !integrationId || !externalId) throw new Error("Kanal tidak valid.");
  const [profile, integration] = await Promise.all([
    db
      .prepare("SELECT archived FROM profiles WHERE id = ? LIMIT 1")
      .bind(profileId)
      .first<{ archived: number }>(),
    getIntegrationById(db, integrationId),
  ]);
  if (!profile) throw new Error("Profil tidak ditemukan.");
  if (profile.archived) throw new Error("Profil ini sudah diarsipkan.");
  if (!integration || integration.status !== "connected")
    throw new Error("Integrasi belum terhubung.");
  const existing = await db
    .prepare("SELECT profile_id FROM profile_channels WHERE integration_id = ? AND external_id = ?")
    .bind(integrationId, externalId)
    .first<{ profile_id: string }>();
  if (existing && existing.profile_id !== profileId)
    throw new Error("Kanal ini sudah terhubung ke profil lain.");
  await db
    .prepare(
      "INSERT INTO profile_channels (id, profile_id, integration_id, external_id, external_name, active, created_at) VALUES (?, ?, ?, ?, ?, 1, ?) ON CONFLICT(integration_id, external_id) DO UPDATE SET profile_id = excluded.profile_id, external_name = excluded.external_name, active = 1",
    )
    .bind(crypto.randomUUID(), profileId, integrationId, externalId, externalName, now())
    .run();
}

export async function unlinkChannel(db: D1Database, profileId: string, channelId: string): Promise<void> {
  await db
    .prepare("DELETE FROM profile_channels WHERE id = ? AND profile_id = ?")
    .bind(channelId, profileId)
    .run();
}

export async function createLinkCode(
  db: D1Database,
  profileId: string,
  integrationId: string,
): Promise<{ code: string; expiresAt: number }> {
  const integration = await getIntegrationById(db, integrationId);
  if (!integration || integration.type !== "telegram" || integration.status !== "connected")
    throw new Error("Integrasi Telegram belum terhubung.");
  const profile = await db
    .prepare("SELECT archived FROM profiles WHERE id = ? LIMIT 1")
    .bind(profileId)
    .first<{ archived: number }>();
  if (!profile) throw new Error("Profil tidak ditemukan.");
  if (profile.archived) throw new Error("Profil ini sudah diarsipkan.");
  const code = randomCode();
  const expiresAt = now() + 10 * 60 * 1000;
  const hash = await sha256Hex(code);
  await db.batch([
    db.prepare("DELETE FROM channel_link_codes WHERE profile_id = ?").bind(profileId),
    db
      .prepare(
        "INSERT INTO channel_link_codes (code_hash, profile_id, integration_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?)",
      )
      .bind(hash, profileId, integrationId, expiresAt, now()),
  ]);
  return { code, expiresAt };
}

export async function claimLinkCode(
  db: D1Database,
  code: string,
  integrationId: string,
  externalId: string,
  externalName: string | null,
): Promise<{ profileId: string; profileName: string }> {
  const hash = await sha256Hex(code.trim().toUpperCase());
  const row = await db
    .prepare(
      "SELECT c.profile_id AS profileId, p.name AS profileName FROM channel_link_codes c JOIN profiles p ON p.id = c.profile_id WHERE c.code_hash = ? AND c.integration_id = ? AND c.expires_at > ? LIMIT 1",
    )
    .bind(hash, integrationId, now())
    .first<{ profileId: string; profileName: string }>();
  if (!row) throw new Error("Kode tidak valid atau sudah kedaluwarsa.");
  await linkChannel(db, row.profileId, integrationId, externalId, externalName);
  await db.prepare("DELETE FROM channel_link_codes WHERE code_hash = ?").bind(hash).run();
  return row;
}

export async function registerDiscordIntegration(
  db: D1Database,
  env: IntegrationEnv,
  input: {
    token: string;
    applicationId: string;
    publicKey: string;
    botName: string;
    interactionsEndpoint: string;
    commands: object[];
  },
): Promise<PublicIntegration> {
  const id = "discord";
  const existing = await getIntegration(db, "discord");
  const config = await encryptConfig(env.BETTER_AUTH_SECRET, id, { token: input.token });
  const publicConfig = {
    applicationId: input.applicationId,
    publicKey: input.publicKey,
    botName: input.botName,
  };
  const timestamp = now();
  if (existing) {
    await db
      .prepare(
        "UPDATE integrations SET config = ?, public_config = ?, status = 'connecting', last_error = NULL, updated_at = ? WHERE id = ?",
      )
      .bind(config, JSON.stringify(publicConfig), timestamp, id)
      .run();
  } else {
    await db
      .prepare(
        "INSERT INTO integrations (id, type, name, source, config, public_config, status, created_at, updated_at) VALUES (?, 'discord', 'Discord', 'db', ?, ?, 'connecting', ?, ?)",
      )
      .bind(id, config, JSON.stringify(publicConfig), timestamp, timestamp)
      .run();
  }
  try {
    await discordApi(input.token, "/applications/@me", "PATCH", {
      interactions_endpoint_url: input.interactionsEndpoint,
    });
    await discordApi(input.token, `/applications/${input.applicationId}/commands`, "PUT", input.commands);
    await db
      .prepare("UPDATE integrations SET status = 'connected', updated_at = ? WHERE id = ?")
      .bind(now(), id)
      .run();
    await db
      .prepare("UPDATE profile_channels SET active = 1 WHERE integration_id = ?")
      .bind(id)
      .run();
  } catch (error) {
    await db
      .prepare("UPDATE integrations SET status = 'error', last_error = ?, updated_at = ? WHERE id = ?")
      .bind(error instanceof Error ? error.message : "Discord request failed", now(), id)
      .run();
    throw error;
  }
  return publicIntegration((await getIntegrationById(db, id))!);
}

export async function disconnectDiscord(db: D1Database): Promise<void> {
  const integration = await getIntegration(db, "discord");
  if (!integration) return;
  await db.batch([
    db
      .prepare("UPDATE integrations SET status = 'disabled', config = NULL, last_error = NULL, updated_at = ? WHERE id = ?")
      .bind(now(), integration.id),
    db.prepare("UPDATE profile_channels SET active = 0 WHERE integration_id = ?").bind(integration.id),
  ]);
}

export async function discordIntegrationConfig(
  db: D1Database,
  env: IntegrationEnv,
): Promise<{
  integrationId: string;
  token: string;
  applicationId: string;
  publicKey: string;
  botName: string;
} | null> {
  const integration = await getIntegration(db, "discord");
  if (!integration || (integration.status !== "connected" && integration.status !== "connecting"))
    return null;
  const config = await decryptConfig<{ token?: string }>(
    env.BETTER_AUTH_SECRET,
    integration.id,
    integration.config,
  );
  const publicConfig = parsePublicConfig(integration.public_config);
  if (
    !config?.token ||
    typeof publicConfig.applicationId !== "string" ||
    typeof publicConfig.publicKey !== "string"
  )
    return null;
  return {
    integrationId: integration.id,
    token: config.token,
    applicationId: publicConfig.applicationId,
    publicKey: publicConfig.publicKey,
    botName: typeof publicConfig.botName === "string" ? publicConfig.botName : "Discord",
  };
}

async function discordApi<T>(
  token: string,
  path: string,
  method = "GET",
  body?: object,
): Promise<T> {
  const response = await fetch(`https://discord.com/api/v10${path}`, {
    method,
    headers: {
      Authorization: `Bot ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = (await response.json().catch(() => null)) as
    | (T & { message?: string; code?: number })
    | null;
  if (!response.ok || data === null)
    throw new Error(data?.message || `Discord request failed (${response.status})`);
  return data;
}

export async function verifyDiscordToken(token: string): Promise<{
  applicationId: string;
  publicKey: string;
  botName: string;
}> {
  const trimmed = token.trim();
  if (!/^[A-Za-z0-9._-]{20,200}$/.test(trimmed)) throw new Error("Token bot Discord tidak valid.");
  const user = await discordApi<{ bot?: boolean; username?: string; global_name?: string }>(
    trimmed,
    "/users/@me",
  );
  if (!user.bot) throw new Error("Token bukan milik bot Discord.");
  const application = await discordApi<{
    id?: string;
    name?: string;
    verify_key?: string;
  }>(trimmed, "/applications/@me");
  if (!application.id || !application.verify_key)
    throw new Error("Public key aplikasi Discord tidak tersedia.");
  return {
    applicationId: application.id,
    publicKey: application.verify_key,
    botName: application.name || user.global_name || user.username || "Discord",
  };
}

export async function listDiscordChannels(
  db: D1Database,
  env: IntegrationEnv,
): Promise<Array<{ guildId: string; guildName: string; channelId: string; channelName: string }>> {
  const integration = await discordIntegrationConfig(db, env);
  if (!integration) throw new Error("Discord belum terhubung.");
  const guilds = await discordApi<Array<{ id: string; name: string }>>(
    integration.token,
    "/users/@me/guilds",
  );
  const result: Array<{
    guildId: string;
    guildName: string;
    channelId: string;
    channelName: string;
  }> = [];
  for (const guild of guilds.slice(0, 20)) {
    const channels = await discordApi<Array<{ id: string; name: string; type: number }>>(
      integration.token,
      `/guilds/${guild.id}/channels`,
    );
    for (const channel of channels.filter((item) => item.type === 0).slice(0, 100)) {
      result.push({
        guildId: guild.id,
        guildName: guild.name,
        channelId: channel.id,
        channelName: channel.name,
      });
    }
  }
  return result;
}
