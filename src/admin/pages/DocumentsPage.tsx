import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { CloudUpload, Download, FileSpreadsheet, FileText, FolderOpen, HardDrive, RefreshCw, Trash2, Unplug } from 'lucide-react'
import { SERVER_MODE } from '@/config/api'
import { useSeo } from '@/hooks/useSeo'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'
import { downloadBlob } from '@/lib/files'
import { formatDate, formatINR } from '@/lib/format'
import {
  chooseDocumentsFolder, documentStore, driveApi, folderAccessSupported, forgetDocumentsFolder,
  type DocKind, type DriveState, type StoredDocument,
} from '@/services/documents'
import { Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, Skeleton, type BadgeTone } from '@/components/ui'
import { AdminPageHeader, DataTable, FilterSelect, IconAction, SearchBox, Toolbar } from '../components/AdminUI'
import { documentKeys, useDriveStatus, useStoreStatus, useStoredDocuments } from '../hooks/useDocuments'
import { errorMessage } from '../hooks/useCrud'

const DRIVE_BADGE: Record<DriveState, { tone: BadgeTone; label: string }> = {
  pending: { tone: 'warning', label: 'Drive: queued' },
  uploading: { tone: 'info', label: 'Drive: uploading' },
  uploaded: { tone: 'success', label: 'Drive: backed up' },
  failed: { tone: 'danger', label: 'Drive: failed' },
  disabled: { tone: 'neutral', label: 'Drive: off' },
}
const kb = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)

