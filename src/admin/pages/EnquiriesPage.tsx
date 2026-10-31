import { useMemo, useState } from 'react'
import { Download, Eye, Mail, Phone, Trash2 } from 'lucide-react'
import type { Enquiry, EnquiryStatus } from '@/types'
import { useCollection } from '@/queries'
import { useSeo } from '@/hooks/useSeo'
import { downloadCsv } from '@/lib/csv'
import { formatDate, mailHref, telHref, whatsappHref } from '@/lib/format'
import { Button, ConfirmDialog, EmptyState, LinkButton, Modal, WhatsAppIcon } from '@/components/ui'
import { AdminPageHeader, DataTable, FilterSelect, IconAction, SearchBox, ToneBadge, Toolbar } from '../components/AdminUI'
import { useCrud } from '../hooks/useCrud'
import { enquiryTone } from '../constants'

const statusOptions: Array<{ value: EnquiryStatus; label: string }> = [
  { value: 'new', label: 'New' }, { value: 'contacted', label: 'Contacted' }, { value: 'closed', label: 'Closed' },
]

export default function EnquiriesPage() {
  const enquiries = useCollection('enquiries')
  useSeo({ title: 'Enquiries', path: '/admin/enquiries', noIndex: true })
  const crud = useCrud('enquiries', 'Enquiry')
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<EnquiryStatus | 'all'>('all')
  const [viewing, setViewing] = useState<Enquiry | null>(null)

  const rows = useMemo(() => enquiries
    .filter((e) => (status === 'all' || e.status === status) && `${e.name} ${e.phone} ${e.city} ${e.service} ${e.message}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [enquiries, q, status])

  const setEnquiryStatus = (e: Enquiry, s: EnquiryStatus) => {
    crud.quickUpdate({ ...e, status: s }, `Marked as ${s}`)
    if (viewing?.id === e.id) setViewing({ ...e, status: s })
  }

  const exportCsv = () => downloadCsv(`baba-solars-enquiries-${new Date().toISOString().slice(0, 10)}.csv`, rows.map((e) => ({
    Date: formatDate(e.createdAt), Name: e.name, Phone: e.phone, Email: e.email, City: e.city, Service: e.service, Source: e.source, Status: e.status, Message: e.message,
  })))

  return (
    <>
      <AdminPageHeader title="Enquiries" description="Messages from the contact form and service pages." actions={<Button variant="secondary" leftIcon={<Download className="size-4" />} onClick={exportCsv} disabled={!rows.length}>Export CSV</Button>} />
      <Toolbar>
        <SearchBox value={q} onChange={setQ} placeholder="Search name, phone, city or message" />
        <FilterSelect label="Status" value={status} onChange={setStatus} options={[{ value: 'all', label: 'All' }, ...statusOptions]} />
      </Toolbar>
      <DataTable
        caption="Enquiries"
        rows={rows}
        empty={<EmptyState title={enquiries.length ? 'No enquiries match' : 'No enquiries yet'} message={enquiries.length ? 'Try clearing the search or status filter.' : 'Submit the contact form on the website to see one appear here.'} />}
        columns={[
          { header: 'Received', cell: (e) => <span className="whitespace-nowrap text-muted">{formatDate(e.createdAt)}</span> },
          { header: 'Customer', cell: (e) => <div><p className="font-semibold text-ink">{e.name}</p><p className="text-muted">{e.phone}, {e.city}</p></div> },
          { header: 'Needs', cell: (e) => <div className="max-w-xs"><p className="text-ink-soft">{e.service}</p><p className="truncate text-muted">{e.message}</p></div> },
          { header: 'Status', cell: (e) => (
            <select
              aria-label={`Status for ${e.name}`}
              value={e.status}
              onChange={(ev) => setEnquiryStatus(e, ev.target.value as EnquiryStatus)}
              className="h-8 rounded-field border border-line bg-canvas px-2 text-sm"
            >
              {statusOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>) },
          { header: 'Actions', className: 'text-right', cell: (e) => (
            <div className="flex justify-end gap-1">
              <IconAction label={`View enquiry from ${e.name}`} onClick={() => setViewing(e)}><Eye className="size-4" /></IconAction>
              <IconAction label={`Delete enquiry from ${e.name}`} danger onClick={() => crud.setDeleting(e)}><Trash2 className="size-4" /></IconAction>
            </div>) },
        ]}
      />

      <Modal open={!!viewing} onClose={() => setViewing(null)} title={viewing ? `Enquiry from ${viewing.name}` : ''} description={viewing ? `Received ${formatDate(viewing.createdAt)} via ${viewing.source} form` : undefined}
        footer={viewing && (
          <>
            {viewing.status === 'new' && <Button variant="secondary" onClick={() => setEnquiryStatus(viewing, 'contacted')}>Mark as contacted</Button>}
            {viewing.status !== 'closed' && <Button variant="secondary" onClick={() => setEnquiryStatus(viewing, 'closed')}>Close enquiry</Button>}
            <Button onClick={() => setViewing(null)}>Done</Button>
          </>
        )}>
        {viewing && (
          <div className="space-y-5">
            <div className="flex items-center gap-2"><ToneBadge tone={enquiryTone[viewing.status]}>{viewing.status}</ToneBadge><span className="text-sm text-muted">{viewing.service}</span></div>
            <dl className="grid gap-4 sm:grid-cols-2">
              <div><dt className="text-sm text-muted">Phone</dt><dd className="font-semibold">{viewing.phone}</dd></div>
              <div><dt className="text-sm text-muted">Email</dt><dd className="font-semibold break-all">{viewing.email || '—'}</dd></div>
              <div><dt className="text-sm text-muted">City</dt><dd className="font-semibold">{viewing.city || '—'}</dd></div>
            </dl>
            <div><p className="text-sm text-muted">Message</p><p className="mt-1 whitespace-pre-wrap rounded-field bg-snow-200/60 p-4 text-ink-soft">{viewing.message}</p></div>
            <div className="flex flex-wrap gap-2">
              <LinkButton href={telHref(viewing.phone)} variant="secondary" size="sm" leftIcon={<Phone className="size-4" />}>Call</LinkButton>
              <LinkButton href={whatsappHref('91' + viewing.phone.replace(/\D/g, '').slice(-10), `Hi ${viewing.name}, this is Baba Solars regarding your enquiry about ${viewing.service}.`)} external variant="secondary" size="sm" leftIcon={<WhatsAppIcon className="size-4" />}>WhatsApp</LinkButton>
              {viewing.email && <LinkButton href={mailHref(viewing.email, `Re: ${viewing.service}`)} variant="secondary" size="sm" leftIcon={<Mail className="size-4" />}>Email</LinkButton>}
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog open={!!crud.deleting} title="Delete this enquiry?" message={`The enquiry from ${crud.deleting?.name} will be permanently removed.`} confirmLabel="Delete enquiry" onConfirm={() => void crud.confirmDelete()} onCancel={() => crud.setDeleting(null)} />
    </>
  )
}
