import { useCallback, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { Invoice, Quotation, QuotationTemplate } from '@/types'
import { SERVER_MODE } from '@/config/api'
import { useToast } from '@/context/ToastContext'
import { documentStore, driveApi, saveInvoiceFiles, saveQuotationFiles, type DocKind, type SaveResult } from '@/services/documents'
import { errorMessage } from './useCrud'

export const documentKeys = {
  all: ['admin', 'documents'] as const,
  list: (f: { kind?: DocKind; q?: string; recordId?: string }) => ['admin', 'documents', 'list', f] as const,
  status: ['admin', 'documents', 'status'] as const,
  drive: ['admin', 'documents', 'drive'] as const,
}

export const useStoredDocuments = (f: { kind?: DocKind; q?: string; recordId?: string } = {}, enabled = true) =>
  useQuery({ queryKey: documentKeys.list(f), queryFn: () => documentStore().list(f), enabled, refetchInterval: SERVER_MODE ? 15_000 : false })

export const useStoreStatus = () => useQuery({ queryKey: documentKeys.status, queryFn: () => documentStore().status(), staleTime: 10_000 })

export const useDriveStatus = (enabled = SERVER_MODE) =>
  useQuery({ queryKey: documentKeys.drive, queryFn: driveApi.status, enabled, refetchInterval: 15_000 })

const describe = (r: SaveResult) => {
  const sep = r.location.includes('/') ? '/' : '\\'
  const names = [...new Set(r.documents.map((d) => d.relativePath.split('/').slice(0, -1).join(sep)))]
  const drive = SERVER_MODE && r.documents.some((d) => d.drive && d.drive.status !== 'disabled') ? ' Google Drive backup queued.' : ''
  return `${r.location}${sep}${names.join(', ')}.${drive}`
}

/**
 * Save the PDF + Excel of a quotation / invoice to the document store (server folder + Drive,
 * or the folder chosen on this computer). `auto` = called right after saving the record: quiet when
 * no folder has been set up yet.
 */
export function useSaveDocuments() {
  const qc = useQueryClient()
  const toast = useToast()
  const [busy, setBusy] = useState(false)

  const run = useCallback(async (label: string, fn: () => Promise<SaveResult>, auto: boolean) => {
    if (auto) {
      const status = await documentStore().status().catch(() => null)
      if (!status?.ready) {
        if (status?.needsPermission) toast({ tone: 'info', title: `${label}: files not saved to the folder yet`, description: 'Open “Saved documents” and choose the Quotation and Billing folder (one time).' })
        else if (status) toast({ tone: 'error', title: `${label}: files not saved`, description: status.message })
        return null
      }
    }
    setBusy(true)
    try {
      const r = await fn()
      toast({ title: `${label}: PDF and Excel saved`, description: describe(r) })
      void qc.invalidateQueries({ queryKey: documentKeys.all })
      return r
    } catch (e) {
      toast({ tone: 'error', title: `${label}: files not saved`, description: errorMessage(e) })
      return null
    } finally { setBusy(false) }
  }, [qc, toast])

  return {
    busy,
    saveQuotation: (q: Quotation, template?: QuotationTemplate, auto = false) => run(`Quotation ${q.quoteNumber ?? ''}`.trim(), () => saveQuotationFiles(q, template), auto),
    saveInvoice: (inv: Invoice, auto = false) => run(`Invoice ${inv.invoiceNumber}`, () => saveInvoiceFiles(inv), auto),
  }
}
