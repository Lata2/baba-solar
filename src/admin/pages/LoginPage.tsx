import { useEffect, useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router'
import { LockKeyhole } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { useSeo } from '@/hooks/useSeo'
import { ApiError } from '@/services/api'
import { Button, Card, Input } from '@/components/ui'
import { LogoMark } from '@/components/layout/Logo'
import { optionalEmail, required } from '@/lib/validation'
import { SERVER_MODE } from '@/config/api'

export default function LoginPage() {
  const { status, login, ensureSession, expired } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  useSeo({ title: 'Admin login', path: '/admin/login', noIndex: true })
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<{ email?: string; password?: string; form?: string }>({})
  const [loading, setLoading] = useState(false)
  const requestedFrom = (location.state as { from?: string } | null)?.from
  const from = typeof requestedFrom === 'string'
    && (requestedFrom === '/admin' || requestedFrom.startsWith('/admin/'))
    && !requestedFrom.includes('\\')
    ? requestedFrom
    : '/admin'

  useEffect(() => { ensureSession() }, [ensureSession])
  if (status === 'authenticated') return <Navigate to={from} replace />

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const next: typeof errors = {}
    next.email = required('email')(email) || optionalEmail(email) || undefined
    next.password = required('password')(password) || undefined
    setErrors(next)
    if (Object.values(next).some(Boolean)) return
    setLoading(true)
    try {
      await login(email.trim(), password)
      navigate(from, { replace: true })
    } catch (err) {
      const fe = err instanceof ApiError ? err.fieldErrors : {}
      setErrors({ email: fe.email, password: fe.password, form: err instanceof Error ? err.message : 'Sign-in failed.' })
      setPassword('')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-gradient-to-b from-ice-100 to-canvas p-4">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <LogoMark className="size-10" />
          <h1 className="font-display text-2xl font-semibold">Baba Solars admin</h1>
        </div>
        <Card className="p-7 shadow-card">
          {expired && (
            <p role="status" className="mb-5 rounded-field border border-sun-500/40 bg-sun-300/30 p-3 text-sm text-navy-800">Your session ended. Please sign in again.</p>
          )}
          {!SERVER_MODE && (
            <p role="note" className="mb-4 rounded-field border border-sun-500/40 bg-sun-300/25 p-3 text-sm leading-relaxed text-navy-800">
              Local-only access: this form does not verify your password. Anyone with access to this site can open the admin panel. Do not enter real credentials or use customer or financial data here.
            </p>
          )}
          <form onSubmit={submit} className="grid gap-4" noValidate>
            <Input label="Email" type="email" autoComplete="username" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} error={errors.email} required />
            <Input label="Password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} error={errors.password} required />
            {errors.form && <p role="alert" className="rounded-field bg-clay-100 p-3 text-sm text-clay-700">{errors.form}</p>}
            <Button type="submit" size="lg" loading={loading} leftIcon={<LockKeyhole className="size-4" />}>{loading ? 'Signing in…' : 'Sign in'}</Button>
          </form>
        </Card>
        <p className="mt-5 text-center text-sm"><Link to="/" className="text-muted underline underline-offset-2 hover:text-ink">Back to website</Link></p>
      </div>
    </main>
  )
}
