import { categoryKey } from "./category";
import {
  buildReport,
  parseAmount,
  recordExpense,
  rupiah,
  type Period,
} from "./channel-commands";
import {
  claimLinkCode,
  findLegacyTelegramProfile,
  findProfileForChannel,
  getTelegramIntegration,
  telegramWebhook,
  type IntegrationEnv,
} from "./integrations";

export type TelegramEnv = IntegrationEnv;

export type TelegramRecovery = (context: {
  chatId: string;
  userId: string;
  appUrl: string;
}) => Promise<string>;

type Message = {
  message_id: number;
  date: number;
  text?: string;
  chat: { id: number; type: string; title?: string };
  from?: {
    id: number;
    is_bot?: boolean;
    first_name?: string;
    last_name?: string;
    username?: string;
  };
};

type Profile = { id: string; name: string };

async function sendMessage(token: string, message: Message, text: string): Promise<void> {
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: String(message.chat.id),
      text,
      reply_parameters: { message_id: message.message_id, allow_sending_without_reply: true },
    }),
  });
  if (!response.ok) throw new Error("Telegram sendMessage failed");
  const result = (await response.json()) as { ok?: boolean };
  if (!result.ok) throw new Error("Telegram sendMessage failed");
}

function parseCommand(text: string) {
  const addressedTo = text.split(/[\s,]+/, 1)[0].match(/^\/[^@]+@([a-zA-Z0-9_]+)$/)?.[1] ?? null;
  const command = text
    .split(/[\s,]+/, 1)[0]
    .replace(/@[a-zA-Z0-9_]+$/, "")
    .toLowerCase();
  return { addressedTo, command };
}

