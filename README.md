# Rekap

Rekap records spending from a Telegram group or private chat and shows reports on a private website. Each installation has one shared owner account. Each profile is linked to one chat and has its own categories and expenses. This project does not yet support WhatsApp.

## Before deployment

This is an early version. Test it with non-sensitive data before you rely on it. Back up the D1 database. Sign-in and recovery have per-IP limits, but these do not stop distributed password guessing. Use a strong password and add Cloudflare access controls if you expose the site publicly. Do not enable Worker traces without checking that outbound Telegram URLs, which contain the bot token, are redacted. Disable request-body logging and protect logs and D1 backups.

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

Send `catat, 20.000, bubur ayam, makan` or `catat, 20000, bubur ayam, makan`. All four fields are required; amounts are positive whole rupiah. The sum of all expenses in one profile cannot exceed Rp9.000.000.000.000.000. New profiles start with `makan`, `transport`, `belanja`, and `tagihan`. Use `/addcategory nama kategori` to add one. Use `/report_daily`, `/report_weekly`, or `/report_monthly` for the current Jakarta period. Weeks begin on Monday. Editing or deleting a Telegram message does not change a saved expense; use the website instead.

The website supports manual entries, historical dates, profile and category management, filters, and CSV export. Archived profiles can be restored. Archived categories remain on existing expenses but cannot be selected for new entries.

## Recovery

Send `/forgot_password` to the bot in a private chat from the trusted Telegram account. The link expires in ten minutes and can be used once. Do not share it.

If Telegram is unavailable, an operator with D1 write access can issue a recovery link from a trusted terminal. Set `D1_DATABASE_ID` and `APP_URL` as above, then run `node scripts/recover.mjs`. This writes to the remote database and invalidates any existing recovery link. It prints a sensitive link; do not save or share terminal output. Open the link within ten minutes and set a new password. For the disposable local database, use `--local` and the local database ID and origin instead.

## Hosted installer and updates

The hosted installer at https://install-rekap-musalabs.ptpcp.id currently uses a private Cloudflare OAuth client. Only authorized members of its owning account can use it until the client is made public. Its Cloudflare permissions can manage other Workers and D1 databases in the account you authorize; review the consent screen before continuing.

The installer creates a Worker and D1 database with the same generated name. Keep that name and the D1 database ID for backups and removal. To check for an update, select **Periksa pembaruan** in Rekap, connect the same Cloudflare account, and select **Perbarui Rekap** if it is available. Review the account and Worker name before continuing.

The updater reuses the existing Worker and database. It does not change the Telegram webhook or write new secret values. Back up the database before updating. The updater records a D1 Time Travel bookmark, but a bookmark is not a replacement for an independently stored backup. It applies only migrations approved for automatic updates; other migrations require a manual update. If an upload or deployment is uncertain, check Cloudflare before taking further action. Rolling back a Worker version does not restore D1 data.

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

Create an ignored `.dev.vars` file with the same variables, using `APP_URL=http://localhost:3000` and non-production credentials. Use the local placeholder database ID, then run `vp exec cf d1 migrations apply 11111111-1111-4111-8111-111111111111 --local --persist-to .cloudflare/state --dir migrations` and `vp exec cf dev`. Telegram cannot send a webhook to localhost without a secure public tunnel. Never use production secrets or real spending data in local development.

Run `vp exec tsc --noEmit`, `vp test run src/server/auth.test.ts --config src/server/auth/test.config.ts`, `vp test run --root src/server telegram.test.ts`, and `vp exec cf build` for the current checks. The tests use a local SQLite test adapter, not a deployed D1 database or live Telegram API. Cloudflare limits and pricing can change; check current Workers and D1 quotas before deployment.
