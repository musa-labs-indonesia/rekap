import { DurableObject } from 'cloudflare:workers'
import { activeVersion, applyMigrations, artifactId, createDatabase, deployUpdate, findDatabase, findVersionByTag, getSubdomain, migrationByPath, migrationWorkerState, setSubdomain, updatePreflight, uploadMigrationWorker, uploadUpdate, uploadWorker, verifyInstallation, workerDatabase, workerSubdomainEnabled } from './deploy'

interface JobEnv { SESSION_KEY: string }
type Input = { botToken: string; username: string; password: string }
type Credentials = Input & { authSecret: string; webhookSecret: string }
type Phase = 'verify' | 'database' | 'database_pending' | 'migrations' | 'worker' | 'worker_pending' | 'domain' | 'health' | 'webhook' | 'commands' | 'done' | 'expired' | 'update_prepare' | 'update_migration_upload_pending' | 'update_migration_domain' | 'update_migration_apply' | 'update_migration_cleanup' | 'update_upload_pending' | 'update_deploy' | 'update_deploy_pending' | 'update_health' | 'update_blocked'
type Job = { phase: Phase; name: string; bot: string; nonce: string; expiresAt: number; secrets: string; subdomain: string; artifactId: string; database?: string; telegramUser?: string; notice?: string; targetArtifactId?: string; previousVersion?: string; newVersion?: string; bookmark?: string; updateTag?: string; updateUploadUncertain?: boolean; migrationWorker?: string; migrationName?: string; migrationUploadUncertain?: boolean; migrationRouteAttempted?: boolean; migrationOrphans?: string[]; updateOrphanTags?: string[]; databaseChanged?: boolean; blockedFrom?: Phase; blockedReason?: string }
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

