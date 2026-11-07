import { betterAuth } from 'better-auth'
import { hashPassword } from 'better-auth/crypto'
import { username } from 'better-auth/plugins'
import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import type { D1Database } from '@cloudflare/workers-types/index.ts'
import { drizzle } from 'drizzle-orm/d1'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export interface AuthEnv {
  DB: D1Database
  BETTER_AUTH_SECRET: string
  BETTER_AUTH_URL: string
  OWNER_USERNAME?: string
  OWNER_PASSWORD?: string
  TRUSTED_TELEGRAM_USER_ID?: string
}

const user = sqliteTable('auth_user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: integer('email_verified', { mode: 'boolean' }).notNull(),
  image: text('image'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  username: text('username').unique(),
  displayUsername: text('display_username'),
})

const session = sqliteTable('auth_session', {
  id: text('id').primaryKey(),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  token: text('token').notNull().unique(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: text('user_id').notNull(),
})

const account = sqliteTable('auth_account', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id').notNull(),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: integer('access_token_expires_at', { mode: 'timestamp_ms' }),
  refreshTokenExpiresAt: integer('refresh_token_expires_at', { mode: 'timestamp_ms' }),
  scope: text('scope'),
  password: text('password'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
})

const verification = sqliteTable('auth_verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
})

function origin(env: AuthEnv): string {
  const url = new URL(env.BETTER_AUTH_URL)
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('BETTER_AUTH_URL must be an HTTPS origin')
  }
  if (!env.BETTER_AUTH_SECRET || env.BETTER_AUTH_SECRET.length < 32) throw new Error('BETTER_AUTH_SECRET must contain at least 32 characters')
  return url.origin
}

function validPassword(password: string): boolean {
  return password.length >= 12 && password.length <= 128
}

export function createAuth(env: AuthEnv) {
  const baseURL = origin(env)
  return betterAuth({
    baseURL,
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(drizzle(env.DB), { provider: 'sqlite', schema: { user, session, account, verification } }),
    trustedOrigins: [baseURL],
    emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: 12, maxPasswordLength: 128, revokeSessionsOnPasswordReset: true },
    plugins: [username()],
    session: { cookieCache: { enabled: false } },
  })
}

export async function bootstrapOwner(env: AuthEnv): Promise<void> {
  origin(env)
  const marker = await env.DB.prepare('SELECT user_id FROM auth_owner_bootstrap WHERE id = 1').first()
  if (marker) return
  const name = env.OWNER_USERNAME
  const password = env.OWNER_PASSWORD
  if (!name || !/^[a-zA-Z0-9_.]{3,30}$/.test(name) || !password || !validPassword(password)) throw new Error('Valid OWNER_USERNAME and OWNER_PASSWORD are required for bootstrap')
  const id = crypto.randomUUID()
  const now = Date.now()
  const hash = await hashPassword(password)
  try {
    await env.DB.batch([
      env.DB.prepare('INSERT INTO auth_owner_bootstrap (id, user_id) VALUES (1, ?)').bind(id),
      env.DB.prepare('INSERT INTO auth_user (id, name, email, email_verified, created_at, updated_at, username, display_username) VALUES (?, ?, ?, 0, ?, ?, ?, ?)').bind(id, name, `${id}@owner.invalid`, now, now, name.toLowerCase(), name),
      env.DB.prepare("INSERT INTO auth_account (id, account_id, provider_id, user_id, password, created_at, updated_at) VALUES (?, ?, 'credential', ?, ?, ?, ?)").bind(crypto.randomUUID(), id, id, hash, now, now),
    ])
  } catch (error) {
    if (!await env.DB.prepare('SELECT user_id FROM auth_owner_bootstrap WHERE id = 1').first()) throw error
  }
}

export async function getSession(env: AuthEnv, headers: Headers) {
  return createAuth(env).api.getSession({ headers })
}

async function tokenHash(token: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function issueTelegramRecoveryLink(env: AuthEnv, senderId: string, chatId: string, chatType: string): Promise<string> {
  const baseURL = origin(env)
  const trusted = env.TRUSTED_TELEGRAM_USER_ID
  if (!trusted || !/^[1-9][0-9]*$/.test(trusted) || senderId !== trusted || chatId !== trusted || chatType !== 'private') throw new Error('Unauthorized recovery request')
  const owner = await env.DB.prepare('SELECT user_id FROM auth_owner_bootstrap WHERE id = 1').first()
  if (!owner) throw new Error('Owner is not initialized')
  const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, '0')).join('')
  await env.DB.prepare('INSERT INTO auth_recovery (id, token_hash, expires_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET token_hash = excluded.token_hash, expires_at = excluded.expires_at').bind(await tokenHash(token), Date.now() + 10 * 60 * 1000).run()
  return `${baseURL}/recover#token=${token}`
}

export async function consumeRecoveryToken(env: AuthEnv, token: string, newPassword: string): Promise<boolean> {
  origin(env)
  if (!/^[0-9a-f]{64}$/.test(token) || !validPassword(newPassword)) return false
  const digest = await tokenHash(token)
  const exists = await env.DB.prepare('SELECT id FROM auth_recovery WHERE id = 1 AND token_hash = ? AND expires_at > ?').bind(digest, Date.now()).first()
  if (!exists) return false
  const hash = await hashPassword(newPassword)
  const now = Date.now()
  const results = await env.DB.batch([
    env.DB.prepare("UPDATE auth_account SET password = ?, updated_at = ? WHERE provider_id = 'credential' AND user_id = (SELECT user_id FROM auth_owner_bootstrap WHERE id = 1) AND EXISTS (SELECT 1 FROM auth_recovery WHERE id = 1 AND token_hash = ? AND expires_at > ?)").bind(hash, now, digest, now),
    env.DB.prepare('DELETE FROM auth_session WHERE user_id = (SELECT user_id FROM auth_owner_bootstrap WHERE id = 1) AND EXISTS (SELECT 1 FROM auth_recovery WHERE id = 1 AND token_hash = ? AND expires_at > ?)').bind(digest, now),
    env.DB.prepare('DELETE FROM auth_recovery WHERE id = 1 AND token_hash = ? AND expires_at > ?').bind(digest, now),
  ])
  return results[0].meta.changes === 1
}
