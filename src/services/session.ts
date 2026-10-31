import type { AdminUser } from '@/types'

/**
 * In server mode, the signed-in user as confirmed by the server (/api/auth/me or /login).
 * The in-browser data layer (src/mocks/mockApi.ts) reads the role from here for its permission
 * checks instead of the demo session, so the demo accounts cannot be used.
 */
let current: AdminUser | null = null
export const serverSession = {
  get: () => current,
  set: (u: AdminUser | null) => { current = u },
}
