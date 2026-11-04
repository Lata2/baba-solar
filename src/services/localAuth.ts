import { permissionsFor } from '@/lib/rbac'
import { ApiError } from './errors'
import { localSession } from './localSession'
import type { AuthProfile } from './api'

const permissions = permissionsFor('admin').filter((permission) => permission !== 'users:manage')

/** Frontend-only auth service. Swap for an HTTP implementation when a backend exists. */
export const localAuthApi = {
  async login(email: string, password: string): Promise<AuthProfile> {
    await new Promise((r) => setTimeout(r, 250)) // same feel as a network call; no timing oracle worth defending here
    return { user: localSession.login(email, password), permissions }
  },
  async me(): Promise<AuthProfile> {
    const user = localSession.currentUser()
    if (!user) throw new ApiError('Please sign in.', { code: 'unauthorized', status: 401 })
    return { user, permissions }
  },
  async logout(): Promise<void> {
    localSession.logout()
  },
}
