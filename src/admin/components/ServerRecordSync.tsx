import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { SERVER_MODE } from '@/config/api'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'
import { api } from '@/services/api'
import { driveApi } from '@/services/documents'
import { broadcastChange } from '@/queries/SiteSync'

/**
 * Server mode only: after sign-in, bring this browser's quotations and invoices up to date with the
 * copies the server keeps next to their PDF/Excel files (another PC, or browser data was cleared).
 * Also moves the number counters forward so a new document never reuses an existing number.
 */
export function ServerRecordSync() {
  const { status, can } = useAuth()
  const qc = useQueryClient()
  const toast = useToast()
  const done = useRef(false)
  useEffect(() => {
    if (!SERVER_MODE || status !== 'authenticated' || done.current || !(can('quotations:read') || can('invoices:read'))) return
    done.current = true
    void (async () => {
      try {
        const snaps = await driveApi.records()
        if (!snaps.length) return
        const { restored } = await api.restoreRecords(snaps)
        if (restored) {
          await qc.invalidateQueries()
          broadcastChange('admin')
          toast({ tone: 'info', title: `${restored} quotation/invoice record${restored === 1 ? '' : 's'} loaded from the server` })
        }
      } catch (error) {
        done.current = false
        toast({
          tone: 'error',
          title: 'Saved records could not be synchronized',
          description: error instanceof Error ? error.message : 'The server request failed.',
        })
      }
    })()
  }, [status, can, qc, toast])
  return null
}
