import { Router, type Response } from 'express'
import type { Role } from '../../src/types'
import { permissionsFor } from '../../src/lib/rbac'
import type { ServerConfig } from '../config'
import { burnPasswordCheck, passwordProblem, verifyPassword } from '../auth/passwords'
import { SESSION_COOKIE, type SessionStore } from '../auth/sessions'
import { ROLES, publicUser, type UserRepository } from '../auth/users'
import { HttpError, RateLimiter, asyncRoute, body, clientIp, csrfCheck, rateLimit, requirePermission, str, type AuthedRequest } from '../http'
import type { Logger } from '../logger'

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/

export function authRoutes(cfg: ServerConfig, users: UserRepository, sessions: SessionStore, authed: ReturnType<typeof import('../http').authenticate>, log: Logger) {
  const r = Router()
  const ipLimiter = new RateLimiter(30, 15 * 60_000)
  const emailFailures = new RateLimiter(5, 15 * 60_000)

  const setCookie = (res: Response, token: string, maxAgeSec: number) =>
    res.cookie(SESSION_COOKIE, token, { httpOnly: true, secure: cfg.cookieSecure, sameSite: 'strict', path: '/api', maxAge: maxAgeSec * 1000 })
  const profile = (u: { id: string; email: string; name: string; role: Role }, csrf: string) =>
    ({ user: { id: u.id, email: u.email, name: u.name, role: u.role }, permissions: permissionsFor(u.role), csrfToken: csrf })

  r.post('/login', rateLimit(ipLimiter, (req) => `ip:${clientIp(req)}`), asyncRoute(async (req, res) => {
    const b = body(req)
    const email = str(b.email, 254).trim().toLowerCase()
    const password = str(b.password, 200)
    if (!EMAIL.test(email) || !password) throw new HttpError(400, 'Enter your email and password.', 'validation')
    if (emailFailures.count(`em:${email}`) >= 5) throw new HttpError(429, 'Too many failed attempts for this account. Try again in 15 minutes.', 'rate_limited')
    const user = await users.byEmail(email)
    const ok = user ? await verifyPassword(password, user.passwordHash) : (await burnPasswordCheck(password), false)
    if (!user || !ok) {
      emailFailures.hit(`em:${email}`)
      log.warn('login_failed', { email, ip: clientIp(req) })
      throw new HttpError(401, 'Email or password is incorrect.', 'unauthorized')
    }
    if (!user.isActive) throw new HttpError(403, 'This account is disabled. Contact the site admin.', 'forbidden')
    emailFailures.reset(`em:${email}`)
    const { token, session } = await sessions.create(user.id, clientIp(req), req.get('user-agent') ?? '')
    await users.update(user.id, { lastLoginAt: new Date().toISOString() })
    setCookie(res, token, cfg.sessionHours * 3600)
    log.info('login', { userId: user.id, ip: clientIp(req) })
    res.json(profile(user, session.csrf))
  }))

  r.get('/me', authed, (req, res) => {
    const a = req as AuthedRequest
    res.setHeader('Cache-Control', 'no-store')
    res.json(profile(a.user, a.session.csrf))
  })

  r.post('/logout', authed, csrfCheck, asyncRoute(async (req, res) => {
    await sessions.destroy((req as AuthedRequest).sessionToken)
    res.clearCookie(SESSION_COOKIE, { path: '/api' })
    res.json({ ok: true })
  }))

  r.post('/logout-all', authed, csrfCheck, asyncRoute(async (req, res) => {
    await sessions.destroyForUser((req as AuthedRequest).user.id)
    res.clearCookie(SESSION_COOKIE, { path: '/api' })
    res.json({ ok: true })
  }))

  r.post('/password', authed, csrfCheck, asyncRoute(async (req, res) => {
    const a = req as AuthedRequest
    const b = body(req)
    const current = str(b.currentPassword, 200)
    const next = str(b.newPassword, 200)
    if (!(await verifyPassword(current, a.user.passwordHash))) throw new HttpError(400, 'Current password is incorrect.', 'validation', { currentPassword: 'Current password is incorrect.' })
    const problem = passwordProblem(next, a.user.email)
    if (problem) throw new HttpError(400, problem, 'validation', { newPassword: problem })
    await users.update(a.user.id, { password: next })
    await sessions.destroyForUser(a.user.id, a.session.id) // sign out other devices
    res.json({ ok: true })
  }))
  return r
}

