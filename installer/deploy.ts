type FileEntry = { path: string; size: number; sha256: string; content: string; uploadHash?: string }
type Artifact = { mainModule: string; compatibilityDate: string; compatibilityFlags: string[]; bundle: FileEntry[]; assets: FileEntry[]; migrations: FileEntry[] }

declare const __REKAP_ARTIFACT__: Artifact

const artifact = __REKAP_ARTIFACT__
const decoder = new TextDecoder()

function bytes(content: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(content), character => character.charCodeAt(0))
}

function api(account: string, path: string): string {
  return `https://api.cloudflare.com/client/v4/accounts/${account}${path}`
}

async function request<T>(account: string, token: string, path: string, method = 'GET', body?: FormData | object): Promise<T> {
  const headers = new Headers({ Authorization: `Bearer ${token}` })
  if (body && !(body instanceof FormData)) headers.set('Content-Type', 'application/json')
  const result = await fetch(api(account, path), { method, headers, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined })
  const data = await result.json() as { success?: boolean; result?: T }
  if (!result.ok || !data.success || data.result === undefined) throw new Error(`Cloudflare request failed (${result.status})`)
  return data.result
}

export async function findDatabase(account: string, token: string, name: string): Promise<string | null> {
  const found: string[] = []
  for (let page = 1; page <= 20; page++) {
    const databases = await request<{ name: string; uuid: string }[]>(account, token, `/d1/database?name=${encodeURIComponent(name)}&per_page=100&page=${page}`)
    found.push(...databases.filter(database => database.name === name).map(database => database.uuid))
    if (databases.length < 100) {
      if (found.length > 1) throw new Error('More than one matching database exists')
      return found[0] ?? null
    }
  }
  throw new Error('Could not check all databases')
}

export async function createDatabase(account: string, token: string, name: string): Promise<string> {
  const database = await request<{ uuid?: string }>(account, token, '/d1/database', 'POST', { name })
  if (!database.uuid) throw new Error('Cloudflare returned no database ID')
  return database.uuid
}

export async function getSubdomain(account: string, token: string): Promise<string> {
  const result = await request<{ subdomain?: string }>(account, token, '/workers/subdomain')
  if (!result.subdomain || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(result.subdomain)) throw new Error('No valid workers.dev subdomain')
  return result.subdomain
}

export async function workerDatabase(account: string, token: string, name: string): Promise<string | null> {
  const result = await fetch(api(account, `/workers/scripts/${name}/settings`), { headers: { Authorization: `Bearer ${token}` } })
  if (result.status === 404) return null
  const data = await result.json() as { success?: boolean; result?: { bindings?: { name?: string; type?: string; database_id?: string; id?: string }[] } }
  if (!result.ok || !data.success || !Array.isArray(data.result?.bindings)) throw new Error('Could not check Worker settings')
  const binding = data.result.bindings.find(item => item.name === 'DB' && item.type === 'd1')
  return binding?.database_id ?? binding?.id ?? ''
}

export async function applyMigrations(account: string, token: string, database: string): Promise<void> {
  const path = `/d1/database/${database}/query`
  await request(account, token, path, 'POST', { sql: 'CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)' })
  const result = await request<{ results?: { name?: string }[] }[]>(account, token, path, 'POST', { sql: 'SELECT name FROM d1_migrations' })
  const applied = new Set(result[0]?.results?.map(row => row.name) ?? [])
  const known = new Set(artifact.migrations.map(migration => migration.path))
  if ([...applied].some(name => !name || !known.has(name))) throw new Error('Database contains an unknown migration')
  for (const migration of artifact.migrations) {
    if (applied.has(migration.path)) continue
    if (!/^[a-zA-Z0-9_.-]+\.sql$/.test(migration.path)) throw new Error('Invalid migration name')
    const sql = decoder.decode(bytes(migration.content))
    await request(account, token, path, 'POST', { sql: `${sql}\nINSERT INTO d1_migrations (name) VALUES ('${migration.path}');` })
  }
}

