type FileEntry = { path: string; size: number; sha256: string; content: string; uploadHash?: string }
type Migration = FileEntry & { statements: string[]; autoUpdate: boolean }
type Artifact = { id: string; mainModule: string; compatibilityDate: string; compatibilityFlags: string[]; bundle: FileEntry[]; assets: FileEntry[]; migrations: Migration[] }

declare const __REKAP_ARTIFACT__: Artifact

const artifact = __REKAP_ARTIFACT__
export const artifactId = artifact.id
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

type Binding = { name: string; type: string; id?: string; database_id?: string; text?: string }

async function workerBindings(account: string, token: string, name: string): Promise<Binding[] | null> {
  const result = await fetch(api(account, `/workers/scripts/${name}/settings`), { headers: { Authorization: `Bearer ${token}` } })
  if (result.status === 404) return null
  const data = await result.json() as { success?: boolean; result?: { bindings?: Binding[] } }
  if (!result.ok || !data.success || !Array.isArray(data.result?.bindings)) throw new Error('Could not check Worker settings')
  return data.result.bindings
}

export async function workerDatabase(account: string, token: string, name: string): Promise<string | null> {
  const bindings = await workerBindings(account, token, name)
  if (bindings === null) return null
  const binding = bindings.find(item => item.name === 'DB' && item.type === 'd1')
  return binding?.database_id ?? binding?.id ?? ''
}

export type MigrationWorkerState = 'missing' | 'owned' | 'unverified'

export async function migrationWorkerState(account: string, token: string, name: string, database: string, ownership: string): Promise<MigrationWorkerState> {
  const bindings = await workerBindings(account, token, name)
  if (bindings === null) return 'missing'
  const databases = bindings.filter(binding => binding.name === 'DB' && binding.type === 'd1')
  const owners = bindings.filter(binding => binding.name === 'MIGRATION_OWNER' && binding.type === 'plain_text')
  if (databases.length === 1 && (databases[0].database_id ?? databases[0].id) === database && owners.length === 1 && owners[0].text === ownership) return 'owned'
  return 'unverified'
}

export function migrationByPath(path: string): Migration | null {
  return artifact.migrations.find(migration => migration.path === path) ?? null
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

async function uploadAssets(account: string, token: string, name: string): Promise<string> {
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
  return completion
}

export async function uploadWorker(account: string, token: string, name: string, database: string, secrets: Record<string, string>): Promise<void> {
  const completion = await uploadAssets(account, token, name)
  const metadata = {
    main_module: artifact.mainModule,
    compatibility_date: artifact.compatibilityDate,
    compatibility_flags: artifact.compatibilityFlags,
    assets: { jwt: completion },
    bindings: [{ name: 'DB', type: 'd1', database_id: database }, { name: 'ASSETS', type: 'assets' }, { name: 'REKAP_ARTIFACT_ID', type: 'plain_text', text: artifact.id }, ...Object.entries(secrets).map(([key, value]) => ({ name: key, type: 'secret_text', text: value }))],
    observability: { enabled: true, traces: { enabled: false }, logs: { enabled: false } },
  }
  const form = new FormData()
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }))
  for (const file of artifact.bundle.filter(item => item.path.endsWith('.js'))) {
    form.append(file.path, new Blob([bytes(file.content)], { type: 'application/javascript+module' }), file.path)
  }
  await request(account, token, `/workers/scripts/${name}`, 'PUT', form)
}

export async function activeVersion(account: string, token: string, name: string): Promise<string> {
  const result = await request<{ deployments?: { versions?: { version_id?: string; percentage?: number }[] }[] }>(account, token, `/workers/scripts/${name}/deployments`)
  const versions = result.deployments?.[0]?.versions
  if (versions?.length !== 1 || versions[0].percentage !== 100 || !versions[0].version_id) throw new Error('Worker deployment is not a single version')
  return versions[0].version_id
}

