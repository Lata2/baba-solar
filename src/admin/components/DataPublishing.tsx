import { useRef, useState } from 'react'
import { DatabaseBackup, Download, Upload } from 'lucide-react'
import { api } from '@/services/api'
import { useImportSnapshot } from '@/queries'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'
import { Button, ConfirmDialog } from '@/components/ui'
import { errorMessage } from '../hooks/useCrud'

function download(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2) + '\n'], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = Object.assign(document.createElement('a'), { href: url, download: filename })
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/**
 * Admin → Site content → Backup & restore.
 * Every change is saved to the database immediately and is live for all visitors; this
 * panel is only for backups and moving content between installations.
 */
export function DataPublishing() {
  const { can } = useAuth()
  const importer = useImportSnapshot()
  const toast = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState<'content' | 'full' | null>(null)
  const [pendingImport, setPendingImport] = useState<{ name: string; data: unknown } | null>(null)
  if (!can('backup:manage')) return null

  const exportFile = async (includeLeads: boolean) => {
    setBusy(includeLeads ? 'full' : 'content')
    try {
      const snap = await api.exportSnapshot({ includeLeads })
      download(`baba-solars-${includeLeads ? 'full-backup' : 'content'}-${snap.exportedAt.slice(0, 10)}.json`, snap)
      toast({ title: 'Backup downloaded', description: includeLeads ? 'Includes enquiries, quotations and invoices. Keep it private.' : 'Website content, prices and settings.' })
    } catch (e) {
      toast({ tone: 'error', title: 'Backup failed', description: errorMessage(e) })
    } finally { setBusy(null) }
  }

  const onFile = async (file: File | undefined) => {
    if (!file) return
    try { setPendingImport({ name: file.name, data: JSON.parse(await file.text()) }) }
    catch { toast({ tone: 'error', title: 'Could not read the file', description: 'Choose a .json backup exported from this admin panel.' }) }
    finally { if (fileRef.current) fileRef.current.value = '' }
  }

  const doImport = async () => {
    const job = pendingImport
    setPendingImport(null)
    if (!job) return
    try {
      const { imported } = await importer.mutateAsync(job.data)
      toast({ title: 'Backup restored', description: `Updated: ${imported.join(', ')}. The website shows it now.` })
    } catch (e) {
      toast({ tone: 'error', title: 'Restore failed — nothing was changed', description: errorMessage(e) })
    }
  }

  return (
    <section id="data" className="scroll-mt-24 rounded-card border border-line bg-surface p-5 shadow-soft md:p-6" aria-labelledby="data-title">
      <h2 id="data-title" className="flex items-center gap-2 font-sans text-base font-semibold"><DatabaseBackup className="size-4 text-steel-600" aria-hidden />Backup &amp; restore</h2>
      <p className="mt-1 text-sm text-muted">Changes are saved in the database and are live for every visitor as soon as you save — there is nothing to publish. Use backups before big edits or to copy content to another server.</p>
      <div className="mt-5 flex flex-wrap gap-2">
        <Button leftIcon={<Download className="size-4" />} loading={busy === 'content'} onClick={() => void exportFile(false)}>Download content backup</Button>
        <Button variant="secondary" leftIcon={<Download className="size-4" />} loading={busy === 'full'} onClick={() => void exportFile(true)}>Full backup (with leads & invoices)</Button>
        <Button variant="secondary" leftIcon={<Upload className="size-4" />} onClick={() => fileRef.current?.click()} loading={importer.isPending}>Restore from file…</Button>
        <input ref={fileRef} type="file" accept="application/json,.json" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => void onFile(e.target.files?.[0])} />
      </div>
      <p className="mt-3 text-xs text-muted">Restore replaces website content, prices, services, banners, gallery, FAQs, companies and settings found in the file. Enquiries, quotations and invoices are never overwritten. Old <code>site-data.json</code> files from the previous version can be restored too.</p>
      <ConfirmDialog open={!!pendingImport} title="Restore this backup?" message={`"${pendingImport?.name}" will replace the matching sections on the live website. Download a backup first if unsure.`}
        confirmLabel="Restore" onConfirm={() => void doImport()} onCancel={() => setPendingImport(null)} />
    </section>
  )
}
