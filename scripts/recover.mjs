import { createHash, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";

const database = process.env.D1_DATABASE_ID;
const appUrl = process.env.APP_URL;
const local = process.argv.includes("--local");
let origin;
try {
  const url = new URL(appUrl);
  if (
    (url.protocol !== "https:" &&
      !(local && url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  )
    throw new Error();
  origin = url.origin;
} catch {
  throw new Error("Set APP_URL to the application HTTPS origin (or localhost with --local).");
}
if (!database || !/^[0-9a-f-]{36}$/i.test(database))
  throw new Error("Set D1_DATABASE_ID to the database UUID.");
const token = randomBytes(32).toString("hex");
const digest = createHash("sha256").update(token).digest("hex");
const sql =
  "INSERT INTO auth_recovery (id, token_hash, expires_at) SELECT 1, ?, ? WHERE EXISTS (SELECT 1 FROM auth_owner_bootstrap WHERE id = 1) ON CONFLICT(id) DO UPDATE SET token_hash = excluded.token_hash, expires_at = excluded.expires_at";
const args = [
  "exec",
  "cf",
  "d1",
  "raw",
  database,
  "--sql",
  sql,
  "--params",
  digest,
  String(Date.now() + 600000),
];
if (local) args.push("--local", "--persist-to", ".cloudflare/state");
const result = spawnSync("vp", args, { encoding: "utf8" });
if (result.status !== 0) throw new Error(result.stderr || "Database update failed.");
let changes;
try {
  changes = JSON.parse(result.stdout)[0].meta.changes;
} catch {
  throw new Error("Unexpected database response.");
}
if (changes !== 1) throw new Error("Owner is not initialized; no recovery link was created.");
console.log(
  `Single-use recovery link, valid for 10 minutes:\n${origin}/recover#token=${token}\nKeep this link private.`,
);
