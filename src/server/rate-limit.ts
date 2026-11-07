import type { D1Database } from '@cloudflare/workers-types/index'

export async function rateLimit(db: D1Database, request: Request, action: string): Promise<boolean> {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown'
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${action}:${ip}`))
  const key = Array.from(new Uint8Array(bytes), value => value.toString(16).padStart(2, '0')).join('')
  const now = Date.now()
  const result = await db.prepare('INSERT INTO auth_rate_limit (key, window_start, attempts) VALUES (?, ?, 1) ON CONFLICT(key) DO UPDATE SET attempts = CASE WHEN window_start <= ? THEN 1 ELSE attempts + 1 END, window_start = CASE WHEN window_start <= ? THEN ? ELSE window_start END RETURNING attempts').bind(key, now, now - 60000, now - 60000, now).first<{ attempts: number }>()
  return !!result && result.attempts <= 10
}
