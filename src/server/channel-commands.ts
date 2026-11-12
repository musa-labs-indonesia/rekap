import type { D1Database } from "@cloudflare/workers-types/index";
import { categoryKey } from "./category";

export type Period = "daily" | "weekly" | "monthly";
export type Profile = { id: string; name: string };
export type Reporter = {
  id: string | null;
  name: string | null;
  username: string | null;
};
export type ChannelRef = {
  channelId: string | null;
  externalMessageId: string | null;
  source: "telegram" | "discord" | "web";
  telegramChatId?: string | null;
  telegramMessageId?: number | null;
};

export type ExpenseInput = {
  profileId: string;
  amount: number;
  item: string;
  categoryName: string;
  occurredAt: number;
  reporter: Reporter;
  channel: ChannelRef;
  createdAt?: number;
};

const offset = 7 * 60 * 60 * 1000;
const day = 24 * 60 * 60 * 1000;

export const rupiah = (amount: number) => `Rp${new Intl.NumberFormat("id-ID").format(amount)}`;

export function periodBounds(time: number, period: Period): [number, number] {
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

export function parseAmount(input: string): number | null {
  const value = input.trim();
  if (!/^(?:\d+|[1-9]\d{0,2}(?:\.\d{3})+)$/.test(value)) return null;
  const amount = Number(value.replaceAll(".", ""));
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}

export async function buildReport(
  db: D1Database,
  profile: Profile,
  period: Period,
  now: number,
): Promise<string> {
  const [start, end] = periodBounds(now, period);
  const total = await db
    .prepare(
      "SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count FROM expenses WHERE profile_id = ? AND occurred_at >= ? AND occurred_at < ?",
    )
    .bind(profile.id, start, end)
    .first<{ total: number; count: number }>();
  const latest = await db
    .prepare(
      "SELECT e.amount, e.item, e.occurred_at, c.name AS category FROM expenses e JOIN categories c ON c.id = e.category_id WHERE e.profile_id = ? AND e.occurred_at >= ? AND e.occurred_at < ? ORDER BY e.occurred_at DESC, e.rowid DESC LIMIT 3",
    )
    .bind(profile.id, start, end)
    .all<{ amount: number; item: string; occurred_at: number; category: string }>();
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

export async function recordExpense(
  db: D1Database,
  input: ExpenseInput,
): Promise<
  | { ok: true; categoryName: string; monthTotal: number; monthCount: number }
  | { ok: false; error: "category"; categories: string[] }
  | { ok: false; error: "duplicate" }
  | { ok: false; error: "limit" }
> {
  const category = await db
    .prepare(
      "SELECT id, name FROM categories WHERE profile_id = ? AND name_key = ? AND archived = 0 LIMIT 1",
    )
    .bind(input.profileId, categoryKey(input.categoryName))
    .first<{ id: string; name: string }>();
  if (!category) {
    const available = await db
      .prepare(
        "SELECT name FROM categories WHERE profile_id = ? AND archived = 0 ORDER BY name LIMIT 20",
      )
      .bind(input.profileId)
      .all<{ name: string }>();
    return { ok: false, error: "category", categories: available.results.map((row) => row.name) };
  }
  if (input.channel.source === "telegram" && input.channel.telegramChatId && input.channel.telegramMessageId) {
    const recorded = await db
      .prepare("SELECT message_id FROM telegram_recorded_messages WHERE chat_id = ? AND message_id = ? LIMIT 1")
      .bind(input.channel.telegramChatId, input.channel.telegramMessageId)
      .first<{ message_id: number }>();
    if (recorded) return { ok: false, error: "duplicate" };
  }
  try {
    const result = await db
      .prepare(
        "INSERT INTO expenses (id, profile_id, category_id, amount, item, occurred_at, channel_id, external_message_id, source, telegram_chat_id, telegram_message_id, reporter_id, reporter_name, reporter_username, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING",
      )
      .bind(
        crypto.randomUUID(),
        input.profileId,
        category.id,
        input.amount,
        input.item,
        input.occurredAt,
        input.channel.channelId,
        input.channel.externalMessageId,
        input.channel.source,
        input.channel.telegramChatId ?? null,
        input.channel.telegramMessageId ?? null,
        input.reporter.id,
        input.reporter.name,
        input.reporter.username,
        input.createdAt ?? Date.now(),
      )
      .run();
    if (!result.meta.changes) return { ok: false, error: "duplicate" };
  } catch (error) {
    if (String(error).includes("spending limit exceeded")) return { ok: false, error: "limit" };
    throw error;
  }
  const [start, end] = periodBounds(Date.now(), "monthly");
  const total = await db
    .prepare(
      "SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count FROM expenses WHERE profile_id = ? AND occurred_at >= ? AND occurred_at < ?",
    )
    .bind(input.profileId, start, end)
    .first<{ total: number; count: number }>();
  return {
    ok: true,
    categoryName: category.name,
    monthTotal: total?.total ?? 0,
    monthCount: total?.count ?? 0,
  };
}
