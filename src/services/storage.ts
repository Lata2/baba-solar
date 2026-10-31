import { SITE } from '@/config/site'

/** Safe localStorage wrapper (private mode / quota errors never crash the app). */
export const storage = {
  get<T>(key: string): T | null {
    try {
      const raw = window.localStorage.getItem(SITE.storagePrefix + key)
      return raw ? (JSON.parse(raw) as T) : null
    } catch {
      return null
    }
  },
  set<T>(key: string, value: T): boolean {
    try {
      window.localStorage.setItem(SITE.storagePrefix + key, JSON.stringify(value))
      return true
    } catch {
      return false
    }
  },
  remove(key: string): void {
    try { window.localStorage.removeItem(SITE.storagePrefix + key) } catch { /* ignore */ }
  },
  /** False in private mode / when storage is blocked. */
  available(): boolean {
    try {
      const k = SITE.storagePrefix + '__probe'
      window.localStorage.setItem(k, '1')
      window.localStorage.removeItem(k)
      return true
    } catch {
      return false
    }
  },
  /** Full key including prefix, for matching `storage` events across tabs. */
  fullKey: (key: string) => SITE.storagePrefix + key,
}
