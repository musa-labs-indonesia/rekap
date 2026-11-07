import { bindings, defineConfig } from 'cf/config'

export default defineConfig({
  worker: {
    name: 'rekap',
    entrypoint: '@tanstack/react-start/server-entry',
    compatibilityDate: '2026-11-07',
    compatibilityFlags: ['nodejs_compat'],
    observability: { enabled: true, traces: { enabled: false }, redactQueryString: true },
    env: {
      DB: bindings.d1({ name: 'rekap', id: process.env.D1_DATABASE_ID || '11111111-1111-4111-8111-111111111111' }),
      BETTER_AUTH_SECRET: bindings.secret(),
      OWNER_USERNAME: bindings.secret(),
      OWNER_PASSWORD: bindings.secret(),
      TELEGRAM_BOT_TOKEN: bindings.secret(),
      TELEGRAM_BOT_USERNAME: bindings.secret(),
      TELEGRAM_WEBHOOK_SECRET: bindings.secret(),
      TRUSTED_TELEGRAM_USER_ID: bindings.secret(),
      APP_URL: bindings.secret(),
    },
  },
})