export async function updatePreflight(account: string, token: string, name: string, database: string, version: string, allowPending = false): Promise<{ bindings: Binding[]; bookmark: string; pending: Migration[] }> {
  const result = await request<{ bindings?: Binding[] }>(account, token, `/workers/workers/${name}/versions/${version}`)
  const bindings = result.bindings
  if (!Array.isArray(bindings) || bindings.some(binding => !binding.name || !binding.type)) throw new Error('Worker bindings are unavailable')
  const db = bindings.filter(binding => binding.name === 'DB' && binding.type === 'd1')
  if (db.length !== 1 || (db[0].database_id ?? db[0].id) !== database) throw new Error('Worker database binding does not match')
  const required = ['BETTER_AUTH_SECRET', 'OWNER_USERNAME', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_BOT_USERNAME', 'TELEGRAM_WEBHOOK_SECRET', 'TRUSTED_TELEGRAM_USER_ID', 'APP_URL']
  if (required.some(name => !bindings.some(binding => binding.name === name && binding.type === 'secret_text'))) throw new Error('Worker secrets are missing')
  if (bindings.some(binding => binding.name === 'OWNER_PASSWORD') || bindings.filter(binding => binding.name === 'ASSETS' && binding.type === 'assets').length !== 1) throw new Error('Worker bindings are not supported')
  if (bindings.some(binding => binding.name === 'REKAP_ARTIFACT_ID' && binding.type !== 'plain_text')) throw new Error('Worker bindings are not supported')
  const migrations = await request<{ results?: { name?: string }[] }[]>(account, token, `/d1/database/${database}/query`, 'POST', { sql: 'SELECT name FROM d1_migrations ORDER BY id' })
  const applied = migrations[0]?.results?.map(row => row.name)
  const known = artifact.migrations.map(migration => migration.path)
  if (!applied || applied.length > known.length || applied.some((name, index) => name !== known[index]) || (!allowPending && applied.length !== known.length)) throw new Error('Database migrations require a manual update')
  const owner = await request<{ results?: { user_id?: string }[] }[]>(account, token, `/d1/database/${database}/query`, 'POST', { sql: 'SELECT user_id FROM auth_owner_bootstrap WHERE id = 1' })
  if (!owner[0]?.results?.[0]?.user_id) throw new Error('Owner setup is incomplete')
  const backup = await request<{ bookmark?: string }>(account, token, `/d1/database/${database}/time_travel/bookmark`)
  if (!backup.bookmark) throw new Error('Database bookmark is unavailable')
  return { bindings, bookmark: backup.bookmark, pending: artifact.migrations.slice(applied.length) }
}

export async function uploadMigrationWorker(account: string, token: string, name: string, database: string, migration: Migration, password: string, ownership: string): Promise<void> {
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(password))))
  const code = `const expected = new Uint8Array(${JSON.stringify(digest)});\nconst sql = ${JSON.stringify(migration.statements)};\nconst name = ${JSON.stringify(migration.path)};\nexport default { async fetch(request, env) {\n  if (request.method !== 'POST') return new Response(null, { status: 405 });\n  const actual = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(request.headers.get('Authorization') || ''));\n  if (!crypto.subtle.timingSafeEqual(expected, actual)) return new Response(null, { status: 403 });\n  try {\n    await env.DB.batch([\n      env.DB.prepare('CREATE TABLE IF NOT EXISTS rekap_migration_guard (name TEXT PRIMARY KEY NOT NULL)'),\n      env.DB.prepare('INSERT OR IGNORE INTO rekap_migration_guard (name) SELECT name FROM d1_migrations'),\n      env.DB.prepare('INSERT INTO rekap_migration_guard (name) VALUES (?)').bind(name),\n      ...sql.map(statement => env.DB.prepare(statement)),\n      env.DB.prepare('INSERT INTO d1_migrations (name) VALUES (?)').bind(name),\n    ]);\n    return new Response(null, { status: 204 });\n  } catch { return new Response(null, { status: 409 }); }\n} };`
  const metadata = {
    main_module: 'index.js', compatibility_date: artifact.compatibilityDate,
    bindings: [{ name: 'DB', type: 'd1', database_id: database }, { name: 'MIGRATION_OWNER', type: 'plain_text', text: ownership }],
    observability: { enabled: false, traces: { enabled: false }, logs: { enabled: false } },
  }
  const form = new FormData()
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }))
  form.append('index.js', new Blob([code], { type: 'application/javascript+module' }), 'index.js')
  await request(account, token, `/workers/scripts/${name}`, 'PUT', form)
}

