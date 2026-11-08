import { DurableObject } from 'cloudflare:workers'
import { InstallerJob } from './job'

export { InstallerJob }

interface InstallerEnv {
  SESSION: DurableObjectNamespace<InstallerSession>
  INSTALL: DurableObjectNamespace<InstallerJob>
  SESSION_KEY: string
  OAUTH_CLIENT_ID: string
  INSTALLER_ORIGIN: string
}

type Pending = { verifier: string; expiresAt: number }
type Session = { token: string; expiresAt: number; tokenExpiresAt: number }
type Sealed = { iv: string; data: string }
type Account = { id: string; name: string }

const cookieName = '__Host-rekap-installer'
const pendingLifetime = 10 * 60 * 1000
const sessionLifetime = 30 * 60 * 1000
const scope = ['account-settings.read', 'd1.write', 'workers-scripts.write']
const encoder = new TextEncoder()

function random(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('')
}

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

async function digest(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)))
}

function origin(env: InstallerEnv): string {
  const url = new URL(env.INSTALLER_ORIGIN)
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Invalid installer origin')
  if (!/^[0-9a-f]{64}$/i.test(env.SESSION_KEY) || !env.OAUTH_CLIENT_ID) throw new Error('Missing installer configuration')
  return url.origin
}

async function key(env: InstallerEnv): Promise<CryptoKey> {
  const bytes = Uint8Array.from(env.SESSION_KEY.match(/../g) ?? [], value => parseInt(value, 16))
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

async function seal(env: InstallerEnv, id: string, value: Pending | Session): Promise<Sealed> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(id) }, await key(env), encoder.encode(JSON.stringify(value)))
  return { iv: base64url(iv), data: base64url(new Uint8Array(data)) }
}

async function unseal<T>(env: InstallerEnv, id: string, value: Sealed): Promise<T> {
  const decode = (input: string) => Uint8Array.from(atob(input.replaceAll('-', '+').replaceAll('_', '/')), char => char.charCodeAt(0))
  const data = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(value.iv), additionalData: encoder.encode(id) }, await key(env), decode(value.data))
  return JSON.parse(new TextDecoder().decode(data)) as T
}

function sessionId(request: Request): string | null {
  const matches = [...(request.headers.get('cookie') ?? '').matchAll(/(?:^|;\s*)__Host-rekap-installer=([0-9a-f]{64})(?=;|$)/g)]
  return matches.length === 1 ? matches[0][1] : null
}

function cookie(id: string, maxAge: number): string {
  return `${cookieName}=${id}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`
}

function response(body: unknown, status = 200, headers?: HeadersInit): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "frame-ancestors 'none'; default-src 'none'", ...headers } })
}

export class InstallerSession extends DurableObject<InstallerEnv> {
  constructor(ctx: DurableObjectState, env: InstallerEnv) {
    super(ctx, env)
    this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS session (kind TEXT PRIMARY KEY, state_hash TEXT, value TEXT NOT NULL, expires_at INTEGER NOT NULL)')
    this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS telegram_checks (id INTEGER PRIMARY KEY, next_at INTEGER NOT NULL)')
  }

  async save(kind: 'pending' | 'authorized', value: Sealed, expiresAt: number, stateHash = ''): Promise<void> {
    this.ctx.storage.sql.exec('INSERT INTO session (kind, state_hash, value, expires_at) VALUES (?, ?, ?, ?)', kind, stateHash, JSON.stringify(value), expiresAt)
    await this.ctx.storage.setAlarm(expiresAt)
  }

  takePending(stateHash: string): Sealed | null {
    const rows = this.ctx.storage.sql.exec<{ value: string }>("DELETE FROM session WHERE kind = 'pending' AND state_hash = ? AND expires_at > ? RETURNING value", stateHash, Date.now()).toArray()
    return rows.length ? JSON.parse(rows[0].value) as Sealed : null
  }

