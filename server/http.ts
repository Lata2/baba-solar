import type { NextFunction, Request, Response } from 'express'
import { timingSafeEqual } from 'node:crypto'
import type { Permission, Role } from '../src/types'
import { permissionsFor } from '../src/lib/rbac'
import type { SessionRecord, SessionStore } from './auth/sessions'
import { SESSION_COOKIE } from './auth/sessions'
import type { UserRecord, UserRepository } from './auth/users'

/** Error with an HTTP status and optional field errors (same shape the frontend ApiError expects). */
export class HttpError extends Error {
  constructor(public status: number, message: string, public code = 'bad_request', public fieldErrors: Record<string, string> = {}) {
    super(message)
  }
}

export const asyncRoute = <R extends Request = Request>(fn: (req: R, res: Response, next: NextFunction) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => { fn(req as R, res, next).catch(next) }

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=')
    if (i < 1) continue
    const k = part.slice(0, i).trim()
    try { out[k] = decodeURIComponent(part.slice(i + 1).trim()) } catch { /* ignore malformed */ }
  }
  return out
}

export function safeEqual(a: string, b: string) {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

// ─── Rate limiting (in memory, per key, sliding window) ────────────────────
export class RateLimiter {
  private hits = new Map<string, number[]>()
  constructor(private limit: number, private windowMs: number) {}
  /** Records a hit; returns seconds to wait when over the limit, else 0. */
  hit(key: string): number {
    const now = Date.now()
    const list = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs)
    list.push(now)
    this.hits.set(key, list)
    if (this.hits.size > 10_000) for (const [k, v] of this.hits) if (!v.some((t) => now - t < this.windowMs)) this.hits.delete(k)
    return list.length > this.limit ? Math.ceil((this.windowMs - (now - list[0])) / 1000) : 0
  }
  count(key: string) { const now = Date.now(); return (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs).length }
  reset(key: string) { this.hits.delete(key) }
}

export function rateLimit(limiter: RateLimiter, keyOf: (req: Request) => string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const wait = limiter.hit(keyOf(req))
    if (wait) { res.setHeader('Retry-After', String(wait)); return next(new HttpError(429, `Too many requests. Try again in ${Math.ceil(wait / 60)} minute(s).`, 'rate_limited')) }
    next()
  }
}

// ─── Auth ──────────────────────────────────────────────────────────────────
export interface AuthedRequest extends Request {
  session: SessionRecord
  sessionToken: string
  user: UserRecord
  permissions: Permission[]
}

export function authenticate(sessions: SessionStore, users: UserRepository) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const token = parseCookies(req.headers.cookie)[SESSION_COOKIE]
      const session = await sessions.get(token)
      if (!session) return next(new HttpError(401, 'Please sign in.', 'unauthorized'))
      const user = await users.byId(session.userId)
      if (!user || !user.isActive) { await sessions.destroy(token!); return next(new HttpError(401, 'Please sign in.', 'unauthorized')) }
      Object.assign(req, { session, sessionToken: token, user, permissions: permissionsFor(user.role) })
      next()
    } catch (e) { next(e) }
  }
}

export const can = (role: Role, p: Permission) => permissionsFor(role).includes(p)

export function requirePermission(...perms: Permission[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const r = req as AuthedRequest
    if (!perms.every((p) => r.permissions?.includes(p))) return next(new HttpError(403, 'You do not have permission to do this.', 'forbidden'))
    next()
  }
}

/**
 * CSRF defence for state-changing requests:
 *  1. Origin (or Referer) must be one of APP_ORIGIN — blocks cross-site form posts / fetches.
 *  2. With a session, the X-CSRF-Token header must match the token bound to that session.
 * The session cookie is also SameSite=Strict.
 */
export function originCheck(allowed: string[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next()
    const origin = req.headers.origin ?? (req.headers.referer ? safeOrigin(req.headers.referer) : '')
    if (!origin || !allowed.includes(origin)) return next(new HttpError(403, 'Request blocked (origin not allowed).', 'forbidden'))
    next()
  }
}
const safeOrigin = (u: string) => { try { return new URL(u).origin } catch { return '' } }

export function csrfCheck(req: Request, _res: Response, next: NextFunction) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next()
  const r = req as AuthedRequest
  const sent = req.get('x-csrf-token') ?? ''
  if (!r.session || !sent || !safeEqual(sent, r.session.csrf)) return next(new HttpError(403, 'Security token missing or expired. Reload the page and try again.', 'forbidden'))
  next()
}

export function clientIp(req: Request) { return req.ip ?? req.socket.remoteAddress ?? 'unknown' }

/** JSON body must be a plain object. */
export function body(req: Request): Record<string, unknown> {
  const b = req.body as unknown
  if (!b || typeof b !== 'object' || Array.isArray(b)) throw new HttpError(400, 'Send a JSON object.')
  return b as Record<string, unknown>
}
export const str = (v: unknown, max = 500) => (typeof v === 'string' ? v.slice(0, max) : '')