export async function findVersionByTag(account: string, token: string, name: string, tag: string): Promise<string | null> {
  const found: string[] = []
  let pageSize = 0
  for (let page = 1; page <= 20; page++) {
    const response = await fetch(api(account, `/workers/workers/${name}/versions?page=${page}&per_page=100`), { headers: { Authorization: `Bearer ${token}` } })
    const data = await response.json() as { success?: boolean; result?: { id?: string; annotations?: { 'workers/tag'?: string } }[]; result_info?: { per_page?: number; total_count?: number } }
    if (!response.ok || !data.success || !Array.isArray(data.result)) throw new Error('Could not check Worker versions')
    for (const version of data.result) {
      if (version.annotations?.['workers/tag'] !== tag) continue
      if (!version.id) throw new Error('Could not check Worker versions')
      found.push(version.id)
    }
    if (data.result.length === 0) break
    const perPage = data.result_info?.per_page
    const total = data.result_info?.total_count
    if (perPage !== undefined && total !== undefined && page * perPage >= total) break
    if (perPage === undefined && data.result.length < 100) break
    if (page === 1) pageSize = data.result.length
    else if (data.result.length < pageSize) break
    if (page === 20) throw new Error('Could not check all Worker versions')
  }
  if (found.length > 1) throw new Error('More than one matching Worker version exists')
  return found[0] ?? null
}

export async function uploadUpdate(account: string, token: string, name: string, version: string, bindings: Binding[], tag: string): Promise<string> {
  const completion = await uploadAssets(account, token, name)
  if (await activeVersion(account, token, name) !== version) throw new Error('Worker deployment changed during update')
  const result = await request<{ id?: string }>(account, token, `/workers/workers/${name}/versions`, 'POST', {
    main_module: artifact.mainModule,
    compatibility_date: artifact.compatibilityDate,
    compatibility_flags: artifact.compatibilityFlags,
    assets: { jwt: completion },
    bindings: [...bindings.filter(binding => binding.name !== 'REKAP_ARTIFACT_ID').map(binding => binding.type === 'assets' ? { name: binding.name, type: 'assets' } : { name: binding.name, type: 'inherit', version_id: version }), { name: 'REKAP_ARTIFACT_ID', type: 'plain_text', text: artifact.id }],
    modules: artifact.bundle.filter(file => file.path.endsWith('.js')).map(file => ({ name: file.path, content_base64: file.content, content_type: 'application/javascript+module' })),
    annotations: { 'workers/message': `Rekap ${artifact.id}`, 'workers/tag': tag },
  })
  if (!result.id) throw new Error('Worker version upload is unresolved')
  return result.id
}

export async function deployUpdate(account: string, token: string, name: string, version: string): Promise<void> {
  await request(account, token, `/workers/scripts/${name}/deployments`, 'POST', { strategy: 'percentage', versions: [{ version_id: version, percentage: 100 }] })
}

export async function setSubdomain(account: string, token: string, name: string, enabled: boolean): Promise<boolean | undefined> {
  const result = await request<{ enabled?: boolean }>(account, token, `/workers/scripts/${name}/subdomain`, 'POST', { enabled })
  return result.enabled
}

export async function workerSubdomainEnabled(account: string, token: string, name: string): Promise<boolean | null> {
  const result = await fetch(api(account, `/workers/scripts/${name}/subdomain`), { headers: { Authorization: `Bearer ${token}` } })
  if (result.status === 404) return null
  const data = await result.json() as { success?: boolean; result?: { enabled?: boolean } }
  if (!result.ok || !data.success || typeof data.result?.enabled !== 'boolean') throw new Error('Could not check Worker subdomain')
  return data.result.enabled
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
