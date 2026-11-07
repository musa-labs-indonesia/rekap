import { timingSafeEqual } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { D1Database } from '@cloudflare/workers-types/index'
import { handleTelegramWebhook } from './telegram'
import type { TelegramEnv, TelegramRecovery } from './telegram'

let sqlite: DatabaseSync
let env: TelegramEnv
let replies: Array<{ chat_id: string; text: string; reply_parameters: { message_id: number } }>
const webhookSecret = 'test-webhook-secret-0123456789abcdef'

function database(db: DatabaseSync): D1Database {
  return {
    prepare(sql: string) {
      return {
        bind(...params: Array<string | number | null>) {
          return {
            async first() { return db.prepare(sql).get(...params) ?? null },
            async all() { return { results: db.prepare(sql).all(...params) } },
            async run() { return { meta: { changes: Number(db.prepare(sql).run(...params).changes) } } },
          }
        },
      }
    },
  } as unknown as D1Database
}

function request(text: string, options: { chat?: number; type?: string; from?: number; id?: number; date?: number; secret?: string } = {}) {
  return new Request('https://app.example/telegram', {
    method: 'POST',
    headers: { 'X-Telegram-Bot-Api-Secret-Token': options.secret ?? webhookSecret },
    body: JSON.stringify({ message: {
      message_id: options.id ?? 1,
      date: options.date ?? Math.floor(Date.now() / 1000),
      chat: { id: options.chat ?? -100, type: options.type ?? 'group' },
      from: { id: options.from ?? 77 },
      text,
    } }),
  })
}

function seedExpense(id: string, date: string, amount: number, profile = 'p') {
  sqlite.prepare('INSERT INTO expenses (id, profile_id, category_id, amount, item, occurred_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, profile, profile === 'p' ? 'c' : 'other-c', amount, id, Date.parse(date), Date.now())
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-03-01T17:30:00Z'))
  Object.defineProperty(crypto.subtle, 'timingSafeEqual', { configurable: true, value: (a: ArrayBuffer, b: ArrayBuffer) => timingSafeEqual(Buffer.from(a), Buffer.from(b)) })
  sqlite = new DatabaseSync(':memory:')
  sqlite.exec(readFileSync('migrations/0001_spending.sql', 'utf8'))
  sqlite.exec("INSERT INTO profiles VALUES ('p', 'Rumah', '-100', 0, 1), ('archived', 'Arsip', '-200', 1, 1), ('other', 'Lain', '-300', 0, 1)")
  sqlite.exec("INSERT INTO categories VALUES ('c', 'p', 'Makan', 'makan', 0), ('arch-c', 'p', 'Lama', 'lama', 1), ('other-c', 'other', 'Lain', 'lain', 0)")
  env = { DB: database(sqlite), TELEGRAM_BOT_TOKEN: 'token', TELEGRAM_BOT_USERNAME: 'bot', TELEGRAM_WEBHOOK_SECRET: webhookSecret, TRUSTED_TELEGRAM_USER_ID: '42', APP_URL: 'https://app.example' }
  replies = []
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
    replies.push(JSON.parse(String(init.body)))
    return Response.json({ ok: true })
  }))
})

afterEach(() => {
  sqlite.close()
  vi.unstubAllGlobals()
  vi.useRealTimers()
  Reflect.deleteProperty(crypto.subtle, 'timingSafeEqual')
})

