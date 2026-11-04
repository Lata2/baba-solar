import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { api } from '@/services/api'
import { localSession, SESSION_KEY } from '@/services/localSession'

/** Minimal browser stand-in: localStorage + window for the session module. */
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
let store: Record<string, string>

beforeEach(() => {
  store = {}
  const localStorage = {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => { store[k] = String(v) },
    removeItem: (k: string) => { delete store[k] },
  }
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage, location: { protocol: 'http:' } } })
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { cookie: '' } })
})

afterEach(() => {
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow)
  else Reflect.deleteProperty(globalThis, 'window')
  if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument)
  else Reflect.deleteProperty(globalThis, 'document')
})

describe('frontend-only admin sign-in', () => {
  it('rejects wrong credentials', async () => {
    await expect(api.login('admin@babasolars.com', 'wrong')).rejects.toMatchObject({ code: 'unauthorized' })
    await expect(api.login('someone@example.com', 'Admin@123')).rejects.toMatchObject({ code: 'unauthorized' })
    await expect(api.login('', '')).rejects.toMatchObject({ code: 'validation' })
    expect(store[SESSION_KEY]).toBeUndefined()
  })

  it('accepts the admin account (email case-insensitive), keeps the session and logs out', async () => {
    const profile = await api.login('Admin@BabaSolars.com ', 'Admin@123')
    expect(profile.user.email).toBe('admin@babasolars.com')
    expect(profile.permissions).toContain('content:write')
    expect(store[SESSION_KEY]).toBeTruthy()
    // "Refresh": a new read of the stored session
    expect((await api.me()).user.email).toBe('admin@babasolars.com')
    await api.logout()
    expect(localSession.currentUser()).toBeNull()
    await expect(api.me()).rejects.toMatchObject({ code: 'unauthorized' })
  })

  it('expires old sessions', async () => {
    store[SESSION_KEY] = JSON.stringify({ email: 'admin@babasolars.com', expiresAt: Date.now() - 1000 })
    expect(localSession.currentUser()).toBeNull()
    expect(store[SESSION_KEY]).toBeUndefined()
  })
})
