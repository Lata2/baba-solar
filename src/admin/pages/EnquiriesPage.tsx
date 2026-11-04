import { useMemo, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { Download, Eye, FilePlus2, FileText, Mail, Pencil, Phone, Plus, Trash2, Upload } from 'lucide-react'
import type { Enquiry, EnquirySource, EnquiryStatus, PropertyType } from '@/types'
import { collectionQuery, useCollection, useSaveEnquiry } from '@/queries'
import { useSeo } from '@/hooks/useSeo'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'
import { api, ApiError, type EnquirySave } from '@/services/api'
import { createId } from '@/lib/id'
import { downloadBlob, todayISO } from '@/lib/files'
import { formatDate, formatINR, mailHref, telHref, whatsappHref } from '@/lib/format'
import { ADMIN_SOURCES, ENQUIRY_SOURCES, ENQUIRY_STATUSES, ENQUIRY_STATUS_LABEL, ENQUIRY_TYPE_LABEL, SOURCE_LABEL, enquiryKw, enquiryTypeOf, originOf, validateEnquiry } from '@/lib/enquiries'
import { PROPERTY_LABEL, PROPERTY_OPTIONS } from '@/lib/labels'
import { GST_STATES } from '@/lib/states'
import { Button, ConfirmDialog, EmptyState, Input, LinkButton, Modal, Select, Textarea, Toggle, WhatsAppIcon } from '@/components/ui'
import { AdminPageHeader, DataTable, DetailList, FilterSelect, IconAction, Pagination, SearchBox, SortSelect, ToneBadge, Toolbar } from '../components/AdminUI'
import { CustomerPicker } from '../components/CustomerPicker'
import { EnquiryImportDialog } from '../components/EnquiryImportDialog'
import { useCrud, errorMessage } from '../hooks/useCrud'
import { byNumber, byText, useTable, type SortOption } from '../hooks/useTable'
import { enquiryTone } from '../constants'

type SourceFilter = 'all' | 'website' | 'admin' | 'import' | EnquirySource
const SOURCE_FILTERS: Array<{ value: SourceFilter; label: string }> = [
  { value: 'all', label: 'All sources' },
  { value: 'website', label: 'Website (all forms)' },
  { value: 'admin', label: 'Entered by admin (all)' },
  { value: 'import', label: 'Excel import' },
  ...ENQUIRY_SOURCES.filter((s) => s.origin !== 'import').map((s) => ({ value: s.value as SourceFilter, label: s.label })),
]

const SORTS: SortOption<Enquiry>[] = [
  { value: 'new', label: 'Newest first', compare: byText((e) => e.createdAt, -1) },
  { value: 'old', label: 'Oldest first', compare: byText((e) => e.createdAt) },
  { value: 'name', label: 'Name A–Z', compare: byText((e) => e.name) },
  { value: 'status', label: 'Status', compare: byNumber((e) => ENQUIRY_STATUSES.findIndex((s) => s.value === e.status)) },
  { value: 'follow', label: 'Follow-up date', compare: byText((e) => e.followUpOn || '9999') },
  { value: 'kw', label: 'Capacity (largest)', compare: byNumber((e) => e.capacityKw ?? e.estimate?.capacityKw ?? 0, -1) },
]

const STATE_OPTIONS = [{ value: '', label: '—' }, ...GST_STATES.map((s) => ({ value: s.name, label: s.name }))]

export default function EnquiriesPage() {
  const enquiries = useCollection('enquiries')
  useSeo({ title: 'Enquiries', path: '/admin/enquiries', noIndex: true })
  const { can } = useAuth()
  const canWrite = can('leads:write')
  const canQuote = can('quotations:write')
  const crud = useCrud('enquiries', 'Enquiry')
  const toast = useToast()
  const navigate = useNavigate()
  const proposals = useQuery({ ...collectionQuery('proposals'), enabled: can('quotations:read') }).data ?? []
  const quotations = useQuery({ ...collectionQuery('quotations'), enabled: can('quotations:read') }).data ?? []
  const [status, setStatus] = useState<EnquiryStatus | 'all'>('all')
  const [source, setSource] = useState<SourceFilter>('all')
  const [viewing, setViewing] = useState<Enquiry | null>(null)
  const [editing, setEditing] = useState<{ value: EnquirySave; isNew: boolean } | null>(null)
  const [importing, setImporting] = useState(false)
  const [exporting, setExporting] = useState(false)

  const matchSource = (e: Enquiry) =>
    source === 'all' ||
    (source === 'website' || source === 'admin' || source === 'import' ? (e.origin ?? originOf(e.source)) === source : e.source === source)
  const table = useTable(enquiries, {
    search: (e) => `${e.name} ${e.phone} ${e.email} ${e.city} ${e.address ?? ''} ${e.service} ${e.message} ${e.notes ?? ''} ${e.submissionId ?? ''}`,
    sorts: SORTS,
    filters: [(e) => status === 'all' || e.status === status, matchSource],
    filterKey: `${status}|${source}`,
  })

  const linked = (id: string) => ({
    proposals: proposals.filter((p) => p.enquiryId === id),
    quotations: quotations.filter((q) => q.enquiryId === id),
  })
  const counts = useMemo(() => Object.fromEntries(ENQUIRY_STATUSES.map((s) => [s.value, enquiries.filter((e) => e.status === s.value).length])) as Record<EnquiryStatus, number>, [enquiries])

  const setEnquiryStatus = (e: Enquiry, s: EnquiryStatus) => {
    void crud.quickUpdate({ ...e, status: s }, `Marked as ${ENQUIRY_STATUS_LABEL[s].toLowerCase()}`)
    if (viewing?.id === e.id) setViewing({ ...e, status: s })
  }

  const exportXlsx = async () => {
    setExporting(true)
    try {
      const blob = await api.enquiriesXlsx(table.filtered.map((e) => e.id))
      downloadBlob(blob, `baba-solars-enquiries-${todayISO()}.xlsx`)
      toast({ title: `Exported ${table.filtered.length} enquiries` })
    } catch (e) {
      toast({ tone: 'error', title: 'Export failed', description: errorMessage(e) })
    } finally {
      setExporting(false)
    }
  }

  const blank = (): EnquirySave => ({
    id: createId('enq'), name: '', phone: '', email: '', city: 'Raipur', state: 'Chhattisgarh', address: '', pincode: '', service: '', message: '',
    source: 'manual', status: 'new', propertyType: 'residential', capacityKw: null, monthlyBill: null, notes: '', followUpOn: null,
  })

  return (
    <>
      <AdminPageHeader
        title="Enquiries"
        description="Website forms, WhatsApp, calls and other leads in one place. Manual enquiries can start a proposal straight away."
        actions={
          <>
            {canWrite && <Button variant="secondary" leftIcon={<Upload className="size-4" />} onClick={() => setImporting(true)}>Import Excel</Button>}
            <Button variant="secondary" leftIcon={<Download className="size-4" />} onClick={() => void exportXlsx()} loading={exporting} disabled={!table.total}>Export Excel</Button>
            {canWrite && <Button leftIcon={<Plus className="size-4" />} onClick={() => setEditing({ value: blank(), isNew: true })}>New enquiry</Button>}
          </>
        }
      />

      <ul className="mb-4 flex flex-wrap gap-2" aria-label="Enquiries by status">
        {ENQUIRY_STATUSES.filter((s) => counts[s.value]).map((s) => (
          <li key={s.value}>
            <button type="button" onClick={() => setStatus(status === s.value ? 'all' : s.value)} aria-pressed={status === s.value}
              className={`rounded-chip border px-3 py-1 text-sm font-medium transition-colors ${status === s.value ? 'border-navy-700 bg-navy-700 text-snow-50' : 'border-line bg-surface text-ink-soft hover:border-steel-400'}`}>
              {s.label} <span className="tabular-nums opacity-75">{counts[s.value]}</span>
            </button>
          </li>
        ))}
      </ul>

      <Toolbar>
        <SearchBox value={table.query} onChange={table.setQuery} placeholder="Search name, mobile, city, requirement or notes" />
        <FilterSelect label="Status" value={status} onChange={setStatus} options={[{ value: 'all', label: 'All' }, ...ENQUIRY_STATUSES]} />
        <FilterSelect label="Source" value={source} onChange={setSource} options={SOURCE_FILTERS} />
        <SortSelect value={table.sort} onChange={table.setSort} options={SORTS} />
      </Toolbar>

      <DataTable
        caption="Enquiries"
        rows={table.pageRows}
        empty={
          <EmptyState
            title={enquiries.length ? 'No enquiries match' : 'No enquiries yet'}
            message={enquiries.length ? 'Try clearing the search or filters.' : 'Website form submissions appear here. You can also add one by hand or import an Excel file.'}
            action={canWrite && !enquiries.length ? <Button onClick={() => setEditing({ value: blank(), isNew: true })}>New enquiry</Button> : undefined}
          />
        }
        columns={[
          { header: 'Customer', cell: (e) => <div><p className="font-semibold text-ink">{e.name}</p><p className="text-muted">{[e.phone, e.city].filter(Boolean).join(', ')}</p></div> },
          { header: 'Received', cell: (e) => <span className="whitespace-nowrap text-muted">{formatDate(e.createdAt)}</span> },
          { header: 'Requirement', cell: (e) => <div className="max-w-xs"><p className="text-ink-soft">{e.service}</p>{(e.capacityKw || e.estimate?.capacityKw) ? <p className="text-muted">{e.capacityKw ?? e.estimate?.capacityKw} kW{e.propertyType ? ` · ${PROPERTY_LABEL[e.propertyType]}` : ''}</p> : e.message ? <p className="truncate text-muted">{e.message}</p> : null}</div> },
          { header: 'Type', cell: (e) => { const t = enquiryTypeOf(e); return t ? <span className="whitespace-nowrap text-ink-soft">{ENQUIRY_TYPE_LABEL[t]}</span> : <span className="text-muted">—</span> } },
          { header: 'kW', cell: (e) => { const kw = enquiryKw(e); return kw ? <span className="whitespace-nowrap tabular-nums text-ink-soft">{kw} kW</span> : <span className="text-muted">—</span> } },
          { header: 'Source', cell: (e) => <span className="text-ink-soft">{SOURCE_LABEL[e.source] ?? e.source}</span> },
          { header: 'Status', cell: (e) => (
            <select aria-label={`Status for ${e.name}`} value={e.status} disabled={!canWrite} onChange={(ev) => setEnquiryStatus(e, ev.target.value as EnquiryStatus)} className="h-8 rounded-field border border-line bg-canvas px-2 text-sm">
              {ENQUIRY_STATUSES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          ) },
          { header: 'Linked', cell: (e) => { const l = linked(e.id); return l.proposals.length + l.quotations.length ? <span className="text-xs text-muted">{[...l.proposals.map((p) => p.proposalNumber), ...l.quotations.map((q) => q.quoteNumber ?? 'Quote')].join(', ')}</span> : <span className="text-xs text-muted">—</span> } },
          { header: 'Actions', className: 'text-right', cell: (e) => (
            <div className="flex items-center justify-end gap-1.5">
              <IconAction label={`View enquiry from ${e.name}`} onClick={() => setViewing(e)}><Eye className="size-4" /></IconAction>
              {canWrite && <IconAction label={`Edit enquiry from ${e.name}`} onClick={() => setEditing({ value: structuredClone(e), isNew: false })}><Pencil className="size-4" /></IconAction>}
              {canQuote && <IconAction label={`Create proposal for ${e.name}`} onClick={() => navigate(`/admin/proposals?fromEnquiry=${e.id}`)}><FilePlus2 className="size-4" /></IconAction>}
              {canQuote && <IconAction label={`Create quotation for ${e.name}`} onClick={() => navigate(`/admin/quotations?fromEnquiry=${e.id}`)}><FileText className="size-4" /></IconAction>}
              {canWrite && <IconAction label={`Delete enquiry from ${e.name}`} danger onClick={() => crud.setDeleting(e)}><Trash2 className="size-4" /></IconAction>}
            </div>
          ) },
        ]}
      />
      <Pagination page={table.page} pages={table.pages} total={table.total} pageSize={table.pageSize} onPage={table.setPage} onPageSize={table.setPageSize} noun="enquiries" />

      {viewing && (
        <EnquiryView
          enquiry={viewing}
          linked={linked(viewing.id)}
          canWrite={canWrite}
          canQuote={canQuote}
          onClose={() => setViewing(null)}
          onStatus={(s) => setEnquiryStatus(viewing, s)}
          onEdit={() => { setEditing({ value: structuredClone(viewing), isNew: false }); setViewing(null) }}
          onProposal={() => navigate(`/admin/proposals?fromEnquiry=${viewing.id}`)}
          onQuotation={() => navigate(`/admin/quotations?fromEnquiry=${viewing.id}`)}
          openDoc={(path) => navigate(path)}
        />
      )}

      {editing && <EnquiryForm initial={editing.value} isNew={editing.isNew} onClose={() => setEditing(null)} />}
      {importing && <EnquiryImportDialog existing={enquiries} onClose={() => setImporting(false)} />}

      <ConfirmDialog open={!!crud.deleting} title="Delete this enquiry?" message={`The enquiry from ${crud.deleting?.name} will be permanently removed. Proposals and quotations made from it are kept.`} confirmLabel="Delete enquiry" onConfirm={() => void crud.confirmDelete()} onCancel={() => crud.setDeleting(null)} />
    </>
  )
}

function EnquiryView({ enquiry: e, linked, canWrite, canQuote, onClose, onStatus, onEdit, onProposal, onQuotation, openDoc }: {
  enquiry: Enquiry
  linked: { proposals: Array<{ id: string; proposalNumber: string; status: string }>; quotations: Array<{ id: string; quoteNumber?: string | null; status: string }> }
  canWrite: boolean; canQuote: boolean
  onClose: () => void; onStatus: (s: EnquiryStatus) => void; onEdit: () => void; onProposal: () => void; onQuotation: () => void; openDoc: (path: string) => void
}) {
  const est = e.estimate
  return (
    <Modal open onClose={onClose} title={`Enquiry from ${e.name}`} description={`Received ${formatDate(e.createdAt)} · ${SOURCE_LABEL[e.source] ?? e.source}`} size="lg"
      footer={
        <>
          {canWrite && <Button variant="secondary" leftIcon={<Pencil className="size-4" />} onClick={onEdit}>Edit</Button>}
          {canQuote && <Button variant="secondary" leftIcon={<FilePlus2 className="size-4" />} onClick={onProposal}>Create proposal</Button>}
          {canQuote && <Button variant="secondary" leftIcon={<FileText className="size-4" />} onClick={onQuotation}>Create quotation</Button>}
          <Button onClick={onClose}>Done</Button>
        </>
      }>
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-3">
          <ToneBadge tone={enquiryTone[e.status]}>{ENQUIRY_STATUS_LABEL[e.status]}</ToneBadge>
          {canWrite && (
            <label className="flex items-center gap-2 text-sm text-muted">Change status
              <select value={e.status} onChange={(ev) => onStatus(ev.target.value as EnquiryStatus)} className="h-8 rounded-field border border-line bg-canvas px-2 text-sm text-ink">
                {ENQUIRY_STATUSES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
          )}
        </div>
        <DetailList items={[
          ['Mobile', e.phone], ['Email', e.email], ['Address', e.address], ['City / location', e.city], ['State', e.state], ['PIN code', e.pincode],
          ['Requirement', e.service], ['Enquiry type', enquiryTypeOf(e) ? ENQUIRY_TYPE_LABEL[enquiryTypeOf(e)!] : ''], ['Property type', e.propertyType ? PROPERTY_LABEL[e.propertyType] : ''], ['System capacity', e.capacityKw ? `${e.capacityKw} kW` : ''],
          ['Monthly bill', e.monthlyBill ? formatINR(e.monthlyBill) : ''], ['Follow-up', e.followUpOn ? formatDate(e.followUpOn) : ''], ['Last updated', e.updatedAt ? formatDate(e.updatedAt) : ''],
          ...(e.submissionId ? [['Submission ID', <span className="break-all font-mono text-xs font-normal">{e.submissionId}</span>] as [string, React.ReactNode]] : []),
        ]} />
        {est && (
          <div className="rounded-card bg-ice-100/70 p-4 text-sm">
            <p className="font-semibold text-ink">Website calculator estimate</p>
            <p className="mt-1 text-ink-soft">{est.capacityKw} kW {est.systemType} · {PROPERTY_LABEL[est.propertyType]} · bill {formatINR(est.monthlyBill)}{est.monthlyUnits ? ` (~${est.monthlyUnits} units)` : ''}</p>
            <p className="text-ink-soft">Estimated {formatINR(est.estimatedCost)} · subsidy {formatINR(est.subsidy)} · after subsidy {formatINR(est.netCost)}{est.quality ? ` · ${est.quality} plan` : ''}</p>
            {est.tariffVerified === false && <p className="mt-1 text-xs text-clay-700">Tariff for this location was indicative — confirm the bill details with the customer.</p>}
          </div>
        )}
        {e.message && <div><p className="text-sm text-muted">Message</p><p className="mt-1 whitespace-pre-wrap rounded-field bg-snow-200/60 p-4 text-ink-soft">{e.message}</p></div>}
        {e.notes && <div><p className="text-sm text-muted">Internal notes</p><p className="mt-1 whitespace-pre-wrap rounded-field bg-sun-300/20 p-4 text-ink-soft">{e.notes}</p></div>}
        {(linked.proposals.length > 0 || linked.quotations.length > 0) && (
          <div>
            <p className="text-sm text-muted">Linked documents</p>
            <ul className="mt-1 flex flex-wrap gap-2">
              {linked.proposals.map((p) => <li key={p.id}><button type="button" className="rounded-chip border border-line px-3 py-1 text-sm hover:bg-ice-100" onClick={() => openDoc(`/admin/proposals?open=${p.id}`)}>Proposal {p.proposalNumber} · {p.status}</button></li>)}
              {linked.quotations.map((q) => <li key={q.id}><button type="button" className="rounded-chip border border-line px-3 py-1 text-sm hover:bg-ice-100" onClick={() => openDoc(`/admin/quotations?open=${q.id}`)}>Quotation {q.quoteNumber ?? ''} · {q.status}</button></li>)}
            </ul>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {e.phone && <LinkButton href={telHref(e.phone)} variant="secondary" size="sm" leftIcon={<Phone className="size-4" />}>Call</LinkButton>}
          {e.phone && <LinkButton href={whatsappHref('91' + e.phone.replace(/\D/g, '').slice(-10), `Hi ${e.name}, this is Baba Solars regarding your enquiry about ${e.service}.`)} external variant="secondary" size="sm" leftIcon={<WhatsAppIcon className="size-4" />}>WhatsApp</LinkButton>}
          {e.email && <LinkButton href={mailHref(e.email, `Re: ${e.service}`)} variant="secondary" size="sm" leftIcon={<Mail className="size-4" />}>Email</LinkButton>}
        </div>
      </div>
    </Modal>
  )
}

function EnquiryForm({ initial, isNew, onClose }: { initial: EnquirySave; isNew: boolean; onClose: () => void }) {
  const save = useSaveEnquiry()
  const toast = useToast()
  const { can } = useAuth()
  const [f, setF] = useState<EnquirySave>(initial)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [withProposal, setWithProposal] = useState(isNew && initial.source === 'manual')
  const websiteRecord = !isNew && originOf(initial.source) !== 'admin'
  const set = <K extends keyof EnquirySave>(k: K, v: EnquirySave[K]) => {
    setF((p) => ({ ...p, [k]: v }))
    setErrors((e) => { const n = { ...e }; delete n[k as string]; return n })
  }
  const num = (v: string) => (v === '' ? null : Number(v))

  const submit = async (ev: FormEvent) => {
    ev.preventDefault()
    const errs = validateEnquiry(f)
    setErrors(errs)
    if (Object.keys(errs).length) { toast({ tone: 'error', title: 'Fix the highlighted fields', description: Object.values(errs)[0] }); return }
    try {
      const res = await save.mutateAsync({ data: f, createProposal: isNew && withProposal })
      toast({
        title: isNew ? 'Enquiry added' : 'Enquiry saved',
        description: res.proposal ? `Draft proposal ${res.proposal.proposalNumber} created — find it under Proposals.` : undefined,
      })
      onClose()
    } catch (e) {
      if (e instanceof ApiError) setErrors(e.fieldErrors)
      toast({ tone: 'error', title: 'Enquiry not saved', description: errorMessage(e) })
    }
  }

  const sourceOptions = websiteRecord
    ? ENQUIRY_SOURCES.filter((s) => s.value === initial.source).map((s) => ({ value: s.value, label: s.label }))
    : ADMIN_SOURCES.map((s) => ({ value: s.value, label: s.label }))

  return (
    <Modal open onClose={() => !save.isPending && onClose()} title={isNew ? 'New enquiry' : `Edit enquiry — ${initial.name}`} size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={save.isPending}>Cancel</Button>
          <Button type="submit" form="enquiry-form" loading={save.isPending}>{isNew ? 'Add enquiry' : 'Save changes'}</Button>
        </>
      }>
      <form id="enquiry-form" onSubmit={submit} noValidate className="grid gap-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold text-ink-soft">Customer</p>
          <CustomerPicker onPick={(c) => setF((p) => ({ ...p, name: c.name, phone: c.phone, email: c.email || p.email, address: c.address || p.address, city: c.city || p.city, state: c.state || p.state }))} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Customer name" required value={f.name} onChange={(e) => set('name', e.target.value)} error={errors.name} autoComplete="off" />
          <Input label="Mobile" required={!f.email.trim()} type="tel" inputMode="tel" value={f.phone} onChange={(e) => set('phone', e.target.value)} error={errors.phone} hint="10-digit Indian mobile (or give an email)" />
          <Input label="Email" type="email" value={f.email} onChange={(e) => set('email', e.target.value)} error={errors.email} />
          <Input label="City / location" value={f.city} onChange={(e) => set('city', e.target.value)} />
          <Input label="Address" value={f.address ?? ''} onChange={(e) => set('address', e.target.value)} wrapperClassName="sm:col-span-2" />
          <Select label="State" value={f.state ?? ''} onChange={(e) => set('state', e.target.value)} options={STATE_OPTIONS} />
          <Input label="PIN code" inputMode="numeric" maxLength={6} value={f.pincode ?? ''} onChange={(e) => set('pincode', e.target.value.replace(/\D/g, ''))} error={errors.pincode} />
        </div>
        <p className="border-t border-line pt-4 text-sm font-semibold text-ink-soft">Requirement</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Requirement" required value={f.service} onChange={(e) => set('service', e.target.value)} error={errors.service} placeholder="e.g. 5 kW rooftop solar for home" wrapperClassName="sm:col-span-2" />
          <Select label="Property type" value={f.propertyType ?? ''} onChange={(e) => set('propertyType', (e.target.value || undefined) as PropertyType | undefined)} options={[{ value: '', label: '—' }, ...PROPERTY_OPTIONS]} />
          <Input label="System capacity (kW)" type="number" step="0.5" min={0} value={f.capacityKw ?? ''} onChange={(e) => set('capacityKw', num(e.target.value))} error={errors.capacityKw} />
          <Input label="Monthly bill (₹)" type="number" min={0} prefix="₹" value={f.monthlyBill ?? ''} onChange={(e) => set('monthlyBill', num(e.target.value))} error={errors.monthlyBill} />
          <Select label="Source" value={f.source} disabled={websiteRecord} onChange={(e) => { const v = e.target.value as EnquirySource; set('source', v); if (isNew) setWithProposal(v === 'manual') }} options={sourceOptions} hint={websiteRecord ? 'Received from the website — source cannot be changed.' : undefined} />
          <Select label="Status" value={f.status} onChange={(e) => set('status', e.target.value as EnquiryStatus)} options={ENQUIRY_STATUSES} />
          <Input label="Follow-up date" type="date" value={f.followUpOn ?? ''} onChange={(e) => set('followUpOn', e.target.value || null)} error={errors.followUpOn} />
        </div>
        <Textarea label="Customer message / details" rows={3} value={f.message} onChange={(e) => set('message', e.target.value)} />
        <Textarea label="Internal notes" rows={3} value={f.notes ?? ''} onChange={(e) => set('notes', e.target.value)} hint="Only visible in the admin panel." />
        {isNew && can('quotations:write') && (
          <Toggle label="Also start a draft proposal" checked={withProposal} onChange={setWithProposal} description="Manual enquiries are added to Proposals too, with the customer details filled in." />
        )}
      </form>
    </Modal>
  )
}
