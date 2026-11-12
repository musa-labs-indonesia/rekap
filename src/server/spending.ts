import { categoryKey } from "./category";

type Payload = Record<string, unknown>;

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const id = () => crypto.randomUUID();
const bad = (message: string, status = 400) => Response.json({ error: message }, { status });

export async function spending(request: Request, db: D1Database): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "GET") {
    const profiles = (await db.prepare("SELECT * FROM profiles ORDER BY archived, name").all())
      .results;
    const profileId = url.searchParams.get("profile") || "";
    const categories = profileId
      ? (
          await db
            .prepare("SELECT * FROM categories WHERE profile_id = ? ORDER BY archived, name")
            .bind(profileId)
            .all()
        ).results
      : [];
    const start = Number(url.searchParams.get("start"));
    const end = Number(url.searchParams.get("end"));
    if (
      !url.searchParams.has("start") ||
      !url.searchParams.has("end") ||
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start >= end
    )
      return bad("Rentang tanggal tidak valid.");
    const category = url.searchParams.get("category") || "";
    const expenses = profileId
      ? (
          await db
            .prepare(
              `SELECT e.*, c.name AS category FROM expenses e JOIN categories c ON c.id = e.category_id AND c.profile_id = e.profile_id WHERE e.profile_id = ? AND e.occurred_at >= ? AND e.occurred_at < ? AND (? = '' OR e.category_id = ?) ORDER BY e.occurred_at DESC, e.created_at DESC`,
            )
            .bind(profileId, start, end, category, category)
            .all()
        ).results
      : [];
    return Response.json({ profiles, categories, expenses });
  }
  let body: Payload;
  try {
    body = (await request.json()) as Payload;
  } catch {
    return bad("Permintaan tidak valid.");
  }
  const action = text(body.action);
  const profileId = text(body.profileId);
  if (action === "createProfile") {
    const name = text(body.name);
    const requestedChatId = text(body.chatId);
    if (!name) return bad("Nama profil wajib diisi.");
    if (requestedChatId && !/^-?\d+$/.test(requestedChatId))
      return bad("ID chat tidak valid.");
    const profile = id();
    const chatId = requestedChatId || `unlinked:${profile}`;
    try {
      await db.batch([
        db
          .prepare("INSERT INTO profiles (id, name, chat_id, created_at) VALUES (?, ?, ?, ?)")
          .bind(profile, name, chatId, Date.now()),
        ...["makan", "transport", "belanja", "tagihan"].map((name) =>
          db
            .prepare("INSERT INTO categories (id, profile_id, name, name_key) VALUES (?, ?, ?, ?)")
            .bind(id(), profile, name, categoryKey(name)),
        ),
      ]);
      return Response.json({ id: profile });
    } catch {
      return bad("ID chat sudah digunakan atau profil tidak dapat dibuat.");
    }
  }
  const profile = await db
    .prepare("SELECT id, archived FROM profiles WHERE id = ?")
    .bind(profileId)
    .first<{ id: string; archived: number }>();
  if (!profile) return bad("Profil tidak ditemukan.", 404);
  if (action === "archiveProfile") {
    await db.prepare("UPDATE profiles SET archived = 1 WHERE id = ?").bind(profileId).run();
    return Response.json({ ok: true });
  }
  if (action === "restoreProfile") {
    await db.prepare("UPDATE profiles SET archived = 0 WHERE id = ?").bind(profileId).run();
    return Response.json({ ok: true });
  }
  if (profile.archived) return bad("Profil ini sudah diarsipkan.");
  if (action === "importExpenses") {
    if (!Array.isArray(body.transactions) || body.transactions.length < 1 || body.transactions.length > 500)
      return bad("Impor harus berisi 1–500 transaksi.");
    const ids = new Set<string>();
    const categories = new Map<string, string>();
    const rows: { id: string; item: string; category: string; amount: number; occurredAt: number }[] = [];
    for (const value of body.transactions) {
      if (!value || typeof value !== "object" || Array.isArray(value)) return bad("Data transaksi tidak valid.");
      const row = value as Payload;
      const rowId = text(row.id);
      const item = text(row.item);
      const category = text(row.category);
      const date = text(row.date);
      const amount = row.amount;
      const occurredAt = Date.parse(`${date}T12:00:00+07:00`);
      if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(rowId) || ids.has(rowId) ||
        !item || !category || category.length > 100 || category.includes(",") ||
        typeof amount !== "number" || !Number.isSafeInteger(amount) || amount <= 0 ||
        !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(occurredAt) ||
        new Date(occurredAt + 7 * 3600000).toISOString().slice(0, 10) !== date
      ) return bad("Data transaksi tidak valid.");
      ids.add(rowId);
      const key = categoryKey(category);
      categories.set(key, categories.get(key) ?? category);
      rows.push({ id: rowId, item, category: key, amount, occurredAt });
    }
    try {
      await db.batch([
        ...Array.from(categories, ([key, name]) => db.prepare(
          "INSERT INTO categories (id, profile_id, name, name_key) VALUES (?, ?, ?, ?) ON CONFLICT(profile_id, name_key) DO NOTHING",
        ).bind(id(), profileId, name, key)),
        ...rows.map((row) => db.prepare(
          "INSERT INTO expenses (id, profile_id, category_id, amount, item, occurred_at, created_at) SELECT ?, ?, (SELECT id FROM categories WHERE profile_id = ? AND name_key = ?), ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM expenses WHERE id = ?)",
        ).bind(row.id, profileId, profileId, row.category, row.amount, row.item, row.occurredAt, Date.now(), row.id)),
      ]);
      return Response.json({ ok: true });
    } catch (error) {
      if (String(error).includes("spending limit exceeded"))
        return bad("Total profil melebihi batas jumlah yang didukung.");
      throw error;
    }
  }
  if (action === "createCategory" || action === "renameCategory") {
    const name = text(body.name);
    if (!name || name.includes(",") || name.length > 100) return bad("Nama kategori tidak valid.");
    try {
      if (action === "createCategory") {
        const result = await db
          .prepare("INSERT INTO categories (id, profile_id, name, name_key) VALUES (?, ?, ?, ?) ON CONFLICT(profile_id, name_key) DO UPDATE SET name = excluded.name, archived = 0 WHERE categories.archived = 1")
          .bind(id(), profileId, name, categoryKey(name))
          .run();
        if (!result.meta.changes) return bad("Kategori sudah ada atau tidak dapat disimpan.");
      } else
        await db
          .prepare("UPDATE categories SET name = ?, name_key = ? WHERE id = ? AND profile_id = ?")
          .bind(name, categoryKey(name), text(body.categoryId), profileId)
          .run();
      return Response.json({ ok: true });
    } catch {
      return bad("Kategori sudah ada atau tidak dapat disimpan.");
    }
  }
  if (action === "deleteCategory") {
    const categoryId = text(body.categoryId);
    await db.batch([
      db
        .prepare("DELETE FROM categories WHERE id = ? AND profile_id = ? AND NOT EXISTS (SELECT 1 FROM expenses WHERE category_id = ?)")
        .bind(categoryId, profileId, categoryId),
      db
        .prepare("UPDATE categories SET archived = 1 WHERE id = ? AND profile_id = ?")
        .bind(categoryId, profileId),
    ]);
    return Response.json({ ok: true });
  }
  if (action === "archiveCategory") {
    await db
      .prepare("UPDATE categories SET archived = 1 WHERE id = ? AND profile_id = ?")
      .bind(text(body.categoryId), profileId)
      .run();
    return Response.json({ ok: true });
  }
  if (action === "deleteExpense") {
    await db
      .prepare("DELETE FROM expenses WHERE id = ? AND profile_id = ?")
      .bind(text(body.expenseId), profileId)
      .run();
    return Response.json({ ok: true });
  }
  if (action === "saveExpense") {
    const amount = Number(body.amount);
    const item = text(body.item);
    const categoryId = text(body.categoryId);
    const date = text(body.date);
    const occurredAt = Date.parse(`${date}T12:00:00+07:00`);
    if (
      !Number.isSafeInteger(amount) ||
      amount <= 0 ||
      !item ||
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !Number.isFinite(occurredAt) ||
      new Date(occurredAt + 7 * 3600000).toISOString().slice(0, 10) !== date
    )
      return bad("Isi jumlah, item, kategori, dan tanggal yang valid.");
    const oldExpense = text(body.expenseId)
      ? await db
          .prepare("SELECT category_id, occurred_at FROM expenses WHERE id = ? AND profile_id = ?")
          .bind(text(body.expenseId), profileId)
          .first<{ category_id: string; occurred_at: number }>()
      : null;
    if (text(body.expenseId) && !oldExpense) return bad("Transaksi tidak ditemukan.", 404);
    const category = await db
      .prepare(
        "SELECT id FROM categories WHERE id = ? AND profile_id = ? AND (archived = 0 OR id = ?)",
      )
      .bind(categoryId, profileId, oldExpense?.category_id || "")
      .first();
    if (!category) return bad("Kategori tidak ditemukan atau sudah diarsipkan.");
    try {
      if (text(body.expenseId)) {
        const timestamp =
          oldExpense &&
          new Date(oldExpense.occurred_at + 7 * 3600000).toISOString().slice(0, 10) === date
            ? oldExpense.occurred_at
            : occurredAt;
        await db
          .prepare(
            "UPDATE expenses SET amount = ?, item = ?, category_id = ?, occurred_at = ? WHERE id = ? AND profile_id = ?",
          )
          .bind(amount, item, categoryId, timestamp, text(body.expenseId), profileId)
          .run();
      } else {
        await db
          .prepare(
            "INSERT INTO expenses (id, profile_id, category_id, amount, item, occurred_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
          )
          .bind(id(), profileId, categoryId, amount, item, occurredAt, Date.now())
          .run();
      }
    } catch (error) {
      if (String(error).includes("spending limit exceeded"))
        return bad("Total profil melebihi batas jumlah yang didukung.");
      throw error;
    }
    return Response.json({ ok: true });
  }
  return bad("Tindakan tidak dikenal.");
}
