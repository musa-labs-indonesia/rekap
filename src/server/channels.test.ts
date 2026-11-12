import { generateKeyPairSync, sign, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { D1Database } from "@cloudflare/workers-types/index";
import { handleDiscordInteraction } from "./discord";
import { encryptConfig } from "./channel-crypto";
import { handleScheduled } from "./recap";
import {
  connectTelegram,
  createLinkCode,
  disconnectTelegram,
  linkChannel,
  type IntegrationEnv,
} from "./integrations";
import { handleTelegramWebhook } from "./telegram";

class Statement {
  private values: SQLInputValue[] = [];
  constructor(private db: DatabaseSync, private sql: string) {}
  bind(...values: SQLInputValue[]) {
    const statement = new Statement(this.db, this.sql);
    statement.values = values;
    return statement;
  }
  async first() {
    return this.db.prepare(this.sql).get(...this.values) ?? null;
  }
  async all() {
    return { results: this.db.prepare(this.sql).all(...this.values) };
  }
  runSync() {
    const result = this.db.prepare(this.sql).run(...this.values);
    return { meta: { changes: Number(result.changes) } };
  }
  async run() {
    return this.runSync();
  }
}

let sqlite: DatabaseSync;
let env: IntegrationEnv;
let replies: Array<{ chat_id: string; text: string }>;
const secret = "test-secret-0123456789abcdef0123456789";
const webhookSecret = "test-webhook-secret-0123456789abcdef";

function request(body: object, headers: Record<string, string> = {}) {
  return new Request("https://app.example/api/discord", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

function telegramRequest(text: string, chat: number, title?: string, id = 1) {
  return new Request("https://app.example/api/telegram", {
    method: "POST",
    headers: { "X-Telegram-Bot-Api-Secret-Token": webhookSecret },
    body: JSON.stringify({
      message: {
        message_id: id,
        date: Math.floor(Date.now() / 1000),
        chat: { id: chat, type: "group", title },
        from: { id: 88, first_name: "Sari", last_name: "Dewi", username: "sari" },
        text,
      },
    }),
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-03-01T17:30:00Z"));
  Object.defineProperty(crypto.subtle, "timingSafeEqual", {
    configurable: true,
    value: (first: ArrayBuffer, second: ArrayBuffer) =>
      timingSafeEqual(Buffer.from(first), Buffer.from(second)),
  });
  sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  sqlite.exec(readFileSync("migrations/0001_spending.sql", "utf8"));
  sqlite.exec(readFileSync("migrations/0003_reporter.sql", "utf8"));
  sqlite.exec(readFileSync("migrations/0004_channels.sql", "utf8"));
  sqlite.exec(readFileSync("migrations/0005_channel_actions.sql", "utf8"));
  sqlite.exec(
    "INSERT INTO profiles (id, name, chat_id, archived, created_at) VALUES ('p1', 'Lama', '-100', 0, 1), ('p2', 'Baru', 'unlinked:p2', 0, 1)",
  );
  sqlite.exec(
    "INSERT INTO categories (id, profile_id, name, name_key) VALUES ('c1', 'p1', 'Makan', 'makan'), ('c2', 'p2', 'Makan', 'makan')",
  );
  env = {
    DB: new TestD1From(sqlite) as unknown as D1Database,
    BETTER_AUTH_SECRET: secret,
    APP_URL: "https://app.example",
    TELEGRAM_BOT_TOKEN: "123:token",
    TELEGRAM_BOT_USERNAME: "bot",
    TELEGRAM_WEBHOOK_SECRET: webhookSecret,
  };
  replies = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
    replies.push(JSON.parse(String(init.body)));
    return Response.json({ ok: true });
  }));
});

afterEach(() => {
  sqlite.close();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  Reflect.deleteProperty(crypto.subtle, "timingSafeEqual");
});

class TestD1From {
  constructor(private source: DatabaseSync) {}
  prepare(sql: string) {
    return new Statement(this.source, sql);
  }
  async batch(statements: Statement[]) {
    this.source.exec("BEGIN");
    try {
      const result = statements.map((statement) => statement.runSync());
      this.source.exec("COMMIT");
      return result;
    } catch (error) {
      this.source.exec("ROLLBACK");
      throw error;
    }
  }
}

describe("Channels", () => {
  it("backfills existing Telegram profiles and expenses into channel rows", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    db.exec(readFileSync("migrations/0001_spending.sql", "utf8"));
    db.exec(readFileSync("migrations/0003_reporter.sql", "utf8"));
    db.exec(
      "INSERT INTO profiles (id, name, chat_id, archived, created_at) VALUES ('old', 'Rumah', '-500', 0, 1)",
    );
    db.exec("INSERT INTO categories (id, profile_id, name, name_key) VALUES ('c', 'old', 'Makan', 'makan')");
    db.exec(
      "INSERT INTO expenses (id, profile_id, category_id, amount, item, occurred_at, telegram_chat_id, telegram_message_id, created_at) VALUES ('e', 'old', 'c', 1000, 'kopi', 1, '-500', 10, 1)",
    );
    db.exec(readFileSync("migrations/0004_channels.sql", "utf8"));
    db.exec(readFileSync("migrations/0005_channel_actions.sql", "utf8"));
    expect(db.prepare("SELECT profile_id, external_id FROM profile_channels").get()).toMatchObject({
      profile_id: "old",
      external_id: "-500",
    });
    expect(db.prepare("SELECT channel_id, external_message_id, source FROM expenses").get()).toMatchObject({
      channel_id: "pc-old",
      external_message_id: "10",
      source: "telegram",
    });
    db.close();
  });

  it("stores a dashboard Telegram token encrypted and disconnects the webhook", async () => {
    const token = `123:${"a".repeat(30)}`;
    const methods: string[] = [];
    let webhookSecretSent = "";
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const method = String(input).split("/").pop() ?? "";
      methods.push(method);
      if (method === "getMe")
        return Response.json({ ok: true, result: { is_bot: true, username: "newbot" } });
      if (method === "getWebhookInfo")
        return Response.json({ ok: true, result: { url: "" } });
      if (method === "setWebhook") {
        const body = JSON.parse(String(init?.body));
        webhookSecretSent = body.secret_token;
        expect(body.allowed_updates).toEqual(["message", "callback_query"]);
        return Response.json({ ok: true, result: true });
      }
      if (method === "setMyCommands" || method === "deleteWebhook")
        return Response.json({ ok: true, result: true });
      const body = JSON.parse(String(init?.body));
      replies.push(body);
      return Response.json({ ok: true, result: {} });
    });

    await connectTelegram(env.DB, env, token);
    const integration = sqlite
      .prepare("SELECT source, config, public_config, webhook_secret_hash, status FROM integrations WHERE id = 'telegram'")
      .get() as Record<string, string>;
    expect(integration).toMatchObject({ source: "db", status: "connected" });
    expect(JSON.parse(integration.public_config)).toMatchObject({ botUsername: "newbot" });
    expect(integration.webhook_secret_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(webhookSecretSent).toMatch(/^[a-f0-9]{64}$/);

    const requestWithSecret = new Request("https://app.example/api/telegram", {
      method: "POST",
      headers: { "X-Telegram-Bot-Api-Secret-Token": webhookSecretSent },
      body: JSON.stringify({
        message: { message_id: 1, date: 1, chat: { id: -900, type: "group" }, text: "/chatid" },
      }),
    });
    expect((await handleTelegramWebhook(requestWithSecret, env)).status).toBe(200);
    expect(replies.at(-1)?.text).toBe("ID chat: -900");

    await disconnectTelegram(env.DB, env);
    expect(methods).toContain("deleteWebhook");
    expect(sqlite.prepare("SELECT status FROM integrations WHERE id = 'telegram'").get()).toMatchObject({
      status: "disabled",
    });
    const before = replies.length;
    expect((await handleTelegramWebhook(requestWithSecret, env)).status).toBe(200);
    expect(replies).toHaveLength(before);
  });

  it("links a Telegram chat with a one-time code and records the sender", async () => {
    const { code } = await createLinkCode(env.DB, "p2", "telegram");
    expect(
      (await handleTelegramWebhook(telegramRequest(`/connect ${code}`, -777, "Grup Dua"), env)).status,
    ).toBe(200);
    expect(replies.at(-1)?.text).toContain('profil "Baru"');
    const channel = sqlite
      .prepare("SELECT id, profile_id, external_id, external_name FROM profile_channels WHERE external_id = '-777'")
      .get() as { id: string; profile_id: string; external_id: string; external_name: string };
    expect(channel).toMatchObject({ profile_id: "p2", external_id: "-777", external_name: "Grup Dua" });

    await handleTelegramWebhook(telegramRequest("catat, 20.000, nasi, makan", -777, "Grup Dua", 2), env);
    expect(replies.at(-1)?.text).toContain("Tercatat: Rp20.000");
    expect(
      sqlite
        .prepare("SELECT channel_id, external_message_id, source, reporter_id, reporter_name, reporter_username FROM expenses")
        .get(),
    ).toMatchObject({
      channel_id: channel.id,
      external_message_id: "2",
      source: "telegram",
      reporter_id: "88",
      reporter_name: "Sari Dewi",
      reporter_username: "sari",
    });
  });

  it("rejects a reused link code", async () => {
    const { code } = await createLinkCode(env.DB, "p2", "telegram");
    await handleTelegramWebhook(telegramRequest(`/connect ${code}`, -777), env);
    sqlite.prepare("DELETE FROM profile_channels WHERE external_id = '-777'").run();
    await handleTelegramWebhook(telegramRequest(`/connect ${code}`, -777), env);
    expect(replies.at(-1)?.text).toContain("tidak valid atau sudah kedaluwarsa");
  });

  it("does not move a channel that already belongs to another profile", async () => {
    const first = await createLinkCode(env.DB, "p2", "telegram");
    await handleTelegramWebhook(telegramRequest(`/connect ${first.code}`, -777), env);
    const second = await createLinkCode(env.DB, "p1", "telegram");
    await handleTelegramWebhook(telegramRequest(`/connect ${second.code}`, -777), env);
    expect(replies.at(-1)?.text).toContain("sudah terhubung ke profil lain");
    expect(
      sqlite.prepare("SELECT profile_id FROM profile_channels WHERE external_id = '-777'").get(),
    ).toMatchObject({ profile_id: "p2" });
  });

  it("rejects a second Telegram channel for one profile", async () => {
    sqlite
      .prepare(
        "INSERT INTO profile_channels (id, profile_id, integration_id, external_id, external_name, active, created_at) VALUES ('tg-p1', 'p1', 'telegram', '-100', 'Telegram', 1, 1)",
      )
      .run();
    await expect(createLinkCode(env.DB, "p1", "telegram")).rejects.toThrow(
      "sudah punya kanal Telegram",
    );
    await expect(linkChannel(env.DB, "p1", "telegram", "-888", "Grup Tiga")).rejects.toThrow(
      "sudah punya kanal Telegram",
    );
    expect(
      sqlite.prepare("SELECT COUNT(*) AS count FROM profile_channels WHERE profile_id = 'p1'").get(),
    ).toMatchObject({ count: 1 });
  });
});

