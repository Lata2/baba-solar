import { API_BASE } from '@/config/api'
import { ApiError, AUTH_EXPIRED_EVENT, type ApiErrorCode } from './errors'

/**
 * HTTP client for the Baba Solars server. The session is an httpOnly cookie (JavaScript cannot
 * read it); every state-changing request also carries the per-session CSRF token in a header.
 * The token is kept in memory only.
 */
let csrfToken = ''
export const setCsrfToken = (t: string) => { csrfToken = t }

interface Options { json?: unknown; form?: FormData; signal?: AbortSignal; raw?: boolean; quiet401?: boolean }

export async function http<T = unknown>(method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, opts: Options = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  let body: BodyInit | undefined
  if (opts.json !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(opts.json) }
  else if (opts.form) body = opts.form
  if (method !== 'GET' && csrfToken) headers['X-CSRF-Token'] = csrfToken
  let res: Response
  try {
    res = await fetch(`${API_BASE}/api${path}`, { method, headers, body, credentials: 'same-origin', signal: opts.signal ?? AbortSignal.timeout(120_000) })
  } catch (e) {
    const timeout = e instanceof DOMException && e.name === 'TimeoutError'
    throw new ApiError(timeout ? 'The server took too long to answer. Try again.' : 'Cannot reach the Baba Solars server. Check that it is running and your connection.', { code: timeout ? 'timeout' : 'network' })
  }
  if (!res.ok) {
    let payload: { error?: { message?: string; code?: ApiErrorCode; fieldErrors?: Record<string, string> } } = {}
    try { payload = await res.json() } catch { /* not JSON */ }
    if (res.status === 401 && !opts.quiet401) window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT))
    throw new ApiError(payload.error?.message ?? `Request failed (${res.status}).`, {
      code: payload.error?.code ?? (res.status === 401 ? 'unauthorized' : res.status === 403 ? 'forbidden' : res.status === 404 ? 'not_found' : res.status === 429 ? 'rate_limited' : 'unknown'),
      status: res.status,
      fieldErrors: payload.error?.fieldErrors,
    })
  }
  if (opts.raw) return (await res.blob()) as T
  const data = (await res.json()) as T
  if (data && typeof data === 'object' && 'csrfToken' in data && typeof (data as { csrfToken: unknown }).csrfToken === 'string') setCsrfToken((data as { csrfToken: string }).csrfToken)
  return data
}