async function signature(key: string, value: unknown[]): Promise<string> {
  if (!/^[0-9a-f]{64}$/i.test(key)) throw new Error('Invalid session key')
  const secret = await crypto.subtle.importKey('raw', Uint8Array.from(key.match(/../g) ?? [], pair => parseInt(pair, 16)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const signed = await crypto.subtle.sign('HMAC', secret, encoder.encode(JSON.stringify(value)))
  return Array.from(new Uint8Array(signed), byte => byte.toString(16).padStart(2, '0')).join('')
}

async function migrationPassword(key: string, account: string, worker: string, artifact: string): Promise<string> {
  return signature(key, [account, worker, artifact])
}

async function migrationOwnership(key: string, account: string, worker: string, artifact: string, database: string, migration: string): Promise<string> {
  return signature(key, ['migration-owner', account, worker, artifact, database, migration])
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

const cancellable = new Set<Phase>(['update_prepare', 'update_migration_upload_pending', 'update_migration_domain', 'update_upload_pending', 'update_deploy'])

function retryTarget(phase: Phase | undefined, reason: string | undefined): 'migration' | 'version' | undefined {
  if ((phase === 'update_migration_upload_pending' || phase === 'update_migration_domain' || phase === 'update_migration_apply') && ['migration_worker_missing', 'migration_worker_unverified', 'migration_worker_route_disabled', 'migration_worker_route_unknown', 'migration_worker_route_unreachable', 'migration_route_enable_failed', 'migration_route_enable_unresolved'].includes(reason ?? '')) return 'migration'
  if (phase === 'update_upload_pending' && (reason === 'worker_version_missing' || reason === 'worker_version_ambiguous')) return 'version'
  return undefined
}

function httpStatus(error: unknown): number {
  return error instanceof Error ? Number(error.message.match(/^Cloudflare request failed \((\d+)\)$/)?.[1] ?? 0) : 0
}

function refused(status: number): boolean {
  return status >= 400 && status < 500 && status !== 408 && status !== 429
}

async function waitForRoute(url: string, open: boolean): Promise<boolean> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const result = await fetch(url, { method: 'GET' }).catch(() => null)
    if (open ? result?.status === 405 : result?.status === 404) return true
    if (attempt < 9) await new Promise(resolve => setTimeout(resolve, 1000))
  }
  return false
}

function remember(list: string[] | undefined, value: string): string[] {
  return [...new Set([...(list ?? []), value])]
}

function view(job: Job) {
  const blocked = job.phase === 'update_blocked'
  const migration = job.phase.startsWith('update_migration_') || blocked
  return {
    phase: job.phase, name: job.name, bot: job.bot,
    verificationUrl: job.phase === 'verify' ? `https://t.me/${job.bot}?start=${job.nonce}` : undefined,
    appUrl: job.phase === 'done' ? `https://${job.name}.${job.subdomain}.workers.dev` : undefined,
    notice: job.notice,
    updateAvailable: job.phase === 'done' && job.artifactId !== artifactId,
    migrationWorker: migration ? job.migrationWorker : undefined,
    migrationWorkerUrl: migration && job.migrationWorker ? `https://${job.migrationWorker}.${job.subdomain}.workers.dev` : undefined,
    orphanWorkers: job.migrationOrphans,
    orphanVersionTags: job.updateOrphanTags,
    blocked: blocked ? {
      from: job.blockedFrom, reason: job.blockedReason,
      canCancel: !job.databaseChanged && job.blockedFrom !== undefined && cancellable.has(job.blockedFrom),
      canRetry: retryTarget(job.blockedFrom, job.blockedReason),
      databaseChanged: job.databaseChanged === true,
      database: job.database, previousVersion: job.previousVersion, newVersion: job.newVersion,
    } : undefined,
  }
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

  private block(job: Job, from: Phase, reason: string): never {
    job.phase = 'update_blocked'
    job.blockedFrom = from
    job.blockedReason = reason
    this.write(job)
    throw new Error('Update is blocked; check Cloudflare before retrying')
  }

  private ownership(account: string, job: Job): Promise<string> {
    if (!job.migrationWorker || !job.migrationName || !job.database) throw new Error('Update is blocked; check Cloudflare before retrying')
    return migrationOwnership(this.env.SESSION_KEY, account, job.migrationWorker, artifactId, job.database, job.migrationName)
  }

  private async freeMigrationWorker(account: string, token: string): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const name = `rekap-migrate-${random(8)}`
      if (await workerDatabase(account, token, name) === null) return name
    }
    throw new Error('Worker name is already in use')
  }

  private async currentVersion(account: string, token: string, job: Job, from: Phase): Promise<string> {
    try {
      return await activeVersion(account, token, job.name)
    } catch (error) {
      if (error instanceof Error && error.message === 'Worker deployment is not a single version') this.block(job, from, 'worker_deployment_changed')
      throw error
    }
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
    const updated = this.ctx.storage.sql.exec<{ id: number }>("UPDATE job SET value = ? WHERE id = 1 AND lock_id IS NULL AND json_extract(value, '$.phase') = 'done' RETURNING id", JSON.stringify({ ...job, phase: 'update_prepare', targetArtifactId: artifactId, previousVersion: undefined, newVersion: undefined, bookmark: undefined, updateTag: undefined, updateUploadUncertain: undefined, migrationWorker: undefined, migrationName: undefined, migrationUploadUncertain: undefined, migrationRouteAttempted: undefined, databaseChanged: undefined, blockedFrom: undefined, blockedReason: undefined })).toArray()
    if (!updated.length) throw new Error('Installation is busy or missing')
    return view(this.read()!)
  }

  async cancelUpdate(account: string, token: string) {
    if (this.ctx.id.name !== account) throw new Error('Invalid account')
    if (this.active) throw new Error('Installation is busy or missing')
    const job = this.read()
    if (!job || job.phase !== 'update_blocked' || !job.blockedFrom || !cancellable.has(job.blockedFrom) || job.databaseChanged) throw new Error('Update cannot be cancelled')
    if (job.previousVersion) {
      let current: string
      try {
        current = await activeVersion(account, token, job.name)
      } catch {
        throw new Error('Update cannot be cancelled')
      }
      if (current !== job.previousVersion) throw new Error('Update cannot be cancelled')
    }
    const updated = this.ctx.storage.sql.exec<{ id: number }>("UPDATE job SET value = ? WHERE id = 1 AND lock_id IS NULL AND json_extract(value, '$.phase') = 'update_blocked' RETURNING id", JSON.stringify({ ...job, phase: 'done', targetArtifactId: undefined, previousVersion: undefined, newVersion: undefined, bookmark: undefined, updateTag: undefined, updateUploadUncertain: undefined, migrationWorker: undefined, migrationName: undefined, migrationUploadUncertain: undefined, migrationRouteAttempted: undefined, databaseChanged: undefined, blockedFrom: undefined, blockedReason: undefined, migrationOrphans: job.migrationWorker ? remember(job.migrationOrphans, job.migrationWorker) : job.migrationOrphans, updateOrphanTags: job.updateTag ? remember(job.updateOrphanTags, job.updateTag) : job.updateOrphanTags })).toArray()
    if (!updated.length) throw new Error('Installation is busy or missing')
    return view(this.read()!)
  }

  async retryUpdate(account: string, token: string, target: 'migration' | 'version') {
    if (this.ctx.id.name !== account) throw new Error('Invalid account')
    if (this.active) throw new Error('Installation is busy or missing')
    const job = this.read()
    if (!job || job.phase !== 'update_blocked' || retryTarget(job.blockedFrom, job.blockedReason) !== target) throw new Error('Update cannot be retried')
    let next: Job
    if (target === 'migration') {
      const name = await this.freeMigrationWorker(account, token)
      next = { ...job, phase: 'update_migration_upload_pending', migrationWorker: name, migrationUploadUncertain: undefined, migrationRouteAttempted: undefined, migrationOrphans: job.migrationWorker ? remember(job.migrationOrphans, job.migrationWorker) : job.migrationOrphans, newVersion: undefined, blockedFrom: undefined, blockedReason: undefined }
    } else {
      next = { ...job, phase: 'update_upload_pending', updateTag: `rekap-update-${random(16)}`, updateUploadUncertain: undefined, updateOrphanTags: job.updateTag ? remember(job.updateOrphanTags, job.updateTag) : job.updateOrphanTags, newVersion: undefined, blockedFrom: undefined, blockedReason: undefined }
    }
    const updated = this.ctx.storage.sql.exec<{ id: number }>("UPDATE job SET value = ? WHERE id = 1 AND lock_id IS NULL AND json_extract(value, '$.phase') = 'update_blocked' RETURNING id", JSON.stringify(next)).toArray()
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
        if (job.phase === 'update_blocked') {
          if (!job.blockedFrom) throw new Error('Update is blocked; check Cloudflare before retrying')
          job.phase = job.blockedFrom
          job.blockedFrom = undefined
          job.blockedReason = undefined
          this.write(job)
        }
        if (job.phase === 'update_prepare') {
          const previous = await activeVersion(account, token, job.name)
          if (job.previousVersion && previous !== job.previousVersion) this.block(job, 'update_prepare', 'worker_deployment_changed')
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
            job.migrationWorker = await this.freeMigrationWorker(account, token)
            job.migrationName = migration.path
            job.migrationUploadUncertain = true
            job.migrationRouteAttempted = undefined
            job.phase = 'update_migration_upload_pending'
            this.write(job)
            const password = await migrationPassword(this.env.SESSION_KEY, account, job.migrationWorker, artifactId)
            try {
              await uploadMigrationWorker(account, token, job.migrationWorker, job.database, migration, password, await this.ownership(account, job))
            } catch {
              throw new Error('Migration Worker upload is unresolved; check Cloudflare before retrying')
            }
            job.migrationUploadUncertain = undefined
            job.phase = 'update_migration_domain'
            this.write(job)
            return view(job)
          }
          job.updateTag = `rekap-update-${random(16)}`
          job.updateUploadUncertain = true
          job.phase = 'update_upload_pending'
          this.write(job)
          try {
            job.newVersion = await uploadUpdate(account, token, job.name, previous, check.bindings, job.updateTag)
          } catch (error) {
            if (error instanceof Error && error.message === 'Worker deployment changed during update') throw error
            throw new Error('Worker version upload is unresolved; check Cloudflare before retrying')
          }
          job.updateUploadUncertain = undefined
          job.phase = 'update_deploy'
          this.write(job)
        } else if (job.phase === 'update_migration_upload_pending') {
          if (!job.migrationWorker || !job.migrationName) this.block(job, job.phase, 'migration_worker_unknown')
          const migration = migrationByPath(job.migrationName)
          if (!migration || !migration.autoUpdate) this.block(job, job.phase, 'migration_worker_unknown')
          if (!job.previousVersion) this.block(job, job.phase, 'worker_deployment_changed')
          if (await this.currentVersion(account, token, job, job.phase) !== job.previousVersion) this.block(job, job.phase, 'worker_deployment_changed')
          const state = await migrationWorkerState(account, token, job.migrationWorker, job.database, await this.ownership(account, job))
          if (state === 'unverified') this.block(job, job.phase, 'migration_worker_unverified')
          if (state === 'owned') {
            job.migrationUploadUncertain = undefined
            job.phase = 'update_migration_domain'
            this.write(job)
          } else if (job.migrationUploadUncertain) {
            this.block(job, job.phase, 'migration_worker_missing')
          } else {
            const check = await updatePreflight(account, token, job.name, job.database, job.previousVersion, true)
            const next = check.pending[0]
            if (!next || next.path !== job.migrationName || !next.autoUpdate) this.block(job, job.phase, 'migration_worker_unknown')
            job.migrationUploadUncertain = true
            this.write(job)
            const password = await migrationPassword(this.env.SESSION_KEY, account, job.migrationWorker, artifactId)
            try {
              await uploadMigrationWorker(account, token, job.migrationWorker, job.database, migration, password, await this.ownership(account, job))
            } catch {
              throw new Error('Migration Worker upload is unresolved; check Cloudflare before retrying')
            }
            job.migrationUploadUncertain = undefined
            job.phase = 'update_migration_domain'
            this.write(job)
          }
        } else if (job.phase === 'update_migration_domain') {
          if (!job.migrationWorker || !job.migrationName) this.block(job, job.phase, 'migration_worker_unknown')
          if (!job.previousVersion) this.block(job, job.phase, 'worker_deployment_changed')
          if (await this.currentVersion(account, token, job, job.phase) !== job.previousVersion) this.block(job, job.phase, 'worker_deployment_changed')
          let state = await migrationWorkerState(account, token, job.migrationWorker, job.database, await this.ownership(account, job))
          if (state === 'unverified') this.block(job, job.phase, 'migration_worker_unverified')
          if (state === 'missing') this.block(job, job.phase, 'migration_worker_missing')
          const route = await workerSubdomainEnabled(account, token, job.migrationWorker)
          if (route === null) this.block(job, job.phase, 'migration_worker_route_unknown')
          if (route) {
            if (!(await waitForRoute(`https://${job.migrationWorker}.${job.subdomain}.workers.dev`, true))) this.block(job, job.phase, 'migration_worker_route_unreachable')
            job.migrationRouteAttempted = undefined
            job.phase = 'update_migration_apply'
            this.write(job)
          } else {
            if (job.migrationRouteAttempted) this.block(job, job.phase, 'migration_route_enable_unresolved')
            state = await migrationWorkerState(account, token, job.migrationWorker, job.database, await this.ownership(account, job))
            if (state === 'unverified') this.block(job, job.phase, 'migration_worker_unverified')
            if (state === 'missing') this.block(job, job.phase, 'migration_worker_missing')
            job.migrationRouteAttempted = true
            this.write(job)
            let accepted: boolean | undefined
            try {
              accepted = await setSubdomain(account, token, job.migrationWorker, true)
            } catch (error) {
              if (refused(httpStatus(error))) {
                job.migrationRouteAttempted = undefined
                this.block(job, job.phase, 'migration_route_enable_failed')
              }
              throw error
            }
            const enabled = accepted ?? await workerSubdomainEnabled(account, token, job.migrationWorker)
            if (enabled === null) this.block(job, job.phase, 'migration_worker_route_unknown')
            if (!enabled) throw new Error('Worker subdomain route is not active yet')
            if (!(await waitForRoute(`https://${job.migrationWorker}.${job.subdomain}.workers.dev`, true))) this.block(job, job.phase, 'migration_worker_route_unreachable')
            job.migrationRouteAttempted = undefined
            job.phase = 'update_migration_apply'
            this.write(job)
          }
        } else if (job.phase === 'update_migration_apply' && job.migrationWorker && job.migrationName && job.previousVersion) {
          if (await this.currentVersion(account, token, job, job.phase) !== job.previousVersion) this.block(job, job.phase, 'worker_deployment_changed')
          let check = await updatePreflight(account, token, job.name, job.database, job.previousVersion, true)
          if (check.pending.some(migration => migration.path === job.migrationName)) {
            if (check.pending[0].path !== job.migrationName || !check.pending[0].autoUpdate) throw new Error('Database migrations require a manual update')
            let state = await migrationWorkerState(account, token, job.migrationWorker, job.database, await this.ownership(account, job))
            if (state === 'unverified') this.block(job, job.phase, 'migration_worker_unverified')
            if (state === 'missing') this.block(job, job.phase, 'migration_worker_missing')
            const route = await workerSubdomainEnabled(account, token, job.migrationWorker)
            if (route === null) this.block(job, job.phase, 'migration_worker_route_unknown')
            if (!route) this.block(job, job.phase, 'migration_worker_route_disabled')
            state = await migrationWorkerState(account, token, job.migrationWorker, job.database, await this.ownership(account, job))
            if (state === 'unverified') this.block(job, job.phase, 'migration_worker_unverified')
            if (state === 'missing') this.block(job, job.phase, 'migration_worker_missing')
            const password = await migrationPassword(this.env.SESSION_KEY, account, job.migrationWorker, artifactId)
            const result = await fetch(`https://${job.migrationWorker}.${job.subdomain}.workers.dev`, { method: 'POST', headers: { Authorization: password } }).catch(() => null)
            if (result?.status === 403) this.block(job, job.phase, 'migration_worker_unverified')
            if (result?.status === 404) this.block(job, job.phase, 'migration_worker_route_disabled')
            check = await updatePreflight(account, token, job.name, job.database, job.previousVersion, true)
            if (check.pending.some(migration => migration.path === job.migrationName)) throw new Error('Database migration did not complete')
          }
          job.databaseChanged = true
          job.phase = 'update_migration_cleanup'
          this.write(job)
        } else if (job.phase === 'update_migration_cleanup' && job.migrationWorker) {
          if (!job.migrationName) this.block(job, job.phase, 'migration_worker_unknown')
          let state = await migrationWorkerState(account, token, job.migrationWorker, job.database, await this.ownership(account, job))
          if (state === 'unverified') this.block(job, job.phase, 'migration_worker_cleanup_unverified')
          if (state === 'owned') {
            const route = await workerSubdomainEnabled(account, token, job.migrationWorker)
            if (route === null) this.block(job, job.phase, 'migration_worker_route_unknown')
            if (!route) {
              if (!(await waitForRoute(`https://${job.migrationWorker}.${job.subdomain}.workers.dev`, false))) this.block(job, job.phase, 'migration_worker_route_close_unresolved')
              job.migrationOrphans = remember(job.migrationOrphans, job.migrationWorker)
            } else {
              state = await migrationWorkerState(account, token, job.migrationWorker, job.database, await this.ownership(account, job))
              if (state === 'unverified') this.block(job, job.phase, 'migration_worker_cleanup_unverified')
              if (state === 'owned') {
                let accepted: boolean | undefined
                try {
                  accepted = await setSubdomain(account, token, job.migrationWorker, false)
                } catch (error) {
                  if (refused(httpStatus(error))) this.block(job, job.phase, 'migration_route_disable_failed')
                  throw error
                }
                const enabled = accepted ?? await workerSubdomainEnabled(account, token, job.migrationWorker)
                if (enabled === null) this.block(job, job.phase, 'migration_worker_route_unknown')
                if (enabled) throw new Error('Worker subdomain route is still active')
                if (!(await waitForRoute(`https://${job.migrationWorker}.${job.subdomain}.workers.dev`, false))) this.block(job, job.phase, 'migration_worker_route_close_unresolved')
                job.migrationOrphans = remember(job.migrationOrphans, job.migrationWorker)
              }
            }
          }
          job.migrationWorker = undefined
          job.migrationName = undefined
          job.migrationUploadUncertain = undefined
          job.migrationRouteAttempted = undefined
          job.databaseChanged = true
          job.phase = 'update_prepare'
          this.write(job)
        } else if (job.phase === 'update_upload_pending') {
          if (!job.previousVersion || !job.updateTag) this.block(job, job.phase, 'worker_version_ambiguous')
          let existing: string | null
          try {
            existing = await findVersionByTag(account, token, job.name, job.updateTag)
          } catch (error) {
            if (error instanceof Error && ['More than one matching Worker version exists', 'Could not check all Worker versions', 'Could not check Worker versions'].includes(error.message)) this.block(job, job.phase, 'worker_version_ambiguous')
            throw error
          }
          if (existing) {
            job.newVersion = existing
            job.updateUploadUncertain = undefined
          } else {
            if (await this.currentVersion(account, token, job, job.phase) !== job.previousVersion) this.block(job, job.phase, 'worker_deployment_changed')
            if (job.updateUploadUncertain) this.block(job, job.phase, 'worker_version_missing')
            const check = await updatePreflight(account, token, job.name, job.database, job.previousVersion)
            job.updateUploadUncertain = true
            this.write(job)
            try {
              job.newVersion = await uploadUpdate(account, token, job.name, job.previousVersion, check.bindings, job.updateTag)
            } catch (error) {
              if (error instanceof Error && error.message === 'Worker deployment changed during update') throw error
              throw new Error('Worker version upload is unresolved; check Cloudflare before retrying')
            }
            job.updateUploadUncertain = undefined
          }
          job.phase = 'update_deploy'
          this.write(job)
        } else if (job.phase === 'update_deploy' && job.newVersion && job.previousVersion) {
          const current = await this.currentVersion(account, token, job, job.phase)
          if (current === job.newVersion) {
            job.phase = 'update_health'
            this.write(job)
          } else if (current === job.previousVersion) {
            await updatePreflight(account, token, job.name, job.database, job.newVersion)
            job.phase = 'update_deploy_pending'
            this.write(job)
            try {
              await deployUpdate(account, token, job.name, job.newVersion)
            } catch {
              throw new Error('Worker deployment is unresolved; check Cloudflare before retrying')
            }
            job.phase = 'update_health'
            this.write(job)
          } else {
            this.block(job, job.phase, 'worker_deployment_changed')
          }
        } else if (job.phase === 'update_deploy_pending' && job.newVersion && job.previousVersion) {
          const current = await this.currentVersion(account, token, job, job.phase)
          if (current === job.newVersion) {
            job.phase = 'update_health'
            this.write(job)
          } else if (current === job.previousVersion) {
            this.block(job, job.phase, 'worker_deployment_unresolved')
          } else {
            this.block(job, job.phase, 'worker_deployment_changed')
          }
        } else if (job.phase === 'update_health' && job.newVersion) {
          const current = await this.currentVersion(account, token, job, job.phase)
          if (current !== job.newVersion) this.block(job, job.phase, 'worker_deployment_changed')
          await updatePreflight(account, token, job.name, job.database, job.newVersion)
          const health = await fetch(`https://${job.name}.${job.subdomain}.workers.dev/api/auth/get-session`, { redirect: 'manual' })
          if (!health.ok) throw new Error('App is not ready yet')
          job.artifactId = job.targetArtifactId
          job.targetArtifactId = undefined
          job.updateTag = undefined
          job.updateUploadUncertain = undefined
          job.migrationUploadUncertain = undefined
          job.migrationRouteAttempted = undefined
          job.databaseChanged = undefined
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
        await setSubdomain(account, token, job.name, true)
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
          { command: 'help', description: 'Tampilkan panduan perintah' },
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
