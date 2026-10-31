import type { Role, StaffUser } from '@/types'
import type { AuthProfile } from './api'
import { http } from './http'
import { serverSession } from './session'

/**
 * Server-mode replacements for the demo auth and user methods of mockApi.
 * Passwords are checked (scrypt) and roles enforced by the server; the browser never sees hashes.
 */
type ServerProfile = AuthProfile & { csrfToken: string }
const remember = (p: ServerProfile): AuthProfile => {
  serverSession.set(p.user)
  return { user: p.user, permissions: p.permissions }
}

export const serverAuthApi = {
  async login(email: string, password: string): Promise<AuthProfile> {
    return remember(await http<ServerProfile>('POST', '/auth/login', { json: { email, password }, quiet401: true }))
  },
  async me(): Promise<AuthProfile> {
    try { return remember(await http<ServerProfile>('GET', '/auth/me', { quiet401: true })) } catch (e) { serverSession.set(null); throw e }
  },
  async logout(): Promise<void> {
    try { await http('POST', '/auth/logout', { quiet401: true }) } finally { serverSession.set(null) }
  },
  async logoutEverywhere(): Promise<void> {
    try { await http('POST', '/auth/logout-all', { quiet401: true }) } finally { serverSession.set(null) }
  },
  async changePassword(currentPassword: string, newPassword: string): Promise<{ ok: true }> {
    return http('POST', '/auth/password', { json: { currentPassword, newPassword } })
  },
  listUsers: (): Promise<StaffUser[]> => http('GET', '/users'),
  createUser: (u: { name: string; email: string; role: Role; password: string }): Promise<StaffUser> => http('POST', '/users', { json: u }),
  updateUser: (id: string, patch: Partial<{ name: string; role: Role; isActive: boolean; password: string }>): Promise<StaffUser> =>
    http('PATCH', `/users/${encodeURIComponent(id)}`, { json: patch }),
  deleteUser: async (id: string): Promise<void> => { await http('DELETE', `/users/${encodeURIComponent(id)}`) },
}
