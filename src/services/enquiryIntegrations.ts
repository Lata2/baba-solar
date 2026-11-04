/**
 * WEBSITE ENQUIRY DELIVERY
 * ─────────────────────────────────────────────────────────────────────────
 * One website enquiry goes to four independent places, in this order:
 *
 *   1. Admin → Enquiries (this browser's data store, existing flow)
 *   2. Google Sheet        (Apps Script, action "sheet")
 *   3. Admin email         (Apps Script, action "email" — MailApp, admin address kept in Script Properties)
 *   4. WhatsApp            (wa.me link with the details, opened in a new tab)
 *
 * Every step has its own try/catch: one failing never stops or undoes the others.
 * A failed Sheet/email call is put in a retry queue (localStorage) and sent again on the next
 * page load or when the browser comes back online — an enquiry is never dropped silently.
 * Each enquiry carries a submissionId (UUID); the admin store and the Apps Script ignore repeats,
 * so retries and double clicks never create duplicate rows or emails.
 *
 * FIREBASE-READY: step 1 is injected (`saveAdmin`), so moving to Firestore means only changing
 * api.submitEnquiry / api.submitQuotation (use the submissionId as the document id → idempotent).
 * Set VITE_ENQUIRY_DELIVERY=server once a Cloud Function sends the Sheet row and email on document
 * create: steps 2–3 are then skipped here and the forms need no change. EnquiryPayload is the
 * shape both the Apps Script and such a function receive.
 */
import type { EnquiryType } from '@/types'
import { INTEGRATIONS, appsScriptConfigured } from '@/config/integrations'

export type IntegrationAction = 'sheet' | 'email'
export type StepStatus = 'sent' | 'queued' | 'skipped'

/** What is sent to the Apps Script and shown in WhatsApp. Empty strings = not provided. */
export interface EnquiryPayload {
  submissionId: string
  /** ISO timestamp */
  createdAt: string
  /** Same moment, formatted for India, e.g. "04 Nov 2026, 10:30 am" */
  dateTime: string
  name: string
  mobile: string
  email: string
  /** "Home" | "Commercial" | "" */
  enquiryType: string
  /** Number as text, e.g. "5" ("" = not given) */
  requiredKw: string
  message: string
  city: string
  service: string
  source: string
  page: string
}

export interface QueueItem {
  key: string
  action: IntegrationAction
  data: EnquiryPayload
  attempts: number
  queuedAt: string
  lastAttemptAt?: string
  lastError?: string
}

export interface SubmissionResult {
  submissionId: string
  admin: 'saved' | 'failed'
  adminError?: unknown
  sheet: StepStatus
  email: StepStatus
  whatsapp: 'opened' | 'blocked'
  whatsappUrl: string
  /** True when the enquiry reached the business (admin store or Google Sheet). */
  delivered: boolean
}

// ─── Small helpers ──────────────────────────────────────────────────────────

/** RFC 4122 v4 UUID (crypto.randomUUID where available). */
export function newSubmissionId(): string {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  const b = new Uint8Array(16)
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(b)
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256)
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

const IST = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true,
})
export const formatSubmissionTime = (iso: string) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : IST.format(d)
}

export const ENQUIRY_TYPE_TEXT: Record<EnquiryType, string> = { home: 'Home', commercial: 'Commercial' }

/** Build the payload from the form values (trimmed; missing values become ""). */
export function buildPayload(v: {
  submissionId: string; createdAt: string; name: string; phone?: string; email?: string; enquiryType?: EnquiryType | null
  capacityKw?: number | null; message?: string; city?: string; service?: string; source?: string; page?: string
}): EnquiryPayload {
  const t = (x: unknown) => String(x ?? '').trim()
  return {
    submissionId: v.submissionId,
    createdAt: v.createdAt,
    dateTime: formatSubmissionTime(v.createdAt),
    name: t(v.name),
    mobile: t(v.phone).replace(/\D/g, '').replace(/^(91|0)(?=\d{10}$)/, ''),
    email: t(v.email),
    enquiryType: v.enquiryType ? ENQUIRY_TYPE_TEXT[v.enquiryType] : '',
    requiredKw: v.capacityKw != null && Number.isFinite(v.capacityKw) && v.capacityKw > 0 ? String(v.capacityKw) : '',
    message: t(v.message),
    city: t(v.city),
    service: t(v.service),
    source: t(v.source),
    page: t(v.page),
  }
}

