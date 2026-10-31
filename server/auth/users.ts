import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Role, StaffUser } from '../../src/types'
import { JsonStore } from '../storage/jsonStore'
import { hashPassword } from './passwords'

export interface UserRecord extends StaffUser {
  passwordHash: string
  passwordChangedAt: string
}

/** Repository interface — JSON file today, a database table later. */
export interface UserRepository {
  list(): Promise<UserRecord[]>
  byId(id: string): Promise<UserRecord | null>
  byEmail(email: string): Promise<UserRecord | null>
  create(u: { name: string; email: string; role: Role; password: string }): Promise<UserRecord>
  update(id: string, patch: Partial<Pick<UserRecord, 'name' | 'role' | 'isActive' | 'lastLoginAt'>> & { password?: string }): Promise<UserRecord | null>
  remove(id: string): Promise<void>
}

export const ROLES: Role[] = ['admin', 'editor', 'sales']
export const publicUser = (u: UserRecord): StaffUser => ({
  id: u.id, name: u.name, email: u.email, role: u.role, isActive: u.isActive, lastLoginAt: u.lastLoginAt, createdAt: u.createdAt, updatedAt: u.updatedAt,
})

export function jsonUserRepository(dataDir: string): UserRepository {
  const store = new JsonStore<{ users: UserRecord[] }>(path.join(dataDir, 'users.json'), () => ({ users: [] }))
  const now = () => new Date().toISOString()
  return {
    async list() { return (await store.read()).users },
    async byId(id) { return (await store.read()).users.find((u) => u.id === id) ?? null },
    async byEmail(email) {
      const e = email.trim().toLowerCase()
      return (await store.read()).users.find((u) => u.email === e) ?? null
    },
    async create(u) {
      const passwordHash = await hashPassword(u.password)
      return store.update((d) => {
        const email = u.email.trim().toLowerCase()
        if (d.users.some((x) => x.email === email)) throw Object.assign(new Error('A user with this email already exists.'), { status: 409, field: 'email' })
        const row: UserRecord = {
          id: `u_${randomUUID()}`, name: u.name.trim(), email, role: u.role, isActive: true, lastLoginAt: null,
          createdAt: now(), updatedAt: now(), passwordHash, passwordChangedAt: now(),
        }
        d.users.push(row)
        return row
      })
    },
    async update(id, patch) {
      const passwordHash = patch.password ? await hashPassword(patch.password) : null
      return store.update((d) => {
        const u = d.users.find((x) => x.id === id)
        if (!u) return null
        if (patch.name !== undefined) u.name = patch.name.trim()
        if (patch.role !== undefined) u.role = patch.role
        if (patch.isActive !== undefined) u.isActive = patch.isActive
        if (patch.lastLoginAt !== undefined) u.lastLoginAt = patch.lastLoginAt
        if (passwordHash) { u.passwordHash = passwordHash; u.passwordChangedAt = now() }
        if (patch.lastLoginAt === undefined) u.updatedAt = now()
        return u
      })
    },
    async remove(id) {
      await store.update((d) => { d.users = d.users.filter((u) => u.id !== id) })
    },
  }
}
