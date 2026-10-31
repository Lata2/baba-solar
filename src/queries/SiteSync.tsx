import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { MOCK_DB_KEY, reloadFromStorage } from '@/mocks/store'

/**
 * Keeps every open tab of this browser consistent. In mock mode all data is in localStorage,
 * so a save in one tab fires a `storage` event in the others: they reload the mock database
 * and re-read their queries (the website updates without a refresh).
 */
const CHANNEL = 'baba-solars-sync'
let channel: BroadcastChannel | null = null
const getChannel = () => {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return null
  channel ??= new BroadcastChannel(CHANNEL)
  return channel
}

/** Tell other tabs that data changed (also covered by the storage event; kept for the future API mode). */
export function broadcastChange(scope: 'site' | 'admin' = 'site') {
  try { getChannel()?.postMessage({ scope, at: Date.now() }) } catch { /* ignore */ }
}

export function SiteSync() {
  const qc = useQueryClient()
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== null && e.key !== MOCK_DB_KEY) return
      reloadFromStorage()
      void qc.invalidateQueries()
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [qc])
  return null
}
