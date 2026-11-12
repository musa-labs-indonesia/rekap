import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { Miniflare } from 'miniflare'

test('Installer update recovery uses new names and tags after uncertain uploads', async () => {
  const source = await readFile('.cloudflare/output/v0/workers/default/bundle/index.js', 'utf8')
  const script = source
    .replace(/("path": "0001_spending\.sql",[\s\S]*?"autoUpdate": )false/, '$1true')
    .replace(/("path": "0002_auth\.sql",[\s\S]*?"autoUpdate": )false/, '$1true')
    .replace(/("path": "0003_reporter\.sql",[\s\S]*?"autoUpdate": )false/, '$1true')
    .replace(/("path": "0004_channels\.sql",[\s\S]*?"autoUpdate": )false/, '$1true')
  assert.notEqual(script, source)
  const accountId = 'b'.repeat(32)
  const databaseId = '11111111-2222-4333-8444-555555555555'
  const workerName = 'rekap-aaaaaaaaaaaa'
  const sessionId = 'c'.repeat(64)
  const origin = 'https://installer.test'
  const required = ['BETTER_AUTH_SECRET', 'OWNER_USERNAME', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_BOT_USERNAME', 'TELEGRAM_WEBHOOK_SECRET', 'TRUSTED_TELEGRAM_USER_ID', 'APP_URL']
  const mainBindings = [
    { name: 'DB', type: 'd1', database_id: databaseId },
    { name: 'ASSETS', type: 'assets' },
    ...required.map(name => ({ name, type: 'secret_text', text: 'value' })),
  ]
  let applied = ['0001_spending.sql', '0002_auth.sql', '0003_reporter.sql']
  let deployedVersion = 'old-version'
  let versions = []
  const migrationWorkers = new Map()
  const migrationSubdomains = new Map()
  let subdomainWrites = []
  let failSubdomain = null
  let failSubdomainStatus = 403
  let loseSubdomainReply = null
  let deferSubdomainReply = null
  let deferredSubdomains = []
  let unknownSubdomain = false
  let replaceAfterRouteRead = false
  let migrationPropagation = 0
  let migrationClosePropagation = 0
  let deferredMigration
  let deferredVersion
  let migrationUploads = 0
  let migrationDeletes = 0
  let versionUploads = 0
  let deploymentAttempts = 0
  let attemptedTags = []
  let failMigrationUpload = false
  let loseMigrationUploadReply = false
  let deferMigrationUpload = false
  let failVersionUpload = false
  let loseVersionUploadReply = false
  let deferVersionUpload = false
  let skipDeployment = false
  let jobStorage

  const createMigrationWorker = async (name, metadata, code) => {
    if (migrationWorkers.has(name)) return
    const runtime = new Miniflare({ workers: [{ config: { name: 'migration', compatibilityDate: '2026-11-08', manifest: { mainModule: 'index.js', modules: { 'index.js': { type: 'esm', contents: code } } }, env: { DB: { type: 'd1', id: 'migration-test-db' } } } }] })
    const db = await runtime.getD1Database('DB')
    const statements = [db.prepare('CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY, name TEXT UNIQUE)')]
    if (applied.includes('0001_spending.sql')) statements.push(
      db.prepare('CREATE TABLE profiles (id TEXT PRIMARY KEY, name TEXT, chat_id TEXT, archived INTEGER, created_at INTEGER)'),
      db.prepare('CREATE TABLE expenses (id TEXT PRIMARY KEY, profile_id TEXT, telegram_chat_id TEXT, telegram_message_id INTEGER, reporter_id TEXT)'),
    )
    for (const name of applied) statements.push(db.prepare('INSERT INTO d1_migrations (name) VALUES (?)').bind(name))
    await db.batch(statements)
    const target = code.match(/const name = "([^"]+)";/)?.[1]
    assert.ok(target)
    migrationWorkers.set(name, { bindings: metadata.bindings, runtime, db, target })
    migrationSubdomains.set(name, false)
  }
  const completeDeferredMigration = async () => {
    assert.ok(deferredMigration)
    const { name, metadata, code } = deferredMigration
    deferredMigration = undefined
    await createMigrationWorker(name, metadata, code)
  }
  const completeDeferredVersion = () => {
    assert.ok(deferredVersion)
    if (!versions.some(version => version.id === deferredVersion.id)) versions.push(deferredVersion)
    deferredVersion = undefined
  }
  const releaseDeferredSubdomain = enabled => {
    const index = deferredSubdomains.findIndex(item => item.enabled === enabled)
    assert.notEqual(index, -1)
    const [item] = deferredSubdomains.splice(index, 1)
    migrationSubdomains.set(item.name, item.enabled)
  }

  const runtime = new Miniflare({
    unsafeInspectDurableObjects: true,
    workers: [{
      config: {
        name: 'rekap-installer',
        compatibilityDate: '2026-11-08',
        manifest: { mainModule: 'index.js', modules: { 'index.js': { type: 'esm', contents: script } } },
        exports: { InstallerSession: { type: 'durable-object', storage: 'sqlite' }, InstallerJob: { type: 'durable-object', storage: 'sqlite' } },
        env: {
          SESSION: { type: 'durable-object', worker: 'rekap-installer', exportName: 'InstallerSession' },
          INSTALL: { type: 'durable-object', worker: 'rekap-installer', exportName: 'InstallerJob' },
          SESSION_KEY: { type: 'text', value: 'ab'.repeat(32) },
          OAUTH_CLIENT_ID: { type: 'text', value: 'client' },
          INSTALLER_ORIGIN: { type: 'text', value: origin },
        },
      },
      dev: { outboundService: { type: 'fetcher', handler: async request => {
        const url = new URL(request.url)
        if (url.pathname === '/client/v4/accounts') {
          assert.equal(request.headers.get('Authorization'), 'Bearer synthetic-token')
          return Response.json({ success: true, result: [{ id: accountId, name: 'Test account' }] })
        }
        if (url.pathname === `/client/v4/accounts/${accountId}/workers/scripts/${workerName}/settings`) return Response.json({ success: true, result: { bindings: mainBindings } })
        if (url.pathname === `/client/v4/accounts/${accountId}/workers/scripts/${workerName}/deployments`) {
          if (request.method === 'GET') return Response.json({ success: true, result: { deployments: [{ versions: [{ version_id: deployedVersion, percentage: 100 }] }] } })
          const body = await request.json()
          deploymentAttempts++
          if (skipDeployment) return Response.json({ success: false }, { status: 503 })
          deployedVersion = body.versions[0].version_id
          return Response.json({ success: true, result: {} })
        }
        if (url.pathname === `/client/v4/accounts/${accountId}/workers/scripts/${workerName}/assets-upload-session`) return Response.json({ success: true, result: { jwt: 'asset-completion', buckets: [] } })
        if (url.pathname === `/client/v4/accounts/${accountId}/workers/workers/${workerName}/versions`) {
          if (request.method === 'GET') return Response.json({ success: true, result: versions, result_info: { page: 1, per_page: 100, total_count: versions.length } })
          const body = await request.json()
          versionUploads++
          attemptedTags.push(body.annotations['workers/tag'])
          if (failVersionUpload) return Response.json({ success: false }, { status: 503 })
          const version = { id: `new-version-${versionUploads}`, annotations: body.annotations }
          if (deferVersionUpload) {
            deferredVersion = version
            return Response.json({ success: false }, { status: 503 })
          }
          versions.push(version)
          if (loseVersionUploadReply) return Response.json({ success: false }, { status: 503 })
          return Response.json({ success: true, result: { id: version.id } })
        }
        if (url.pathname.startsWith(`/client/v4/accounts/${accountId}/workers/workers/${workerName}/versions/`)) return Response.json({ success: true, result: { bindings: mainBindings } })
        if (url.pathname === `/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`) {
          const { sql } = await request.json()
          if (sql === 'SELECT name FROM d1_migrations' || sql === 'SELECT name FROM d1_migrations ORDER BY id') return Response.json({ success: true, result: [{ results: applied.map(name => ({ name })) }] })
          if (sql === 'SELECT user_id FROM auth_owner_bootstrap WHERE id = 1') return Response.json({ success: true, result: [{ results: [{ user_id: 'owner-id' }] }] })
          return Response.json({ success: true, result: [{ results: [] }] })
        }
        if (url.pathname === `/client/v4/accounts/${accountId}/d1/database/${databaseId}/time_travel/bookmark`) return Response.json({ success: true, result: { bookmark: 'test-bookmark' } })
        if (url.pathname === `/client/v4/accounts/${accountId}/workers/subdomain`) return Response.json({ success: true, result: { subdomain: 'test-subdomain' } })
        const migrationPath = url.pathname.match(new RegExp(`^/client/v4/accounts/${accountId}/workers/scripts/(rekap-migrate-[a-f0-9]{16})(/.*)?$`))
        if (migrationPath) {
          const [, name, suffix = ''] = migrationPath
          if (suffix === '/settings') {
            const worker = migrationWorkers.get(name)
            return worker ? Response.json({ success: true, result: { bindings: worker.bindings } }) : Response.json({ success: false }, { status: 404 })
          }
          if (suffix === '' && request.method === 'PUT') {
            migrationUploads++
            if (failMigrationUpload) return Response.json({ success: false }, { status: 503 })
            const form = await request.formData()
            const metadata = JSON.parse(await form.get('metadata').text())
            const code = await form.get('index.js').text()
            assert.equal(metadata.bindings[0].name, 'DB')
            assert.equal(metadata.bindings[0].database_id, databaseId)
            assert.equal(metadata.bindings[1].name, 'MIGRATION_OWNER')
            assert.equal(metadata.bindings[1].type, 'plain_text')
            if (deferMigrationUpload) {
              deferredMigration = { name, metadata, code }
              return Response.json({ success: false }, { status: 503 })
            }
            await createMigrationWorker(name, metadata, code)
            if (loseMigrationUploadReply) return Response.json({ success: false }, { status: 503 })
            return Response.json({ success: true, result: {} })
          }
          if (suffix === '/subdomain') {
            if (request.method === 'GET') {
              if (unknownSubdomain) return Response.json({ success: false }, { status: 404 })
              if (replaceAfterRouteRead) {
                replaceAfterRouteRead = false
                const worker = migrationWorkers.get(name)
                if (worker) worker.bindings = worker.bindings.filter(binding => binding.name === 'DB')
              }
              return Response.json({ success: true, result: { enabled: migrationSubdomains.get(name) ?? false, previews_enabled: false } })
            }
            const { enabled } = await request.json()
            const action = enabled ? 'enable' : 'disable'
            subdomainWrites.push({ name, enabled })
            if (failSubdomain === action) return Response.json({ success: false }, { status: failSubdomainStatus })
            if (deferSubdomainReply === action) {
              deferredSubdomains.push({ name, enabled })
              return Response.json({ success: false }, { status: 503 })
            }
            migrationSubdomains.set(name, enabled)
            if (loseSubdomainReply === action) return Response.json({ success: false }, { status: 503 })
            return Response.json({ success: true, result: { enabled } })
          }
          if (suffix === '' && request.method === 'DELETE') {
            const worker = migrationWorkers.get(name)
            if (!worker) return Response.json({ success: false }, { status: 404 })
            migrationDeletes++
            await worker.runtime.dispose()
            migrationWorkers.delete(name)
            migrationSubdomains.set(name, false)
            return Response.json({ success: true, result: {} })
          }
        }
        const migrationHost = url.hostname.match(/^(rekap-migrate-[a-f0-9]{16})\.test-subdomain\.workers\.dev$/)
        if (migrationHost) {
          const name = migrationHost[1]
          if (!migrationSubdomains.get(name)) {
            if (request.method === 'GET' && migrationClosePropagation > 0) {
              migrationClosePropagation--
              return new Response(null, { status: 405 })
            }
            return new Response(null, { status: 404 })
          }
          const worker = migrationWorkers.get(name)
          if (!worker) return new Response(null, { status: 404 })
          if (migrationPropagation > 0) {
            migrationPropagation--
            return new Response(null, { status: 404 })
          }
          if (request.method !== 'POST') {
            const result = await worker.runtime.dispatchFetch('https://migration.test/', { method: 'GET' })
            return new Response(null, { status: result.status })
          }
          const result = await worker.runtime.dispatchFetch('https://migration.test/', { method: 'POST', headers: { Authorization: request.headers.get('Authorization') } })
          if (result.status === 204 && worker.target && !applied.includes(worker.target)) applied.push(worker.target)
          return new Response(null, { status: result.status })
        }
        if (url.hostname.endsWith('.workers.dev')) return new Response('Rekap', { status: 200 })
        throw new Error(`Unexpected upstream ${url.pathname}`)
      } } },
    }],
  })
  const call = (path, options = {}) => runtime.dispatchFetch(`${origin}${path}`, options)
  const headers = { origin, cookie: `__Host-rekap-installer=${sessionId}`, 'content-type': 'application/json' }
  const install = (action, body = {}) => call(`/api/install/${action}`, { method: 'POST', headers, body: JSON.stringify({ accountId, ...body }) })
  const status = async () => (await (await install('status')).json()).installation
  const startUpdate = async () => {
    const result = await install('update')
    assert.equal(result.status, 200)
    return (await result.json()).installation
  }
  const step = async () => {
    const result = await install('step')
    return { result, body: await result.json() }
  }
  const encode = value => Buffer.from(value).toString('base64url')
  const key = await crypto.subtle.importKey('raw', Buffer.from('ab'.repeat(32), 'hex'), 'AES-GCM', false, ['encrypt'])
  const seal = async value => {
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(sessionId) }, key, new TextEncoder().encode(JSON.stringify(value)))
    return JSON.stringify({ iv: encode(iv), data: encode(new Uint8Array(ciphertext)) })
  }
  const resetJob = async () => {
    for (const worker of migrationWorkers.values()) await worker.runtime.dispose()
    migrationWorkers.clear()
    migrationSubdomains.clear()
    subdomainWrites = []
    failSubdomain = null
    failSubdomainStatus = 403
    loseSubdomainReply = null
    deferSubdomainReply = null
    deferredSubdomains = []
    unknownSubdomain = false
    replaceAfterRouteRead = false
    migrationPropagation = 0
    migrationClosePropagation = 0
    deferredMigration = undefined
    deferredVersion = undefined
    migrationUploads = 0
    migrationDeletes = 0
    versionUploads = 0
    deploymentAttempts = 0
    attemptedTags = []
    failMigrationUpload = false
    loseMigrationUploadReply = false
    deferMigrationUpload = false
    failVersionUpload = false
    loseVersionUploadReply = false
    deferVersionUpload = false
    skipDeployment = false
    deployedVersion = 'old-version'
    versions = [{ id: 'old-version', annotations: {} }]
    applied = ['0001_spending.sql', '0002_auth.sql', '0003_reporter.sql']
    const job = { phase: 'done', name: workerName, bot: 'rekap_bot', nonce: 'nonce', expiresAt: Date.now() + 3600000, secrets: '', subdomain: 'test-subdomain', artifactId: 'older-artifact', database: databaseId }
    await jobStorage.exec('INSERT OR REPLACE INTO job (id, value, lock_id, lock_until) VALUES (1, ?, NULL, 0)', JSON.stringify(job))
  }

  try {
    assert.equal((await install('status')).status, 401)
    const sessionStorage = await runtime.unsafeGetDurableObjectStorage('rekap-installer', 'InstallerSession', { name: sessionId })
    const expiresAt = Date.now() + 3600000
    await sessionStorage.exec('INSERT OR REPLACE INTO session (kind, state_hash, value, expires_at) VALUES (?, ?, ?, ?)', 'authorized', '', await seal({ token: 'synthetic-token', expiresAt, tokenExpiresAt: expiresAt }), expiresAt)
    assert.equal((await install('status')).status, 200)
    jobStorage = await runtime.unsafeGetDurableObjectStorage('rekap-installer', 'InstallerJob', { name: accountId })

    await resetJob()
    await startUpdate()
    loseMigrationUploadReply = true
    let outcome = await install('step')
    assert.equal(outcome.status, 502)
    let current = await status()
    assert.equal(current.phase, 'update_migration_upload_pending')
    const adoptedWorker = current.migrationWorker
    assert.match(adoptedWorker, /^rekap-migrate-[a-f0-9]{16}$/)
    assert.equal(migrationUploads, 1)
    assert.ok(migrationWorkers.has(adoptedWorker))
    assert.equal(migrationSubdomains.get(adoptedWorker), false)
    loseMigrationUploadReply = false
    let stepped = await step()
    assert.equal(stepped.result.status, 200)
    assert.equal(stepped.body.installation.phase, 'update_migration_domain')
    assert.equal(migrationUploads, 1)
    assert.equal(migrationSubdomains.get(adoptedWorker), false)
    stepped = await step()
    assert.equal(stepped.body.installation.phase, 'update_migration_apply')
    assert.equal(migrationSubdomains.get(adoptedWorker), true)
    assert.deepEqual(subdomainWrites.map(item => item.enabled), [true])
    stepped = await step()
    assert.equal(stepped.body.installation.phase, 'update_migration_cleanup')
    assert.deepEqual(applied, ['0001_spending.sql', '0002_auth.sql', '0003_reporter.sql', '0004_channels.sql'])
    assert.equal(migrationSubdomains.get(adoptedWorker), true)
    stepped = await step()
    assert.equal(stepped.body.installation.phase, 'update_prepare')
    assert.equal(migrationDeletes, 1)
    assert.equal(migrationWorkers.has(adoptedWorker), false)
    assert.equal(migrationSubdomains.get(adoptedWorker), false)
    assert.deepEqual(subdomainWrites.map(item => item.enabled), [true, false])
    assert.equal((await status()).orphanWorkers, undefined)
    stepped = await step()
    assert.equal(stepped.body.installation.phase, 'update_deploy')
    stepped = await step()
    assert.equal(stepped.body.installation.phase, 'update_health')
    stepped = await step()
    assert.equal(stepped.body.installation.phase, 'done')
    assert.equal(stepped.body.installation.orphanWorkers, undefined)

    await resetJob()
    await startUpdate()
    loseMigrationUploadReply = true
    outcome = await install('step')
    assert.equal(outcome.status, 502)
    current = await status()
    const propagatedWorker = current.migrationWorker
    loseMigrationUploadReply = false
    stepped = await step()
    assert.equal(stepped.body.installation.phase, 'update_migration_domain')
    migrationPropagation = 1
    stepped = await step()
    assert.equal(stepped.body.installation.phase, 'update_migration_apply')
    assert.equal(migrationPropagation, 0)
    assert.equal(migrationSubdomains.get(propagatedWorker), true)
    assert.deepEqual(subdomainWrites.map(item => item.enabled), [true])
    stepped = await step()
    assert.equal(stepped.body.installation.phase, 'update_migration_cleanup')
    assert.deepEqual(applied, ['0001_spending.sql', '0002_auth.sql', '0003_reporter.sql', '0004_channels.sql'])

    await resetJob()
    await startUpdate()
    loseMigrationUploadReply = true
    outcome = await install('step')
    assert.equal(outcome.status, 502)
    loseMigrationUploadReply = false
    stepped = await step()
    assert.equal(stepped.body.installation.phase, 'update_migration_domain')
    stepped = await step()
    assert.equal(stepped.body.installation.phase, 'update_migration_apply')
    stepped = await step()
    assert.equal(stepped.body.installation.phase, 'update_migration_cleanup')
    current = await status()
    const closedWorker = current.migrationWorker
    assert.equal(migrationSubdomains.get(closedWorker), true)
    migrationClosePropagation = 1
    stepped = await step()
    assert.equal(stepped.body.installation.phase, 'update_prepare')
    assert.equal(migrationClosePropagation, 0)
    assert.equal(migrationSubdomains.get(closedWorker), false)
    assert.deepEqual(subdomainWrites.map(item => item.enabled), [true, false])

    await resetJob()
    await startUpdate()
    loseMigrationUploadReply = true
    outcome = await install('step')
    assert.equal(outcome.status, 502)
    current = await status()
    const rejectedWorker = current.migrationWorker
    loseMigrationUploadReply = false
    stepped = await step()
    assert.equal(stepped.body.installation.phase, 'update_migration_domain')
    failSubdomain = 'enable'
    outcome = await install('step')
    assert.equal(outcome.status, 502)
    current = await status()
    assert.equal(current.phase, 'update_blocked')
    assert.equal(current.blocked.reason, 'migration_route_enable_failed')
    assert.equal(current.blocked.canCancel, true)
    assert.equal(current.blocked.canRetry, 'migration')
    assert.equal(current.migrationWorkerUrl, `https://${rejectedWorker}.test-subdomain.workers.dev`)
    assert.equal(migrationSubdomains.get(rejectedWorker), false)
    assert.deepEqual(subdomainWrites.map(item => item.enabled), [true])
    failSubdomain = null
    stepped = await step()
    assert.equal(stepped.body.installation.phase, 'update_migration_apply')
    assert.equal(migrationSubdomains.get(rejectedWorker), true)
    assert.deepEqual(subdomainWrites.map(item => item.enabled), [true, true])

    await resetJob()
    await startUpdate()
    loseMigrationUploadReply = true
    outcome = await install('step')
    assert.equal(outcome.status, 502)
    current = await status()
    const uncertainEnableWorker = current.migrationWorker
    loseMigrationUploadReply = false
    stepped = await step()
    assert.equal(stepped.body.installation.phase, 'update_migration_domain')
    failSubdomain = 'enable'
    failSubdomainStatus = 408
    outcome = await install('step')
    assert.equal(outcome.status, 502)
    current = await status()
    assert.equal(current.phase, 'update_migration_domain')
    assert.equal(current.migrationWorker, uncertainEnableWorker)
    assert.equal(migrationSubdomains.get(uncertainEnableWorker), false)
    assert.deepEqual(subdomainWrites.map(item => item.enabled), [true])
    failSubdomain = null
    failSubdomainStatus = 403
    outcome = await install('step')
    assert.equal(outcome.status, 502)
    current = await status()
    assert.equal(current.phase, 'update_blocked')
    assert.equal(current.blocked.reason, 'migration_route_enable_unresolved')
    assert.equal(current.blocked.canRetry, 'migration')
    assert.equal(current.blocked.canCancel, true)
    assert.deepEqual(subdomainWrites.map(item => item.enabled), [true])

    await resetJob()
    await startUpdate()
    loseMigrationUploadReply = true
    outcome = await install('step')
    assert.equal(outcome.status, 502)
    current = await status()
    const lateWorker = current.migrationWorker
    loseMigrationUploadReply = false
    stepped = await step()
    assert.equal(stepped.body.installation.phase, 'update_migration_domain')
    deferSubdomainReply = 'enable'
    outcome = await install('step')
    assert.equal(outcome.status, 502)
    current = await status()
    assert.equal(current.phase, 'update_migration_domain')
    assert.equal(current.migrationWorker, lateWorker)
    assert.equal(current.migrationWorkerUrl, `https://${lateWorker}.test-subdomain.workers.dev`)
    assert.equal(migrationSubdomains.get(lateWorker), false)
    assert.deepEqual(subdomainWrites.map(item => item.enabled), [true])
    deferSubdomainReply = null
    outcome = await install('step')
    assert.equal(outcome.status, 502)
    current = await status()
    assert.equal(current.phase, 'update_blocked')
    assert.equal(current.blocked.reason, 'migration_route_enable_unresolved')
    assert.equal(current.blocked.canCancel, true)
    assert.equal(current.blocked.canRetry, 'migration')
    assert.deepEqual(subdomainWrites.map(item => item.enabled), [true])
    assert.deepEqual(applied, ['0001_spending.sql', '0002_auth.sql', '0003_reporter.sql'])
    releaseDeferredSubdomain(true)
    assert.equal(migrationSubdomains.get(lateWorker), true)
    stepped = await step()
    assert.equal(stepped.body.installation.phase, 'update_migration_apply')
    assert.deepEqual(subdomainWrites.map(item => item.enabled), [true])
    stepped = await step()
    assert.equal(stepped.body.installation.phase, 'update_migration_cleanup')
    assert.deepEqual(applied, ['0001_spending.sql', '0002_auth.sql', '0003_reporter.sql', '0004_channels.sql'])
    stepped = await step()
    assert.equal(stepped.body.installation.phase, 'update_prepare')
    assert.equal(migrationSubdomains.get(lateWorker), false)
    assert.deepEqual(subdomainWrites.map(item => item.enabled), [true, false])

    await resetJob()
    await startUpdate()
    loseMigrationUploadReply = true
    outcome = await install('step')
    assert.equal(outcome.status, 502)
    current = await status()
    const lostEnableWorker = current.migrationWorker
    loseMigrationUploadReply = false
    stepped = await step()
    assert.equal(stepped.body.installation.phase, 'update_migration_domain')
    loseSubdomainReply = 'enable'
    outcome = await install('step')
    assert.equal(outcome.status, 502)
    current = await status()
    assert.equal(current.phase, 'update_migration_domain')
    assert.equal(current.migrationWorker, lostEnableWorker)
    assert.equal(migrationSubdomains.get(lostEnableWorker), true)
    assert.deepEqual(subdomainWrites.map(item => item.enabled), [true])
    loseSubdomainReply = null
    stepped = await step()
    assert.equal(stepped.body.installation.phase, 'update_migration_apply')
    assert.deepEqual(subdomainWrites.map(item => item.enabled), [true])
    stepped = await step()
    assert.equal(stepped.body.installation.phase, 'update_migration_cleanup')
    assert.deepEqual(applied, ['0001_spending.sql', '0002_auth.sql', '0003_reporter.sql', '0004_channels.sql'])
    stepped = await step()
    assert.equal(stepped.body.installation.phase, 'update_prepare')
    assert.equal(migrationSubdomains.get(lostEnableWorker), false)
    assert.deepEqual(subdomainWrites.map(item => item.enabled), [true, false])

    await resetJob()
    await startUpdate()
    loseMigrationUploadReply = true
    outcome = await install('step')
    assert.equal(outcome.status, 502)
    loseMigrationUploadReply = false
    stepped = await step()
    assert.equal(stepped.body.installation.phase, 'update_migration_domain')
    stepped = await step()
    assert.equal(stepped.body.installation.phase, 'update_migration_apply')
    current = await status()
    const disabledAtApplyWorker = current.migrationWorker
    migrationSubdomains.set(disabledAtApplyWorker, false)
    const applyWrites = subdomainWrites.length
    outcome = await install('step')
    assert.equal(outcome.status, 502)
    current = await status()
    assert.equal(current.phase, 'update_blocked')
    assert.equal(current.blocked.reason, 'migration_worker_route_disabled')
    assert.equal(current.blocked.canRetry, 'migration')
    assert.equal(current.blocked.canCancel, false)
    assert.equal(current.migrationWorkerUrl, `https://${disabledAtApplyWorker}.test-subdomain.workers.dev`)
    assert.equal(migrationSubdomains.get(disabledAtApplyWorker), false)
    assert.equal(subdomainWrites.length, applyWrites)
    migrationSubdomains.set(disabledAtApplyWorker, true)
    stepped = await step()
    assert.equal(stepped.body.installation.phase, 'update_migration_cleanup')
    assert.deepEqual(applied, ['0001_spending.sql', '0002_auth.sql', '0003_reporter.sql', '0004_channels.sql'])

    await resetJob()
    await startUpdate()
    loseMigrationUploadReply = true
    outcome = await install('step')
    assert.equal(outcome.status, 502)
    loseMigrationUploadReply = false
    stepped = await step()
    assert.equal(stepped.body.installation.phase, 'update_migration_domain')
    stepped = await step()
    assert.equal(stepped.body.installation.phase, 'update_migration_apply')
    stepped = await step()
    assert.equal(stepped.body.installation.phase, 'update_migration_cleanup')
    current = await status()
    const lostDisableWorker = current.migrationWorker
    assert.equal(migrationSubdomains.get(lostDisableWorker), true)
    loseSubdomainReply = 'disable'
    outcome = await install('step')
    assert.equal(outcome.status, 502)
    current = await status()
    assert.equal(current.phase, 'update_migration_cleanup')
    assert.equal(migrationSubdomains.get(lostDisableWorker), false)
    loseSubdomainReply = null
    migrationClosePropagation = 100
    outcome = await install('step')
    assert.equal(outcome.status, 502)
    current = await status()
    assert.equal(current.phase, 'update_blocked')
    assert.equal(current.blocked.reason, 'migration_worker_route_close_unresolved')
    assert.equal(current.blocked.databaseChanged, true)
    assert.equal(current.blocked.canCancel, false)
    assert.equal(current.migrationWorkerUrl, `https://${lostDisableWorker}.test-subdomain.workers.dev`)
    assert.equal(migrationSubdomains.get(lostDisableWorker), false)
    assert.equal(migrationClosePropagation, 90)
    assert.equal(current.orphanWorkers, undefined)
    assert.deepEqual(subdomainWrites.map(item => item.enabled), [true, false])
    migrationClosePropagation = 100
    outcome = await install('step')
    assert.equal(outcome.status, 502)
    current = await status()
    assert.equal(current.phase, 'update_blocked')
    assert.equal(current.blocked.reason, 'migration_worker_route_close_unresolved')
    assert.equal(migrationClosePropagation, 90)
    assert.equal(current.orphanWorkers, undefined)
    migrationClosePropagation = 0
    stepped = await step()
    assert.equal(stepped.body.installation.phase, 'update_prepare')
    current = await status()
    assert.equal(migrationSubdomains.get(lostDisableWorker), false)
    assert.equal(current.orphanWorkers, undefined)
    assert.deepEqual(subdomainWrites.map(item => item.enabled), [true, false])

    await resetJob()
    await startUpdate()
    loseMigrationUploadReply = true
    outcome = await install('step')
    assert.equal(outcome.status, 502)
    loseMigrationUploadReply = false
    stepped = await step()
    assert.equal(stepped.body.installation.phase, 'update_migration_domain')
    stepped = await step()
    assert.equal(stepped.body.installation.phase, 'update_migration_apply')
    stepped = await step()
    assert.equal(stepped.body.installation.phase, 'update_migration_cleanup')
    current = await status()
    const lateDisableWorker = current.migrationWorker
    deferSubdomainReply = 'disable'
    outcome = await install('step')
    assert.equal(outcome.status, 502)
    current = await status()
    assert.equal(current.phase, 'update_migration_cleanup')
    assert.equal(migrationSubdomains.get(lateDisableWorker), true)
    deferSubdomainReply = null
    stepped = await step()
    assert.equal(stepped.body.installation.phase, 'update_prepare')
    assert.equal(migrationSubdomains.get(lateDisableWorker), false)
    releaseDeferredSubdomain(false)
    assert.equal(migrationSubdomains.get(lateDisableWorker), false)
    assert.deepEqual(subdomainWrites.map(item => item.enabled), [true, false, false])

    await resetJob()
    await startUpdate()
    loseMigrationUploadReply = true
    outcome = await install('step')
    assert.equal(outcome.status, 502)
    loseMigrationUploadReply = false
    stepped = await step()
    assert.equal(stepped.body.installation.phase, 'update_migration_domain')
    stepped = await step()
    assert.equal(stepped.body.installation.phase, 'update_migration_apply')
    stepped = await step()
    assert.equal(stepped.body.installation.phase, 'update_migration_cleanup')
    current = await status()
    const blockedCleanupWorker = current.migrationWorker
    assert.equal(migrationSubdomains.get(blockedCleanupWorker), true)
    failSubdomain = 'disable'
    outcome = await install('step')
    assert.equal(outcome.status, 502)
    current = await status()
    assert.equal(current.phase, 'update_blocked')
    assert.equal(current.blocked.reason, 'migration_route_disable_failed')
    assert.equal(current.blocked.databaseChanged, true)
    assert.equal(current.blocked.canCancel, false)
    assert.equal(current.blocked.canRetry, undefined)
    assert.equal(current.migrationWorkerUrl, `https://${blockedCleanupWorker}.test-subdomain.workers.dev`)
    assert.equal(migrationSubdomains.get(blockedCleanupWorker), true)
    assert.deepEqual(subdomainWrites.map(item => item.enabled), [true, false])
    failSubdomain = null
    stepped = await step()
    assert.equal(stepped.body.installation.phase, 'update_prepare')
    assert.equal(migrationSubdomains.get(blockedCleanupWorker), false)
    assert.equal((await status()).orphanWorkers, undefined)

    await resetJob()
    await startUpdate()
    loseMigrationUploadReply = true
    outcome = await install('step')
    assert.equal(outcome.status, 502)
    loseMigrationUploadReply = false
    stepped = await step()
    assert.equal(stepped.body.installation.phase, 'update_migration_domain')
    stepped = await step()
    assert.equal(stepped.body.installation.phase, 'update_migration_apply')
    stepped = await step()
    assert.equal(stepped.body.installation.phase, 'update_migration_cleanup')
    current = await status()
    const unknownWorker = current.migrationWorker
    assert.equal(migrationSubdomains.get(unknownWorker), true)
    unknownSubdomain = true
    outcome = await install('step')
    assert.equal(outcome.status, 502)
    current = await status()
    assert.equal(current.phase, 'update_blocked')
    assert.equal(current.blocked.reason, 'migration_worker_route_unknown')
    assert.equal(current.blocked.databaseChanged, true)
    assert.equal(current.blocked.canCancel, false)
    assert.equal(current.migrationWorkerUrl, `https://${unknownWorker}.test-subdomain.workers.dev`)
    assert.equal(migrationSubdomains.get(unknownWorker), true)
    assert.deepEqual(subdomainWrites.map(item => item.enabled), [true])
    unknownSubdomain = false
    stepped = await step()
    assert.equal(stepped.body.installation.phase, 'update_prepare')
    assert.equal(migrationSubdomains.get(unknownWorker), false)
    assert.deepEqual(subdomainWrites.map(item => item.enabled), [true, false])

    await resetJob()
    await startUpdate()
    loseMigrationUploadReply = true
    outcome = await install('step')
    assert.equal(outcome.status, 502)
    loseMigrationUploadReply = false
    stepped = await step()
    assert.equal(stepped.body.installation.phase, 'update_migration_domain')
    stepped = await step()
    assert.equal(stepped.body.installation.phase, 'update_migration_apply')
    stepped = await step()
    assert.equal(stepped.body.installation.phase, 'update_migration_cleanup')
    current = await status()
    const replacedWorker = current.migrationWorker
    assert.equal(migrationSubdomains.get(replacedWorker), true)
    const replacedWrites = subdomainWrites.length
    replaceAfterRouteRead = true
    outcome = await install('step')
    assert.equal(outcome.status, 502)
    current = await status()
    assert.equal(current.phase, 'update_blocked')
    assert.equal(current.blocked.reason, 'migration_worker_cleanup_unverified')
    assert.equal(current.blocked.databaseChanged, true)
    assert.equal(current.blocked.canCancel, false)
    assert.equal(current.migrationWorkerUrl, `https://${replacedWorker}.test-subdomain.workers.dev`)
    assert.equal(migrationSubdomains.get(replacedWorker), true)
    assert.equal(subdomainWrites.length, replacedWrites)

    await resetJob()
    await startUpdate()
    deferMigrationUpload = true
    outcome = await install('step')
    assert.equal(outcome.status, 502)
    current = await status()
    assert.equal(current.phase, 'update_migration_upload_pending')
    const firstWorker = current.migrationWorker
    assert.equal(migrationUploads, 1)
    assert.equal(migrationWorkers.has(firstWorker), false)
    deferMigrationUpload = false
    deployedVersion = 'foreign-version'
    outcome = await install('step')
    assert.equal(outcome.status, 502)
    current = await status()
    assert.equal(current.phase, 'update_blocked')
    assert.equal(current.blocked.reason, 'worker_deployment_changed')
    assert.equal(migrationUploads, 1)
    deployedVersion = 'old-version'
    outcome = await install('step')
    assert.equal(outcome.status, 502)
    current = await status()
    assert.equal(current.phase, 'update_blocked')
    assert.equal(current.blocked.reason, 'migration_worker_missing')
    assert.equal(current.blocked.canRetry, 'migration')
    assert.equal(current.blocked.canCancel, true)
    assert.equal(migrationUploads, 1)
    outcome = await install('update/retry', { target: 'migration' })
    assert.equal(outcome.status, 200)
    current = (await outcome.json()).installation
    assert.equal(current.phase, 'update_migration_upload_pending')
    const secondWorker = current.migrationWorker
    assert.notEqual(secondWorker, firstWorker)
    assert.ok(current.orphanWorkers.includes(firstWorker))
    await completeDeferredMigration()
    assert.ok(migrationWorkers.has(firstWorker))
    stepped = await step()
    assert.equal(stepped.result.status, 200)
    assert.equal(stepped.body.installation.phase, 'update_migration_domain')
    assert.equal(migrationUploads, 2)
    assert.ok(migrationWorkers.has(firstWorker))
    assert.ok(migrationWorkers.has(secondWorker))
    stepped = await step()
    assert.equal(stepped.body.installation.phase, 'update_migration_apply')
    stepped = await step()
    assert.equal(stepped.body.installation.phase, 'update_migration_cleanup')
    assert.equal(migrationSubdomains.get(firstWorker), false)
    assert.equal(migrationSubdomains.get(secondWorker), true)
    stepped = await step()
    assert.equal(stepped.body.installation.phase, 'update_prepare')
    assert.equal(migrationSubdomains.get(firstWorker), false)
    assert.equal(migrationSubdomains.get(secondWorker), false)
    assert.equal(migrationDeletes, 1)
    assert.equal(await migrationWorkers.get(firstWorker).db.prepare("SELECT name FROM d1_migrations WHERE name = '0004_channels.sql'").first(), null)
    current = await status()
    assert.ok(current.orphanWorkers.includes(firstWorker))
    assert.equal(current.orphanWorkers.includes(secondWorker), false)

    await resetJob()
    await startUpdate()
    loseMigrationUploadReply = true
    outcome = await install('step')
    assert.equal(outcome.status, 502)
    current = await status()
    const unverifiedWorker = current.migrationWorker
    assert.equal(migrationUploads, 1)
    migrationWorkers.get(unverifiedWorker).bindings = migrationWorkers.get(unverifiedWorker).bindings.filter(binding => binding.name === 'DB')
    loseMigrationUploadReply = false
    outcome = await install('step')
    assert.equal(outcome.status, 502)
    current = await status()
    assert.equal(current.phase, 'update_blocked')
    assert.equal(current.blocked.reason, 'migration_worker_unverified')
    assert.equal(current.blocked.canRetry, 'migration')
    assert.equal(current.blocked.canCancel, true)
    assert.equal(migrationUploads, 1)
    outcome = await install('update/cancel')
    assert.equal(outcome.status, 200)
    current = (await outcome.json()).installation
    assert.equal(current.phase, 'done')
    assert.ok(current.orphanWorkers.includes(unverifiedWorker))
    assert.ok(migrationWorkers.has(unverifiedWorker))
    assert.equal(migrationDeletes, 0)
    current = await status()
    assert.equal(current.orphanWorkers, undefined)
    assert.equal(migrationDeletes, 1)
    assert.equal(migrationWorkers.has(unverifiedWorker), false)

    await resetJob()
    applied = ['0001_spending.sql', '0002_auth.sql', '0003_reporter.sql', '0004_channels.sql']
    await startUpdate()
    loseVersionUploadReply = true
    outcome = await install('step')
    assert.equal(outcome.status, 502)
    current = await status()
    assert.equal(current.phase, 'update_upload_pending')
    assert.equal(versionUploads, 1)
    assert.equal(versions.length, 2)
    loseVersionUploadReply = false
    stepped = await step()
    assert.equal(stepped.body.installation.phase, 'update_deploy')
    assert.equal(versionUploads, 1)
    assert.equal(versions.length, 2)
    stepped = await step()
    assert.equal(stepped.body.installation.phase, 'update_health')
    assert.equal(deployedVersion, versions[1].id)
    stepped = await step()
    assert.equal(stepped.body.installation.phase, 'done')
    assert.equal(stepped.body.installation.updateAvailable, false)

    await resetJob()
    applied = ['0001_spending.sql', '0002_auth.sql', '0003_reporter.sql', '0004_channels.sql']
    await startUpdate()
    deferVersionUpload = true
    outcome = await install('step')
    assert.equal(outcome.status, 502)
    current = await status()
    assert.equal(current.phase, 'update_upload_pending')
    const firstTag = attemptedTags[0]
    assert.equal(versionUploads, 1)
    assert.equal(versions.length, 1)
    deferVersionUpload = false
    deployedVersion = 'foreign-version'
    outcome = await install('step')
    assert.equal(outcome.status, 502)
    current = await status()
    assert.equal(current.phase, 'update_blocked')
    assert.equal(current.blocked.reason, 'worker_deployment_changed')
    assert.equal(versionUploads, 1)
    deployedVersion = 'old-version'
    outcome = await install('step')
    assert.equal(outcome.status, 502)
    current = await status()
    assert.equal(current.phase, 'update_blocked')
    assert.equal(current.blocked.reason, 'worker_version_missing')
    assert.equal(current.blocked.canRetry, 'version')
    assert.equal(current.blocked.canCancel, true)
    assert.equal(versionUploads, 1)
    outcome = await install('update/retry', { target: 'version' })
    assert.equal(outcome.status, 200)
    current = (await outcome.json()).installation
    assert.equal(current.phase, 'update_upload_pending')
    assert.ok(current.orphanVersionTags.includes(firstTag))
    completeDeferredVersion()
    assert.equal(versions.length, 2)
    assert.equal(versions[1].annotations['workers/tag'], firstTag)
    stepped = await step()
    assert.equal(stepped.result.status, 200)
    assert.equal(stepped.body.installation.phase, 'update_deploy')
    assert.equal(versionUploads, 2)
    assert.equal(versions.length, 3)
    const secondTag = attemptedTags[1]
    assert.notEqual(secondTag, firstTag)
    assert.equal(versions[2].annotations['workers/tag'], secondTag)
    stepped = await step()
    assert.equal(stepped.body.installation.phase, 'update_health')
    assert.equal(deployedVersion, versions[2].id)
    stepped = await step()
    assert.equal(stepped.body.installation.phase, 'done')
    assert.ok(stepped.body.installation.orphanVersionTags.includes(firstTag))

    await resetJob()
    applied = ['0001_spending.sql', '0002_auth.sql', '0003_reporter.sql', '0004_channels.sql']
    await startUpdate()
    loseVersionUploadReply = true
    outcome = await install('step')
    assert.equal(outcome.status, 502)
    assert.equal(versionUploads, 1)
    versions.push({ ...versions[1] })
    loseVersionUploadReply = false
    outcome = await install('step')
    assert.equal(outcome.status, 502)
    current = await status()
    assert.equal(current.phase, 'update_blocked')
    assert.equal(current.blocked.reason, 'worker_version_ambiguous')
    assert.equal(current.blocked.canRetry, 'version')
    assert.equal(current.blocked.canCancel, true)
    const ambiguousTag = versions[1].annotations['workers/tag']
    outcome = await install('update/retry', { target: 'version' })
    assert.equal(outcome.status, 200)
    stepped = await step()
    assert.equal(stepped.body.installation.phase, 'update_deploy')
    assert.equal(versionUploads, 2)
    assert.notEqual(attemptedTags[1], ambiguousTag)
    assert.ok(stepped.body.installation.orphanVersionTags.includes(ambiguousTag))

    await resetJob()
    applied = ['0001_spending.sql', '0002_auth.sql', '0003_reporter.sql', '0004_channels.sql']
    await startUpdate()
    stepped = await step()
    assert.equal(stepped.body.installation.phase, 'update_deploy')
    skipDeployment = true
    outcome = await install('step')
    assert.equal(outcome.status, 502)
    current = await status()
    assert.equal(current.phase, 'update_deploy_pending')
    assert.equal(deploymentAttempts, 1)
    assert.equal(deployedVersion, 'old-version')
    outcome = await install('step')
    assert.equal(outcome.status, 502)
    current = await status()
    assert.equal(current.phase, 'update_blocked')
    assert.equal(current.blocked.reason, 'worker_deployment_unresolved')
    assert.equal(current.blocked.canCancel, false)
    assert.equal(current.blocked.canRetry, undefined)
    assert.equal(deploymentAttempts, 1)
    outcome = await install('update/cancel')
    assert.equal(outcome.status, 502)
    assert.equal((await outcome.json()).error, 'Update cannot be cancelled')
    deployedVersion = versions[1].id
    outcome = await install('step')
    assert.equal(outcome.status, 200)
    current = (await outcome.json()).installation
    assert.equal(current.phase, 'update_health')
    assert.equal(deploymentAttempts, 1)
    outcome = await install('step')
    assert.equal((await outcome.json()).installation.phase, 'done')

    await resetJob()
    applied = ['0001_spending.sql', '0002_auth.sql', '0003_reporter.sql', '0004_channels.sql']
    await startUpdate()
    stepped = await step()
    assert.equal(stepped.body.installation.phase, 'update_deploy')
    deployedVersion = 'foreign-version'
    outcome = await install('step')
    assert.equal(outcome.status, 502)
    current = await status()
    assert.equal(current.phase, 'update_blocked')
    assert.equal(current.blocked.reason, 'worker_deployment_changed')
    assert.equal(current.blocked.canCancel, true)
    assert.equal(deploymentAttempts, 0)
    outcome = await install('update/cancel')
    assert.equal(outcome.status, 502)
    deployedVersion = 'old-version'
    outcome = await install('update/cancel')
    assert.equal(outcome.status, 200)
    current = (await outcome.json()).installation
    assert.equal(current.phase, 'done')

    await resetJob()
    applied = []
    await startUpdate()
    stepped = await step()
    assert.equal(stepped.body.installation.phase, 'update_migration_domain')
    const firstMigrationWorker = [...migrationWorkers.keys()][0]
    stepped = await step()
    assert.equal(stepped.body.installation.phase, 'update_migration_apply')
    stepped = await step()
    assert.equal(stepped.body.installation.phase, 'update_migration_cleanup')
    assert.deepEqual(applied, ['0001_spending.sql'])
    stepped = await step()
    assert.equal(stepped.body.installation.phase, 'update_prepare')
    assert.equal(migrationSubdomains.get(firstMigrationWorker), false)
    assert.equal((await status()).orphanWorkers, undefined)
    loseMigrationUploadReply = true
    outcome = await install('step')
    assert.equal(outcome.status, 502)
    current = await status()
    assert.equal(current.phase, 'update_migration_upload_pending')
    const secondMigrationWorker = current.migrationWorker
    assert.equal(migrationUploads, 2)
    assert.equal(migrationSubdomains.get(secondMigrationWorker), false)
    migrationWorkers.get(secondMigrationWorker).bindings = migrationWorkers.get(secondMigrationWorker).bindings.filter(binding => binding.name === 'DB')
    loseMigrationUploadReply = false
    outcome = await install('step')
    assert.equal(outcome.status, 502)
    current = await status()
    assert.equal(current.phase, 'update_blocked')
    assert.equal(current.blocked.reason, 'migration_worker_unverified')
    assert.equal(current.blocked.databaseChanged, true)
    assert.equal(current.blocked.canCancel, false)
    assert.equal(current.blocked.canRetry, 'migration')
    outcome = await install('update/cancel')
    assert.equal(outcome.status, 502)
    assert.equal((await outcome.json()).error, 'Update cannot be cancelled')
    outcome = await install('update/retry', { target: 'migration' })
    assert.equal(outcome.status, 200)
    current = (await outcome.json()).installation
    assert.equal(current.phase, 'update_migration_upload_pending')
    const thirdMigrationWorker = current.migrationWorker
    assert.notEqual(thirdMigrationWorker, secondMigrationWorker)
    stepped = await step()
    assert.equal(stepped.body.installation.phase, 'update_migration_domain')
    assert.equal(migrationUploads, 3)
    assert.equal(migrationSubdomains.get(thirdMigrationWorker), false)
    assert.ok(migrationWorkers.has(secondMigrationWorker))
    assert.equal(migrationDeletes, 1)

    await resetJob()
    await startUpdate()
    loseMigrationUploadReply = true
    outcome = await install('step')
    assert.equal(outcome.status, 502)
    current = await status()
    const cleanupWorker = current.migrationWorker
    loseMigrationUploadReply = false
    stepped = await step()
    assert.equal(stepped.body.installation.phase, 'update_migration_domain')
    stepped = await step()
    assert.equal(stepped.body.installation.phase, 'update_migration_apply')
    stepped = await step()
    assert.equal(stepped.body.installation.phase, 'update_migration_cleanup')
    current = await status()
    assert.equal(migrationSubdomains.get(cleanupWorker), true)
    const cleanupWrites = subdomainWrites.length
    migrationWorkers.get(cleanupWorker).bindings = migrationWorkers.get(cleanupWorker).bindings.filter(binding => binding.name === 'DB')
    outcome = await install('step')
    assert.equal(outcome.status, 502)
    current = await status()
    assert.equal(current.phase, 'update_blocked')
    assert.equal(current.blocked.reason, 'migration_worker_cleanup_unverified')
    assert.equal(current.blocked.databaseChanged, true)
    assert.equal(current.blocked.canCancel, false)
    assert.equal(current.blocked.canRetry, undefined)
    assert.equal(migrationDeletes, 0)
    assert.ok(migrationWorkers.has(cleanupWorker))
    assert.equal(migrationSubdomains.get(cleanupWorker), true)
    assert.equal(subdomainWrites.length, cleanupWrites)
    await migrationWorkers.get(cleanupWorker).runtime.dispose()
    migrationWorkers.delete(cleanupWorker)
    migrationSubdomains.delete(cleanupWorker)
    outcome = await install('step')
    assert.equal(outcome.status, 200)
    current = (await outcome.json()).installation
    assert.equal(current.phase, 'update_prepare')
    assert.equal(migrationDeletes, 0)
    assert.equal(subdomainWrites.length, cleanupWrites)
  } finally {
    for (const worker of migrationWorkers.values()) await worker.runtime.dispose()
    await runtime.dispose()
  }
})
