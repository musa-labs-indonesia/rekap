import { DurableObject } from 'cloudflare:workers'
import { applyMigrations, createDatabase, enableSubdomain, findDatabase, getSubdomain, uploadWorker, verifyInstallation, workerDatabase } from './deploy'

interface JobEnv { SESSION_KEY: string }
type Input = { botToken: string; username: string; password: string }
type Credentials = Input & { authSecret: string; webhookSecret: string }
type Phase = 'verify' | 'database' | 'database_pending' | 'migrations' | 'worker' | 'worker_pending' | 'domain' | 'health' | 'webhook' | 'commands' | 'done' | 'expired'
type Job = { phase: Phase; name: string; bot: string; nonce: string; expiresAt: number; secrets: string; subdomain: string; database?: string; telegramUser?: string; notice?: string }
type Row = { value: string; lock_id: string | null; lock_until: number }

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function random(size = 32): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(size)), byte => byte.toString(16).padStart(2, '0')).join('')
}

async function encryptionKey(value: string): Promise<CryptoKey> {
  if (!/^[0-9a-f]{64}$/i.test(value)) throw new Error('Invalid session key')
  return crypto.subtle.importKey('raw', Uint8Array.from(value.match(/../g) ?? [], pair => parseInt(pair, 16)), 'AES-GCM', false, ['encrypt', 'decrypt'])
}

async function encrypt(key: string, account: string, value: Credentials): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(account) }, await encryptionKey(key), encoder.encode(JSON.stringify(value)))
  return JSON.stringify({ iv: Array.from(iv), data: Array.from(new Uint8Array(ciphertext)) })
}

async function decrypt(key: string, account: string, value: string): Promise<Credentials> {
  const sealed = JSON.parse(value) as { iv: number[]; data: number[] }
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: Uint8Array.from(sealed.iv), additionalData: encoder.encode(account) }, await encryptionKey(key), Uint8Array.from(sealed.data))
  return JSON.parse(decoder.decode(plaintext)) as Credentials
}

async function telegram<T>(token: string, method: string, body?: object): Promise<T> {
  const result = await fetch(`https://api.telegram.org/bot${token}/${method}`, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined)
  const data = await result.json() as { ok?: boolean; result?: T }
  if (!result.ok || !data.ok || data.result === undefined) throw new Error('Telegram request failed')
  return data.result
}

function view(job: Job) {
  return { phase: job.phase, name: job.name, bot: job.bot, verificationUrl: job.phase === 'verify' ? `https://t.me/${job.bot}?start=${job.nonce}` : undefined, appUrl: job.phase === 'done' ? `https://${job.name}.${job.subdomain}.workers.dev` : undefined, notice: job.notice }
}

export class InstallerJob extends DurableObject<JobEnv> {
  constructor(ctx: DurableObjectState, env: JobEnv) {
    super(ctx, env)
    this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS job (id INTEGER PRIMARY KEY CHECK (id = 1), value TEXT NOT NULL, lock_id TEXT, lock_until INTEGER NOT NULL DEFAULT 0)')
  }

  private read(): Job | null {
    const row = this.ctx.storage.sql.exec<Row>('SELECT value, lock_id, lock_until FROM job WHERE id = 1').toArray()[0]
    return row ? JSON.parse(row.value) as Job : null
  }

  private write(job: Job): void {
    const updated = this.ctx.storage.sql.exec<{ id: number }>("UPDATE job SET value = ? WHERE id = 1 AND json_extract(value, '$.phase') != 'expired' RETURNING id", JSON.stringify(job)).toArray()
    if (!updated.length) throw new Error('Installation expired')
  }

  status() {
    const job = this.read()
    return job ? view(job) : null
  }

  resetExpired(): void {
    const deleted = this.ctx.storage.sql.exec<{ id: number }>("DELETE FROM job WHERE id = 1 AND lock_id IS NULL AND json_extract(value, '$.phase') = 'expired' RETURNING id").toArray()
    if (!deleted.length) throw new Error('Installation is busy or not expired')
  }

  async start(account: string, token: string, input: Input) {
    if (this.ctx.id.name !== account) throw new Error('Invalid account')
    if (this.read()) throw new Error('An installation already exists for this account')
    const [bot, webhook, subdomain] = await Promise.all([
      telegram<{ is_bot?: boolean; username?: string; can_join_groups?: boolean }>(input.botToken, 'getMe'),
      telegram<{ url?: string }>(input.botToken, 'getWebhookInfo'),
      getSubdomain(account, token),
    ])
    if (!bot.is_bot || !bot.username || !/^[a-zA-Z0-9_]{5,32}$/.test(bot.username) || !bot.can_join_groups || typeof webhook.url !== 'string') throw new Error('Bot cannot be used')
    if (webhook.url) throw new Error('Bot already has a webhook')
    const expiresAt = Date.now() + 30 * 60_000
    const credentials = { ...input, authSecret: random(), webhookSecret: random() }
    const job: Job = { phase: 'verify', name: `rekap-${random(6)}`, bot: bot.username, nonce: random(16), subdomain, expiresAt, secrets: await encrypt(this.env.SESSION_KEY, account, credentials) }
    await this.ctx.storage.setAlarm(expiresAt)
    const inserted = this.ctx.storage.sql.exec<{ id: number }>('INSERT OR IGNORE INTO job (id, value) VALUES (1, ?) RETURNING id', JSON.stringify(job)).toArray()
    if (!inserted.length) throw new Error('An installation already exists for this account')
    return view(job)
  }

