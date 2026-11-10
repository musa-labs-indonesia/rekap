# Rekap

Rekap records spending from a Telegram group or private chat and shows reports on a private website. Each installation has one shared owner account. Each profile is linked to one chat and has its own categories and expenses. This project does not yet support WhatsApp.

## Install Rekap

Use the [hosted installer](https://install-rekap-musalabs.ptpcp.id) to create Rekap in your Cloudflare account. You do not need to clone this repository or use a terminal.

Rekap is an early version. Test it with non-sensitive data before you rely on it. Back up D1, use a strong password, and add Cloudflare access controls if the site is public. Sign-in limits alone do not stop distributed password guessing.

You need a Cloudflare account with Workers, D1, and a workers.dev subdomain, plus a Telegram bot from BotFather. The bot must be able to join groups and must not already have a webhook.

1. Open the installer, connect Cloudflare, and review its requested permissions. They can manage other Workers and D1 databases in the account you authorize.
2. Choose the account and enter the bot token and owner credentials. Use a strong owner password of at least 12 characters.
3. Open the bot using the installer link and press **Start** in a private chat. This Telegram account can later request password recovery.
4. Return to the installer, verify the Telegram account, and start installation. When it finishes, open Rekap and sign in.
5. In BotFather, disable group privacy mode. Add the bot to your group, or remove and re-add it if it was already there. Send `/chatid` in the group or private chat, then create a profile with that ID in Rekap.

The installer sets the Telegram webhook. Keep the bot token private. Anyone in a linked group can add expenses and categories or request reports. The [usage](#usage), [recovery](#recovery), and [updates](#hosted-installer-and-updates) sections cover operation after installation. The app also has a **Panduan** page.

## Manual deployment

This is an early version. Test it with non-sensitive data before you rely on it. Back up the D1 database. Sign-in and recovery have per-IP limits, but these do not stop distributed password guessing. Use a strong password and add Cloudflare access controls if you expose the site publicly. Do not enable Worker traces without checking that outbound Telegram URLs, which contain the bot token, are redacted. Disable request-body logging and protect logs and D1 backups.

The following manual path is an alternative for operators who manage deployment themselves. The hosted installer does not require these steps.

You need Node.js 22.18 or later, Vite+ (`vp`), a Cloudflare account with Workers and D1, and a Telegram bot created with BotFather. Run `vp install` and `vp exec cf auth login`.

Create a D1 database with `vp exec cf d1 create --name rekap`. Set `D1_DATABASE_ID` to the UUID in the result. The UUID in `cloudflare.config.ts` is a local placeholder: **never deploy with it**. Apply migrations to the new database with `vp exec cf d1 migrations apply "$D1_DATABASE_ID" --dir migrations`. This writes to the remote database; check the ID first.

Set these Worker secrets using a private JSON secrets file and pass it to `vp exec cf deploy --secrets-file <path>`, or use your Cloudflare secret management workflow. Do not commit the file.

| Name | Value |
| --- | --- |
| `APP_URL` | Public HTTPS origin, without a path or trailing slash |
| `BETTER_AUTH_SECRET` | Random secret of at least 32 characters |
| `OWNER_USERNAME` | Initial username: 3–30 letters, digits, underscores or periods |
| `OWNER_PASSWORD` | Initial password: 12–128 characters |
| `TELEGRAM_BOT_TOKEN` | BotFather token |
| `TELEGRAM_BOT_USERNAME` | Bot username without `@` |
| `TELEGRAM_WEBHOOK_SECRET` | Random Telegram webhook secret token, 32–256 letters, digits, `_` or `-` |
| `TRUSTED_TELEGRAM_USER_ID` | Numeric user ID allowed to request recovery in a private chat |

The owner account is created on the first auth request. Later changes to the initial username or password secrets do not reset the account. Change the password on the website. Keep `BETTER_AUTH_SECRET` stable across deployments. Deploy with the same `D1_DATABASE_ID` in the environment and verify the URL before linking Telegram. Deployment and migrations affect shared infrastructure; review them first.

Generate a webhook secret with `openssl rand -hex 32`. The command prints a sensitive value: keep it private and use it for both the Worker secret and Telegram `setWebhook` secret token. Length alone does not make a secret random. Existing installations with a shorter secret must update both values when deploying this version; Telegram delivery will fail until they match.

In BotFather, disable group privacy mode for this bot, then remove and re-add the bot to the group if needed. The bot needs normal group messages to receive `catat`. Configure Telegram `setWebhook` with URL `https://YOUR-ORIGIN/api/telegram` and the same `secret_token` as `TELEGRAM_WEBHOOK_SECRET`. Telegram must be able to reach the URL over HTTPS. Treat the bot token and webhook secret as passwords; avoid putting them in shell history, logs, or screenshots. Send `/chatid` in the chat to get its numeric ID; a group ID is normally negative. Create a profile on the website with that chat ID. Anyone in the linked group can add expenses and categories or request reports.

## Usage

Send `/help` to see the bot commands, even before a chat is linked to a profile. Send `catat, 20.000, bubur ayam, makan` or `catat, 20000, bubur ayam, makan`. All four fields are required; amounts are positive whole rupiah. The sum of all expenses in one profile cannot exceed Rp9.000.000.000.000.000. New profiles start with `makan`, `transport`, `belanja`, and `tagihan`. Use `/addcategory nama kategori` to add one. Use `/report_daily`, `/report_weekly`, or `/report_monthly` for the current Jakarta period. Weeks begin on Monday. Each `catat` message stores the sender's Telegram name, username, and numeric ID. The transaction list and CSV export show this as `Pelapor`; older expenses and manual website entries have no reporter. Editing or deleting a Telegram message does not change a saved expense; use the website instead.

The website supports manual entries, historical dates, profile and category management, filters, and CSV export. To import, select a profile and choose **Impor CSV** on the transactions page. Use UTF-8 CSV with columns `Tanggal,Item,Kategori,Jumlah` and an optional `Pelapor` column, ISO dates such as `2024-05-04`, and positive whole rupiah amounts without separators. Import ignores `Pelapor`. Review the preview and any new categories before importing. Each file is limited to 500 transactions and 1 MB. Reimporting a file can create duplicates. Archived profiles can be restored. Archived categories remain on existing expenses but cannot be selected for new manual entries; imported transactions keep matching categories archived.

CSV export prefixes an apostrophe to values that could be interpreted as spreadsheet formulas. Import preserves that apostrophe because it cannot tell whether it was part of the original value.

## Recovery

Send `/forgot_password` to the bot in a private chat from the trusted Telegram account. The link expires in ten minutes and can be used once. Do not share it.

If Telegram is unavailable, an operator with D1 write access can issue a recovery link from a trusted terminal. Set `D1_DATABASE_ID` and `APP_URL` as above, then run `node scripts/recover.mjs`. This writes to the remote database and invalidates any existing recovery link. It prints a sensitive link; do not save or share terminal output. Open the link within ten minutes and set a new password. For the disposable local database, use `--local` and the local database ID and origin instead.

## Hosted installer and updates

The hosted installer at https://install-rekap-musalabs.ptpcp.id requests Cloudflare permissions that can manage other Workers and D1 databases in the account you authorize. Review the consent screen before continuing.

The installer creates a Worker and D1 database with the same generated name. Keep that name and the D1 database ID for backups and removal. When **Pembaruan tersedia** appears in Rekap, select it to open the installer. Connect the same Cloudflare account, review the account and Worker name, and select **Perbarui Rekap**. If Rekap cannot check the update status, open the installer directly. Manually deployed installations do not report an installer build identity.

The updater reuses the existing Worker and database. It does not change the Telegram webhook or write new secret values. Back up the database before updating. The updater records a D1 Time Travel bookmark, but a bookmark is not a replacement for an independently stored backup. It applies only migrations approved for automatic updates; other migrations require a manual update. Rolling back a Worker version does not restore D1 data.

If a Cloudflare response is lost, the updater records the intended operation before sending it and reads Cloudflare again before deciding the next action. A missing resource does not prove that the request failed. The updater does not reuse the same migration Worker name or version tag after an uncertain upload. It adopts the resource if it appears, or you can select **Coba Worker baru** or **Coba versi baru** to use a new random name or tag. Old names and tags are reported for manual cleanup.

A temporary migration Worker carries an ownership marker derived from the installer session key, the account, the Worker name, the installed build, the database ID and the migration name. The updater uses that Worker only when the marker and D1 binding match. Cloudflare creates a new Worker with its workers.dev route disabled. After the active Worker version and ownership are verified, the updater enables the route, applies the migration, and disables the route again before it records the Worker as an orphan. It never deletes, overwrites, or deploys the temporary Worker. The migration apply is idempotent and protected by a per-migration secret, so a late or duplicate apply is a no-op or a conflict response.

The updater does not retry an enable whose outcome is uncertain. If an enable request has an uncertain outcome, such as a lost response, a 5xx, a 408, or a 429, the updater reads the route. If the route is enabled, the update continues. If the route is still disabled, the updater stops and does not send a second enable, because the first request may still complete and a late enable could re-enable the route after cleanup. Re-check later, use a new Worker, or cancel. A clear rejection such as 400, 401, 403, 404, or 405 does not change the route; after you fix the cause, a re-check may retry the enable. A disable is retried only after a read, because a duplicate disable cannot re-enable the route. Cleanup does not finish until the change response and a read show the route disabled, or the Worker is gone. If the route cannot be read or disabled, the updater blocks and shows the Worker URL. Disable the route and delete the Worker manually only after you verify that it belongs to this installation.

Cloudflare reports a successful subdomain change before every edge serves the new route. The updater therefore uses the change response, waits up to 10 seconds for a read-only `GET` to the Worker URL to return `405`, and only then sends the migration. After disabling the route, it waits up to 10 seconds for the URL to return `404`. Cleanup applies the same wait when the control-plane flag is already false, because a lost disable response can leave an edge serving the route. If either wait expires, the updater blocks with the Worker URL and does not assume that the route is disabled or missing. Cloudflare does not document a propagation bound, so a longer delay needs a manual re-check.

The ownership read and a route write are separate API calls. The updater re-reads ownership immediately before each route write and never deletes or overwrites the temporary Worker. It assumes that during an update no other account administrator deletes and recreates the same generated `rekap-migrate-...` name or changes that Worker's route. Without that assumption, a route enable or disable can apply to a same-name replacement. The updater also assumes that the Workers subdomain API applies writes in order and that a read reflects the latest write; Cloudflare does not document a bounded completion guarantee. If that assumption does not hold, a late or external request can re-enable an orphan route. Check and disable the listed Workers before you delete them. Cancellation is refused after any migration has been applied, including in a multi-migration update; retrying with a new Worker keeps that rule and records the old Worker for manual cleanup.

No route-free invocation is available here. Cloudflare service bindings can call a Worker without a public route, but the installer cannot add a binding to a dynamically named temporary Worker at runtime. Version URLs are public and use the same workers.dev setting. The temporary Worker uses `D1Database.batch`, which Cloudflare documents as atomic; the D1 REST batch API has no documented atomic guarantee.

A lost deployment is not retried automatically. Check the active version, or deploy the new version manually, then select **Periksa lagi**. **Batalkan pembaruan** is available only before a deployment request is sent and before any database migration is applied. After a migration, cancellation is refused; continue the update or restore the database manually.

Before approving a migration in `migrations/auto-update.json`, review whether the running old Worker can safely use the changed schema throughout the update, including if deployment fails. Add the migration filename and its SHA-256 hash to the file only after that review. The approval list is empty initially. The hash detects changes to the reviewed file; it does not prove that the migration is safe. Migrations that cannot meet this requirement need a manual update plan.

The current update check compares the embedded build's hash with the installed build's hash. It does not yet verify a Git tag or release, or prevent downgrades. Do not rely on it as a release verification mechanism.

The installer currently tracks one installation per Cloudflare account. It does not yet provide a way to forget a completed installation. Deleting that installation's Worker and database does not clear the installer record, so a new hosted installation in the same account is not yet supported.

## Disconnect and remove an installation

1. Export the correct D1 database from the Cloudflare dashboard and verify the backup if you may need its spending data later. Deleting a database removes its data.
2. In the installer, select **Putuskan koneksi**. This revokes the installer's current OAuth token; it does not delete the app or database. You can also revoke the authorization under Cloudflare profile → Access Management → Connected Applications.
3. To stop Telegram from sending messages to the app, call Telegram's `deleteWebhook` method with the bot token. Keep the token out of chat, shell history, and logs. `deleteWebhook` does not revoke the bot token; retained pending messages may be delivered if you connect the bot again. To replace a compromised token, use BotFather's `/revoke` and replace the old token wherever it is used.
4. In Cloudflare **Workers & Pages**, find the generated Rekap Worker and delete it. This stops the website and does not delete D1.
5. Only after checking the backup and the database ID, delete the matching database in **Storage & databases → D1**. This is a separate, destructive action.

Do not delete `rekap-installer` to remove a single Rekap app. That Worker hosts the installer and its installation records.

To call `deleteWebhook` from a terminal, run the following command and enter the bot token when prompted. Input is hidden, and the token is passed to `curl` through standard input rather than a command-line argument. The response should contain `"ok":true`.

```sh
bash -c '
  trap "stty echo" EXIT
  printf "Bot token: " >&2
  stty -echo
  IFS= read -r token
  stty echo
  printf "\n" >&2
  printf "url = \"https://api.telegram.org/bot%s/deleteWebhook\"\ndata = \"drop_pending_updates=false\"\n" "$token" | curl --silent --show-error --config -
  unset token
'
```

## Local development

Clone the repository, install Node.js 22.18 or later and Vite+ (`vp`), then run `vp install`. Create an ignored `.dev.vars` file with the variables in [Manual deployment](#manual-deployment), using `APP_URL=http://localhost:3000` and non-production credentials. Use the local placeholder database ID, then run `vp exec cf d1 migrations apply 11111111-1111-4111-8111-111111111111 --local --persist-to .cloudflare/state --dir migrations` and `vp exec cf dev`. Telegram cannot send a webhook to localhost without a secure public tunnel. Never use production secrets or real spending data in local development.

Run `vp exec tsc --noEmit`, `vp test run src/server/auth.test.ts --config src/server/auth/test.config.ts`, `vp test run --root src/server telegram.test.ts`, and `vp exec cf build` for the current checks. The tests use a local SQLite test adapter, not a deployed D1 database or live Telegram API. Cloudflare limits and pricing can change; check current Workers and D1 quotas before deployment.

For installer changes, run `pnpm --dir installer test`. The installer build embeds the app bundle and migrations. A push to GitHub does not update the hosted installer; it must be rebuilt and deployed separately.

## Contributing

Use the local development setup and checks above. Keep credentials, `.dev.vars` files, and real spending data out of commits. Describe the change and its verification when you open a pull request.
