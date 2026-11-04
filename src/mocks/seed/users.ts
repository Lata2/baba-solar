import type { Role } from '@/types'

export interface MockUser { id: string; name: string; email: string; role: Role; isActive: boolean; lastLoginAt: string | null; createdAt: string; updatedAt: string }
