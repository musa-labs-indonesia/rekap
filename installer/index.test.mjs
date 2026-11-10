import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { Miniflare } from 'miniflare'

test('OAuth sessions bind authorization, list accounts, and revoke tokens', async () => {
  const source = await readFile('.cloudflare/output/v0/workers/default/bundle/index.js', 'utf8')
  const script = source
    .replace(/("path": "0002_auth\.sql",[\s\S]*?"autoUpdate": )false/, '$1true')
    .replace(/("path": "0003_reporter\.sql",[\s\S]*?"autoUpdate": )false/, '$1true')
  assert.notEqual(script, source)
  let failRevocation = false
  let revocations = 0
  let verifier
  let grantedScope = 'account-settings.read d1.write workers-scripts.write'
  let hasCollision = false
  let databasePages = false
  let webhookUrl = 'https://existing.example/webhook'
  let verificationText = ''
  let verificationUser = 123456
  let blockUpdates
  let updatesStarted
  let databaseName = ''
  let databaseCreates = 0
  let failCreateReply = true
  let workerName = ''
  let workerBindings = []
  let ownerExists = true
  let failSecretDeleteReply = true
  let secretDeletes = 0
  let deployedVersion = 'old-version'
  let newBindings = []
  let versionUploads = 0
  let deploys = 0
  let failDeploymentReply = false
  let wrongDatabase = false
  let migrationRuntime
  let migrationDb
  let migrationName
  let migrationBindings = []
  let migrationAttempts = 0
  let migrationDeletes = 0
  let migrationSubdomain = false
  let failMigrationUpload = false
  let publishedArtifact
  const applied = new Set()
  const databaseId = '11111111-2222-4333-8444-555555555555'
  const accountId = 'a'.repeat(32)
  const botToken = `123456:${'a'.repeat(35)}`
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
          INSTALLER_ORIGIN: { type: 'text', value: 'https://installer.test' },
        },
      },
      dev: { outboundService: { type: 'fetcher', handler: async request => {
        const url = new URL(request.url)
        if (url.pathname === '/oauth2/token') {
          verifier = new URLSearchParams(await request.text()).get('code_verifier')
          return Response.json({ access_token: 'synthetic-token', token_type: 'Bearer', expires_in: 3600, scope: grantedScope })
        }
        if (url.pathname === '/oauth2/revoke') {
          revocations++
          return new Response('', { status: failRevocation ? 503 : 200 })
        }
        if (url.pathname === '/client/v4/accounts') {
          assert.equal(request.headers.get('Authorization'), 'Bearer synthetic-token')
          const page = Number(url.searchParams.get('page'))
          const result = page === 1 ? Array.from({ length: 50 }, (_, i) => ({ id: `id-${i}`, name: `Account ${i}` })) : [{ id: accountId, name: 'Last account' }]
          return Response.json({ success: true, result })
        }
        if (url.pathname === `/client/v4/accounts/${accountId}/workers/scripts`) return Response.json({ success: true, result: [{ id: hasCollision ? 'rekap' : 'rekap-other' }] })
        if (url.pathname === `/client/v4/accounts/${accountId}/d1/database`) {
          if (request.method === 'POST') {
            databaseName = (await request.json()).name
            databaseCreates++
            if (failCreateReply) {
              failCreateReply = false
              return Response.json({ success: false }, { status: 503 })
            }
            return Response.json({ success: true, result: { uuid: databaseId } })
          }
          if (url.searchParams.get('name') !== 'rekap') return Response.json({ success: true, result: databaseName ? [{ name: databaseName, uuid: databaseId }] : [] })
          if (databasePages && url.searchParams.get('page') === '1') return Response.json({ success: true, result: Array.from({ length: 100 }, (_, i) => ({ name: `rekap-${i}` })), result_info: { total_count: 500 } })
          return Response.json({ success: true, result: [{ name: hasCollision ? 'rekap' : 'rekap-backup' }], result_info: { total_count: 500 } })
        }
        if (url.pathname === `/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`) {
          const { sql } = await request.json()
          if (sql === 'SELECT name FROM d1_migrations' || sql === 'SELECT name FROM d1_migrations ORDER BY id') return Response.json({ success: true, result: [{ results: [...applied].map(name => ({ name })) }] })
          if (sql === 'SELECT user_id FROM auth_owner_bootstrap WHERE id = 1') return Response.json({ success: true, result: [{ results: ownerExists ? [{ user_id: 'owner-id' }] : [] }] })
          const match = sql.match(/INSERT INTO d1_migrations \(name\) VALUES \('([^']+)'\)/)
          if (match) applied.add(match[1])
          return Response.json({ success: true, result: [{ results: [] }] })
        }
        if (url.pathname === `/client/v4/accounts/${accountId}/d1/database/${databaseId}/time_travel/bookmark`) return Response.json({ success: true, result: { bookmark: 'test-bookmark' } })
        if (url.pathname === `/client/v4/accounts/${accountId}/workers/subdomain`) return Response.json({ success: true, result: { subdomain: 'test-subdomain' } })
        if (url.pathname === `/bot${botToken}/getMe`) return Response.json({ ok: true, result: { is_bot: true, username: 'rekap_bot', can_join_groups: true, can_read_all_group_messages: false } })
        if (url.pathname === `/bot${botToken}/getWebhookInfo`) return Response.json({ ok: true, result: { url: webhookUrl } })
        if (url.pathname === `/bot${botToken}/getUpdates`) {
          if (blockUpdates) {
            updatesStarted()
            await blockUpdates
          }
          return Response.json({ ok: true, result: verificationText ? [{ message: { text: verificationText, from: { id: verificationUser }, chat: { id: 123456, type: 'private' } } }] : [] })
        }
        if (url.pathname === `/bot${botToken}/setWebhook`) {
          const body = await request.json()
          assert.equal(body.drop_pending_updates, false)
          assert.equal(body.secret_token.length, 64)
          webhookUrl = body.url
          return Response.json({ ok: true, result: true })
        }
        if (url.pathname === `/bot${botToken}/getMyCommands`) return Response.json({ ok: true, result: [] })
        if (url.pathname === `/bot${botToken}/setMyCommands`) {
          const body = await request.json()
          assert.ok(body.commands.some(command => command.command === 'help'))
          return Response.json({ ok: true, result: true })
        }
        const migrationPath = url.pathname.match(new RegExp(`^/client/v4/accounts/${accountId}/workers/scripts/(rekap-migrate-[a-f0-9]{16})(/.*)?$`))
        if (migrationPath) {
          const [, name, suffix = ''] = migrationPath
          if (suffix === '/settings') return migrationName === name ? Response.json({ success: true, result: { bindings: migrationBindings } }) : Response.json({ success: false }, { status: 404 })
          if (suffix === '' && request.method === 'PUT') {
            if (failMigrationUpload) return Response.json({ success: false }, { status: 503 })
            const form = await request.formData()
            const metadata = JSON.parse(await form.get('metadata').text())
            assert.equal(metadata.bindings[0].database_id, databaseId)
            assert.equal(metadata.bindings[1].name, 'MIGRATION_OWNER')
            assert.equal(metadata.bindings[1].type, 'plain_text')
            migrationBindings = metadata.bindings
            migrationName = name
            migrationSubdomain = false
            migrationRuntime = new Miniflare({ workers: [{ config: { name: 'migration', compatibilityDate: '2026-11-08', manifest: { mainModule: 'index.js', modules: { 'index.js': { type: 'esm', contents: await form.get('index.js').text() } } }, env: { DB: { type: 'd1', id: 'migration-test-db' } } } }] })
            migrationDb = await migrationRuntime.getD1Database('DB')
            await migrationDb.batch([
              migrationDb.prepare('CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY, name TEXT UNIQUE)'),
              migrationDb.prepare("INSERT INTO d1_migrations (name) VALUES ('0001_spending.sql'), ('0002_auth.sql')"),
              migrationDb.prepare('CREATE TABLE spending (amount INTEGER NOT NULL)'),
              migrationDb.prepare('INSERT INTO spending VALUES (23000)'),
              migrationDb.prepare('CREATE TABLE expenses (id TEXT PRIMARY KEY, reporter_id TEXT)'),
            ])
            return Response.json({ success: true, result: {} })
          }
          if (suffix === '/subdomain') {
            if (request.method === 'GET') return Response.json({ success: true, result: { enabled: migrationSubdomain, previews_enabled: false } })
            migrationSubdomain = (await request.json()).enabled === true
            return Response.json({ success: true, result: { enabled: migrationSubdomain } })
          }
          if (suffix === '' && request.method === 'DELETE') {
            assert.equal(name, migrationName)
            migrationDeletes++
            await migrationRuntime?.dispose()
            migrationRuntime = undefined
            migrationName = undefined
            migrationBindings = []
            return Response.json({ success: true, result: {} })
          }
        }
        const workerPath = url.pathname.match(new RegExp(`^/client/v4/accounts/${accountId}/workers/scripts/(rekap-[a-f0-9]{12})(/.*)?$`))
        if (workerPath) {
          const [, name, suffix = ''] = workerPath
          if (suffix === '/settings') return workerName === name ? Response.json({ success: true, result: { bindings: workerBindings } }) : Response.json({ success: false }, { status: 404 })
          if (suffix === '/secrets') return Response.json({ success: true, result: workerBindings.filter(binding => binding.type === 'secret_text').map(binding => ({ name: binding.name })) })
          if (suffix === '/secrets/OWNER_PASSWORD' && request.method === 'DELETE') {
            assert.equal(applied.size, 3)
            workerBindings = workerBindings.filter(binding => binding.name !== 'OWNER_PASSWORD')
            secretDeletes++
            if (failSecretDeleteReply) {
              failSecretDeleteReply = false
              return Response.json({ success: false }, { status: 503 })
            }
            return Response.json({ success: true, result: {} })
          }
          if (suffix === '/assets-upload-session') {
            const body = await request.json()
            const hash = Object.values(body.manifest)[0].hash
            return Response.json({ success: true, result: { jwt: 'asset-upload', buckets: [[hash]] } })
          }
          if (suffix === '/deployments' && request.method === 'GET') return Response.json({ success: true, result: { deployments: [{ versions: [{ version_id: deployedVersion, percentage: 100 }] }] } })
          if (suffix === '/deployments' && request.method === 'POST') {
            const body = await request.json()
            assert.equal(body.versions[0].version_id, 'new-version')
            deployedVersion = 'new-version'
            deploys++
            if (failDeploymentReply) return Response.json({ success: false }, { status: 503 })
            return Response.json({ success: true, result: {} })
          }
          if (suffix === '' && request.method === 'PUT') {
            const form = await request.formData()
            const metadata = JSON.parse(await form.get('metadata').text())
            assert.equal(metadata.assets.jwt, 'asset-completion')
            assert.equal(form.has(metadata.main_module), true)
            workerName = name
            workerBindings = metadata.bindings
            return Response.json({ success: true, result: {} })
          }
          if (suffix === '/subdomain') return Response.json({ success: true, result: {} })
        }
        if (url.pathname === `/client/v4/accounts/${accountId}/workers/workers/${workerName}/versions` && request.method === 'POST') {
          const body = await request.json()
          assert.equal(body.assets.jwt, 'asset-completion')
          assert.equal(body.modules.some(module => module.name === body.main_module), true)
          assert.equal(body.bindings.filter(binding => binding.type === 'inherit').every(binding => binding.version_id === 'old-version'), true)
          assert.deepEqual(body.bindings.filter(binding => 'text' in binding), [{ name: 'REKAP_ARTIFACT_ID', type: 'plain_text', text: publishedArtifact }])
          newBindings = [...workerBindings.filter(binding => binding.name !== 'REKAP_ARTIFACT_ID').map(binding => ({ ...binding })), { name: 'REKAP_ARTIFACT_ID', type: 'plain_text', text: publishedArtifact }]
          versionUploads++
          return Response.json({ success: true, result: { id: 'new-version' } })
        }
        if (url.pathname.startsWith(`/client/v4/accounts/${accountId}/workers/workers/${workerName}/versions/`)) {
          const bindings = (url.pathname.endsWith('/new-version') ? newBindings : workerBindings).map(binding => binding.name === 'DB' && wrongDatabase ? { ...binding, database_id: 'wrong' } : binding)
          return Response.json({ success: true, result: { bindings } })
        }
        if (url.pathname === `/client/v4/accounts/${accountId}/workers/assets/upload`) return Response.json({ success: true, result: { jwt: 'asset-completion' } })
        if (migrationName && url.hostname === `${migrationName}.test-subdomain.workers.dev`) {
          if (!migrationSubdomain) return new Response(null, { status: 404 })
          if (request.method !== 'POST') {
            const result = await migrationRuntime.dispatchFetch('https://migration.test/', { method: 'GET' })
            return new Response(null, { status: result.status })
          }
          migrationAttempts++
          const denied = await migrationRuntime.dispatchFetch('https://migration.test/', { method: 'POST', headers: { Authorization: 'wrong' } })
          assert.equal(denied.status, 403)
          const result = await migrationRuntime.dispatchFetch('https://migration.test/', { method: 'POST', headers: { Authorization: request.headers.get('Authorization') } })
          if (result.status === 204) {
            applied.add('0003_reporter.sql')
            const replay = await migrationRuntime.dispatchFetch('https://migration.test/', { method: 'POST', headers: { Authorization: request.headers.get('Authorization') } })
            assert.equal(replay.status, 409)
            return new Response(null, { status: 503 })
          }
          return new Response(null, { status: result.status })
        }
        if (url.hostname.endsWith('.workers.dev')) return new Response('Rekap', { status: 200 })
        throw new Error(`Unexpected upstream ${url.pathname}`)
      } } },
    }],
  })
  const call = (path, options = {}) => runtime.dispatchFetch(`https://installer.test${path}`, options)
  const start = () => call('/api/oauth/start', { method: 'POST', headers: { origin: 'https://installer.test' } })

  try {
    assert.equal((await call('/api/session')).status, 401)
    publishedArtifact = (await (await call('/api/release')).json()).artifactId
    assert.match(publishedArtifact, /^[a-f0-9]{64}$/)
    assert.equal((await call('/api/oauth/start', { method: 'POST', headers: { origin: 'https://evil.test' } })).status, 403)
    let initial = await start()
    let pendingCookie = initial.headers.get('set-cookie').split(';')[0]
    let authorization = new URL((await initial.json()).url)
    assert.equal(authorization.searchParams.get('code_challenge_method'), 'S256')
    assert.equal((await call(`/api/oauth/callback?state=${'a'.repeat(64)}&code=test`, { headers: { cookie: pendingCookie } })).status, 400)

    const callbackPath = `/api/oauth/callback?state=${authorization.searchParams.get('state')}&code=test`
    let callback = await call(callbackPath, { headers: { cookie: pendingCookie }, redirect: 'manual' })
    assert.equal(callback.status, 303)
    assert.equal(callback.headers.get('location'), '/')
    const sessionCookie = callback.headers.get('set-cookie').split(';')[0]
    assert.notEqual(sessionCookie, pendingCookie)
    const challenge = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))).toString('base64url')
    assert.equal(challenge, authorization.searchParams.get('code_challenge'))
    assert.equal((await call(callbackPath, { headers: { cookie: pendingCookie } })).status, 400)

    const session = await call('/api/session', { headers: { cookie: sessionCookie } })
    const { accounts } = await session.json()
    assert.equal(accounts.length, 51)
    assert.deepEqual(accounts[50], { id: accountId, name: 'Last account' })

    const preflight = id => call('/api/preflight', { method: 'POST', headers: { origin: 'https://installer.test', cookie: sessionCookie, 'content-type': 'application/json' }, body: JSON.stringify({ accountId: id }) })
    assert.equal((await preflight('b'.repeat(32))).status, 403)
    let check = await preflight(accountId)
    assert.deepEqual(await check.json(), { account: accounts[50], workerExists: false, databaseExists: false, subdomain: 'test-subdomain' })
    hasCollision = true
    databasePages = true
    check = await preflight(accountId)
    assert.deepEqual(await check.json(), { account: accounts[50], workerExists: true, databaseExists: true, subdomain: 'test-subdomain' })
    hasCollision = false
    check = await preflight(accountId)
    assert.deepEqual(await check.json(), { account: accounts[50], workerExists: false, databaseExists: false, subdomain: 'test-subdomain' })

    const telegramCheck = cookie => call('/api/telegram/check', { method: 'POST', headers: { origin: 'https://installer.test', cookie, 'content-type': 'application/json' }, body: JSON.stringify({ token: botToken }) })
    assert.equal((await telegramCheck('')).status, 401)
    const telegram = await telegramCheck(sessionCookie)
    assert.deepEqual(await telegram.json(), { username: 'rekap_bot', canJoinGroups: true, canReadGroupMessages: false, hasWebhook: true })
    assert.equal((await telegramCheck(sessionCookie)).status, 429)

    const install = (action, body = {}) => call(`/api/install/${action}`, { method: 'POST', headers: { origin: 'https://installer.test', cookie: sessionCookie, 'content-type': 'application/json' }, body: JSON.stringify({ accountId, ...body }) })
    assert.equal((await install('start', { accountId: 'b'.repeat(32), botToken, username: 'owner', password: 'correct horse battery' })).status, 403)
    webhookUrl = ''
    let result = await install('start', { botToken, username: 'owner', password: 'correct horse battery' })
    assert.equal(result.status, 200)
    let { installation } = await result.json()
    assert.equal(installation.phase, 'verify')
    assert.equal((await install('reset')).status, 502)
    const storage = await runtime.unsafeGetDurableObjectStorage('rekap-installer', 'InstallerJob', { name: accountId })
    await storage.exec("UPDATE job SET value = json_set(value, '$.expiresAt', 1) WHERE id = 1")
    assert.equal((await (await install('step')).json()).installation.phase, 'expired')
    assert.equal((await (await install('reset')).json()).installation, null)
    assert.equal((await (await install('status')).json()).installation, null)
    result = await install('start', { botToken, username: 'owner', password: 'a long example passphrase' })
    assert.equal(result.status, 200)
    installation = (await result.json()).installation
    const jobRows = await storage.exec('SELECT value FROM job WHERE id = 1')
    const originalJob = JSON.parse(jobRows[0].value)
    await storage.exec("UPDATE job SET value = json_set(value, '$.artifactId', 'different') WHERE id = 1")
    const mismatch = await install('step')
    assert.equal(mismatch.status, 502)
    assert.equal((await mismatch.json()).error, 'Installer version changed during installation')
    await storage.exec('UPDATE job SET value = ? WHERE id = 1', JSON.stringify(originalJob))
    const code = new URL(installation.verificationUrl).searchParams.get('start')
    verificationText = `/start ${code}`
    verificationUser = 987654
    let releaseUpdates
    blockUpdates = new Promise(resolve => { releaseUpdates = resolve })
    const started = new Promise(resolve => { updatesStarted = resolve })
    const pendingStep = install('step')
    await started
    await storage.exec('UPDATE job SET lock_until = 1 WHERE id = 1')
    assert.equal((await install('step')).status, 502)
    releaseUpdates()
    assert.equal((await (await pendingStep).json()).installation.phase, 'verify')
    blockUpdates = undefined
    result = await install('step')
    assert.equal((await result.json()).installation.phase, 'verify')
    verificationUser = 123456
    result = await install('step')
    assert.equal((await result.json()).installation.phase, 'database')
    assert.equal((await install('step')).status, 502)
    result = await install('status')
    assert.equal((await result.json()).installation.phase, 'database_pending')
    result = await install('step')
    assert.equal((await result.json()).installation.phase, 'migrations')
    assert.equal(databaseCreates, 1)
    for (const phase of ['worker', 'domain', 'health']) {
      result = await install('step')
      assert.equal(result.status, 200)
      installation = (await result.json()).installation
      assert.equal(installation.phase, phase)
    }
    ownerExists = false
    assert.equal((await install('step')).status, 502)
    assert.equal(secretDeletes, 0)
    assert.equal(workerBindings.some(binding => binding.name === 'OWNER_PASSWORD'), true)
    ownerExists = true
    assert.equal((await install('step')).status, 502)
    assert.equal((await (await install('status')).json()).installation.phase, 'health')
    for (const phase of ['webhook', 'commands', 'done']) {
      result = await install('step')
      assert.equal(result.status, 200)
      installation = (await result.json()).installation
      assert.equal(installation.phase, phase)
    }
    assert.equal(applied.size, 3)
    assert.equal(secretDeletes, 1)
    assert.equal(workerBindings.some(binding => binding.name === 'OWNER_PASSWORD'), false)
    assert.equal(workerBindings.find(binding => binding.name === 'DB').database_id, databaseId)
    assert.equal(workerBindings.find(binding => binding.name === 'TRUSTED_TELEGRAM_USER_ID').text, '123456')
    assert.equal(workerBindings.find(binding => binding.name === 'REKAP_ARTIFACT_ID').text, publishedArtifact)
    assert.equal(webhookUrl, `${installation.appUrl}/api/telegram`)
    assert.doesNotMatch(JSON.stringify(installation), /correct horse battery|123456:a{35}/)

    assert.equal(installation.updateAvailable, false)
    assert.equal((await install('update')).status, 502)
    workerBindings.find(binding => binding.name === 'REKAP_ARTIFACT_ID').text = '0'.repeat(64)
    await storage.exec("UPDATE job SET value = json_set(value, '$.artifactId', 'older-artifact') WHERE id = 1")
    assert.equal((await (await install('status')).json()).installation.updateAvailable, true)
    assert.equal((await (await install('update')).json()).installation.phase, 'update_prepare')
    wrongDatabase = true
    assert.equal((await (await install('step')).json()).error, 'Worker database binding does not match')
    assert.equal(versionUploads, 0)
    wrongDatabase = false
    applied.add('unknown.sql')
    assert.equal((await (await install('step')).json()).error, 'Database migrations require a manual update')
    assert.equal((await (await install('status')).json()).installation.phase, 'done')
    applied.clear()
    applied.add('0002_auth.sql')
    assert.equal((await (await install('update')).json()).installation.phase, 'update_prepare')
    assert.equal((await (await install('step')).json()).error, 'Database migrations require a manual update')
    assert.equal((await (await install('status')).json()).installation.phase, 'done')
    applied.clear()
    applied.add('0001_spending.sql')
    applied.add('0002_auth.sql')
    assert.equal((await (await install('update')).json()).installation.phase, 'update_prepare')
    assert.equal((await (await install('step')).json()).installation.phase, 'update_migration_domain')
    assert.equal((await (await install('step')).json()).installation.phase, 'update_migration_apply')
    assert.equal((await (await install('step')).json()).error, 'Database migration did not complete')
    assert.equal(await migrationDb.prepare("SELECT name FROM d1_migrations WHERE name = '0003_reporter.sql'").first(), null)
    assert.equal(await migrationDb.prepare("SELECT name FROM sqlite_master WHERE name = 'rekap_migration_guard'").first(), null)
    await migrationDb.prepare('DROP TABLE expenses').run()
    await migrationDb.prepare('CREATE TABLE expenses (id TEXT PRIMARY KEY)').run()
    assert.equal((await (await install('step')).json()).installation.phase, 'update_migration_cleanup')
    assert.equal(migrationAttempts, 2)
    assert.equal((await (await install('step')).json()).installation.phase, 'update_prepare')
    assert.equal((await (await install('step')).json()).installation.phase, 'update_deploy')
    assert.equal(versionUploads, 1)
    failDeploymentReply = true
    assert.equal((await install('step')).status, 502)
    assert.equal((await (await install('status')).json()).installation.phase, 'update_deploy_pending')
    assert.equal((await (await install('step')).json()).installation.phase, 'update_health')
    assert.equal((await (await install('step')).json()).installation.phase, 'done')
    assert.equal(deploys, 1)
    assert.equal(databaseCreates, 1)
    assert.equal(secretDeletes, 1)
    assert.equal(webhookUrl, `${installation.appUrl}/api/telegram`)

    deployedVersion = 'old-version'
    await storage.exec("UPDATE job SET value = json_set(value, '$.artifactId', 'older-artifact') WHERE id = 1")
    applied.delete('0003_reporter.sql')
    failMigrationUpload = true
    assert.equal((await (await install('update')).json()).installation.phase, 'update_prepare')
    assert.equal((await install('step')).status, 502)
    const uncertain = (await (await install('status')).json()).installation
    assert.equal(uncertain.phase, 'update_migration_upload_pending')
    assert.match(uncertain.migrationWorker, /^rekap-migrate-[a-f0-9]{16}$/)

    const logout = () => call('/api/oauth/logout', { method: 'POST', headers: { origin: 'https://installer.test', cookie: sessionCookie } })
    failRevocation = true
    assert.equal((await logout()).status, 500)
    assert.equal((await call('/api/session', { headers: { cookie: sessionCookie } })).status, 200)
    failRevocation = false
    assert.equal((await logout()).status, 200)
    assert.equal((await call('/api/session', { headers: { cookie: sessionCookie } })).status, 401)

    grantedScope = 'account-settings.read'
    initial = await start()
    pendingCookie = initial.headers.get('set-cookie').split(';')[0]
    authorization = new URL((await initial.json()).url)
    callback = await call(`/api/oauth/callback?state=${authorization.searchParams.get('state')}&code=test`, { headers: { cookie: pendingCookie } })
    assert.equal(callback.status, 502)
    assert.equal(revocations, 3)
  } finally {
    if (migrationRuntime) await migrationRuntime.dispose()
    await runtime.dispose()
  }
})