/** Admin → Saved documents: where quotation / billing files are kept, Google Drive backup, and every stored file. */
export default function DocumentsPage() {
  useSeo({ title: 'Saved documents', path: '/admin/documents', noIndex: true })
  const { can } = useAuth()
  const toast = useToast()
  const qc = useQueryClient()
  const [params, setParams] = useSearchParams()
  const [kind, setKind] = useState<DocKind | 'all'>('all')
  const [q, setQ] = useState('')
  const [deleting, setDeleting] = useState<StoredDocument | null>(null)
  const list = useStoredDocuments({ kind: kind === 'all' ? undefined : kind })
  const store = useStoreStatus()

  // Back from Google's consent screen: /admin/documents?drive=connected|error&message=…
  useEffect(() => {
    const d = params.get('drive')
    if (!d) return
    if (d === 'connected') toast({ title: 'Google Drive connected', description: 'Quotations and bills are now backed up automatically.' })
    else toast({ tone: 'error', title: 'Google Drive not connected', description: params.get('message') ?? 'Try again.' })
    setParams({}, { replace: true })
    void qc.invalidateQueries({ queryKey: documentKeys.all })
  }, [params, setParams, toast, qc])

  const rows = useMemo(() => {
    const t = q.trim().toLowerCase()
    return (list.data ?? []).filter((d) => !t || `${d.docNumber} ${d.clientName} ${d.fileName}`.toLowerCase().includes(t))
  }, [list.data, q])

  const download = async (d: StoredDocument) => {
    try { downloadBlob(await documentStore().download(d), d.fileName) } catch (e) { toast({ tone: 'error', title: 'Download failed', description: errorMessage(e) }) }
  }
  const remove = async () => {
    if (!deleting) return
    try {
      const r = await driveApi.remove(deleting.id)
      toast({ title: 'Removed from the storage folder', description: r.driveCopyKept ? 'The Google Drive backup copy is kept.' : undefined })
      void qc.invalidateQueries({ queryKey: documentKeys.all })
    } catch (e) { toast({ tone: 'error', title: 'Not removed', description: errorMessage(e) }) }
    setDeleting(null)
  }

  return (
    <>
      <AdminPageHeader
        title="Saved documents"
        description="Every saved quotation and bill is stored as PDF and Excel, named “number – client”, in the Quotations and Billing folders."
        actions={<Button variant="secondary" leftIcon={<RefreshCw className="size-4" />} onClick={() => void qc.invalidateQueries({ queryKey: documentKeys.all })}>Refresh</Button>}
      />

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        {SERVER_MODE ? <ServerStorageCard /> : <BrowserFolderCard ready={!!store.data?.ready} message={store.data?.message ?? ''} location={store.data?.location ?? ''} onChange={() => void qc.invalidateQueries({ queryKey: documentKeys.all })} />}
        {SERVER_MODE ? <DriveCard canManage={can('backup:manage')} /> : (
          <Card className="p-5">
            <div className="flex items-center gap-2"><CloudUpload className="size-5 text-steel-600" aria-hidden /><h2 className="font-sans text-base font-semibold">Google Drive backup</h2></div>
            <p className="mt-2 text-sm text-muted">Automatic backup to babasolars76@gmail.com needs the Baba Solars server, which keeps the Google sign-in secret safely. It is never put in the website code. See README → “Server mode”.</p>
          </Card>
        )}
      </div>

      <Toolbar>
        <SearchBox value={q} onChange={setQ} placeholder="Search client or document no." />
        <FilterSelect label="Type" value={kind} onChange={setKind} options={[{ value: 'all', label: 'All' }, { value: 'quotation', label: 'Quotations' }, { value: 'billing', label: 'Billing' }]} />
      </Toolbar>
      {list.isError ? <ErrorState message={errorMessage(list.error)} onRetry={() => void list.refetch()} /> : list.isPending ? <Skeleton className="h-40" /> : (
        <DataTable
          caption="Saved documents"
          rows={rows}
          empty={<EmptyState title={list.data?.length ? 'No documents match' : 'No saved documents yet'} message="Files are saved when you create or edit a quotation or invoice, or with “Save PDF & Excel”." />}
          columns={[
            { header: 'Document', cell: (d) => (
              <div className="flex items-start gap-2">
                {d.format === 'pdf' ? <FileText className="mt-0.5 size-4 text-clay-700" aria-hidden /> : <FileSpreadsheet className="mt-0.5 size-4 text-leaf-700" aria-hidden />}
                <div>
                  <p className="font-semibold text-ink">{d.docNumber}</p>
                  <p className="text-muted">{d.kind === 'quotation' ? 'Quotation' : 'Billing'} · {d.format.toUpperCase()} · {kb(d.size)}</p>
                </div>
              </div>
            ) },
            { header: 'Client', cell: (d) => <div><p className="font-semibold text-ink">{d.clientName}</p><p className="break-all text-xs text-muted">{d.relativePath}</p></div> },
            { header: 'Date / amount', cell: (d) => <div className="whitespace-nowrap"><p>{formatDate(d.docDate)}</p><p className="text-muted tabular-nums">{formatINR(d.amount)}</p></div> },
            { header: 'Saved', cell: (d) => <div className="whitespace-nowrap"><p>{formatDate(d.updatedAt)}</p><p className="text-muted">Version {d.version}</p></div> },
            { header: 'Backup', cell: (d) => d.drive ? (
              <div>
                <Badge tone={DRIVE_BADGE[d.drive.status].tone} className="whitespace-nowrap">{DRIVE_BADGE[d.drive.status].label}</Badge>
                {d.drive.lastError && d.drive.status !== 'uploaded' && <p className="mt-1 max-w-56 text-xs text-clay-700">{d.drive.lastError}{d.drive.status === 'pending' && d.drive.attempts ? ` · retry ${d.drive.attempts}` : ''}</p>}
              </div>
            ) : <span className="text-sm text-muted">This computer only</span> },
            { header: 'Actions', className: 'text-right', cell: (d) => (
              <div className="flex justify-end gap-1">
                <IconAction label={`Download ${d.fileName}`} onClick={() => void download(d)}><Download className="size-4" /></IconAction>
                {SERVER_MODE && can('backup:manage') && <IconAction label={`Delete ${d.fileName}`} danger onClick={() => setDeleting(d)}><Trash2 className="size-4" /></IconAction>}
              </div>
            ) },
          ]}
        />
      )}
      <ConfirmDialog
        open={!!deleting}
        title="Delete this file from the storage folder?"
        message={`${deleting?.fileName} will be removed from the server folder. A Google Drive backup copy, if any, is kept. Saving the record again recreates it.`}
        confirmLabel="Delete file"
        onConfirm={() => void remove()}
        onCancel={() => setDeleting(null)}
      />
    </>
  )
}

function ServerStorageCard() {
  const s = useDriveStatus()
  const st = s.data?.storage
  return (
    <Card className="p-5">
      <div className="flex items-center gap-2"><HardDrive className="size-5 text-steel-600" aria-hidden /><h2 className="font-sans text-base font-semibold">Storage folder</h2></div>
      {s.isPending ? <Skeleton className="mt-3 h-12" /> : s.isError ? <p className="mt-2 text-sm text-clay-700">{errorMessage(s.error)}</p> : (
        <>
          <p className="mt-2 break-all font-mono text-sm text-ink">{st?.root}</p>
          <p className="mt-1 text-sm text-muted">Inside: <code>Quotations</code> and <code>Billing</code>{st?.clientSubfolders ? ', one folder per client' : ''}.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Badge tone={st?.writable ? 'success' : 'danger'}>{st?.writable ? 'Writable' : 'Not writable'}</Badge>
            <Badge tone="neutral">{st?.platform === 'win32' ? 'Windows PC (local drive)' : 'Server folder — use the sync agent for C:\\'}</Badge>
          </div>
        </>
      )}
    </Card>
  )
}

