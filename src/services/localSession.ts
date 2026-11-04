import type { AdminUser } from '@/types'
import { ADMIN_ACCOUNT, SESSION_HOURS } from '@/config/auth'
import { ApiError } from './errors'

/**
 * Browser-only admin session (see the limitations in src/config/auth.ts).
 * Stored in localStorage so it survives refreshes and is shared by tabs; it expires after
 * SESSION_HOURS of inactivity.
 */
export const SESSION_KEY = 'baba-solars:admin-session'
const LEGACY_COOKIE = 'baba-solars-admin-session'
const TTL = SESSION_HOURS * 60 * 60 * 1000

interface StoredSession { email: string; expiresAt: number }

const user = (): AdminUser => ({ id: 'admin', name: ADMIN_ACCOUNT.name, email: ADMIN_ACCOUNT.email, role: 'admin' })

function read(): StoredSession | null {
  try {
    const raw = window.localStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const s = JSON.parse(raw) as Partial<StoredSession>
    if (typeof s.email !== 'string' || typeof s.expiresAt !== 'number') return null
    return s as StoredSession
  } catch {
    return null
  }
}

function write(s: StoredSession | null) {
  try {
    if (s) window.localStorage.setItem(SESSION_KEY, JSON.stringify(s))
    else window.localStorage.removeItem(SESSION_KEY)
  } catch {
    if (s) throw new ApiError('This browser blocks local storage, so you cannot stay signed in. Turn off private browsing and try again.', { code: 'storage' })
  }
}

export const localSession = {
  currentUser(): AdminUser | null {
    if (typeof window === 'undefined') return null
    const s = read()
    if (!s || s.email !== ADMIN_ACCOUNT.email) return null
    if (s.expiresAt < Date.now()) { write(null); return null }
    // Sliding expiry: renew at most once a minute while the admin is active.
    if (s.expiresAt - Date.now() < TTL - 60_000) write({ ...s, expiresAt: Date.now() + TTL })
    return user()
  },

  login(email: string, password: string): AdminUser {
    if (!email.trim() || !password) throw new ApiError('Enter your email and password.', { code: 'validation' })
    if (typeof window === 'undefined') throw new ApiError('Sign-in is only available in a browser.', { code: 'network' })
    if (email.trim().toLowerCase() !== ADMIN_ACCOUNT.email || password !== ADMIN_ACCOUNT.password) {
      throw new ApiError('Incorrect email or password.', { code: 'unauthorized', status: 401 })
    }
    write({ email: ADMIN_ACCOUNT.email, expiresAt: Date.now() + TTL })
    return user()
  },

  logout(): void {
    if (typeof window === 'undefined') return
    write(null)
    // Remove the cookie used by earlier releases.
    try { document.cookie = `${LEGACY_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax` } catch { /* ignore */ }
  },
}
