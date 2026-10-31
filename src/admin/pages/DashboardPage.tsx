import { Link } from 'react-router'
import { FileText, Image, Inbox, ReceiptIndianRupee, Tag } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { collectionQuery, useCollection, useInvoices } from '@/queries'
import { useAuth } from '@/context/AuthContext'
import { useSeo } from '@/hooks/useSeo'
import { formatDate, formatLakh } from '@/lib/format'
import { todayISO } from '@/lib/files'
import { Card, EmptyState } from '@/components/ui'
import { AdminPageHeader, ToneBadge } from '../components/AdminUI'
import { enquiryTone } from '../constants'

export default function DashboardPage() {
  useSeo({ title: 'Dashboard', path: '/admin', noIndex: true })
  const { can, user } = useAuth()
  // Leads and billing load only for roles allowed to see them.
  const enquiries = useQuery({ ...collectionQuery('enquiries'), enabled: can('leads:read') }).data ?? []
  const quotations = useQuery({ ...collectionQuery('quotations'), enabled: can('quotations:read') }).data ?? []
  const monthStart = `${todayISO().slice(0, 7)}-01`
  const showBilling = can('invoices:read')
  const billing = useInvoices({ pageSize: 1, from: monthStart }, showBilling)
  const billingAll = useInvoices({ pageSize: 1, paymentStatus: 'overdue' }, showBilling)
  const db = { enquiries, quotations, pricingPlans: useCollection('pricingPlans'), projects: useCollection('projects') }

  const newEnq = db.enquiries.filter((e) => e.status === 'new').length
  const pendingQ = db.quotations.filter((q) => q.status === 'pending' || q.status === 'sent')
  const pipeline = pendingQ.reduce((s, q) => s + q.netCost, 0)
  const won = db.quotations.filter((q) => q.status === 'accepted').reduce((s, q) => s + q.netCost, 0)

  const kpis: Array<{ label: string; value: string | number; sub?: string; to: string; icon: typeof Inbox; show: boolean }> = [
    { label: 'New enquiries', value: newEnq, to: '/admin/enquiries', icon: Inbox, show: can('leads:read') },
    { label: 'Open quotations', value: pendingQ.length, sub: `${formatLakh(pipeline)} in pipeline`, to: '/admin/quotations', icon: FileText, show: can('quotations:read') },
    { label: 'Billed this month', value: billing.data ? formatLakh(billing.data.summary.billed) : '…', sub: billing.data ? `${formatLakh(billing.data.summary.due)} outstanding · ${billingAll.data?.total ?? 0} overdue` : undefined, to: '/admin/billing', icon: ReceiptIndianRupee, show: showBilling },
    { label: 'Published plans', value: db.pricingPlans.filter((p) => p.status === 'published').length, sub: (() => { const n = db.pricingPlans.filter((p) => p.status === 'draft').length; return `${n} draft${n === 1 ? '' : 's'}` })(), to: '/admin/pricing', icon: Tag, show: true },
    { label: 'Published projects', value: db.projects.filter((p) => p.status === 'published').length, to: '/admin/projects', icon: Image, show: true },
  ].filter((k) => k.show)

  const bySource = (['contact', 'service', 'pricing', 'calculator'] as const).map((s) => ({ s, n: db.enquiries.filter((e) => e.source === s).length }))
  const quoteSources = db.quotations.length
  const sourceRows = [...bySource.filter((r) => r.s !== 'calculator'), { s: 'calculator' as const, n: quoteSources }]
  const maxN = Math.max(1, ...sourceRows.map((r) => r.n))
  const recent = [...db.enquiries].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5)

  return (
    <>
      <AdminPageHeader title="Dashboard" description={`Welcome, ${user?.name ?? ''}. An overview of leads, billing and website content.`} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {kpis.map(({ label, value, sub, to, icon: Icon }) => (
          <Link key={label} to={to} className="rounded-card border border-line bg-surface p-5 shadow-soft card-lift">
            <div className="flex items-center justify-between text-muted"><span className="text-sm">{label}</span><Icon className="size-4" aria-hidden /></div>
            <p className="mt-2 font-display text-4xl text-ink">{value}</p>
            {sub && <p className="mt-1 text-sm text-muted">{sub}</p>}
          </Link>
        ))}
      </div>

      {can('leads:read') && <div className="mt-6 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card padded={false}>
          <div className="flex items-center justify-between border-b border-line px-5 py-4">
            <h2 className="font-sans text-base font-semibold">Latest enquiries</h2>
            <Link to="/admin/enquiries" className="text-sm font-semibold text-steel-600 hover:text-ink">View all</Link>
          </div>
          {recent.length ? (
            <ul>
              {recent.map((e) => (
                <li key={e.id} className="flex items-start justify-between gap-3 border-b border-line px-5 py-3.5 last:border-0">
                  <div className="min-w-0">
                    <p className="font-semibold text-ink">{e.name}</p>
                    <p className="truncate text-sm text-muted">{e.service}, {e.city}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <ToneBadge tone={enquiryTone[e.status]}>{e.status}</ToneBadge>
                    <p className="mt-1 text-xs text-muted">{formatDate(e.createdAt)}</p>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="p-5"><EmptyState title="No enquiries yet" message="Submissions from the contact form appear here." /></div>
          )}
        </Card>

        <div className="space-y-6">
          <Card>
            <h2 className="font-sans text-base font-semibold">Where leads come from</h2>
            <ul className="mt-4 space-y-3">
              {sourceRows.map(({ s, n }) => (
                <li key={s}>
                  <div className="flex justify-between text-sm"><span className="capitalize text-ink-soft">{s === 'calculator' ? 'Calculator quotes' : `${s} form`}</span><span className="font-semibold">{n}</span></div>
                  <div className="mt-1 h-2 rounded-full bg-snow-200"><div className="h-2 rounded-full bg-steel-500" style={{ width: `${(n / maxN) * 100}%` }} /></div>
                </li>
              ))}
            </ul>
          </Card>
          <Card tone="warm">
            <h2 className="font-sans text-base font-semibold">Accepted quotations</h2>
            <p className="mt-2 font-display text-3xl">{formatLakh(won)}</p>
            <p className="text-sm text-muted">Net value after subsidy</p>
          </Card>
        </div>
      </div>}
    </>
  )
}
