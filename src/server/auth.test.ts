import { readFileSync } from 'node:fs'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { beforeEach, describe, expect, it } from 'vitest'
import type { AuthEnv } from './auth'
import { bootstrapOwner, consumeRecoveryToken, createAuth, getSession, issueTelegramRecoveryLink } from './auth'

class Statement {
  private values: SQLInputValue[] = []
  constructor(private db: DatabaseSync, private sql: string) {}
  bind(...values: SQLInputValue[]) {
    const statement = new Statement(this.db, this.sql)
    statement.values = values
    return statement
  }
  async first() {
    return this.db.prepare(this.sql).get(...this.values) ?? null
  }
  runSync() {
    const result = this.db.prepare(this.sql).run(...this.values)
    return { success: true, meta: { changes: Number(result.changes) }, results: [] }
  }
  async run() {
    return this.runSync()
  }
  async all() {
    return { success: true, results: this.db.prepare(this.sql).all(...this.values) }
  }
  async raw() {
    const statement = this.db.prepare(this.sql)
    statement.setReturnArrays(true)
    return statement.all(...this.values)
  }
}

class TestD1 {
  db = new DatabaseSync(':memory:')
  constructor() {
    this.db.exec('PRAGMA foreign_keys = ON')
    this.db.exec(readFileSync(new URL('../../migrations/0002_auth.sql', import.meta.url), 'utf8'))
  }
  prepare(sql: string) { return new Statement(this.db, sql) }
  async batch(statements: Statement[]) {
    this.db.exec('BEGIN')
    try {
      const results = statements.map((statement) => statement.runSync())
      this.db.exec('COMMIT')
      return results
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }
}

describe('owner authentication', () => {
  let db: TestD1
  let env: AuthEnv
  beforeEach(() => {
    db = new TestD1()
    env = {
      DB: db as unknown as AuthEnv['DB'],
      BETTER_AUTH_URL: 'https://example.com',
      BETTER_AUTH_SECRET: 'a-long-random-looking-secret-at-least-32-characters',
      OWNER_USERNAME: 'Owner',
      OWNER_PASSWORD: 'first-password-123',
      TRUSTED_TELEGRAM_USER_ID: '123456',
    }
  })

  async function signIn(password: string) {
    return createAuth(env).handler(new Request('https://example.com/api/auth/sign-in/username', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://example.com' },
      body: JSON.stringify({ username: 'OWNER', password }),
    }))
  }

  it('bootstraps once, signs in, checks sessions, and rejects public signup', async () => {
    await bootstrapOwner(env)
    env.OWNER_PASSWORD = 'different-password-123'
    await bootstrapOwner(env)
    const response = await signIn('first-password-123')
    expect(response.status).toBe(200)
    expect((await signIn('different-password-123')).status).not.toBe(200)
    const cookie = response.headers.get('set-cookie')!.split(';')[0]
    expect((await getSession(env, new Headers({ cookie })))?.user.username).toBe('owner')
    const signup = await createAuth(env).handler(new Request('https://example.com/api/auth/sign-up/email', {
      method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://example.com' },
      body: JSON.stringify({ name: 'intruder', email: 'intruder@example.com', password: 'some-password-123' }),
    }))
    expect(signup.status).not.toBe(200)
  })

  it('authorizes private recovery, expires and replaces links, consumes once and revokes sessions', async () => {
    await bootstrapOwner(env)
    const login = await signIn('first-password-123')
    const cookie = login.headers.get('set-cookie')!.split(';')[0]
    await expect(issueTelegramRecoveryLink(env, '1', '123456', 'private')).rejects.toThrow()
    await expect(issueTelegramRecoveryLink(env, '123456', '123456', 'group')).rejects.toThrow()
    await expect(issueTelegramRecoveryLink(env, '123456', '7', 'private')).rejects.toThrow()
    const token = (link: string) => new URLSearchParams(new URL(link).hash.slice(1)).get('token')!
    const expired = token(await issueTelegramRecoveryLink(env, '123456', '123456', 'private'))
    await db.prepare('UPDATE auth_recovery SET expires_at = 0').run()
    expect(await consumeRecoveryToken(env, expired, 'second-password-123')).toBe(false)
    const old = token(await issueTelegramRecoveryLink(env, '123456', '123456', 'private'))
    const current = token(await issueTelegramRecoveryLink(env, '123456', '123456', 'private'))
    expect(await consumeRecoveryToken(env, old, 'second-password-123')).toBe(false)
    expect(await consumeRecoveryToken(env, current, 'short')).toBe(false)
    expect(await consumeRecoveryToken(env, current, 'second-password-123')).toBe(true)
    expect(await consumeRecoveryToken(env, current, 'third-password-123')).toBe(false)
    expect(await getSession(env, new Headers({ cookie }))).toBeNull()
    expect((await signIn('first-password-123')).status).not.toBe(200)
    expect((await signIn('second-password-123')).status).toBe(200)
  })

  it('does not recreate a deleted owner and validates configuration', async () => {
    await bootstrapOwner(env)
    await db.prepare('DELETE FROM auth_user').run()
    await bootstrapOwner({ ...env, OWNER_USERNAME: 'attacker', OWNER_PASSWORD: 'attacker-password' })
    expect((await db.prepare('SELECT count(*) AS n FROM auth_user').first())?.n).toBe(0)
    expect(() => createAuth({ ...env, BETTER_AUTH_URL: 'http://example.com' })).toThrow()
    await expect(issueTelegramRecoveryLink({ ...env, TRUSTED_TELEGRAM_USER_ID: undefined }, '123456', '123456', 'private')).rejects.toThrow()
  })

  it('serializes concurrent bootstrap and recovery attempts', async () => {
    await Promise.all([bootstrapOwner(env), bootstrapOwner(env)])
    expect((await db.prepare('SELECT count(*) AS n FROM auth_user').first())?.n).toBe(1)
    const link = await issueTelegramRecoveryLink(env, '123456', '123456', 'private')
    const token = new URLSearchParams(new URL(link).hash.slice(1)).get('token')!
    const results = await Promise.all([
      consumeRecoveryToken(env, token, 'second-password-123'),
      consumeRecoveryToken(env, token, 'third-password-123'),
    ])
    expect(results.filter(Boolean)).toHaveLength(1)
  })
})