  async step(account: string, token: string) {
    if (this.ctx.id.name !== account) throw new Error('Invalid account')
    const lock = random(16)
    const acquired = this.ctx.storage.sql.exec<{ value: string }>('UPDATE job SET lock_id = ?, lock_until = ? WHERE id = 1 AND lock_until < ? RETURNING value', lock, Date.now() + 10 * 60_000, Date.now()).toArray()
    if (!acquired.length) throw new Error('Installation is busy or missing')
    try {
      const job = JSON.parse(acquired[0].value) as Job
      if (job.phase === 'done' || job.phase === 'expired') return view(job)
      if (job.expiresAt <= Date.now()) {
        job.phase = 'expired'
        job.secrets = ''
        this.write(job)
        return view(job)
      }
      const credentials = await decrypt(this.env.SESSION_KEY, account, job.secrets)
      if (job.phase === 'verify') {
        const updates = await telegram<{ message?: { text?: string; from?: { id?: number }; chat?: { id?: number; type?: string } } }[]>(credentials.botToken, 'getUpdates', { limit: 100, timeout: 0, allowed_updates: ['message'] })
        const message = updates.find(update => update.message?.text === `/start ${job.nonce}` && update.message.chat?.type === 'private' && Number.isSafeInteger(update.message.from?.id) && update.message.from?.id === update.message.chat.id)?.message
        if (!message?.from?.id) return view(job)
        job.telegramUser = String(message.from.id)
        job.phase = 'database'
        this.write(job)
      } else if (job.phase === 'database') {
        if (await findDatabase(account, token, job.name)) throw new Error('Database name is already in use')
        job.phase = 'database_pending'
        this.write(job)
        job.database = await createDatabase(account, token, job.name)
        job.phase = 'migrations'
        this.write(job)
      } else if (job.phase === 'database_pending') {
        const database = await findDatabase(account, token, job.name)
        if (!database) throw new Error('Database creation is unresolved; check Cloudflare before retrying')
        job.database = database
        job.phase = 'migrations'
        this.write(job)
      } else if (job.phase === 'migrations' && job.database) {
        await applyMigrations(account, token, job.database)
        job.phase = 'worker'
        this.write(job)
      } else if (job.phase === 'worker' && job.database && job.telegramUser) {
        if (await workerDatabase(account, token, job.name) !== null) throw new Error('Worker name is already in use')
        job.phase = 'worker_pending'
        this.write(job)
        await uploadWorker(account, token, job.name, job.database, {
          BETTER_AUTH_SECRET: credentials.authSecret, OWNER_USERNAME: credentials.username, OWNER_PASSWORD: credentials.password,
          TELEGRAM_BOT_TOKEN: credentials.botToken, TELEGRAM_BOT_USERNAME: job.bot, TELEGRAM_WEBHOOK_SECRET: credentials.webhookSecret,
          TRUSTED_TELEGRAM_USER_ID: job.telegramUser, APP_URL: `https://${job.name}.${job.subdomain}.workers.dev`,
        })
        job.phase = 'domain'
        this.write(job)
      } else if (job.phase === 'worker_pending' && job.database) {
        const database = await workerDatabase(account, token, job.name)
        if (database !== job.database) throw new Error('Worker upload is unresolved; check Cloudflare before retrying')
        job.phase = 'domain'
        this.write(job)
      } else if (job.phase === 'domain') {
        await enableSubdomain(account, token, job.name)
        job.phase = 'health'
        this.write(job)
      } else if (job.phase === 'health' && job.database) {
        const result = await fetch(`https://${job.name}.${job.subdomain}.workers.dev/api/auth/get-session`, { redirect: 'manual' })
        if (!result.ok) throw new Error('App is not ready yet')
        await verifyInstallation(account, token, job.name, job.database)
        job.phase = 'webhook'
        this.write(job)
      } else if (job.phase === 'webhook') {
        const url = `https://${job.name}.${job.subdomain}.workers.dev/api/telegram`
        const current = await telegram<{ url?: string }>(credentials.botToken, 'getWebhookInfo')
        if (typeof current.url !== 'string' || (current.url && current.url !== url)) throw new Error('Bot webhook changed during installation')
        await telegram(credentials.botToken, 'setWebhook', { url, secret_token: credentials.webhookSecret, allowed_updates: ['message'], drop_pending_updates: false })
        job.phase = 'commands'
        this.write(job)
      } else if (job.phase === 'commands') {
        const commands = await telegram<{ command: string }[]>(credentials.botToken, 'getMyCommands')
        if (commands.length) job.notice = 'Existing Telegram command menu was not changed.'
        else await telegram(credentials.botToken, 'setMyCommands', { commands: [
          { command: 'chatid', description: 'Tampilkan ID chat' },
          { command: 'addcategory', description: 'Tambah kategori' },
          { command: 'report_daily', description: 'Laporan hari ini' },
          { command: 'report_weekly', description: 'Laporan minggu ini' },
          { command: 'report_monthly', description: 'Laporan bulan ini' },
          { command: 'forgot_password', description: 'Pulihkan kata sandi' },
        ] })
        job.phase = 'done'
        job.secrets = ''
        this.write(job)
      } else {
        throw new Error('Installation state is incomplete')
      }
      return view(job)
    } finally {
      this.ctx.storage.sql.exec('UPDATE job SET lock_id = NULL, lock_until = 0 WHERE id = 1 AND lock_id = ?', lock)
    }
  }

  async alarm(): Promise<void> {
    const job = this.read()
    if (job && job.phase !== 'done' && job.expiresAt <= Date.now()) {
      job.secrets = ''
      job.phase = 'expired'
      this.write(job)
    }
  }
}
