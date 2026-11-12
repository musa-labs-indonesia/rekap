import { categoryKey } from "./category";
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

type CallbackQuery = {
  id: string;
  data?: string;
  from?: { id: number; is_bot?: boolean };
  message?: Message;
};

type ReplyMarkup = {
  inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
};

type Profile = { id: string; name: string };

async function telegramRequest(token: string, method: string, body: object): Promise<unknown> {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Telegram ${method} failed`);
  const result = (await response.json()) as { ok?: boolean };
  if (!result.ok) throw new Error(`Telegram ${method} failed`);
  return result;
}

async function sendMessage(
  token: string,
  message: Message,
  text: string,
  replyMarkup?: ReplyMarkup,
): Promise<void> {
  await telegramRequest(token, "sendMessage", {
    chat_id: String(message.chat.id),
    text,
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    reply_parameters: { message_id: message.message_id, allow_sending_without_reply: true },
  });
}

export async function sendTelegramText(
  token: string,
  chatId: string,
  text: string,
): Promise<void> {
  await telegramRequest(token, "sendMessage", { chat_id: chatId, text });
}

async function answerCallback(token: string, id: string): Promise<void> {
  try {
    await telegramRequest(token, "answerCallbackQuery", { callback_query_id: id });
  } catch {}
}

async function clearInlineKeyboard(token: string, chatId: string, messageId: number): Promise<void> {
  try {
    await telegramRequest(token, "editMessageReplyMarkup", {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: { inline_keyboard: [] },
    });
  } catch {}
}

function parseCommand(text: string) {
  const addressedTo = text.split(/[\s,]+/, 1)[0].match(/^\/[^@]+@([a-zA-Z0-9_]+)$/)?.[1] ?? null;
  const command = text
    .split(/[\s,]+/, 1)[0]
    .replace(/@[a-zA-Z0-9_]+$/, "")
    .toLowerCase();
  return { addressedTo, command };
}

type TelegramAuth = NonNullable<Awaited<ReturnType<typeof telegramWebhook>>>;
const actionWindow = 15 * 60 * 1000;
const editWindow = 10 * 60 * 1000;

async function getPendingEdit(
  db: IntegrationEnv["DB"],
  integrationId: string,
  chatId: string,
  userId: string,
): Promise<{ expense_id: string } | null> {
  return db
    .prepare(
      "SELECT expense_id FROM channel_pending_edits WHERE integration_id = ? AND external_chat_id = ? AND user_id = ? AND expires_at > ? LIMIT 1",
    )
    .bind(integrationId, chatId, userId, Date.now())
    .first<{ expense_id: string }>();
}

async function setPendingEdit(
  db: IntegrationEnv["DB"],
  integrationId: string,
  chatId: string,
  userId: string,
  expenseId: string,
): Promise<void> {
  await db
    .prepare(
      "INSERT INTO channel_pending_edits (id, integration_id, external_chat_id, user_id, expense_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(integration_id, external_chat_id, user_id) DO UPDATE SET expense_id = excluded.expense_id, expires_at = excluded.expires_at, created_at = excluded.created_at",
    )
    .bind(
      crypto.randomUUID(),
      integrationId,
      chatId,
      userId,
      expenseId,
      Date.now() + editWindow,
      Date.now(),
    )
    .run();
}

async function clearPendingEdit(
  db: IntegrationEnv["DB"],
  integrationId: string,
  chatId: string,
  userId: string,
): Promise<void> {
  await db
    .prepare(
      "DELETE FROM channel_pending_edits WHERE integration_id = ? AND external_chat_id = ? AND user_id = ?",
    )
    .bind(integrationId, chatId, userId)
    .run();
}

async function handleTelegramCallback(
  query: CallbackQuery,
  env: TelegramEnv,
  auth: TelegramAuth,
): Promise<Response> {
  await answerCallback(auth.token, query.id);
  const message = query.message;
  const from = query.from;
  if (!message || !from || from.is_bot || !query.data) return new Response("OK");
  const match = query.data.match(/^(undo|edit):([0-9a-f-]{36})$/i);
  if (!match) return new Response("OK");
  const [, action, expenseId] = match;
  const chatId = String(message.chat.id);
  const userId = String(from.id);
  const expense = await getExpenseForAction(env.DB, expenseId);
  if (!expense || expense.telegram_chat_id !== chatId) {
    await sendTelegramText(auth.token, chatId, "Transaksi ini tidak ditemukan.");
    return new Response("OK");
  }
  if (expense.reporter_id !== userId) {
    await sendTelegramText(auth.token, chatId, "Hanya pencatat transaksi ini yang dapat mengubahnya.");
    return new Response("OK");
  }
  if (Date.now() - expense.created_at > actionWindow) {
    await sendTelegramText(auth.token, chatId, "Batas waktu ubah sudah lewat. Gunakan situs web.");
    return new Response("OK");
  }
  await clearInlineKeyboard(auth.token, chatId, message.message_id);
  if (action === "undo") {
    await deleteExpense(env.DB, expenseId);
    await env.DB.prepare("DELETE FROM channel_pending_edits WHERE expense_id = ?")
      .bind(expenseId)
      .run();
    await sendTelegramText(
      auth.token,
      chatId,
      `Pengeluaran dibatalkan: ${rupiah(expense.amount)} · ${expense.item}.`,
    );
    return new Response("OK");
  }
  await setPendingEdit(env.DB, auth.integrationId, chatId, userId, expenseId);
  await sendTelegramText(
    auth.token,
    chatId,
    `Edit pengeluaran sekarang: ${rupiah(expense.amount)} · ${expense.item} · ${expense.category}.\nKirim data baru: jumlah, item, kategori. Contoh: 25.000, nasi goreng, makan.\nKirim /batal untuk membatalkan.`,
  );
  return new Response("OK");
}

async function handlePendingEdit(
  message: Message,
  env: TelegramEnv,
  auth: TelegramAuth,
  pending: { expense_id: string },
): Promise<Response> {
  const chatId = String(message.chat.id);
  const userId = String(message.from?.id);
  const text = message.text?.trim() ?? "";
  const parts = text.split(",").map((part) => part.trim());
  const amount = parts.length === 3 ? parseAmount(parts[0]) : null;
  if (!amount || !parts[1] || parts[1].length > 200 || !parts[2] || parts[2].length > 100) {
    await sendTelegramText(
      auth.token,
      chatId,
      "Format edit: jumlah, item, kategori. Contoh: 25.000, nasi goreng, makan.",
    );
    return new Response("OK");
  }
  const expense = await getExpenseForAction(env.DB, pending.expense_id);
  if (!expense) {
    await clearPendingEdit(env.DB, auth.integrationId, chatId, userId);
    await sendTelegramText(auth.token, chatId, "Transaksi ini sudah tidak ada.");
    return new Response("OK");
  }
  const result = await updateExpense(env.DB, {
    expenseId: expense.id,
    profileId: expense.profile_id,
    amount,
    item: parts[1],
    categoryName: parts[2],
  });
  if (!result.ok) {
    if (result.error === "category") {
      const names = result.categories.join(", ") || "belum ada";
      await sendTelegramText(
        auth.token,
        chatId,
        `Kategori "${parts[2]}" tidak ditemukan atau sudah diarsipkan. Kategori tersedia: ${names}.`,
      );
      return new Response("OK");
    }
    if (result.error === "limit") {
      await sendTelegramText(auth.token, chatId, "Total profil melebihi batas jumlah yang didukung.");
      return new Response("OK");
    }
    await clearPendingEdit(env.DB, auth.integrationId, chatId, userId);
    await sendTelegramText(auth.token, chatId, "Transaksi ini sudah tidak ada.");
    return new Response("OK");
  }
  await clearPendingEdit(env.DB, auth.integrationId, chatId, userId);
  await sendTelegramText(
    auth.token,
    chatId,
    `Diperbarui: ${rupiah(amount)} · ${result.categoryName} · ${parts[1]}.`,
  );
  return new Response("OK");
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

  let update: { message?: Message; callback_query?: CallbackQuery };
  try {
    update = (await request.json()) as { message?: Message; callback_query?: CallbackQuery };
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }
  if (update?.callback_query) return handleTelegramCallback(update.callback_query, env, auth);
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
  const pendingUser = message.from ? String(message.from.id) : "";
  const pending = pendingUser
    ? await getPendingEdit(env.DB, auth.integrationId, String(message.chat.id), pendingUser)
    : null;
  if (pending) {
    if (command === "/batal") {
      await clearPendingEdit(env.DB, auth.integrationId, String(message.chat.id), pendingUser);
      await sendTelegramText(auth.token, String(message.chat.id), "Edit dibatalkan.");
      return new Response("OK");
    }
    if (!text.startsWith("/")) return handlePendingEdit(message, env, auth, pending);
    await clearPendingEdit(env.DB, auth.integrationId, String(message.chat.id), pendingUser);
  }
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
        "/batal — batalkan edit transaksi",
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
        {
          inline_keyboard: [
            [
              { text: "Batalkan", callback_data: `undo:${result.expenseId}` },
              { text: "Edit", callback_data: `edit:${result.expenseId}` },
            ],
          ],
        },
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