/** WhatsApp text with ONLY the fields that were filled in: Name, Mobile, Email, Type, kW, Message, Time. */
export function buildWhatsAppText(p: EnquiryPayload): string {
  const lines: Array<[string, string]> = [
    ['Name', p.name],
    ['Mobile', p.mobile],
    ['Email', p.email],
    ['Type', p.enquiryType],
    ['Required kW', p.requiredKw ? `${p.requiredKw} kW` : ''],
    ['Message', p.message],
    ['Time', p.dateTime],
  ]
  return ['Hi Baba Solars, I have a new enquiry:', ...lines.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`)].join('\n')
}

export const whatsappEnquiryUrl = (p: EnquiryPayload, number = INTEGRATIONS.whatsappNumber) =>
  `https://wa.me/${number}?text=${encodeURIComponent(buildWhatsAppText(p))}`

// ─── Apps Script call ───────────────────────────────────────────────────────

export class IntegrationError extends Error {}

interface PostOptions { url?: string; token?: string; fetchImpl?: typeof fetch; timeoutMs?: number }

/**
 * POST one action to the Apps Script Web App. Sent as text/plain so the browser makes a "simple"
 * request (no CORS preflight, which Apps Script cannot answer). Resolves only on {"ok": true}.
 */
export async function postToAppsScript(action: IntegrationAction, data: EnquiryPayload, opts: PostOptions = {}) {
  const url = opts.url ?? INTEGRATIONS.appsScriptUrl
  const doFetch = opts.fetchImpl ?? globalThis.fetch.bind(globalThis)
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null
  const timer = ctrl ? setTimeout(() => ctrl.abort(), opts.timeoutMs ?? INTEGRATIONS.timeoutMs) : null
  try {
    const res = await doFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, token: opts.token ?? INTEGRATIONS.appsScriptToken, data }),
      redirect: 'follow',
      signal: ctrl?.signal,
    })
    if (!res.ok) throw new IntegrationError(`Apps Script returned HTTP ${res.status}`)
    let body: { ok?: boolean; error?: string; result?: string }
    try {
      body = await res.json()
    } catch {
      throw new IntegrationError('Apps Script did not return JSON (check the Web App URL and "Anyone" access).')
    }
    if (!body?.ok) throw new IntegrationError(body?.error || 'Apps Script rejected the request')
    return body
  } catch (e) {
    if (e instanceof IntegrationError) throw e
    throw new IntegrationError(e instanceof Error ? (e.name === 'AbortError' ? 'Request timed out' : e.message) : String(e))
  } finally {
    if (timer) clearTimeout(timer)
  }
}

// ─── Retry queue (localStorage) ─────────────────────────────────────────────

export const QUEUE_KEY = 'baba-solars:enquiry-retry-queue'
const MAX_QUEUE = 300
let memoryQueue: QueueItem[] = [] // used only when localStorage is blocked

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null
  } catch {
    return null
  }
}

export function readQueue(): QueueItem[] {
  const s = storage()
  if (!s) return memoryQueue
  try {
    const list = JSON.parse(s.getItem(QUEUE_KEY) || '[]')
    return Array.isArray(list) ? list.filter((x) => x && typeof x.key === 'string' && x.data) : []
  } catch {
    return []
  }
}

function writeQueue(list: QueueItem[]) {
  const trimmed = list.slice(-MAX_QUEUE)
  const s = storage()
  if (!s) { memoryQueue = trimmed; return }
  try {
    if (trimmed.length) s.setItem(QUEUE_KEY, JSON.stringify(trimmed))
    else s.removeItem(QUEUE_KEY)
  } catch {
    memoryQueue = trimmed
  }
}

/** Add (or refresh) a pending delivery. One entry per submission + action, so no duplicates. */
export function enqueue(action: IntegrationAction, data: EnquiryPayload, error?: string) {
  const key = `${action}:${data.submissionId}`
  const list = readQueue()
  const i = list.findIndex((x) => x.key === key)
  const now = new Date().toISOString()
  if (i >= 0) list[i] = { ...list[i], attempts: list[i].attempts + 1, lastAttemptAt: now, lastError: error }
  else list.push({ key, action, data, attempts: 1, queuedAt: now, lastAttemptAt: now, lastError: error })
  writeQueue(list)
}

let flushing: Promise<{ sent: number; pending: number }> | null = null

/**
 * Send everything in the retry queue. Safe to call often (page load, "online" event): runs once at
 * a time, and the Apps Script ignores items it already has.
 */
