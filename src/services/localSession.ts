import type { AdminUser } from '@/types'
import { ApiError } from './errors'

const COOKIE_NAME = 'baba-solars-local-admin'
const SESSION_SECONDS = 8 * 60 * 60
const LOCAL_ADMIN: AdminUser = {
  id: 'local-admin',
  name: 'Local admin',
  email: 'local-admin@local.invalid',
  role: 'admin',
}

function cookieValue(): string | null {
  if (typeof document === 'undefined') return null
  const entry = document.cookie
    .split('; ')
    .find((part) => part.startsWith(`${COOKIE_NAME}=`))
  return entry ? entry.slice(COOKIE_NAME.length + 1) : null
}

function cookieAttributes(maxAge: number): string {
  const secure = window.location.protocol === 'https:' ? '; Secure' : ''
  return `Path=/; Max-Age=${maxAge}; SameSite=Lax${secure}`
}

export const localSession = {
  currentUser: (): AdminUser | null => cookieValue() === 'active' ? LOCAL_ADMIN : null,

  login(email: string, password: string): AdminUser {
    if (!email.trim() || !password) {
      throw new ApiError('Enter your email and password.', { code: 'validation' })
    }

    if (typeof document === 'undefined' || typeof window === 'undefined') {
      throw new ApiError('Local admin sign-in is only available in a browser.', { code: 'network' })
    }
    document.cookie = `${COOKIE_NAME}=active; ${cookieAttributes(SESSION_SECONDS)}`
    if (cookieValue() !== 'active') {
      throw new ApiError('The browser blocked the local session cookie. Check your cookie settings and try again.', {
        code: 'storage',
      })
    }
    return LOCAL_ADMIN
  },

  logout(): void {
    if (typeof document !== 'undefined') {
      document.cookie = `${COOKIE_NAME}=; ${cookieAttributes(0)}`
    }
  },
}