function DriveCard({ canManage }: { canManage: boolean }) {
  const s = useDriveStatus()
  const toast = useToast()
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [confirmOff, setConfirmOff] = useState(false)
  const d = s.data
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true)
    try { await fn(); toast({ title: ok }); await qc.invalidateQueries({ queryKey: documentKeys.all }) } catch (e) { toast({ tone: 'error', title: 'Google Drive', description: errorMessage(e) }) } finally { setBusy(false) }
  }
  return (
    <Card className="p-5">
      <div className="flex items-center gap-2"><CloudUpload className="size-5 text-steel-600" aria-hidden /><h2 className="font-sans text-base font-semibold">Google Drive backup</h2></div>
      {s.isPending ? <Skeleton className="mt-3 h-12" /> : !d ? null : !d.configured ? (
        <p className="mt-2 text-sm text-muted">Not set up on the server. Add <code>GOOGLE_CLIENT_ID</code>, <code>GOOGLE_CLIENT_SECRET</code> and <code>TOKEN_ENCRYPTION_KEY</code> to <code>server/.env</code> (see README), then restart the server.</p>
      ) : (
        <>
          <p className="mt-2 text-sm">
            {d.connected ? <>Connected as <strong>{d.account}</strong> · folder <strong>{d.rootFolder}</strong> (Quotations, Billing)</> : <>Not connected. Sign in with <strong>{d.expectedAccount}</strong>.</>}
          </p>
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <Badge tone="success">{d.counts.uploaded} backed up</Badge>
            <Badge tone="warning">{d.counts.pending + d.counts.uploading} queued</Badge>
            {d.counts.failed > 0 && <Badge tone="danger">{d.counts.failed} failed</Badge>}
          </div>
          {d.lastError && <p className="mt-2 text-sm text-clay-700">{d.lastError}</p>}
          {canManage && (
            <div className="mt-4 flex flex-wrap gap-2">
              {!d.connected ? (
                <Button leftIcon={<CloudUpload className="size-4" />} loading={busy} onClick={() => void act(async () => { const { url } = await driveApi.connect(); window.location.assign(url) }, 'Opening Google sign-in…')}>Connect Google Drive</Button>
              ) : (
                <>
                  <Button variant="secondary" leftIcon={<RefreshCw className="size-4" />} loading={busy} onClick={() => void act(driveApi.retry, 'Failed uploads queued again')}>Retry failed uploads</Button>
                  <Button variant="ghost" leftIcon={<Unplug className="size-4" />} onClick={() => setConfirmOff(true)}>Disconnect</Button>
                </>
              )}
            </div>
          )}
        </>
      )}
      <ConfirmDialog open={confirmOff} title="Disconnect Google Drive?" message="New documents will no longer be backed up until you connect again. Files already in Drive stay there." confirmLabel="Disconnect"
        onConfirm={() => { setConfirmOff(false); void act(driveApi.disconnect, 'Google Drive disconnected') }} onCancel={() => setConfirmOff(false)} />
    </Card>
  )
}

function BrowserFolderCard({ ready, message, location, onChange }: { ready: boolean; message: string; location: string; onChange: () => void }) {
  const toast = useToast()
  const supported = folderAccessSupported()
  const pick = async () => {
    try {
      const name = await chooseDocumentsFolder()
      toast({ title: `Saving into “${name}”`, description: 'Quotations and Billing folders are ready.' })
      onChange()
    } catch (e) {
      if ((e as DOMException)?.name !== 'AbortError') toast({ tone: 'error', title: 'Folder not set', description: errorMessage(e) })
    }
  }
  const allowAgain = async () => {
    try { await documentStore().list(); const st = await documentStore().status(); if (!st.ready) await pick(); onChange() } catch (e) { toast({ tone: 'error', title: 'No access', description: errorMessage(e) }) }
  }
  return (
    <Card className="p-5">
      <div className="flex items-center gap-2"><FolderOpen className="size-5 text-steel-600" aria-hidden /><h2 className="font-sans text-base font-semibold">Folder on this computer</h2></div>
      <p className="mt-2 text-sm text-muted">{message}</p>
      {supported && (
        <p className="mt-1 text-sm text-muted">Choose <strong>C:\</strong> (a “Quotation and Billing” folder is created inside) or an existing “Quotation and Billing” folder. The browser asks for permission — websites cannot write to your drive without it.</p>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        {supported && <Button leftIcon={<FolderOpen className="size-4" />} onClick={() => void (location && !ready ? allowAgain() : pick())}>{!location ? 'Choose folder' : ready ? 'Change folder' : 'Allow access again'}</Button>}
        {location && <Button variant="ghost" onClick={() => void forgetDocumentsFolder().then(onChange)}>Stop saving here</Button>}
      </div>
    </Card>
  )
}
