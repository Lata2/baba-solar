import { useEffect, type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router'
import type { Permission } from '@/types'
import { useAuth } from '@/context/AuthContext'
import { PageLoader } from '@/components/layout/PageLoader'
import { EmptyState } from '@/components/ui'

/** Admin route guard: checks the server session; optionally requires a permission. */
export function RequireAuth({ children, permission }: { children: ReactNode; permission?: Permission }) {
  const { status, ensureSession, can } = useAuth()
  const location = useLocation()
  useEffect(() => { ensureSession() }, [ensureSession])
  if (status === 'idle' || status === 'checking') return <div className="min-h-dvh"><PageLoader label="Checking your session" /></div>
  if (status === 'anonymous') return <Navigate to="/admin/login" replace state={{ from: location.pathname + location.search }} />
  if (permission && !can(permission)) return <Forbidden />
  return <>{children}</>
}

/** Same check for a single admin page inside the layout. */
export function RequirePermission({ permission, children }: { permission: Permission; children: ReactNode }) {
  const { can } = useAuth()
  return can(permission) ? <>{children}</> : <Forbidden />
}

function Forbidden() {
  return <EmptyState title="No access" message="Your role does not include this section. Ask an admin if you need it." className="mt-8" />
}
