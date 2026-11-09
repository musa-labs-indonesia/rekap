import { afterEach, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ installed: 'a'.repeat(64), signedIn: true }))
vi.mock('./env', () => ({ authEnv: {}, bindings: { get REKAP_ARTIFACT_ID() { return state.installed } } }))
vi.mock('./auth', () => ({ getSession: () => state.signedIn ? { user: { id: 'owner' } } : null }))

import { Route } from '../routes/api/update'

const get = (Route.options as unknown as { server: { handlers: { GET: (context: { request: Request }) => Promise<Response> } } }).server.handlers.GET
const request = () => get({ request: new Request('https://rekap.test/api/update') })

afterEach(() => {
  state.installed = 'a'.repeat(64)
  state.signedIn = true
  vi.unstubAllGlobals()
})

it('reports the deployable installer build without exposing update status to anonymous requests', async () => {
  let latest: unknown = { artifactId: 'a'.repeat(64) }
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(latest)))

  expect(await (await request()).json()).toEqual({ status: 'current' })
  latest = { artifactId: 'b'.repeat(64) }
  expect(await (await request()).json()).toEqual({ status: 'available' })
  latest = { artifactId: 'invalid' }
  expect(await (await request()).json()).toEqual({ status: 'unknown' })
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network failed') }))
  expect(await (await request()).json()).toEqual({ status: 'unknown' })
  state.installed = ''
  expect(await (await request()).json()).toEqual({ status: 'unknown' })
  state.signedIn = false
  expect((await request()).status).toBe(401)
})
