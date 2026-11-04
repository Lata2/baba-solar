import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { onExternalChange, reloadFromStorage } from '@/mocks/store'

/**
 * Keeps every open tab of this browser consistent: when another tab saves, the store tells
 * this one (BroadcastChannel), which reloads the dataset and re-reads its queries — the
 * website updates without a refresh.
 */
export function broadcastChange(_scope: 'site' | 'admin' = 'site') {
  // The store announces every successful write itself (see transaction() in mocks/store.ts).
  // Kept as the hook point for a future API mode (e.g. server-sent events).
}

export function SiteSync() {
  const qc = useQueryClient()
  useEffect(() => onExternalChange(() => {
    void reloadFromStorage().then(() => qc.invalidateQueries())
  }), [qc])
  return null
}
