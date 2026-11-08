import { DurableObject } from 'cloudflare:workers'
import { activeVersion, applyMigrations, artifactId, createDatabase, deleteMigrationWorker, deployUpdate, enableSubdomain, findDatabase, getSubdomain, updatePreflight, uploadMigrationWorker, uploadUpdate, uploadWorker, verifyInstallation, workerDatabase } from './deploy'

interface JobEnv { SESSION_KEY: string }
type Input = { botToken: string; username: string; password: string }
type Credentials = Input & { authSecret: string; webhookSecret: string }
type Phase = 'verify' | 'database' | 'database_pending' | 'migrations' | 'worker' | 'worker_pending' | 'domain' | 'health' | 'webhook' | 'commands' | 'done' | 'expired' | 'update_prepare' | 'update_migration_upload_pending' | 'update_migration_domain' | 'update_migration_apply' | 'update_migration_cleanup' | 'update_upload_pending' | 'update_deploy' | 'update_deploy_pending' | 'update_health'
type Job = { phase: Phase; name: string; bot: string; nonce: string; expiresAt: number; secrets: string; subdomain: string; artifactId: string; database?: string; telegramUser?: string; notice?: string; targetArtifactId?: string; previousVersion?: string; newVersion?: string; bookmark?: string; migrationWorker?: string; migrationName?: string }
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

