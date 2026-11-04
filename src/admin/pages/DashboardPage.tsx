import { cn } from '@/lib/cn'
import { Link } from 'react-router'
import {
  ArrowRight, FilePen, FileText, HelpCircle, Image, Images, Inbox, MessageSquareQuote, Plus, ReceiptIndianRupee, Tag, TrendingUp, Wrench, GalleryHorizontal,
} from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { collectionQuery, useCollection, useInvoices } from '@/queries'
import { useAuth } from '@/context/AuthContext'
import { useSeo } from '@/hooks/useSeo'
import { formatDate, formatLakh } from '@/lib/format'
import { todayISO } from '@/lib/files'
import { Card, EmptyState } from '@/components/ui'
import { AdminPageHeader, ToneBadge } from '../components/AdminUI'
import { enquiryTone, quotationTone } from '../constants'
import { ENQUIRY_STATUS_LABEL } from '@/lib/enquiries'

type Publishable = { status?: string }
const split = (list: Publishable[]) => {
  const published = list.filter((x) => (x.status ?? 'published') === 'published').length
  return { published, draft: list.length - published }
}

export default function DashboardPage() {
  useSeo({ title: 'Dashboard', path: '/admin', noIndex: true })
  const { can } = useAuth()
  const enquiries = useQuery({ ...collectionQuery('enquiries'), enabled: can('leads:read') }).data ?? []
  const quotations = useQuery({ ...collectionQuery('quotations'), enabled: can('quotations:read') }).data ?? []
  const proposals = useQuery({ ...collectionQuery('proposals'), enabled: can('quotations:read') }).data ?? []
  const monthStart = `${todayISO().slice(0, 7)}-01`
  const showBilling = can('invoices:read')
  const billing = useInvoices({ pageSize: 1, from: monthStart }, showBilling)
  const overdue = useInvoices({ pageSize: 1, paymentStatus: 'overdue' }, showBilling)

  const content = {
    pricingPlans: useCollection('pricingPlans'),
    services: useCollection('services'),
    projects: useCollection('projects'),
    testimonials: useCollection('testimonials'),
    gallery: useCollection('gallery'),
    heroSlides: useCollection('heroSlides'),
    faqs: useCollection('faqs'),
  }

  const newEnq = enquiries.filter((e) => e.status === 'new').length
  const followUps = enquiries.filter((e) => e.followUpOn && e.followUpOn <= todayISO() && !['won', 'lost', 'closed'].includes(e.status)).length
  const openProposals = proposals.filter((p) => p.status === 'draft' || p.status === 'sent')
  const openQ = quotations.filter((q) => q.status === 'pending' || q.status === 'sent')
  const pipeline = openQ.reduce((s, q) => s + (q.netCost || 0), 0)
  const won = quotations.filter((q) => q.status === 'accepted').reduce((s, q) => s + (q.netCost || 0), 0)

  const kpis = [
    { label: 'New enquiries', value: newEnq, sub: `${enquiries.length} in total${followUps ? ` · ${followUps} follow-up due` : ''}`, to: '/admin/enquiries', icon: Inbox, show: can('leads:read'), accent: 'bg-sun-300/40 text-sun-500' },
    { label: 'Open proposals', value: openProposals.length, sub: `${formatLakh(openProposals.reduce((s, p) => s + p.grandTotal, 0))} proposed`, to: '/admin/proposals', icon: FilePen, show: can('quotations:read'), accent: 'bg-ice-200 text-navy-600' },
    { label: 'Open quotations', value: openQ.length, sub: `${formatLakh(pipeline)} in pipeline`, to: '/admin/quotations', icon: FileText, show: can('quotations:read'), accent: 'bg-ice-200 text-steel-600' },
    {
      label: 'Billed this month',
      value: billing.data ? formatLakh(billing.data.summary.billed) : '—',
      sub: billing.data ? `${formatLakh(billing.data.summary.due)} due · ${overdue.data?.total ?? 0} overdue` : 'Loading…',
      to: '/admin/billing', icon: ReceiptIndianRupee, show: showBilling, accent: 'bg-leaf-100 text-leaf-700',
    },
    { label: 'Accepted value', value: formatLakh(won), sub: 'Net after subsidy', to: '/admin/quotations', icon: TrendingUp, show: can('quotations:read'), accent: 'bg-snow-200 text-navy-600' },
  ].filter((k) => k.show)

  const website = [
    { label: 'Pricing plans', to: '/admin/pricing', icon: Tag, ...split(content.pricingPlans) },
    { label: 'Services', to: '/admin/services', icon: Wrench, ...split(content.services) },
    { label: 'Projects', to: '/admin/projects', icon: Image, ...split(content.projects) },
    { label: 'Testimonials', to: '/admin/reviews-faqs', icon: MessageSquareQuote, ...split(content.testimonials) },
    { label: 'Gallery photos', to: '/admin/gallery', icon: Images, ...split(content.gallery) },
    { label: 'Banner slides', to: '/admin/slides', icon: GalleryHorizontal, ...split(content.heroSlides) },
    { label: 'FAQs', to: '/admin/reviews-faqs?tab=faqs', icon: HelpCircle, ...split(content.faqs) },
  ]

  const recentEnquiries = [...enquiries].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5)
  const recentQuotes = [...quotations].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5)

  return (
    <>
      <AdminPageHeader
        title="Dashboard"
        actions={
          <>
            {can('leads:write') && (
              <Link to="/admin/enquiries" className="inline-flex h-10 items-center gap-2 rounded-field border border-line bg-surface px-4 text-sm font-semibold text-ink shadow-soft transition-colors hover:bg-ice-100">
                <Inbox className="size-4" aria-hidden /> Enquiries
              </Link>
            )}
            {can('quotations:write') && (
              <Link to="/admin/proposals?new=1" className="inline-flex h-10 items-center gap-2 rounded-field border border-line bg-surface px-4 text-sm font-semibold text-ink shadow-soft transition-colors hover:bg-ice-100">
                <Plus className="size-4" aria-hidden /> New proposal
              </Link>
            )}
            {can('quotations:write') && (
              <Link to="/admin/quotations?new=1" className="inline-flex h-10 items-center gap-2 rounded-field bg-primary px-4 text-sm font-semibold text-snow-50 shadow-soft transition-colors hover:bg-primary-hover">
                <Plus className="size-4" aria-hidden /> New quotation
              </Link>
            )}
          </>
        }
      />

      {/* 6-column grid: 3 + 2 cards fill each row with no gaps on tablets; one row of 5 on wide screens. */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-6 xl:grid-cols-5">
        {kpis.map(({ label, value, sub, to, icon: Icon, accent }, i) => (
          <Link key={label} to={to} className={cn(
            'group rounded-card border border-line bg-surface p-4 shadow-soft card-lift sm:p-5 md:col-span-2 xl:col-span-1',
            kpis.length % 3 === 2 && i >= kpis.length - 2 && 'md:col-span-3',
            kpis.length % 2 === 1 && i === kpis.length - 1 && 'max-md:col-span-2',
          )}>
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted sm:text-sm">{label}</span>
              <span className={`hidden size-9 shrink-0 place-items-center rounded-full sm:grid ${accent}`}><Icon className="size-4.5" aria-hidden /></span>
            </div>
            <p className="mt-2 font-display text-2xl text-ink tabular-nums sm:mt-3 sm:text-3xl">{value}</p>
            <p className="mt-1 text-xs text-muted sm:text-sm">{sub}</p>
          </Link>
        ))}
      </div>

      <h2 className="mb-3 mt-8 font-sans text-sm font-semibold uppercase tracking-wider text-muted">Website content</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
        {website.map(({ label, to, icon: Icon, published, draft }) => (
          <Link key={label} to={to} className="rounded-card bg-surface p-4 shadow-soft card-lift">
            <Icon className="size-4.5 text-steel-500" aria-hidden />
            <p className="mt-2 font-display text-2xl text-ink tabular-nums">{published}</p>
            <p className="text-sm font-medium text-ink-soft">{label}</p>
            <p className="text-xs text-muted">{draft ? `${draft} hidden` : 'All live'}</p>
          </Link>
        ))}
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        {can('leads:read') && (
          <RecentCard title="Latest enquiries" to="/admin/enquiries">
            {recentEnquiries.length ? recentEnquiries.map((e) => (
              <li key={e.id} className="flex items-start justify-between gap-3 px-5 py-3.5">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-ink">{e.name}</p>
                  <p className="truncate text-sm text-muted">{[e.service, e.city].filter(Boolean).join(' · ')}</p>
                </div>
                <div className="shrink-0 text-right">
                  <ToneBadge tone={enquiryTone[e.status]}>{ENQUIRY_STATUS_LABEL[e.status]}</ToneBadge>
                  <p className="mt-1 text-xs text-muted">{formatDate(e.createdAt)}</p>
                </div>
              </li>
            )) : <li className="p-5"><EmptyState title="No enquiries yet" message="Contact form submissions appear here." /></li>}
          </RecentCard>
        )}
        {can('quotations:read') && (
          <RecentCard title="Latest quotations" to="/admin/quotations">
            {recentQuotes.length ? recentQuotes.map((q) => (
              <li key={q.id} className="flex items-start justify-between gap-3 px-5 py-3.5">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-ink">{q.customerName}</p>
                  <p className="truncate text-sm text-muted">{q.quoteNumber ?? 'Website request'} · {q.capacityKw} kW · {formatLakh(q.netCost)}</p>
                </div>
                <div className="shrink-0 text-right">
                  <ToneBadge tone={quotationTone[q.status]}>{q.status}</ToneBadge>
                  <p className="mt-1 text-xs text-muted">{formatDate(q.createdAt)}</p>
                </div>
              </li>
            )) : <li className="p-5"><EmptyState title="No quotations yet" message="Create one from an enquiry or proposal." /></li>}
          </RecentCard>
        )}
      </div>
    </>
  )
}

function RecentCard({ title, to, children }: { title: string; to: string; children: React.ReactNode }) {
  return (
    <Card padded={false} className="overflow-hidden">
      <div className="flex items-center justify-between px-5 pb-2 pt-4">
        <h2 className="font-sans text-base font-semibold">{title}</h2>
        <Link to={to} className="inline-flex items-center gap-1 text-sm font-semibold text-steel-600 hover:text-ink">View all <ArrowRight className="size-3.5" aria-hidden /></Link>
      </div>
      <ul className="divide-y divide-line">{children}</ul>
    </Card>
  )
}