export async function uploadWorker(account: string, token: string, name: string, database: string, secrets: Record<string, string>): Promise<void> {
  const manifest = Object.fromEntries(artifact.assets.map(file => [`/${file.path}`, { hash: file.uploadHash, size: file.size }]))
  const upload = await request<{ jwt: string; buckets: string[][] }>(account, token, `/workers/scripts/${name}/assets-upload-session`, 'POST', { manifest })
  if (!upload.jwt || !Array.isArray(upload.buckets)) throw new Error('Invalid asset upload session')
  let completion = upload.buckets.length === 0 ? upload.jwt : ''
  for (const bucket of upload.buckets) {
    const form = new FormData()
    for (const hash of bucket) {
      const file = artifact.assets.find(item => item.uploadHash === hash)
      if (!file) throw new Error('Cloudflare requested an unknown asset')
      const extension = file.path.split('.').pop()
      const mime = ({ js: 'text/javascript', css: 'text/css', svg: 'image/svg+xml', woff2: 'font/woff2', png: 'image/png' } as Record<string, string>)[extension ?? ''] ?? 'application/octet-stream'
      form.append(hash, new Blob([file.content], { type: mime }), file.path)
    }
    const result = await request<{ jwt?: string }>(account, upload.jwt, '/workers/assets/upload?base64=true', 'POST', form)
    if (result.jwt) completion = result.jwt
  }
  if (!completion) throw new Error('Asset upload did not complete')
  const metadata = {
    main_module: artifact.mainModule,
    compatibility_date: artifact.compatibilityDate,
    compatibility_flags: artifact.compatibilityFlags,
    assets: { jwt: completion },
    bindings: [{ name: 'DB', type: 'd1', database_id: database }, { name: 'ASSETS', type: 'assets' }, ...Object.entries(secrets).map(([key, value]) => ({ name: key, type: 'secret_text', text: value }))],
    observability: { enabled: true, traces: { enabled: false }, logs: { enabled: false } },
  }
  const form = new FormData()
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }))
  for (const file of artifact.bundle.filter(item => item.path.endsWith('.js'))) {
    form.append(file.path, new Blob([bytes(file.content)], { type: 'application/javascript+module' }), file.path)
  }
  await request(account, token, `/workers/scripts/${name}`, 'PUT', form)
}

export async function enableSubdomain(account: string, token: string, name: string): Promise<void> {
  await request(account, token, `/workers/scripts/${name}/subdomain`, 'POST', { enabled: true })
}

export async function verifyInstallation(account: string, token: string, name: string, database: string): Promise<void> {
  if (await workerDatabase(account, token, name) !== database) throw new Error('Worker database binding does not match')
  const secrets = await request<{ name: string }[]>(account, token, `/workers/scripts/${name}/secrets`)
  const names = new Set(secrets.map(secret => secret.name))
  const required = ['BETTER_AUTH_SECRET', 'OWNER_USERNAME', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_BOT_USERNAME', 'TELEGRAM_WEBHOOK_SECRET', 'TRUSTED_TELEGRAM_USER_ID', 'APP_URL']
  for (const name of required) {
    if (!names.has(name)) throw new Error('Worker secrets are missing')
  }
  const result = await request<{ results?: { user_id?: string }[] }[]>(account, token, `/d1/database/${database}/query`, 'POST', { sql: 'SELECT user_id FROM auth_owner_bootstrap WHERE id = 1' })
  if (!result[0]?.results?.[0]?.user_id) throw new Error('Owner setup is incomplete')
  if (names.has('OWNER_PASSWORD')) {
    await request(account, token, `/workers/scripts/${name}/secrets/OWNER_PASSWORD`, 'DELETE')
    const updated = await request<{ name: string }[]>(account, token, `/workers/scripts/${name}/secrets`)
    const remaining = new Set(updated.map(secret => secret.name))
    if (remaining.has('OWNER_PASSWORD') || required.some(name => !remaining.has(name))) throw new Error('Owner password cleanup is incomplete')
    if (await workerDatabase(account, token, name) !== database) throw new Error('Worker database binding does not match')
  }
}