  getAuthorized(includeExpired = false): Sealed | null {
    const rows = this.ctx.storage.sql.exec<{ value: string }>("SELECT value FROM session WHERE kind = 'authorized' AND (expires_at > ? OR ?)", Date.now(), includeExpired ? 1 : 0).toArray()
    return rows.length ? JSON.parse(rows[0].value) as Sealed : null
  }

  allowTelegramCheck(): boolean {
    const now = Date.now()
    const rows = this.ctx.storage.sql.exec<{ id: number }>('INSERT INTO telegram_checks (id, next_at) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET next_at = excluded.next_at WHERE next_at <= ? RETURNING id', now + 5000, now).toArray()
    return rows.length === 1
  }

  async clear(): Promise<void> {
    this.ctx.storage.sql.exec('DELETE FROM session')
    this.ctx.storage.sql.exec('DELETE FROM telegram_checks')
    await this.ctx.storage.deleteAlarm()
  }

  async alarm(): Promise<void> {
    const rows = this.ctx.storage.sql.exec<{ value: string }>("SELECT value FROM session WHERE kind = 'authorized'").toArray()
    if (rows.length) {
      const id = this.ctx.id.name
      if (!id) throw new Error('Session identity unavailable')
      const session = await unseal<Session>(this.env, id, JSON.parse(rows[0].value) as Sealed)
      if (session.tokenExpiresAt > Date.now()) {
        try {
          await revoke(this.env, session.token)
        } catch {
          await this.ctx.storage.setAlarm(Math.min(session.tokenExpiresAt, Date.now() + 60_000))
          return
        }
      }
    }
    this.ctx.storage.sql.exec('DELETE FROM session')
    this.ctx.storage.sql.exec('DELETE FROM telegram_checks')
  }
}

function stub(env: InstallerEnv, id: string) {
  return env.SESSION.getByName(id)
}

async function authorized(request: Request, env: InstallerEnv, includeExpired = false): Promise<Session | null> {
  const id = sessionId(request)
  if (!id) return null
  const encrypted = await stub(env, id).getAuthorized(includeExpired)
  return encrypted ? unseal<Session>(env, id, encrypted) : null
}

async function revoke(env: InstallerEnv, token: string): Promise<void> {
  const result = await fetch('https://dash.cloudflare.com/oauth2/revoke', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.OAUTH_CLIENT_ID, token }),
  })
  if (!result.ok) throw new Error('Cloudflare revocation failed')
}

async function listAccounts(token: string): Promise<Account[]> {
  const accounts: Account[] = []
  for (let page = 1; page <= 20; page++) {
    const result = await fetch(`https://api.cloudflare.com/client/v4/accounts?per_page=50&page=${page}`, { headers: { Authorization: `Bearer ${token}` } })
    const data = await result.json() as { success?: boolean; result?: Account[] }
    if (!result.ok || !data.success || !Array.isArray(data.result)) throw new Error('Could not load accounts')
    accounts.push(...data.result.map(({ id, name }) => ({ id, name })))
    if (data.result.length < 50) return accounts
  }
  throw new Error('Too many accounts to list')
}

async function databaseExists(baseUrl: string, headers: HeadersInit): Promise<boolean> {
  for (let page = 1; page <= 20; page++) {
    const result = await fetch(`${baseUrl}/d1/database?name=rekap&per_page=100&page=${page}`, { headers })
    const data = await result.json() as { success?: boolean; result?: { name?: string }[] }
    if (!result.ok || !data.success || !Array.isArray(data.result)) throw new Error('Could not check databases')
    if (data.result.some(database => database.name === 'rekap')) return true
    if (data.result.length < 100) return false
  }
  throw new Error('Could not check all databases')
}

async function readJson(request: Request): Promise<unknown> {
  if (request.headers.get('content-type') !== 'application/json' || !request.body) throw new Error('Invalid request')
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > 8192) {
      await reader.cancel()
      throw new Error('Request too large')
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown
}