describe("Discord interactions", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const publicKeyHex = Buffer.from(
    publicKey.export({ format: "der", type: "spki" }),
  )
    .subarray(-32)
    .toString("hex");

  async function configureDiscord(status = "connected") {
    const token = await encryptConfig(secret, "discord", { token: "discord-token" });
    sqlite
      .prepare(
        "INSERT OR REPLACE INTO integrations (id, type, name, source, config, public_config, status, created_at, updated_at) VALUES ('discord', 'discord', 'Discord', 'db', ?, ?, ?, 1, 1)",
      )
      .run(
        token,
        JSON.stringify({ applicationId: "app", publicKey: publicKeyHex, botName: "Bot" }),
        status,
      );
    sqlite
      .prepare(
        "INSERT INTO profile_channels (id, profile_id, integration_id, external_id, external_name, active, created_at) VALUES ('discord-channel', 'p2', 'discord', 'd-channel', 'Server / #umum', 1, 1)",
      )
      .run();
  }

  function signedRequest(body: object) {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const raw = JSON.stringify(body);
    const signature = sign(null, Buffer.from(timestamp + raw), privateKey).toString("hex");
    return new Request("https://app.example/api/discord", {
      method: "POST",
      headers: {
        "X-Signature-Ed25519": signature,
        "X-Signature-Timestamp": timestamp,
      },
      body: raw,
    });
  }

  it("accepts a signed PING while the integration is connecting", async () => {
    await configureDiscord("connecting");
    const response = await handleDiscordInteraction(
      signedRequest({ id: "ping", type: 1 }),
      env,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ type: 1 });
  });

  it("rejects a bad signature", async () => {
    await configureDiscord();
    const response = await handleDiscordInteraction(
      request({ id: "ping", type: 1 }, {
        "X-Signature-Ed25519": "00".repeat(64),
        "X-Signature-Timestamp": String(Math.floor(Date.now() / 1000)),
      }),
      env,
    );
    expect(response.status).toBe(401);
  });

  it("records a slash command with the Discord reporter and dedupes retries", async () => {
    await configureDiscord();
    const body = {
      id: "interaction-1",
      type: 2,
      channel_id: "d-channel",
      data: { name: "catat", options: [{ name: "data", value: "30.000, nasi, makan" }] },
      member: { user: { id: "u1", username: "sari", global_name: "Sari" } },
    };
    const response = await handleDiscordInteraction(signedRequest(body), env);
    expect(response.status).toBe(200);
    expect((await response.json() as { data: { content: string } }).data.content).toContain(
      "Tercatat: Rp30.000",
    );
    expect(
      sqlite
        .prepare("SELECT channel_id, external_message_id, source, reporter_id, reporter_name, reporter_username FROM expenses")
        .get(),
    ).toMatchObject({
      channel_id: "discord-channel",
      external_message_id: "interaction-1",
      source: "discord",
      reporter_id: "u1",
      reporter_name: "Sari",
      reporter_username: "sari",
    });

    const retry = await handleDiscordInteraction(signedRequest(body), env);
    expect((await retry.json() as { data: { content: string } }).data.content).toContain(
      "sudah dicatat",
    );
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM expenses").get()).toMatchObject({ n: 1 });
  });

  it("edits a slash command with the inline button and modal", async () => {
    await configureDiscord();
    const create = await handleDiscordInteraction(
      signedRequest({
        id: "interaction-edit",
        type: 2,
        channel_id: "d-channel",
        data: { name: "catat", options: [{ name: "data", value: "30.000, nasi, makan" }] },
        member: { user: { id: "u1", username: "sari", global_name: "Sari" } },
      }),
      env,
    );
    const created = await create.json() as {
      data: { components: Array<{ components: Array<{ custom_id: string }> }> };
    };
    const expenseId = sqlite.prepare("SELECT id FROM expenses").get()?.id as string;
    expect(created.data.components[0].components.map((item) => item.custom_id)).toEqual([
      `undo_${expenseId}`,
      `edit_${expenseId}`,
    ]);

    const edit = await handleDiscordInteraction(
      signedRequest({
        id: "component-edit",
        type: 3,
        channel_id: "d-channel",
        data: { custom_id: `edit_${expenseId}`, component_type: 2 },
        member: { user: { id: "u1", username: "sari" } },
      }),
      env,
    );
    const modal = await edit.json() as { type: number; data: { custom_id: string } };
    expect(modal.type).toBe(9);
    expect(modal.data.custom_id).toBe(`editmodal_${expenseId}`);

    const updated = await handleDiscordInteraction(
      signedRequest({
        id: "modal-edit",
        type: 5,
        channel_id: "d-channel",
        data: {
          custom_id: `editmodal_${expenseId}`,
          components: [
            {
              type: 1,
              components: [{ type: 4, custom_id: "data", value: "25.000, nasi goreng, makan" }],
            },
          ],
        },
        member: { user: { id: "u1", username: "sari" } },
      }),
      env,
    );
    expect((await updated.json() as { data: { content: string } }).data.content).toContain(
      "Diperbarui: Rp25.000",
    );
    expect(sqlite.prepare("SELECT amount, item FROM expenses").get()).toMatchObject({
      amount: 25000,
      item: "nasi goreng",
    });
  });

  it("undoes a slash command from the inline button and rejects another reporter", async () => {
    await configureDiscord();
    await handleDiscordInteraction(
      signedRequest({
        id: "interaction-undo",
        type: 2,
        channel_id: "d-channel",
        data: { name: "catat", options: [{ name: "data", value: "40.000, bensin, makan" }] },
        member: { user: { id: "u1", username: "sari" } },
      }),
      env,
    );
    const expenseId = sqlite.prepare("SELECT id FROM expenses").get()?.id as string;
    const denied = await handleDiscordInteraction(
      signedRequest({
        id: "component-denied",
        type: 3,
        channel_id: "d-channel",
        data: { custom_id: `undo_${expenseId}`, component_type: 2 },
        member: { user: { id: "u2", username: "budi" } },
      }),
      env,
    );
    expect((await denied.json() as { data: { content: string } }).data.content).toContain(
      "Hanya pencatat",
    );
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM expenses").get()?.n).toBe(1);
    const undo = await handleDiscordInteraction(
      signedRequest({
        id: "component-undo",
        type: 3,
        channel_id: "d-channel",
        data: { custom_id: `undo_${expenseId}`, component_type: 2 },
        member: { user: { id: "u1", username: "sari" } },
      }),
      env,
    );
    expect((await undo.json() as { type: number }).type).toBe(7);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM expenses").get()?.n).toBe(0);
  });


  it("rejects a second Discord channel for one profile", async () => {
    await configureDiscord();
    await expect(linkChannel(env.DB, "p2", "discord", "d-other", "Server / #lain")).rejects.toThrow(
      "sudah punya kanal Discord",
    );
  });

  it("reports all channels on the same profile", async () => {
    await configureDiscord();
    sqlite.exec(
      `INSERT INTO expenses (id, profile_id, category_id, amount, item, occurred_at, channel_id, external_message_id, source, created_at) VALUES ('d1', 'p2', 'c2', 5000, 'teh', ${Date.now() - 1000}, 'discord-channel', 'old', 'discord', 1), ('t1', 'p2', 'c2', 7000, 'kopi', ${Date.now() - 2000}, NULL, NULL, 'telegram', 2)`,
    );
    const body = {
      id: "interaction-2",
      type: 2,
      channel_id: "d-channel",
      data: { name: "laporan", options: [{ name: "periode", value: "bulanan" }] },
      member: { user: { id: "u2", username: "budi" } },
    };
    const response = await handleDiscordInteraction(signedRequest(body), env);
    expect((await response.json() as { data: { content: string } }).data.content).toContain(
      "Total: Rp12.000 (2 transaksi)",
    );
  });
});

