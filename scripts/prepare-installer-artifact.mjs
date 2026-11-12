import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, extname, join, relative, resolve, sep } from 'node:path'
import { parse, parseStmt } from 'sqlite3-parser'

const output = resolve('.cloudflare/output/v0/workers/default')
const target = resolve('.cloudflare/installer-artifact')
const configuration = JSON.parse(await readFile(join(output, 'worker.config.json'), 'utf8'))

if (!configuration.manifest?.mainModule || configuration.manifest.type !== 'partial') {
  throw new Error('The Rekap build has an unsupported Worker manifest')
}

async function files(directory, root = directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const result = []
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) result.push(...await files(path, root))
    else if (entry.isFile() && !entry.name.endsWith('.map')) result.push(relative(root, path).split(sep).join('/'))
    else if (!entry.isFile()) throw new Error(`Unsupported build entry: ${path}`)
  }
  return result
}

const bundle = await files(join(output, 'bundle'))
const assets = await files(join(output, 'assets'))
const migrations = (await files(resolve('migrations'))).filter((name) => name.endsWith('.sql'))
const compatibleMigrations = JSON.parse(await readFile(resolve('migrations/auto-update.json'), 'utf8'))
if (!bundle.includes(configuration.manifest.mainModule) || migrations.length === 0) {
  throw new Error('The Rekap build is missing its entrypoint or migrations')
}

await rm(target, { recursive: true, force: true })
await mkdir(target, { recursive: true })

async function copyFiles(source, destination, names) {
  const entries = []
  for (const name of names) {
    const from = join(source, name)
    const to = join(target, destination, name)
    const bytes = await readFile(from)
    await mkdir(dirname(to), { recursive: true })
    await writeFile(to, bytes)
    const entry = { path: name, size: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') }
    if (destination === 'assets') entry.uploadHash = createHash('sha256').update(bytes.toString('base64') + extname(name).slice(1)).digest('hex').slice(0, 32)
    if (destination === 'migrations') {
      let sql = bytes.toString('utf8')
      const script = parse(sql)
      if (script.status !== 'ok' || !script.root.cmds.length) throw new Error(`Cannot parse migration: ${name}`)
      entry.autoUpdate = compatibleMigrations[name] === entry.sha256
      entry.statements = []
      for (const _ of script.root.cmds) {
        const statement = parseStmt(sql, { allowTrailing: true })
        if (statement.status !== 'ok' || !statement.tail) throw new Error(`Cannot parse migration: ${name}`)
        entry.statements.push(sql.slice(0, statement.tail).trim())
        sql = sql.slice(statement.tail)
      }
    }
    entries.push(entry)
  }
  return entries
}

const manifest = {
  format: 1,
  mainModule: configuration.manifest.mainModule,
  compatibilityDate: configuration.compatibilityDate,
  compatibilityFlags: configuration.compatibilityFlags ?? [],
  triggers: (configuration.triggers ?? []).filter(trigger => trigger.type === 'scheduled').map(trigger => trigger.schedule),
  bundle: await copyFiles(join(output, 'bundle'), 'bundle', bundle),
  assets: await copyFiles(join(output, 'assets'), 'assets', assets),
  migrations: await copyFiles(resolve('migrations'), 'migrations', migrations),
}

manifest.id = createHash('sha256').update(JSON.stringify(manifest)).digest('hex')
await writeFile(join(target, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
const embedded = { ...manifest }
for (const section of ['bundle', 'assets', 'migrations']) {
  embedded[section] = await Promise.all(manifest[section].map(async entry => ({
    ...entry,
    content: (await readFile(join(target, section, entry.path))).toString('base64'),
  })))
}
await writeFile(join(target, 'embedded.json'), JSON.stringify(embedded))
console.log(`Prepared ${manifest.bundle.length} bundle files, ${manifest.assets.length} assets and ${manifest.migrations.length} migrations in ${target}`)
