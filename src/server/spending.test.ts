import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { expect, it } from "vitest";
import { spending } from "./spending";

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

class TestD1 {
  db = new DatabaseSync(":memory:");
  constructor() {
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec(readFileSync(new URL("../../migrations/0001_spending.sql", import.meta.url), "utf8"));
    this.db.exec(readFileSync(new URL("../../migrations/0003_reporter.sql", import.meta.url), "utf8"));
  }
  prepare(sql: string) { return new Statement(this.db, sql); }
  async batch(statements: Statement[]) {
    this.db.exec("BEGIN");
    try {
      const result = statements.map((statement) => statement.runSync());
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
}

it("removes categories without losing historical expenses and restores a reused name", async () => {
  const db = new TestD1();
  const run = (body: object) => spending(new Request("https://example.com/api/data", {
    method: "POST", body: JSON.stringify(body),
  }), db as unknown as D1Database);
  const profileResponse = await run({ action: "createProfile", name: "Test", chatId: "123" });
  const { id: profileId } = await profileResponse.json() as { id: string };
  const get = async () => (await spending(new Request(`https://example.com/api/data?profile=${profileId}&start=1706716800000&end=1709424000000`), db as unknown as D1Database)).json() as Promise<{
    categories: Array<{ id: string; name: string; archived: number }>;
    expenses: Array<{ item: string; amount: number; category: string }>;
  }>;
  expect((await run({ action: "createCategory", profileId, name: "Jajan" })).ok).toBe(true);
  const created = await get();
  const categoryId = created.categories.find((category) => category.name === "Jajan")!.id;
  expect((await run({ action: "createCategory", profileId, name: "JAJAN" })).status).toBe(400);
  expect((await run({ action: "saveExpense", profileId, categoryId, item: "Teh", amount: 12000, date: "2024-02-29" })).ok).toBe(true);
  expect((await run({ action: "deleteCategory", profileId, categoryId })).ok).toBe(true);
  const afterDelete = await get();
  expect(afterDelete.categories.find((category) => category.id === categoryId)?.archived).toBe(1);
  expect(afterDelete.expenses).toMatchObject([{ item: "Teh", amount: 12000, category: "Jajan" }]);
  expect((await run({ action: "createCategory", profileId, name: "jajan" })).ok).toBe(true);
  const restored = await get();
  expect(restored.categories.find((category) => category.id === categoryId)).toMatchObject({ archived: 0 });
  expect(restored.expenses).toMatchObject([{ item: "Teh", amount: 12000, category: "jajan" }]);
  const unused = restored.categories.find((category) => category.name === "transport")!;
  expect((await run({ action: "deleteCategory", profileId, categoryId: unused.id })).ok).toBe(true);
  expect((await get()).categories.some((category) => category.id === unused.id)).toBe(false);
  db.db.close();
});

it("imports transactions atomically with profile categories and safely retries the same request", async () => {
  const db = new TestD1();
  const run = (body: object) => spending(new Request("https://example.com/api/data", {
    method: "POST", body: JSON.stringify(body),
  }), db as unknown as D1Database);
  const { id: profileId } = await (await run({ action: "createProfile", name: "Test", chatId: "123" })).json() as { id: string };
  const transactions = [
    { id: "11111111-1111-4111-8111-111111111111", date: "2024-02-29", item: "Nasi, ayam", category: "MAKAN", amount: 22000 },
    { id: "22222222-2222-4222-8222-222222222222", date: "2024-03-04", item: "Sabun", category: "Kebutuhan", amount: 37000 },
  ];
  const payload = { action: "importExpenses", profileId, transactions };
  expect((await run({ ...payload, transactions: [transactions[0], { ...transactions[1], date: "2024-02-30" }] })).status).toBe(400);
  expect(db.db.prepare("SELECT COUNT(*) AS count FROM expenses").get()?.count).toBe(0);
  expect(db.db.prepare("SELECT COUNT(*) AS count FROM categories WHERE name_key = 'kebutuhan'").get()?.count).toBe(0);
  expect((await run(payload)).ok).toBe(true);
  expect((await run(payload)).ok).toBe(true);
  const rows = db.db.prepare("SELECT e.item, e.amount, e.occurred_at, c.name FROM expenses e JOIN categories c ON c.id = e.category_id ORDER BY e.item").all();
  expect(rows).toMatchObject([
    { item: "Nasi, ayam", amount: 22000, occurred_at: Date.parse("2024-02-29T12:00:00+07:00"), name: "makan" },
    { item: "Sabun", amount: 37000, occurred_at: Date.parse("2024-03-04T12:00:00+07:00"), name: "Kebutuhan" },
  ]);
  expect(db.db.prepare("SELECT COUNT(*) AS count FROM categories WHERE profile_id = ?").get(profileId)?.count).toBe(5);
  const tooLarge = [{ id: "33333333-3333-4333-8333-333333333333", date: "2024-03-05", item: "Besar", category: "Baru", amount: 9000000000000000 }];
  expect((await run({ ...payload, transactions: tooLarge })).status).toBe(400);
  expect(db.db.prepare("SELECT COUNT(*) AS count FROM categories WHERE name_key = 'baru'").get()?.count).toBe(0);
  expect(db.db.prepare("SELECT COUNT(*) AS count FROM expenses").get()?.count).toBe(2);
  const longItem = "a".repeat(220);
  expect((await run({ ...payload, transactions: [{ ...transactions[0], id: "55555555-5555-4555-8555-555555555555", item: longItem }] })).ok).toBe(true);
  expect(db.db.prepare("SELECT item FROM expenses WHERE id = ?").get("55555555-5555-4555-8555-555555555555")?.item).toBe(longItem);
  const { id: nearLimitProfile } = await (await run({ action: "createProfile", name: "Limit", chatId: "456" })).json() as { id: string };
  const nearLimit = { action: "importExpenses", profileId: nearLimitProfile, transactions: [
    { id: "44444444-4444-4444-8444-444444444444", date: "2024-03-05", item: "Batas", category: "Makan", amount: 9000000000000000 },
  ] };
  expect((await run(nearLimit)).ok).toBe(true);
  expect((await run(nearLimit)).ok).toBe(true);
  expect(db.db.prepare("SELECT COUNT(*) AS count FROM expenses WHERE profile_id = ?").get(nearLimitProfile)?.count).toBe(1);
  db.db.close();
});