/** Admin user management (users:manage). */
export function userRoutes(users: UserRepository, sessions: SessionStore) {
  const r = Router()
  r.use(requirePermission('users:manage'))
  const role = (v: unknown): Role => {
    if (!ROLES.includes(v as Role)) throw new HttpError(400, 'Choose a valid role.', 'validation', { role: 'Choose a valid role.' })
    return v as Role
  }
  const otherActiveAdmin = async (id: string) => (await users.list()).some((u) => u.id !== id && u.role === 'admin' && u.isActive)

  r.get('/', asyncRoute(async (_req, res) => { res.json((await users.list()).map(publicUser)) }))

  r.post('/', asyncRoute(async (req, res) => {
    const b = body(req)
    const name = str(b.name, 120).trim()
    const email = str(b.email, 254).trim().toLowerCase()
    const password = str(b.password, 200)
    const e: Record<string, string> = {}
    if (!name) e.name = 'Enter a name.'
    if (!EMAIL.test(email)) e.email = 'Enter a valid email.'
    const pw = passwordProblem(password, email)
    if (pw) e.password = pw
    if (Object.keys(e).length) throw new HttpError(400, 'Some fields need attention.', 'validation', e)
    try {
      res.status(201).json(publicUser(await users.create({ name, email, role: role(b.role), password })))
    } catch (err) {
      if ((err as { status?: number }).status === 409) throw new HttpError(409, 'A user with this email already exists.', 'conflict', { email: 'A user with this email already exists.' })
      throw err
    }
  }))

  r.patch('/:id', asyncRoute(async (req, res) => {
    const me = (req as AuthedRequest).user
    const id = String(req.params.id)
    const b = body(req)
    const target = await users.byId(id)
    if (!target) throw new HttpError(404, 'User not found.', 'not_found')
    const patch: Parameters<UserRepository['update']>[1] = {}
    if (b.name !== undefined) { patch.name = str(b.name, 120).trim(); if (!patch.name) throw new HttpError(400, 'Enter a name.', 'validation', { name: 'Enter a name.' }) }
    if (b.role !== undefined) patch.role = role(b.role)
    if (b.isActive !== undefined) patch.isActive = b.isActive === true
    if (b.password !== undefined && b.password !== '') {
      const pw = passwordProblem(str(b.password, 200), target.email)
      if (pw) throw new HttpError(400, pw, 'validation', { password: pw })
      patch.password = str(b.password, 200)
    }
    const demoting = (patch.role && patch.role !== 'admin') || patch.isActive === false
    if (target.role === 'admin' && demoting) {
      if (id === me.id) throw new HttpError(400, 'You cannot remove your own admin access or deactivate yourself.')
      if (!(await otherActiveAdmin(id))) throw new HttpError(400, 'At least one active admin must remain.')
    }
    const saved = await users.update(id, patch)
    if (patch.isActive === false || patch.password || patch.role) await sessions.destroyForUser(id)
    res.json(publicUser(saved!))
  }))

  r.delete('/:id', asyncRoute(async (req, res) => {
    const me = (req as AuthedRequest).user
    const id = String(req.params.id)
    if (id === me.id) throw new HttpError(400, 'You cannot delete your own account.')
    const u = await users.byId(id)
    if (u?.role === 'admin' && !(await otherActiveAdmin(id))) throw new HttpError(400, 'At least one active admin must remain.')
    await users.remove(id)
    await sessions.destroyForUser(id)
    res.json({ ok: true })
  }))
  return r
}
