import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { useSeo } from '@/hooks/useSeo'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'
import { api, ApiError } from '@/services/api'
import { Button, Card, Input } from '@/components/ui'
import { AdminPageHeader } from '../components/AdminUI'
import { errorMessage } from '../hooks/useCrud'
import { passwordProblem } from './UsersPage'
import { SERVER_MODE } from '@/config/api'

export default function AccountPage() {
  useSeo({ title: 'My account', path: '/admin/account', noIndex: true })
  const { user, logout } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const [v, setV] = useState({ current: '', next: '', confirm: '' })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const errs: Record<string, string> = {}
    if (!v.current) errs.current = 'Enter your current password.'
    const p = passwordProblem(v.next); if (p) errs.next = p
    if (v.next !== v.confirm) errs.confirm = 'The passwords do not match.'
    setErrors(errs)
    if (Object.keys(errs).length) return
    setBusy(true)
    try {
      await api.changePassword(v.current, v.next)
      setV({ current: '', next: '', confirm: '' })
      toast({ title: 'Password changed', description: 'Other devices have been signed out.' })
    } catch (err) {
      const fe = err instanceof ApiError ? err.fieldErrors : {}
      setErrors({ current: fe.currentPassword, next: fe.newPassword, ...(fe.currentPassword || fe.newPassword ? {} : { form: errorMessage(err) }) })
    } finally { setBusy(false) }
  }
  const signOutAll = async () => {
    let failed = false
    try {
      await api.logoutEverywhere()
    } catch (error) {
      failed = true
      toast({
        tone: 'error',
        title: 'Other sessions could not be revoked',
        description: errorMessage(error),
      })
    }
    try {
      await logout()
    } catch (error) {
      failed = true
      toast({
        tone: 'error',
        title: 'Sign-out could not be confirmed',
        description: errorMessage(error),
      })
    } finally {
      navigate('/admin/login', { replace: true })
    }
    if (!failed) toast({ title: 'Signed out everywhere' })
  }
  const signOutThisBrowser = async () => {
    try {
      await logout()
      navigate('/admin/login', { replace: true })
      toast({ title: 'Signed out of this browser' })
    } catch (error) {
      toast({ tone: 'error', title: 'Sign-out failed', description: errorMessage(error) })
    }
  }

  return (
    <>
      <AdminPageHeader title="My account" description={`${user?.name} · ${user?.email} · ${user?.role}`} />
      <div className="grid gap-6 lg:grid-cols-2">
        {SERVER_MODE && <Card>
          <h2 className="font-sans text-base font-semibold">Change password</h2>
          <form onSubmit={submit} noValidate className="mt-4 grid gap-4">
            <Input label="Current password" type="password" autoComplete="current-password" value={v.current} onChange={(e) => setV({ ...v, current: e.target.value })} error={errors.current} />
            <Input label="New password" type="password" autoComplete="new-password" value={v.next} onChange={(e) => setV({ ...v, next: e.target.value })} error={errors.next} hint="At least 8 characters with letters and a number." />
            <Input label="Repeat new password" type="password" autoComplete="new-password" value={v.confirm} onChange={(e) => setV({ ...v, confirm: e.target.value })} error={errors.confirm} />
            {errors.form && <p role="alert" className="text-sm text-clay-700">{errors.form}</p>}
            <div><Button type="submit" loading={busy}>Change password</Button></div>
          </form>
        </Card>}
        <Card>
          <h2 className="font-sans text-base font-semibold">Sessions</h2>
          <p className="mt-2 text-sm text-muted">
            {SERVER_MODE
              ? 'Lost a phone or used a shared computer? Sign out of the admin panel on every device.'
              : 'This local-only session exists only in this browser. It is not verified by a server.'}
          </p>
          <Button className="mt-4" variant="secondary" onClick={() => void (SERVER_MODE ? signOutAll() : signOutThisBrowser())}>
            {SERVER_MODE ? 'Sign out everywhere' : 'Sign out of this browser'}
          </Button>
        </Card>
      </div>
    </>
  )
}
