import type {
  D1Database,
  SubtleCrypto as WorkersSubtleCrypto,
} from "@cloudflare/workers-types/index";
import { categoryKey } from "./category";

export type TelegramEnv = {
  DB: D1Database;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_BOT_USERNAME: string;
  TELEGRAM_WEBHOOK_SECRET: string;
  TRUSTED_TELEGRAM_USER_ID: string;
  APP_URL: string;
};

export type TelegramRecovery = (context: {
  chatId: string;
  userId: string;
  appUrl: string;
}) => Promise<string>;

type Message = {
  message_id: number;
  date: number;
  text?: string;
  chat: { id: number; type: string };
  from?: { id: number; is_bot?: boolean };
};

type Period = "daily" | "weekly" | "monthly";
type Profile = { id: string; name: string };
type Category = { id: string; name: string };
type Expense = { amount: number; item: string; category: string; occurred_at: number };

const offset = 7 * 60 * 60 * 1000;
const day = 24 * 60 * 60 * 1000;
const rupiah = (amount: number) => `Rp${new Intl.NumberFormat("id-ID").format(amount)}`;

function periodBounds(time: number, period: Period): [number, number] {
  const local = new Date(time + offset);
  const midnight =
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - offset;
  if (period === "daily") return [midnight, midnight + day];
  if (period === "weekly") {
    const start = midnight - ((local.getUTCDay() + 6) % 7) * day;
    return [start, start + 7 * day];
  }
  return [
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) - offset,
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + 1, 1) - offset,
  ];
}

function parseAmount(input: string): number | null {
  const value = input.trim();
  if (!/^(?:\d+|[1-9]\d{0,2}(?:\.\d{3})+)$/.test(value)) return null;
  const amount = Number(value.replaceAll(".", ""));
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}

async function secretMatches(provided: string, expected: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(provided)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  return (crypto.subtle as SubtleCrypto & WorkersSubtleCrypto).timingSafeEqual(a, b);
}

