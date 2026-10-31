import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { AdminUser, Permission } from '@/types'
import { api } from '@/services/api'
import { AUTH_EXPIRED_EVENT } from '@/services/errors'
import { siteKeys } from '@/queries/keys'
import { SERVER_MODE } from '@/config/api'
import { permissionsFor } from '@/lib/rbac'
import { localSession } from '@/services/localSession'

/**
 * Server mode uses the server-verified HttpOnly cookie. Static mode has an explicitly
 * unverified, JavaScript-readable local access gate for local-only preview use.
 */
type Status = 'idle' | 'checking' | 'authenticated' | 'anonymous'

interface AuthContextValue {
  user: AdminUser | null
  permissions: Permission[]
  status: Status
  can: (p: Permission) => boolean
  /** Check the session once (no-op if already known). */
  ensureSession: () => void
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  /** True right after the server rejected the session (shown on the login page). */
  expired: boolean
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const [user, setUser] = useState<AdminUser | null>(null)
  const [permissions, setPermissions] = useState<Permission[]>([])
  const [status, setStatus] = useState<Status>('idle')
  const [expired, setExpired] = useState(false)
  const checking = useRef<Promise<void> | null>(null)

  const clear = useCallback(() => {
    setUser(null)
    setPermissions([])
    setStatus('anonymous')
    qc.removeQueries({ queryKey: ['admin'] })
    qc.removeQueries({ queryKey: siteKeys.collection('enquiries') })
    qc.removeQueries({ queryKey: siteKeys.collection('quotations') })
  }, [qc])

  const ensureSession = useCallback(() => {
    if (status !== 'idle' || checking.current) return
    setStatus('checking')
    const session = SERVER_MODE ? api.me() : Promise.resolve(localSession.currentUser()
      ? {
          user: localSession.currentUser()!,
          permissions: permissionsFor('admin').filter((permission) => permission !== 'users:manage'),
        }
      : null)
    checking.current = session
      .then((p) => {
        if (!p) {
          setStatus('anonymous')
          return
        }
        setUser(p.user)
        setPermissions(p.permissions)
        setStatus('authenticated')
      })
      .catch(() => { setStatus('anonymous') })
      .finally(() => { checking.current = null })
  }, [status])

  // Any 401 from an admin request means the session ended (expired, revoked, user disabled).
  useEffect(() => {
    const onExpired = () => {
      if (status !== 'authenticated') return
      setExpired(true)
      clear()
    }
    window.addEventListener(AUTH_EXPIRED_EVENT, onExpired)
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, onExpired)
  }, [status, clear])

  const login = useCallback(async (email: string, password: string) => {
    if (SERVER_MODE) {
      const p = await api.login(email, password)
      setUser(p.user)
      setPermissions(p.permissions)
    } else {
      setUser(localSession.login(email, password))
      setPermissions(permissionsFor('admin').filter((permission) => permission !== 'users:manage'))
    }
    setStatus('authenticated')
    setExpired(false)
    // Staff see drafts too: re-read website data with the new session.
    void qc.invalidateQueries({ queryKey: siteKeys.all })
  }, [qc])

  const logout = useCallback(async () => {
    try {
      if (SERVER_MODE) await api.logout()
      else localSession.logout()
    } finally {
      clear()
      void qc.invalidateQueries({ queryKey: siteKeys.all })
    }
  }, [clear, qc])

  const value = useMemo<AuthContextValue>(() => ({
    user, permissions, status, expired, ensureSession, login, logout,
    can: (p) => permissions.includes(p),
  }), [user, permissions, status, expired, ensureSession, login, logout])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