export default {
  async fetch(request: Request, env: InstallerEnv): Promise<Response> {
    try {
      const base = origin(env)
      const url = new URL(request.url)
      if (url.origin !== base) return response({ error: 'Invalid origin' }, 400)
      if (request.method === 'POST' && request.headers.get('origin') !== base) return response({ error: 'Invalid origin' }, 403)

      if (request.method === 'POST' && url.pathname === '/api/oauth/start') {
        const previous = sessionId(request)
        if (previous) {
          const session = await authorized(request, env, true)
          if (session) await revoke(env, session.token)
          await stub(env, previous).clear()
        }
        const id = random()
        const state = random()
        const verifier = random()
        const expiresAt = Date.now() + pendingLifetime
        await stub(env, id).save('pending', await seal(env, id, { verifier, expiresAt }), expiresAt, base64url(await digest(state)))
        const target = new URL('https://dash.cloudflare.com/oauth2/auth')
        target.search = new URLSearchParams({ client_id: env.OAUTH_CLIENT_ID, redirect_uri: `${base}/api/oauth/callback`, response_type: 'code', scope: scope.join(' '), state, code_challenge: base64url(await digest(verifier)), code_challenge_method: 'S256' }).toString()
        return response({ url: target.toString() }, 200, { 'Set-Cookie': cookie(id, pendingLifetime / 1000) })
      }

      if (request.method === 'GET' && url.pathname === '/api/oauth/callback') {
        const id = sessionId(request)
        const state = url.searchParams.get('state')
        const code = url.searchParams.get('code')
        if (!id || !state || !/^[0-9a-f]{64}$/.test(state)) return response({ error: 'Invalid authorization' }, 400)
        const encrypted = await stub(env, id).takePending(base64url(await digest(state)))
        if (!encrypted) return response({ error: 'Expired or invalid authorization' }, 400)
        await stub(env, id).clear()
        if (!code) return response({ error: 'Authorization cancelled' }, 400, { 'Set-Cookie': cookie('', 0) })
        const pending = await unseal<Pending>(env, id, encrypted)
        if (pending.expiresAt <= Date.now()) return response({ error: 'Authorization expired' }, 400, { 'Set-Cookie': cookie('', 0) })
        const result = await fetch('https://dash.cloudflare.com/oauth2/token', {
          method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ grant_type: 'authorization_code', client_id: env.OAUTH_CLIENT_ID, redirect_uri: `${base}/api/oauth/callback`, code, code_verifier: pending.verifier }),
        })
        const data = await result.json() as { access_token?: string; token_type?: string; expires_in?: number; scope?: string }
        if (!result.ok || !data.access_token || data.token_type?.toLowerCase() !== 'bearer' || !Number.isFinite(data.expires_in) || (data.expires_in ?? 0) <= 0 || !scope.every(item => data.scope?.split(' ').includes(item))) {
          if (data.access_token) await revoke(env, data.access_token)
          return response({ error: 'Cloudflare authorization failed' }, 502, { 'Set-Cookie': cookie('', 0) })
        }
        const next = random()
        const tokenExpiresAt = Date.now() + (data.expires_in ?? 0) * 1000
        const expiresAt = Math.min(Date.now() + sessionLifetime, tokenExpiresAt)
        try {
          await stub(env, next).save('authorized', await seal(env, next, { token: data.access_token, expiresAt, tokenExpiresAt }), expiresAt)
        } catch (error) {
          await revoke(env, data.access_token)
          throw error
        }
        return response({ authenticated: true }, 303, { Location: '/', 'Set-Cookie': cookie(next, Math.floor((expiresAt - Date.now()) / 1000)) })
      }

      if (request.method === 'GET' && url.pathname === '/api/session') {
        const session = await authorized(request, env)
        if (!session || session.expiresAt <= Date.now()) return response({ error: 'Not authorized' }, 401)
        try {
          return response({ accounts: await listAccounts(session.token) })
        } catch {
          return response({ error: 'Could not load accounts' }, 502)
        }
      }

      if (request.method === 'POST' && url.pathname === '/api/preflight') {
        const session = await authorized(request, env)
        if (!session) return response({ error: 'Not authorized' }, 401)
        if (request.headers.get('content-type') !== 'application/json') return response({ error: 'Invalid request' }, 400)
        const body = await request.json() as { accountId?: unknown } | null
        if (!body || typeof body.accountId !== 'string' || !/^[a-f0-9]{32}$/.test(body.accountId)) return response({ error: 'Invalid account' }, 400)
        const account = (await listAccounts(session.token)).find(item => item.id === body.accountId)
        if (!account) return response({ error: 'Account not authorized' }, 403)
        const baseUrl = `https://api.cloudflare.com/client/v4/accounts/${account.id}`
        const headers = { Authorization: `Bearer ${session.token}` }
        const [workersResponse, hasDatabase, subdomainResponse] = await Promise.all([
          fetch(`${baseUrl}/workers/scripts`, { headers }),
          databaseExists(baseUrl, headers).catch(() => null),
          fetch(`${baseUrl}/workers/subdomain`, { headers }),
        ])
        const workers = await workersResponse.json() as { success?: boolean; result?: { id: string }[] }
        const subdomain = await subdomainResponse.json() as { success?: boolean; result?: { subdomain?: string } }
        if (!workersResponse.ok || !workers.success || !Array.isArray(workers.result) || hasDatabase === null || !subdomainResponse.ok || !subdomain.success || !subdomain.result?.subdomain) return response({ error: 'Could not check Cloudflare resources' }, 502)
        return response({ account, workerExists: workers.result.some(worker => worker.id === 'rekap'), databaseExists: hasDatabase, subdomain: subdomain.result.subdomain })
      }

      if (request.method === 'POST' && url.pathname === '/api/telegram/check') {
        const id = sessionId(request)
        const session = await authorized(request, env)
        if (!id || !session) return response({ error: 'Not authorized' }, 401)
        if (request.headers.get('content-type') !== 'application/json') return response({ error: 'Invalid request' }, 400)
        const body = await request.json() as { token?: unknown } | null
        if (!body || typeof body.token !== 'string' || !/^[0-9]{1,20}:[a-zA-Z0-9_-]{20,128}$/.test(body.token)) return response({ error: 'Invalid bot token' }, 400)
        if (!await stub(env, id).allowTelegramCheck()) return response({ error: 'Try again later' }, 429)
        const botUrl = `https://api.telegram.org/bot${body.token}`
        const [botResponse, webhookResponse] = await Promise.all([fetch(`${botUrl}/getMe`), fetch(`${botUrl}/getWebhookInfo`)])
        const bot = await botResponse.json() as { ok?: boolean; result?: { is_bot?: boolean; username?: string; can_join_groups?: boolean; can_read_all_group_messages?: boolean } }
        const webhook = await webhookResponse.json() as { ok?: boolean; result?: { url?: string } }
        if (!botResponse.ok || !bot.ok || !bot.result?.is_bot || !bot.result.username || !webhookResponse.ok || !webhook.ok || typeof webhook.result?.url !== 'string') return response({ error: 'Could not verify Telegram bot' }, 502)
        return response({ username: bot.result.username, canJoinGroups: bot.result.can_join_groups === true, canReadGroupMessages: bot.result.can_read_all_group_messages === true, hasWebhook: webhook.result.url.length > 0 })
      }

      if (request.method === 'POST' && ['/api/install/start', '/api/install/status', '/api/install/step', '/api/install/reset', '/api/install/update', '/api/install/update/cancel', '/api/install/update/retry'].includes(url.pathname)) {
        const session = await authorized(request, env)
        if (!session) return response({ error: 'Not authorized' }, 401)
        let body: { accountId?: unknown; botToken?: unknown; username?: unknown; password?: unknown; target?: unknown } | null
        try {
          body = await readJson(request) as typeof body
        } catch {
          return response({ error: 'Invalid request' }, 400)
        }
        if (!body || typeof body.accountId !== 'string' || !/^[a-f0-9]{32}$/.test(body.accountId)) return response({ error: 'Invalid account' }, 400)
        if (!(await listAccounts(session.token)).some(account => account.id === body?.accountId)) return response({ error: 'Account not authorized' }, 403)
        const job = env.INSTALL.getByName(body.accountId)
        try {
          if (url.pathname === '/api/install/status') return response({ installation: await job.status() })
          if (url.pathname === '/api/install/step') return response({ installation: await job.step(body.accountId, session.token) })
          if (url.pathname === '/api/install/update') return response({ installation: await job.startUpdate(body.accountId) })
          if (url.pathname === '/api/install/update/cancel') return response({ installation: await job.cancelUpdate(body.accountId, session.token) })
          if (url.pathname === '/api/install/update/retry') {
            if (body.target !== 'migration' && body.target !== 'version') return response({ error: 'Invalid request' }, 400)
            return response({ installation: await job.retryUpdate(body.accountId, session.token, body.target) })
          }
          if (url.pathname === '/api/install/reset') {
            await job.resetExpired()
            return response({ installation: null })
          }
          if (typeof body.botToken !== 'string' || !/^[0-9]{1,20}:[a-zA-Z0-9_-]{20,128}$/.test(body.botToken) || typeof body.username !== 'string' || !/^[a-zA-Z0-9_.]{3,30}$/.test(body.username) || typeof body.password !== 'string' || body.password.length < 12 || body.password.length > 128) return response({ error: 'Invalid installation details' }, 400)
          return response({ installation: await job.start(body.accountId, session.token, { botToken: body.botToken, username: body.username, password: body.password }) })
        } catch (error) {
          const message = error instanceof Error ? error.message : ''
          const known = ['An installation already exists for this account', 'Bot cannot be used', 'Bot already has a webhook', 'No valid workers.dev subdomain', 'Installation is busy or missing', 'Installation is busy or not expired', 'Installer version changed during installation', 'Database name is already in use', 'Database creation is unresolved; check Cloudflare before retrying', 'Worker name is already in use', 'Worker upload is unresolved; check Cloudflare before retrying', 'App is not ready yet', 'Bot webhook changed during installation', 'Update is not available', 'Installer version changed during update', 'Worker deployment is not a single version', 'Worker bindings are unavailable', 'Worker database binding does not match', 'Worker secrets are missing', 'Worker bindings are not supported', 'Database migrations require a manual update', 'Database migration did not complete', 'Migration Worker upload is unresolved; check Cloudflare before retrying', 'Owner setup is incomplete', 'Database bookmark is unavailable', 'Worker deployment changed during update', 'Worker version upload is unresolved; check Cloudflare before retrying', 'Worker deployment is unresolved; check Cloudflare before retrying', 'Update is blocked; check Cloudflare before retrying', 'Worker subdomain route is not active yet', 'Worker subdomain route is still active', 'Could not check Worker subdomain', 'Update cannot be cancelled', 'Update cannot be retried']
          return response({ error: known.includes(message) ? message : 'Installation step failed' }, 502)
        }
      }

      if (request.method === 'POST' && url.pathname === '/api/oauth/logout') {
        const id = sessionId(request)
        const session = await authorized(request, env, true)
        if (session) await revoke(env, session.token)
        if (id) await stub(env, id).clear()
        return response({ authenticated: false }, 200, { 'Set-Cookie': cookie('', 0) })
      }

      return response({ error: 'Not found' }, 404)
    } catch {
      return response({ error: 'Installer request failed' }, 500)
    }
  },
}