async function sendMessage(env: TelegramEnv, message: Message, text: string): Promise<void> {
  const response = await fetch(
    `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: String(message.chat.id),
        text,
        reply_parameters: { message_id: message.message_id, allow_sending_without_reply: true },
      }),
    },
  );
  if (!response.ok) throw new Error("Telegram sendMessage failed");
  const result = (await response.json()) as { ok?: boolean };
  if (!result.ok) throw new Error("Telegram sendMessage failed");
}

async function report(
  env: TelegramEnv,
  profile: Profile,
  period: Period,
  now: number,
): Promise<string> {
  const [start, end] = periodBounds(now, period);
  const total = await env.DB.prepare(
    "SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count FROM expenses WHERE profile_id = ? AND occurred_at >= ? AND occurred_at < ?",
  )
    .bind(profile.id, start, end)
    .first<{ total: number; count: number }>();
  const latest = await env.DB.prepare(
    "SELECT e.amount, e.item, e.occurred_at, c.name AS category FROM expenses e JOIN categories c ON c.id = e.category_id WHERE e.profile_id = ? AND e.occurred_at >= ? AND e.occurred_at < ? ORDER BY e.occurred_at DESC, e.rowid DESC LIMIT 3",
  )
    .bind(profile.id, start, end)
    .all<Expense>();
  const label = { daily: "hari ini", weekly: "minggu ini", monthly: "bulan ini" }[period];
  const lines = latest.results.map((entry) => {
    const date = new Intl.DateTimeFormat("id-ID", {
      timeZone: "Asia/Jakarta",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(entry.occurred_at);
    return `• ${date} — ${entry.item} (${entry.category}): ${rupiah(entry.amount)}`;
  });
  return `Laporan ${label} (${profile.name})\nTotal: ${rupiah(total?.total ?? 0)} (${total?.count ?? 0} transaksi)\n\n${lines.length ? `3 transaksi terbaru:\n${lines.join("\n")}` : "Belum ada transaksi."}`;
}

export async function handleTelegramWebhook(
  request: Request,
  env: TelegramEnv,
  recoverPassword?: TelegramRecovery,
): Promise<Response> {
  if (
    !env.TELEGRAM_WEBHOOK_SECRET ||
    !(await secretMatches(
      request.headers.get("X-Telegram-Bot-Api-Secret-Token") ?? "",
      env.TELEGRAM_WEBHOOK_SECRET,
    ))
  ) {
    return new Response("Unauthorized", { status: 401 });
  }
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });

  let update: { message?: Message };
  try {
    update = (await request.json()) as { message?: Message };
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }
  const message = update?.message;
  if (
    !message ||
    typeof message.text !== "string" ||
    !Number.isSafeInteger(message.message_id) ||
    !Number.isSafeInteger(message.chat?.id)
  )
    return new Response("OK");
  const text = message.text.trim();
  const addressedTo = text.split(/[\s,]+/, 1)[0].match(/^\/[^@]+@([a-zA-Z0-9_]+)$/)?.[1];
  if (addressedTo && addressedTo.toLowerCase() !== env.TELEGRAM_BOT_USERNAME?.toLowerCase())
    return new Response("OK");
  const command = text
    .split(/[\s,]+/, 1)[0]
    .replace(/@[a-zA-Z0-9_]+$/, "")
    .toLowerCase();
  const periods: Record<string, Period> = {
    "/report_daily": "daily",
    "/report_weekly": "weekly",
    "/report_monthly": "monthly",
  };
  if (
    command !== "catat" &&
    command !== "/catat" &&
    command !== "/chatid" &&
    command !== "/addcategory" &&
    command !== "/forgot_password" &&
    !Object.hasOwn(periods, command)
  )
    return new Response("OK");

  try {
    if (command === "/chatid") {
      await sendMessage(env, message, `ID chat: ${message.chat.id}`);
      return new Response("OK");
    }

    if (command === "/forgot_password") {
      if (
        message.chat.type !== "private" ||
        !message.from ||
        message.from.is_bot ||
        String(message.from.id) !== env.TRUSTED_TELEGRAM_USER_ID ||
        message.chat.id !== message.from.id
      ) {
        await sendMessage(
          env,
          message,
          "Pemulihan hanya tersedia untuk pengguna tepercaya melalui chat pribadi.",
        );
      } else if (!recoverPassword) {
        await sendMessage(
          env,
          message,
          "Pemulihan kata sandi belum tersedia. Hubungi pengelola aplikasi.",
        );
      } else {
        const reply = await recoverPassword({
          chatId: String(message.chat.id),
          userId: String(message.from.id),
          appUrl: env.APP_URL,
        });
        await sendMessage(env, message, reply);
      }
      return new Response("OK");
    }

    const profile = await env.DB.prepare(
      "SELECT id, name FROM profiles WHERE chat_id = ? AND archived = 0 LIMIT 1",
    )
      .bind(String(message.chat.id))
      .first<Profile>();
    if (!profile) {
      await sendMessage(
        env,
        message,
        "Chat ini belum terhubung atau profilnya telah diarsipkan. Hubungkan chat di aplikasi terlebih dahulu.",
      );
      return new Response("OK");
    }

    if (command === "catat" || command === "/catat") {
      const existing = await env.DB.prepare(
        "SELECT message_id FROM telegram_recorded_messages WHERE chat_id = ? AND message_id = ? LIMIT 1",
      )
        .bind(String(message.chat.id), message.message_id)
        .first<{ id: string }>();
      if (existing) {
        await sendMessage(
          env,
          message,
          "Pesan ini sudah dicatat sebelumnya; tidak ada transaksi duplikat.",
        );
        return new Response("OK");
      }
      const parts = text.split(",").map((part) => part.trim());
      const amount = parts.length === 4 ? parseAmount(parts[1]) : null;
      if (!amount || !parts[2] || parts[2].length > 200 || !parts[3] || parts[3].length > 100) {
        await sendMessage(
          env,
          message,
          "Format: catat, 20.000, nama barang, kategori. Gunakan jumlah rupiah bulat lebih dari 0.",
        );
        return new Response("OK");
      }
      const category = await env.DB.prepare(
        "SELECT id, name FROM categories WHERE profile_id = ? AND name_key = ? AND archived = 0 LIMIT 1",
      )
        .bind(profile.id, categoryKey(parts[3]))
        .first<Category>();
      if (!category) {
        const available = await env.DB.prepare(
          "SELECT name FROM categories WHERE profile_id = ? AND archived = 0 ORDER BY name LIMIT 20",
        )
          .bind(profile.id)
          .all<{ name: string }>();
        const names = available.results.map((entry) => entry.name).join(", ") || "belum ada";
        await sendMessage(
          env,
          message,
          `Kategori "${parts[3]}" tidak ditemukan atau sudah diarsipkan. Kategori tersedia: ${names}. Gunakan kategori tersebut atau tambahkan dengan /addcategory nama kategori, lalu kirim ulang.`,
        );
        return new Response("OK");
      }
      const now = Date.now();
      const occurred =
        Number.isSafeInteger(message.date) && message.date > 0 ? message.date * 1000 : now;
      let result;
      try {
        result = await env.DB.prepare(
          "INSERT INTO expenses (id, profile_id, category_id, amount, item, occurred_at, telegram_chat_id, telegram_message_id, created_at) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM telegram_recorded_messages WHERE chat_id = ? AND message_id = ?) ON CONFLICT(telegram_chat_id, telegram_message_id) DO NOTHING",
        )
          .bind(
            crypto.randomUUID(),
            profile.id,
            category.id,
            amount,
            parts[2],
            occurred,
            String(message.chat.id),
            message.message_id,
            now,
            String(message.chat.id),
            message.message_id,
          )
          .run();
      } catch (error) {
        if (!String(error).includes("spending limit exceeded")) throw error;
        await sendMessage(env, message, "Total profil melebihi batas jumlah yang didukung.");
        return new Response("OK");
      }
      if (!result.meta.changes) {
        await sendMessage(
          env,
          message,
          "Pesan ini sudah dicatat sebelumnya; tidak ada transaksi duplikat.",
        );
        return new Response("OK");
      }
      const [start, end] = periodBounds(now, "monthly");
      const total = await env.DB.prepare(
        "SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count FROM expenses WHERE profile_id = ? AND occurred_at >= ? AND occurred_at < ?",
      )
        .bind(profile.id, start, end)
        .first<{ total: number; count: number }>();
      const date = new Intl.DateTimeFormat("id-ID", {
        timeZone: "Asia/Jakarta",
        day: "numeric",
        month: "short",
      }).format(occurred);
      const month = new Intl.DateTimeFormat("id-ID", {
        timeZone: "Asia/Jakarta",
        month: "long",
      }).format(now);
      await sendMessage(
        env,
        message,
        `Tercatat: ${rupiah(amount)} · ${category.name} · ${parts[2]}, ${date}.\n\nTotal ${month}: ${rupiah(total?.total ?? 0)} dari ${total?.count ?? 0} transaksi.`,
      );
      return new Response("OK");
    }

    if (command === "/addcategory") {
      const name = text.replace(/^\/?addcategory(?:@[a-zA-Z0-9_]+)?(?:[\s,]+|$)/i, "").trim();
      if (!name || name.length > 100 || name.includes(",")) {
        await sendMessage(env, message, "Format: /addcategory nama kategori");
        return new Response("OK");
      }
      const result = await env.DB.prepare(
        "INSERT INTO categories (id, profile_id, name, name_key) VALUES (?, ?, ?, ?) ON CONFLICT(profile_id, name_key) DO NOTHING",
      )
        .bind(crypto.randomUUID(), profile.id, name, categoryKey(name))
        .run();
      await sendMessage(
        env,
        message,
        result.meta.changes
          ? `Kategori "${name}" ditambahkan.`
          : `Kategori "${name}" sudah ada atau diarsipkan. Kelola kategori di aplikasi.`,
      );
      return new Response("OK");
    }

    if (Object.hasOwn(periods, command)) {
      await sendMessage(env, message, await report(env, profile, periods[command], Date.now()));
    }
    return new Response("OK");
  } catch {
    return new Response("Temporary failure", { status: 500 });
  }
}
