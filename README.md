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

## Local development

Create an ignored `.dev.vars` file with the same variables, using `APP_URL=http://localhost:3000` and non-production credentials. Use the local placeholder database ID, then run `vp exec cf d1 migrations apply 11111111-1111-4111-8111-111111111111 --local --persist-to .cloudflare/state --dir migrations` and `vp exec cf dev`. Telegram cannot send a webhook to localhost without a secure public tunnel. Never use production secrets or real spending data in local development.

Run `vp exec tsc --noEmit`, `vp test run src/server/auth.test.ts --config src/server/auth/test.config.ts`, `vp test run --root src/server telegram.test.ts`, and `vp exec cf build` for the current checks. The tests use a local SQLite test adapter, not a deployed D1 database or live Telegram API. Cloudflare limits and pricing can change; check current Workers and D1 quotas before deployment.
