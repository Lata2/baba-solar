import type { ReactNode } from 'react'
import { Search } from 'lucide-react'
import type { PublishStatus } from '@/types'
import { cn } from '@/lib/cn'
import { Badge, type BadgeTone } from '@/components/ui'

export function AdminPageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-3xl">{title}</h1>
        {description && <p className="mt-1 text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  )
}

export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="mb-4 flex flex-col gap-3 rounded-card border border-line bg-surface p-3 sm:flex-row sm:items-center">{children}</div>
}

export function SearchBox({ value, onChange, placeholder = 'Search' }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="relative flex-1">
      <span className="sr-only">{placeholder}</span>
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-10 w-full rounded-field border border-line bg-canvas pl-9 pr-3 text-sm focus:border-steel-500 focus:outline-none focus:ring-2 focus:ring-sun-400/40"
      />
    </label>
  )
}

export function FilterSelect<T extends string>({ label, value, onChange, options }: { label: string; value: T; onChange: (v: T) => void; options: Array<{ value: T; label: string }> }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-muted">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value as T)} className="h-10 rounded-field border border-line bg-canvas px-3 focus:border-steel-500 focus:outline-none">
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  )
}

export function StatusBadge({ status }: { status: PublishStatus }) {
  return <Badge tone={status === 'published' ? 'success' : 'neutral'}>{status === 'published' ? 'Published' : 'Draft'}</Badge>
}

export function ToneBadge({ tone, children }: { tone: BadgeTone; children: ReactNode }) {
  return <Badge tone={tone} className="capitalize">{children}</Badge>
}

export interface Column<T> {
  header: string
  cell: (row: T) => ReactNode
  className?: string
}

/** Responsive table: scrolls horizontally on small screens. */
export function DataTable<T extends { id: string }>({ rows, columns, empty, caption }: { rows: T[]; columns: Column<T>[]; empty: ReactNode; caption: string }) {
  if (!rows.length) return <>{empty}</>
  return (
    <div className="overflow-x-auto rounded-card border border-line bg-surface shadow-soft">
      <table className="w-full min-w-[44rem] text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="border-b border-line bg-snow-200/60 text-ink-soft">
          <tr>{columns.map((c) => <th key={c.header} scope="col" className={cn('px-4 py-3 font-semibold', c.className)}>{c.header}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-line last:border-0 hover:bg-ice-100/40">
              {columns.map((c) => <td key={c.header} className={cn('px-4 py-3 align-top', c.className)}>{c.cell(r)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function IconAction({ label, onClick, children, danger, disabled }: { label: string; onClick: () => void; children: ReactNode; danger?: boolean; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      disabled={disabled}
      className={cn('grid size-9 place-items-center rounded-field text-muted transition-colors disabled:pointer-events-none disabled:opacity-35 sm:size-8', danger ? 'hover:bg-clay-100 hover:text-clay-700' : 'hover:bg-ice-100 hover:text-ink')}
    >
      {children}
    </button>
  )
}

/** Converts newline-separated textarea text ↔ string[] */
export const linesToList = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean)
export const listToLines = (l: string[]) => l.join('\n')