describe("Scheduled recaps", () => {
  async function seedChannels() {
    const config = await encryptConfig(secret, "discord", { token: "discord-token" });
    sqlite
      .prepare(
        "INSERT INTO integrations (id, type, name, source, config, public_config, status, created_at, updated_at) VALUES ('discord', 'discord', 'Discord', 'db', ?, ?, 'connected', 1, 1)",
      )
      .run(config, JSON.stringify({ applicationId: "app", publicKey: "00", botName: "Bot" }));
    sqlite.exec(
      "INSERT INTO profile_channels (id, profile_id, integration_id, external_id, external_name, active, created_at) VALUES ('pc-p1', 'p1', 'telegram', '-100', 'Telegram', 1, 1), ('pc-p2-discord', 'p2', 'discord', 'd-chan', 'Server / #umum', 1, 1)",
    );
    sqlite.exec(
      "INSERT INTO expenses (id, profile_id, category_id, amount, item, occurred_at, channel_id, external_message_id, source, created_at) VALUES ('w1', 'p1', 'c1', 20000, 'nasi', 1771927200000, 'pc-p1', 'w1', 'telegram', 1), ('w2', 'p2', 'c2', 30000, 'kopi', 1771927200000, 'pc-p2-discord', 'w2', 'discord', 1)",
    );
  }

  it("sends previous week to every active channel and skips unknown cron", async () => {
    await seedChannels();
    const sent: Array<{ type: string; id: string; text: string }> = [];
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      const body = JSON.parse(String(init?.body));
      if (url.includes("api.telegram.org")) {
        sent.push({ type: "telegram", id: body.chat_id, text: body.text });
        return Response.json({ ok: true });
      }
      if (url.includes("discord.com")) {
        sent.push({ type: "discord", id: url.split("/channels/")[1].split("/")[0], text: body.content });
        return Response.json({});
      }
      throw new Error(`Unexpected request ${url}`);
    });
    await handleScheduled({ cron: "0 1 * * 1" }, env);
    expect(sent).toHaveLength(2);
    expect(sent).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "telegram", id: "-100" }),
        expect.objectContaining({ type: "discord", id: "d-chan" }),
      ]),
    );
    expect(sent.every((item) => item.text.includes("Laporan minggu lalu"))).toBe(true);
    expect(sent.some((item) => item.text.includes("Rp20.000"))).toBe(true);
    expect(sent.some((item) => item.text.includes("Rp30.000"))).toBe(true);

    const before = sent.length;
    await handleScheduled({ cron: "0 1 * * 2" }, env);
    expect(sent).toHaveLength(before);
  });

  it("sends previous month for the monthly schedule", async () => {
    await seedChannels();
    const sent: string[] = [];
    vi.mocked(fetch).mockImplementation(async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      sent.push(body.text ?? body.content);
      return Response.json({ ok: true });
    });
    await handleScheduled({ cron: "0 1 1 * *" }, env);
    expect(sent).toHaveLength(2);
    expect(sent.every((text) => text.includes("Laporan bulan lalu"))).toBe(true);
  });
});