describe('Telegram webhook', () => {
  it('checks webhook secret before any work and rejects malformed requests', async () => {
    expect((await handleTelegramWebhook(request('catat', { secret: 'wrong' }), env)).status).toBe(401)
    expect(replies).toHaveLength(0)
    expect((await handleTelegramWebhook(new Request('https://app.example', { headers: { 'X-Telegram-Bot-Api-Secret-Token': webhookSecret } }), env)).status).toBe(405)
    expect((await handleTelegramWebhook(new Request('https://app.example', { method: 'POST', headers: { 'X-Telegram-Bot-Api-Secret-Token': webhookSecret }, body: '{' }), env)).status).toBe(400)
  })

  it('rejects invalid configured webhook secrets even when the header matches', async () => {
    for (const secret of ['a'.repeat(31), 'a'.repeat(257), `${'a'.repeat(31)}!`]) {
      expect((await handleTelegramWebhook(request('/chatid', { secret }), { ...env, TELEGRAM_WEBHOOK_SECRET: secret })).status).toBe(401)
    }
    for (const secret of ['a'.repeat(32), 'a'.repeat(256)]) {
      expect((await handleTelegramWebhook(request('/chatid', { secret }), { ...env, TELEGRAM_WEBHOOK_SECRET: secret })).status).toBe(200)
    }
  })

  it('returns only the current chat ID before a profile is linked', async () => {
    await handleTelegramWebhook(request('/chatid@otherbot', { chat: -1009876543210 }), env)
    await handleTelegramWebhook(request('/chatid', { chat: -1009876543210, secret: 'wrong' }), env)
    expect(replies).toHaveLength(0)
    await handleTelegramWebhook(request('/CHATID@bot', { chat: -1009876543210, id: 7 }), env)
    await handleTelegramWebhook(request('/chatid', { chat: 42, type: 'private', id: 8 }), env)
    await handleTelegramWebhook(request('/chatid', { chat: -200, id: 9 }), env)
    expect(replies.map(({ chat_id, text, reply_parameters }) => ({ chat_id, text, message_id: reply_parameters.message_id }))).toEqual([
      { chat_id: '-1009876543210', text: 'ID chat: -1009876543210', message_id: 7 },
      { chat_id: '42', text: 'ID chat: 42', message_id: 8 },
      { chat_id: '-200', text: 'ID chat: -200', message_id: 9 },
    ])
  })

  it('rejects unknown and archived chats, while allowing group members', async () => {
    await handleTelegramWebhook(request('catat, 20000, nasi, makan', { chat: -999 }), env)
    await handleTelegramWebhook(request('catat, 20000, nasi, makan', { chat: -200 }), env)
    expect(replies.every((r) => r.text.includes('belum terhubung'))).toBe(true)
    await handleTelegramWebhook(request('CaTaT, 20.000, nasi, mAkAn', { from: 99 }), env)
    expect(replies.at(-1)?.text).toContain('Tercatat: Rp20.000 · Makan · nasi, 2 Mar.')
    expect(replies.at(-1)?.text).toContain('Total Maret: Rp20.000 dari 1 transaksi')
    expect(replies.at(-1)?.reply_parameters.message_id).toBe(1)
    expect(sqlite.prepare('SELECT amount, occurred_at, telegram_chat_id FROM expenses').get()).toMatchObject({ amount: 20000, occurred_at: Date.now(), telegram_chat_id: '-100' })
  })

  it('validates amounts, fields, and active profile-specific categories', async () => {
    const inputs = ['catat, 0, nasi, makan', 'catat, -10, nasi, makan', 'catat, 12.34, nasi, makan', 'catat, 1,5, nasi, makan', 'catat, 9007199254740992, nasi, makan', 'catat, 10, , makan', 'catat, 10, nasi', 'catat, 10, nasi, Lama', 'catat, 10, nasi, Lain']
    for (const [index, input] of inputs.entries()) await handleTelegramWebhook(request(input, { id: index + 1 }), env)
    expect(replies.slice(0, 7).every((reply) => reply.text.includes('Format:'))).toBe(true)
    expect(replies.slice(7).every((reply) => reply.text.includes('tidak ditemukan'))).toBe(true)
    expect(sqlite.prepare('SELECT count(*) AS n FROM expenses').get()?.n).toBe(0)
  })

  it('handles duplicate deliveries and retries after a send failure without another expense', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('failed', { status: 500 }))
    expect((await handleTelegramWebhook(request('catat, 1000, kopi, makan'), env)).status).toBe(500)
    expect((await handleTelegramWebhook(request('catat, 1000, kopi, makan'), env)).status).toBe(200)
    expect(replies.at(-1)?.text).toContain('sudah dicatat')
    expect(sqlite.prepare('SELECT count(*) AS n FROM expenses').get()?.n).toBe(1)
    await handleTelegramWebhook(request('catat, 1000, kopi, makan', { id: 2 }), env)
    expect(replies.at(-1)?.text).toContain('Rp2.000')
    sqlite.exec("DELETE FROM expenses WHERE telegram_message_id = 1")
    await handleTelegramWebhook(request('catat, 1000, kopi, makan'), env)
    expect(sqlite.prepare('SELECT count(*) AS n FROM expenses').get()?.n).toBe(1)
  })

  it('adds categories case-insensitively without reviving archived categories', async () => {
    await handleTelegramWebhook(request('/addcategory@otherbot ignored'), env)
    expect(replies).toHaveLength(0)
    await handleTelegramWebhook(request('/ADDCATEGORY@bot Transport'), env)
    expect(replies.at(-1)?.text).toContain('ditambahkan')
    await handleTelegramWebhook(request('/addcategory transport'), env)
    await handleTelegramWebhook(request('/addcategory Lama'), env)
    expect(replies.at(-1)?.text).toContain('diarsipkan')
    await handleTelegramWebhook(request('/addcategory'), env)
    expect(replies.at(-1)?.text).toContain('Format:')
    expect(sqlite.prepare("SELECT count(*) AS n FROM categories WHERE profile_id = 'p'").get()?.n).toBe(3)
  })

  it('matches normalized Unicode category names', async () => {
    await handleTelegramWebhook(request('/addcategory Café'), env)
    await handleTelegramWebhook(request('/addcategory CAFE\u0301'), env)
    expect(replies.at(-1)?.text).toContain('sudah ada')
    await handleTelegramWebhook(request('catat, 1000, kopi, CAFÉ', { id: 3 }), env)
    expect(replies.at(-1)?.text).toContain('Café · kopi')
  })

  it('rejects transactions that would make profile totals inexact', async () => {
    seedExpense('large', '2026-03-01T17:00:00Z', 8999999999999999)
    await handleTelegramWebhook(request('catat, 2, kopi, makan'), env)
    expect(replies.at(-1)?.text).toContain('melebihi batas')
    expect(sqlite.prepare('SELECT count(*) AS n FROM expenses').get()?.n).toBe(1)
    await handleTelegramWebhook(request('catat, 1, kopi, makan', { id: 2 }), env)
    expect(replies.at(-1)?.text).toContain('Rp9.000.000.000.000.000')
  })

  it('reports Jakarta calendar periods and the three latest transactions for the profile', async () => {
    seedExpense('early', '2026-03-01T16:59:59Z', 100)
    seedExpense('first', '2026-03-01T17:00:00Z', 200)
    seedExpense('second', '2026-03-01T17:01:00Z', 300)
    seedExpense('third', '2026-03-01T17:02:00Z', 400)
    seedExpense('fourth', '2026-03-01T17:03:00Z', 500)
    seedExpense('past-month', '2026-02-28T16:59:59Z', 1000)
    seedExpense('other-profile', '2026-03-01T17:04:00Z', 9000, 'other')
    await handleTelegramWebhook(request('/report_daily'), env)
    expect(replies.at(-1)?.text).toContain('Rp1.400 (4 transaksi)')
    expect(replies.at(-1)?.text).toContain('fourth')
    expect(replies.at(-1)?.text).not.toContain('first')
    expect(replies.at(-1)?.text).not.toContain('other-profile')
    await handleTelegramWebhook(request('/report_weekly'), env)
    expect(replies.at(-1)?.text).toContain('Rp1.400 (4 transaksi)')
    await handleTelegramWebhook(request('/report_monthly'), env)
    expect(replies.at(-1)?.text).toContain('Rp1.500 (5 transaksi)')
  })

  it('only invokes recovery for the trusted private user, including unlinked chats', async () => {
    const recovery = vi.fn<TelegramRecovery>(async () => 'Buka tautan pemulihan')
    await handleTelegramWebhook(request('/forgot_password', { chat: -100, from: 42 }), env, recovery)
    await handleTelegramWebhook(request('/forgot_password', { chat: 41, type: 'private', from: 41 }), env, recovery)
    expect(recovery).not.toHaveBeenCalled()
    await handleTelegramWebhook(request('/forgot_password', { chat: 42, type: 'private', from: 42 }), env, recovery)
    expect(recovery).toHaveBeenCalledWith({ chatId: '42', userId: '42', appUrl: 'https://app.example' })
    expect(replies.at(-1)?.text).toBe('Buka tautan pemulihan')
    await handleTelegramWebhook(request('/forgot_password', { chat: 42, type: 'private', from: 42 }), env)
    expect(replies.at(-1)?.text).toContain('belum tersedia')
  })
})