async function migrationPassword(key: string, account: string, worker: string, artifact: string): Promise<string> {
  if (!/^[0-9a-f]{64}$/i.test(key)) throw new Error('Invalid session key')
  const secret = await crypto.subtle.importKey('raw', Uint8Array.from(key.match(/../g) ?? [], pair => parseInt(pair, 16)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const signature = await crypto.subtle.sign('HMAC', secret, encoder.encode(JSON.stringify([account, worker, artifact])))
  return Array.from(new Uint8Array(signature), byte => byte.toString(16).padStart(2, '0')).join('')
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
  return { phase: job.phase, name: job.name, bot: job.bot, verificationUrl: job.phase === 'verify' ? `https://t.me/${job.bot}?start=${job.nonce}` : undefined, appUrl: job.phase === 'done' ? `https://${job.name}.${job.subdomain}.workers.dev` : undefined, notice: job.notice, updateAvailable: job.phase === 'done' && job.artifactId !== artifactId, migrationWorker: job.phase === 'update_migration_upload_pending' ? job.migrationWorker : undefined }
}

export class InstallerJob extends DurableObject<JobEnv> {
  private active = false

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

  startUpdate(account: string) {
    if (this.ctx.id.name !== account) throw new Error('Invalid account')
    if (this.active) throw new Error('Installation is busy or missing')
    const job = this.read()
    if (!job || job.phase !== 'done' || !job.database || job.artifactId === artifactId) throw new Error('Update is not available')
    const updated = this.ctx.storage.sql.exec<{ id: number }>("UPDATE job SET value = ? WHERE id = 1 AND lock_id IS NULL AND json_extract(value, '$.phase') = 'done' RETURNING id", JSON.stringify({ ...job, phase: 'update_prepare', targetArtifactId: artifactId, previousVersion: undefined, newVersion: undefined, bookmark: undefined })).toArray()
    if (!updated.length) throw new Error('Installation is busy or missing')
    return view(this.read()!)
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
    const job: Job = { phase: 'verify', name: `rekap-${random(6)}`, bot: bot.username, nonce: random(16), subdomain, artifactId, expiresAt, secrets: await encrypt(this.env.SESSION_KEY, account, credentials) }
    await this.ctx.storage.setAlarm(expiresAt)
    const inserted = this.ctx.storage.sql.exec<{ id: number }>('INSERT OR IGNORE INTO job (id, value) VALUES (1, ?) RETURNING id', JSON.stringify(job)).toArray()
    if (!inserted.length) throw new Error('An installation already exists for this account')
    return view(job)
  }

  async step(account: string, token: string) {
    if (this.ctx.id.name !== account) throw new Error('Invalid account')
    if (this.active) throw new Error('Installation is busy or missing')
    const lock = random(16)
    const acquired = this.ctx.storage.sql.exec<{ value: string }>('UPDATE job SET lock_id = ?, lock_until = ? WHERE id = 1 AND lock_until < ? RETURNING value', lock, Date.now() + 10 * 60_000, Date.now()).toArray()
    if (!acquired.length) throw new Error('Installation is busy or missing')
    this.active = true
    try {
      const job = JSON.parse(acquired[0].value) as Job
      if (job.phase === 'done' || job.phase === 'expired') return view(job)
      if (job.phase.startsWith('update_')) {
        if (!job.database || job.targetArtifactId !== artifactId) throw new Error('Installer version changed during update')
        if (job.phase === 'update_prepare') {
          const previous = await activeVersion(account, token, job.name)
          if (job.previousVersion && previous !== job.previousVersion) throw new Error('Worker deployment changed during update')
          let check: Awaited<ReturnType<typeof updatePreflight>>
          try {
            check = await updatePreflight(account, token, job.name, job.database, previous, true)
            if (check.pending.some(migration => !migration.autoUpdate)) throw new Error('Database migrations require a manual update')
          } catch (error) {
            if (!job.previousVersion && error instanceof Error && error.message === 'Database migrations require a manual update') {
              job.phase = 'done'
              job.targetArtifactId = undefined
              this.write(job)
            }
            throw error
          }
          job.previousVersion = previous
          job.bookmark ??= check.bookmark
          if (check.pending.length) {
            const migration = check.pending[0]
            job.migrationWorker = `rekap-migrate-${random(8)}`
            job.migrationName = migration.path
            if (await workerDatabase(account, token, job.migrationWorker) !== null) throw new Error('Worker name is already in use')
            job.phase = 'update_migration_upload_pending'
            this.write(job)
            const password = await migrationPassword(this.env.SESSION_KEY, account, job.migrationWorker, artifactId)
            await uploadMigrationWorker(account, token, job.migrationWorker, job.database, migration, password)
            job.phase = 'update_migration_domain'
            this.write(job)
            return view(job)
          }
          job.phase = 'update_upload_pending'
          this.write(job)
          job.newVersion = await uploadUpdate(account, token, job.name, previous, check.bindings)
          job.phase = 'update_deploy'
          this.write(job)
        } else if (job.phase === 'update_migration_domain' && job.migrationWorker) {
          if (await workerDatabase(account, token, job.migrationWorker) !== job.database) throw new Error('Worker database binding does not match')
          await enableSubdomain(account, token, job.migrationWorker)
          job.phase = 'update_migration_apply'
          this.write(job)
        } else if (job.phase === 'update_migration_apply' && job.migrationWorker && job.migrationName && job.previousVersion) {
          if (await activeVersion(account, token, job.name) !== job.previousVersion) throw new Error('Worker deployment changed during update')
          if (await workerDatabase(account, token, job.migrationWorker) !== job.database) throw new Error('Worker database binding does not match')
          let check = await updatePreflight(account, token, job.name, job.database, job.previousVersion, true)
          if (check.pending.some(migration => migration.path === job.migrationName)) {
            if (check.pending[0].path !== job.migrationName || !check.pending[0].autoUpdate) throw new Error('Database migrations require a manual update')
            const password = await migrationPassword(this.env.SESSION_KEY, account, job.migrationWorker, artifactId)
            await fetch(`https://${job.migrationWorker}.${job.subdomain}.workers.dev`, { method: 'POST', headers: { Authorization: password } }).catch(() => undefined)
            check = await updatePreflight(account, token, job.name, job.database, job.previousVersion, true)
            if (check.pending.some(migration => migration.path === job.migrationName)) throw new Error('Database migration did not complete')
          }
          job.phase = 'update_migration_cleanup'
          this.write(job)
        } else if (job.phase === 'update_migration_cleanup' && job.migrationWorker) {
          const database = await workerDatabase(account, token, job.migrationWorker)
          if (database !== null && database !== job.database) throw new Error('Worker database binding does not match')
          if (database !== null) await deleteMigrationWorker(account, token, job.migrationWorker)
          job.migrationWorker = undefined
          job.migrationName = undefined
          job.phase = 'update_prepare'
          this.write(job)
        } else if (job.phase === 'update_migration_upload_pending') {
          throw new Error('Migration Worker upload is unresolved; check Cloudflare before retrying')
        } else if (job.phase === 'update_deploy' && job.newVersion && job.previousVersion) {
          if (await activeVersion(account, token, job.name) !== job.previousVersion) throw new Error('Worker deployment changed during update')
          await updatePreflight(account, token, job.name, job.database, job.newVersion)
          job.phase = 'update_deploy_pending'
          this.write(job)
          await deployUpdate(account, token, job.name, job.newVersion)
          job.phase = 'update_health'
          this.write(job)
        } else if (job.phase === 'update_deploy_pending' && job.newVersion) {
          if (await activeVersion(account, token, job.name) !== job.newVersion) throw new Error('Worker deployment is unresolved; check Cloudflare before retrying')
          job.phase = 'update_health'
          this.write(job)
        } else if (job.phase === 'update_health' && job.newVersion) {
          if (await activeVersion(account, token, job.name) !== job.newVersion) throw new Error('Worker deployment changed during update')
          await updatePreflight(account, token, job.name, job.database, job.newVersion)
          const health = await fetch(`https://${job.name}.${job.subdomain}.workers.dev/api/auth/get-session`, { redirect: 'manual' })
          if (!health.ok) throw new Error('App is not ready yet')
          job.artifactId = job.targetArtifactId
          job.targetArtifactId = undefined
          job.phase = 'done'
          this.write(job)
        } else {
          throw new Error('Worker version upload is unresolved; check Cloudflare before retrying')
        }
        return view(job)
      }
      if (job.expiresAt <= Date.now()) {
        job.phase = 'expired'
        job.secrets = ''
        this.write(job)
        return view(job)
      }
      if (job.artifactId !== artifactId) throw new Error('Installer version changed during installation')
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
      this.active = false
      this.ctx.storage.sql.exec('UPDATE job SET lock_id = NULL, lock_until = 0 WHERE id = 1 AND lock_id = ?', lock)
    }
  }

  async alarm(): Promise<void> {
    const job = this.read()
    if (job && job.phase !== 'done' && !job.phase.startsWith('update_') && job.expiresAt <= Date.now()) {
      job.secrets = ''
      job.phase = 'expired'
      this.write(job)
    }
  }
}
