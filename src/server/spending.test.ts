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
