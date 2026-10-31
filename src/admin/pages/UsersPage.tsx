import { useState, type FormEvent } from 'react'
import { KeyRound, Pencil, Plus, Trash2 } from 'lucide-react'
import type { Role, StaffUser } from '@/types'
import { useUserMutations, useUsers } from '@/queries'
import { useSeo } from '@/hooks/useSeo'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'
import { ApiError } from '@/services/api'
import { formatDate } from '@/lib/format'
import { Badge, Button, ConfirmDialog, EmptyState, ErrorState, Input, Modal, Select, Skeleton, Toggle } from '@/components/ui'
import { AdminPageHeader, DataTable, IconAction } from '../components/AdminUI'
import { errorMessage } from '../hooks/useCrud'

export const ROLE_OPTIONS: Array<{ value: Role; label: string; text: string }> = [
  { value: 'admin', label: 'Admin', text: 'Everything, including users, backups and business settings.' },
  { value: 'editor', label: 'Editor', text: 'Website content: pages, prices, services, banners, gallery, SEO.' },
  { value: 'sales', label: 'Sales', text: 'Enquiries, quotations, billing and company price lists.' },
]

export const passwordProblem = (pw: string) => (pw.length < 8 ? 'Use at least 8 characters.' : !/[A-Za-z]/.test(pw) || !/\d/.test(pw) ? 'Use letters and at least one number.' : '')

export default function UsersPage() {
  useSeo({ title: 'Users', path: '/admin/users', noIndex: true })
  const { data, isPending, isError, error, refetch } = useUsers()
  const { user: me } = useAuth()
  const m = useUserMutations()
  const toast = useToast()
  const [editing, setEditing] = useState<StaffUser | 'new' | null>(null)
  const [deleting, setDeleting] = useState<StaffUser | null>(null)

  return (
    <>
      <AdminPageHeader title="Users" description="Staff who can sign in to this admin panel, and what each role may do." actions={<Button leftIcon={<Plus className="size-4" />} onClick={() => setEditing('new')}>Add user</Button>} />
      <ul className="mb-6 grid gap-3 sm:grid-cols-3">
        {ROLE_OPTIONS.map((r) => <li key={r.value} className="rounded-card border border-line bg-surface p-4 text-sm"><p className="font-semibold">{r.label}</p><p className="text-muted">{r.text}</p></li>)}
      </ul>
      {isPending ? <Skeleton className="h-40" /> : isError ? <ErrorState message={errorMessage(error)} onRetry={() => void refetch()} /> : (
        <DataTable caption="Users" rows={data} empty={<EmptyState title="No users" />} columns={[
          { header: 'Name', cell: (u) => <div><p className="font-semibold text-ink">{u.name}{u.id === me?.id && <span className="ml-2 text-xs text-muted">(you)</span>}</p><p className="text-muted">{u.email}</p></div> },
          { header: 'Role', cell: (u) => <Badge tone={u.role === 'admin' ? 'warning' : 'info'} className="capitalize">{u.role}</Badge> },
          { header: 'Status', cell: (u) => <Badge tone={u.isActive ? 'success' : 'neutral'}>{u.isActive ? 'Active' : 'Disabled'}</Badge> },
          { header: 'Last sign-in', cell: (u) => <span className="text-muted">{u.lastLoginAt ? formatDate(u.lastLoginAt) : 'Never'}</span> },
          { header: 'Actions', className: 'text-right', cell: (u) => (
            <div className="flex justify-end gap-1">
              <IconAction label={`Edit ${u.name}`} onClick={() => setEditing(u)}><Pencil className="size-4" /></IconAction>
              <IconAction label={`Delete ${u.name}`} danger disabled={u.id === me?.id} onClick={() => setDeleting(u)}><Trash2 className="size-4" /></IconAction>
            </div>) },
        ]} />
      )}
      {editing && <UserEditor user={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog open={!!deleting} title={`Delete ${deleting?.name}?`} message="They will be signed out and can no longer access the admin panel." confirmLabel="Delete user"
        onConfirm={() => { const u = deleting; setDeleting(null); if (u) void m.remove.mutateAsync(u.id).then(() => toast({ title: 'User deleted' }), (e) => toast({ tone: 'error', title: 'Not deleted', description: errorMessage(e) })) }}
        onCancel={() => setDeleting(null)} />
    </>
  )
}

function UserEditor({ user, onClose }: { user: StaffUser | null; onClose: () => void }) {
  const m = useUserMutations()
  const toast = useToast()
  const [v, setV] = useState({ name: user?.name ?? '', email: user?.email ?? '', role: user?.role ?? ('editor' as Role), isActive: user?.isActive ?? true, password: '' })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const pending = m.create.isPending || m.update.isPending

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const errs: Record<string, string> = {}
    if (!v.name.trim()) errs.name = 'Enter a name.'
    if (!user && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email)) errs.email = 'Enter a valid email.'
    if (!user || v.password) { const p = passwordProblem(v.password); if (p) errs.password = p }
    setErrors(errs)
    if (Object.keys(errs).length) return
    try {
      if (user) await m.update.mutateAsync({ id: user.id, patch: { name: v.name, role: v.role, isActive: v.isActive, ...(v.password ? { password: v.password } : {}) } })
      else await m.create.mutateAsync({ name: v.name, email: v.email, role: v.role, password: v.password })
      toast({ title: user ? 'User updated' : 'User added', description: user ? undefined : `Share the password with ${v.name} securely.` })
      onClose()
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fieldErrors)
      toast({ tone: 'error', title: 'Not saved', description: errorMessage(err) })
    }
  }
  return (
    <Modal open onClose={onClose} title={user ? `Edit ${user.name}` : 'Add user'} size="sm"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="user-form" loading={pending}>Save</Button></>}>
      <form id="user-form" onSubmit={submit} noValidate className="grid gap-4">
        <Input label="Name" required value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} error={errors.name} />
        <Input label="Email" type="email" required disabled={!!user} value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} error={errors.email} autoComplete="off" />
        <Select label="Role" value={v.role} onChange={(e) => setV({ ...v, role: e.target.value as Role })} options={ROLE_OPTIONS.map((r) => ({ value: r.value, label: `${r.label} — ${r.text}` }))} />
        <Input label={user ? 'New password (optional)' : 'Password'} type="password" required={!user} autoComplete="new-password" value={v.password} onChange={(e) => setV({ ...v, password: e.target.value })} error={errors.password}
          hint={user ? 'Setting a password signs the user out everywhere.' : 'At least 8 characters with letters and a number.'} />
        {user && <Toggle label="Active" description="Disabled users cannot sign in." checked={v.isActive} onChange={(x) => setV({ ...v, isActive: x })} />}
        {user && <p className="flex items-center gap-1.5 text-xs text-muted"><KeyRound className="size-3.5" aria-hidden />Changing the role or disabling also ends their current sessions.</p>}
      </form>
    </Modal>
  )
}