export async function handleTelegramWebhook(
  request: Request,
  env: TelegramEnv,
  recoverPassword?: TelegramRecovery,
): Promise<Response> {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const integration = await getTelegramIntegration(env.DB);
  if (integration?.status === "disabled") return new Response("OK");
  const auth = await telegramWebhook(
    env.DB,
    env,
    request.headers.get("X-Telegram-Bot-Api-Secret-Token") ?? "",
  );
  if (!auth) return new Response("Unauthorized", { status: 401 });

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
  const { addressedTo, command } = parseCommand(text);
  if (addressedTo && addressedTo.toLowerCase() !== auth.botUsername?.toLowerCase())
    return new Response("OK");
  const periods: Record<string, Period> = {
    "/report_daily": "daily",
    "/report_weekly": "weekly",
    "/report_monthly": "monthly",
  };
  if (
    command !== "catat" &&
    command !== "/catat" &&
    command !== "/help" &&
    command !== "/chatid" &&
    command !== "/connect" &&
    command !== "/addcategory" &&
    command !== "/forgot_password" &&
    !Object.hasOwn(periods, command)
  )
    return new Response("OK");

  try {
    if (command === "/help") {
      await sendMessage(auth.token, message, [
        "Perintah Rekap:",
        "catat, 20.000, bubur ayam, makan — catat pengeluaran",
        "/help — tampilkan panduan ini",
        "/chatid — tampilkan ID chat",
        "/connect KODE — hubungkan chat ke profil",
        "/addcategory nama kategori — tambah kategori",
        "/report_daily — laporan hari ini",
        "/report_weekly — laporan minggu ini",
        "/report_monthly — laporan bulan ini",
        "/forgot_password — pulihkan kata sandi di chat pribadi pemilik",
      ].join("\n"));
      return new Response("OK");
    }

    if (command === "/chatid") {
      await sendMessage(auth.token, message, `ID chat: ${message.chat.id}`);
      return new Response("OK");
    }

    if (command === "/connect") {
      const code = text.replace(/^\/?connect(?:@[a-zA-Z0-9_]+)?(?:[\s,]+|$)/i, "").trim();
      if (!code) {
        await sendMessage(auth.token, message, "Format: /connect KODE");
        return new Response("OK");
      }
      try {
        const linked = await claimLinkCode(
          env.DB,
          code,
          auth.integrationId,
          String(message.chat.id),
          message.chat.title || String(message.chat.id),
        );
        await sendMessage(
          auth.token,
          message,
          `Chat ini sekarang terhubung ke profil "${linked.profileName}".`,
        );
      } catch (error) {
        await sendMessage(
          auth.token,
          message,
          error instanceof Error ? error.message : "Kode tidak valid atau sudah kedaluwarsa.",
        );
      }
      return new Response("OK");
    }

    if (command === "/forgot_password") {
      if (
        message.chat.type !== "private" ||
        !message.from ||
        message.from.is_bot ||
        !auth.trustedTelegramUserId ||
        String(message.from.id) !== auth.trustedTelegramUserId ||
        message.chat.id !== message.from.id
      ) {
        await sendMessage(
          auth.token,
          message,
          "Pemulihan hanya tersedia untuk pengguna tepercaya melalui chat pribadi.",
        );
      } else if (!recoverPassword) {
        await sendMessage(
          auth.token,
          message,
          "Pemulihan kata sandi belum tersedia. Hubungi pengelola aplikasi.",
        );
      } else {
        const reply = await recoverPassword({
          chatId: String(message.chat.id),
          userId: String(message.from.id),
          appUrl: env.APP_URL,
        });
        await sendMessage(auth.token, message, reply);
      }
      return new Response("OK");
    }

    const link = await findProfileForChannel(
      env.DB,
      auth.integrationId,
      String(message.chat.id),
    );
    const legacy = link
      ? null
      : await findLegacyTelegramProfile(env.DB, String(message.chat.id));
    const profileId = link?.profileId ?? legacy?.profileId;
    const channelId = link?.channelId ?? legacy?.channelId ?? null;
    const profile = profileId
      ? await env.DB.prepare("SELECT id, name FROM profiles WHERE id = ? AND archived = 0 LIMIT 1")
          .bind(profileId)
          .first<Profile>()
      : null;
    if (!profile) {
      await sendMessage(
        auth.token,
        message,
        "Chat ini belum terhubung atau profilnya telah diarsipkan. Hubungkan chat di aplikasi terlebih dahulu.",
      );
      return new Response("OK");
    }

    if (command === "catat" || command === "/catat") {
      const parts = text.split(",").map((part) => part.trim());
      const amount = parts.length === 4 ? parseAmount(parts[1]) : null;
      if (!amount || !parts[2] || parts[2].length > 200 || !parts[3] || parts[3].length > 100) {
        await sendMessage(
          auth.token,
          message,
          "Format: catat, 20.000, nama barang, kategori. Gunakan jumlah rupiah bulat lebih dari 0.",
        );
        return new Response("OK");
      }
      const now = Date.now();
      const occurred =
        Number.isSafeInteger(message.date) && message.date > 0 ? message.date * 1000 : now;
      const reporter = message.from;
      const reporterName =
        [reporter?.first_name, reporter?.last_name]
          .map((part) => part?.trim())
          .filter(Boolean)
          .join(" ") || null;
      const result = await recordExpense(env.DB, {
        profileId: profile.id,
        amount,
        item: parts[2],
        categoryName: parts[3],
        occurredAt: occurred,
        createdAt: now,
        reporter: {
          id: reporter ? String(reporter.id) : null,
          name: reporterName,
          username: reporter?.username?.trim() || null,
        },
        channel: {
          channelId,
          externalMessageId: String(message.message_id),
          source: "telegram",
          telegramChatId: String(message.chat.id),
          telegramMessageId: message.message_id,
        },
      });
      if (!result.ok) {
        if (result.error === "duplicate") {
          await sendMessage(
            auth.token,
            message,
            "Pesan ini sudah dicatat sebelumnya; tidak ada transaksi duplikat.",
          );
        } else if (result.error === "limit") {
          await sendMessage(auth.token, message, "Total profil melebihi batas jumlah yang didukung.");
        } else {
          const names = result.categories.join(", ") || "belum ada";
          await sendMessage(
            auth.token,
            message,
            `Kategori "${parts[3]}" tidak ditemukan atau sudah diarsipkan. Kategori tersedia: ${names}. Gunakan kategori tersebut atau tambahkan dengan /addcategory nama kategori, lalu kirim ulang.`,
          );
        }
        return new Response("OK");
      }
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
        auth.token,
        message,
        `Tercatat: ${rupiah(amount)} · ${result.categoryName} · ${parts[2]}, ${date}.\n\nTotal ${month}: ${rupiah(result.monthTotal)} dari ${result.monthCount} transaksi.`,
      );
      return new Response("OK");
    }

    if (command === "/addcategory") {
      const name = text.replace(/^\/?addcategory(?:@[a-zA-Z0-9_]+)?(?:[\s,]+|$)/i, "").trim();
      if (!name || name.length > 100 || name.includes(",")) {
        await sendMessage(auth.token, message, "Format: /addcategory nama kategori");
        return new Response("OK");
      }
      const result = await env.DB.prepare(
        "INSERT INTO categories (id, profile_id, name, name_key) VALUES (?, ?, ?, ?) ON CONFLICT(profile_id, name_key) DO NOTHING",
      )
        .bind(crypto.randomUUID(), profile.id, name, categoryKey(name))
        .run();
      await sendMessage(
        auth.token,
        message,
        result.meta.changes
          ? `Kategori "${name}" ditambahkan.`
          : `Kategori "${name}" sudah ada atau diarsipkan. Kelola kategori di aplikasi.`,
      );
      return new Response("OK");
    }

    if (Object.hasOwn(periods, command)) {
      await sendMessage(auth.token, message, await buildReport(env.DB, profile, periods[command], Date.now()));
    }
    return new Response("OK");
  } catch {
    return new Response("Temporary failure", { status: 500 });
  }
}
