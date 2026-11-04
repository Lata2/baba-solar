import type { Permission, Role } from '@/types'

/** Role → permissions. Mirrors what the backend will enforce (admin / editor / sales). */
export const PERMISSIONS: Record<Permission, Role[]> = {
  'content:read': ['admin', 'editor', 'sales'],
  'content:write': ['admin', 'editor'],
  'uploads:write': ['admin', 'editor', 'sales'],
  'leads:read': ['admin', 'sales'],
  'leads:write': ['admin', 'sales'],
  'companies:read': ['admin', 'sales', 'editor'],
  'companies:write': ['admin', 'sales'],
  'quotations:read': ['admin', 'sales'],
  'quotations:write': ['admin', 'sales'],
  'invoices:read': ['admin', 'sales'],
  'invoices:write': ['admin', 'sales'],
  'invoices:delete': ['admin'],
  'business:read': ['admin', 'sales', 'editor'],
  'business:write': ['admin'],
  'users:manage': ['admin'],
  'backup:manage': ['admin'],
}
export const permissionsFor = (role: Role): Permission[] => (Object.keys(PERMISSIONS) as Permission[]).filter((p) => PERMISSIONS[p].includes(role))