export function flushQueue(opts: PostOptions = {}): Promise<{ sent: number; pending: number }> {
  if (flushing) return flushing
  flushing = (async () => {
    let sent = 0
    if (!(opts.url ?? INTEGRATIONS.appsScriptUrl)) return { sent, pending: readQueue().length }
    for (const item of readQueue()) {
      try {
        await postToAppsScript(item.action, item.data, opts)
        writeQueue(readQueue().filter((x) => x.key !== item.key))
        sent++
      } catch (e) {
        enqueue(item.action, item.data, e instanceof Error ? e.message : String(e))
        // Offline: stop early, the "online" event will try again.
        if (typeof navigator !== 'undefined' && navigator.onLine === false) break
      }
    }
    return { sent, pending: readQueue().length }
  })().finally(() => { flushing = null })
  return flushing
}

let started = false
/** Call once on app start: retries pending deliveries shortly after load and whenever the browser comes online. */
export function startRetryQueue() {
  if (started || typeof window === 'undefined') return
  started = true
  const run = () => { if (readQueue().length && appsScriptConfigured()) void flushQueue() }
  window.addEventListener('online', run)
  window.setTimeout(run, 2500)
}

// ─── The submission flow ────────────────────────────────────────────────────

/**
 * Open an empty tab NOW (inside the click handler) so the browser allows it; it is pointed at
 * WhatsApp after saving. Returns null when popups are blocked.
 */
export function openPendingWindow(): Window | null {
  if (typeof window === 'undefined') return null
  try {
    const w = window.open('', '_blank')
    if (!w) return null
    try {
      w.opener = null
      w.document.title = 'Opening WhatsApp…'
      w.document.body.style.fontFamily = 'system-ui, sans-serif'
      w.document.body.textContent = 'Opening WhatsApp…'
    } catch { /* cross-origin or locked down — fine */ }
    return w
  } catch {
    return null
  }
}

function openWhatsApp(url: string, pending: Window | null): 'opened' | 'blocked' {
  try {
    if (pending && !pending.closed) {
      pending.location.replace(url)
      return 'opened'
    }
    const w = window.open(url, '_blank')
    if (!w) return 'blocked'
    try { w.opener = null } catch { /* ignore */ }
    return 'opened'
  } catch {
    try { pending?.close() } catch { /* ignore */ }
    return 'blocked'
  }
}

async function deliver(action: IntegrationAction, data: EnquiryPayload, opts: PostOptions): Promise<StepStatus> {
  if (!opts.url && INTEGRATIONS.delivery === 'server') return 'skipped' // the backend delivers it
  if (!(opts.url ?? INTEGRATIONS.appsScriptUrl)) return 'skipped'
  try {
    await postToAppsScript(action, data, opts)
    return 'sent'
  } catch (e) {
    enqueue(action, data, e instanceof Error ? e.message : String(e))
    if (import.meta.env.DEV) console.warn(`[enquiry] ${action} failed — queued for retry`, e)
    return 'queued'
  }
}

/** Errors that mean the enquiry itself is invalid: nothing else should run. */
const isValidationError = (e: unknown) => !!e && typeof e === 'object' && (e as { code?: string }).code === 'validation'

/**
 * Run the whole flow. `saveAdmin` is the existing api.submitEnquiry (Admin → Enquiries).
 * Throws only for validation errors from the admin save (the form shows them); everything else is
 * reported in the result.
 */
export async function submitWebsiteEnquiry(
  payload: EnquiryPayload,
  saveAdmin: () => Promise<unknown>,
  opts: PostOptions & { pendingWindow?: Window | null } = {},
): Promise<SubmissionResult> {
  const pending = opts.pendingWindow ?? null
  const whatsappUrl = whatsappEnquiryUrl(payload)

  // 1. Admin → Enquiries (existing store)
  let admin: SubmissionResult['admin'] = 'saved'
  let adminError: unknown
  try {
    await saveAdmin()
  } catch (e) {
    if (isValidationError(e)) {
      try { pending?.close() } catch { /* ignore */ }
      throw e
    }
    admin = 'failed'
    adminError = e
  }

  // 2 + 3. Google Sheet and email — started together, each with its own try/catch + retry queue.
  const sheetP = deliver('sheet', payload, opts)
  const emailP = deliver('email', payload, opts)

  // 4. WhatsApp — opened right away (not after the network calls).
  let whatsapp: SubmissionResult['whatsapp'] = 'blocked'
  try {
    whatsapp = openWhatsApp(whatsappUrl, pending)
  } catch {
    whatsapp = 'blocked'
  }

  const [sheet, email] = await Promise.all([sheetP, emailP])
  return { submissionId: payload.submissionId, admin, adminError, sheet, email, whatsapp, whatsappUrl, delivered: admin === 'saved' || sheet === 'sent' }
}
