import { env } from 'cloudflare:workers'

export const bindings = env
export const authEnv = { ...env, BETTER_AUTH_URL: env.APP_URL }
