import express, { type NextFunction, type Request, type Response } from 'express'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import multer from 'multer'
import type { ServerConfig } from './config'
import type { Logger } from './logger'
import { SessionStore } from './auth/sessions'
import type { UserRepository } from './auth/users'
import type { DocumentRepository } from './storage/documentRepository'
import type { FileStorage } from './storage/fileStorage'
import { DriveBackup } from './drive/backup'
import type { FetchFn } from './drive/google'
import { HttpError, authenticate, csrfCheck, originCheck, RateLimiter, rateLimit, clientIp } from './http'
import { authRoutes, userRoutes } from './routes/auth'
import { agentRoutes, documentRoutes, driveCallback, driveRoutes } from './routes/documents'

export interface AppDeps {
  cfg: ServerConfig
  log: Logger
  users: UserRepository
  docs: DocumentRepository
  files: FileStorage
  fetchFn?: FetchFn
}

/** Public website routes that are prerendered as dist/<route>/index.html by `npm run build:ssg`. */
const PRERENDERED = ['/', '/about', '/services', '/pricing', '/projects', '/faqs', '/gallery', '/contact', '/drone-cleaning', '/pm-surya-ghar', '/calculator']

export function createApp({ cfg, log, users, docs, files, fetchFn }: AppDeps) {
  const app = express()
  app.disable('x-powered-by')
  if (cfg.trustProxy) app.set('trust proxy', 1)
  const sessions = new SessionStore(cfg.dataDir, cfg.sessionHours, cfg.sessionIdleMinutes)
  const drive = new DriveBackup(cfg, docs, files, log, fetchFn)
  const authed = authenticate(sessions, users)

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
    res.setHeader('X-Frame-Options', 'SAMEORIGIN')
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()')
    if (cfg.cookieSecure) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
    if (req.path.startsWith('/api/')) {
      res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'")
      res.setHeader('Cache-Control', 'no-store')
    }
    next()
  })

  // ─── API ──────────────────────────────────────────────────────────────────
  const api = express.Router()
  const apiLimiter = new RateLimiter(600, 60_000)
  api.use(rateLimit(apiLimiter, (req) => `api:${clientIp(req)}`))
  api.get('/health', (_req, res) => { res.json({ ok: true, service: 'baba-solars-server', time: new Date().toISOString() }) })
  api.get('/drive/oauth/callback', driveCallback(cfg, drive))
  api.use('/agent', rateLimit(new RateLimiter(240, 60_000), (req) => `agent:${clientIp(req)}`), agentRoutes(cfg, docs, files))
  api.use(originCheck(cfg.appOrigins))
  api.use((req, _res, next) => {
    // JSON endpoints only accept JSON (a cross-site HTML form cannot send it without a CORS preflight).
    const ct = req.headers['content-type'] ?? ''
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && req.headers['content-length'] !== '0' && ct && !/^application\/json\b|^multipart\/form-data\b/i.test(ct))
      return next(new HttpError(415, 'Unsupported content type.', 'bad_request'))
    next()
  })
  api.use(express.json({ limit: '200kb', strict: true }))
  api.use('/auth', authRoutes(cfg, users, sessions, authed, log))
  api.use('/users', authed, csrfCheck, userRoutes(users, sessions))
  api.use('/documents', authed, csrfCheck, documentRoutes(cfg, docs, files, drive, log))
  api.use('/drive', authed, csrfCheck, driveRoutes(cfg, drive, files))
  api.use((_req, _res, next) => next(new HttpError(404, 'Not found.', 'not_found')))
  app.use('/api', api)

  // ─── Built website + admin (same origin as the API, so cookies stay first-party) ─────
  if (cfg.serveFrontend && existsSync(path.join(cfg.distDir, 'index.html'))) mountFrontend(app, cfg)

  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    let e: HttpError
    if (err instanceof HttpError) e = err
    else if (err instanceof multer.MulterError) e = new HttpError(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400, err.code === 'LIMIT_FILE_SIZE' ? `Files must be ${cfg.maxUploadMb} MB or smaller.` : 'Upload not accepted.', err.code === 'LIMIT_FILE_SIZE' ? 'payload_too_large' : 'validation')
    else if ((err as { type?: string }).type === 'entity.parse.failed') e = new HttpError(400, 'Invalid JSON.', 'bad_request')
    else if ((err as { type?: string }).type === 'entity.too.large') e = new HttpError(413, 'Request too large.', 'payload_too_large')
    else {
      log.error('unhandled', { path: req.path, error: (err as Error)?.message, stack: cfg.env === 'production' ? undefined : (err as Error)?.stack })
      e = new HttpError(500, 'Something went wrong on the server.', 'internal')
    }
    if (!res.headersSent) res.status(e.status).json({ error: { message: e.message, code: e.code, fieldErrors: e.fieldErrors } })
  })
  return { app, drive, sessions }
}

function mountFrontend(app: express.Express, cfg: ServerConfig) {
  const dist = cfg.distDir
  // CSP: only our own scripts plus the exact inline scripts Vite wrote into the HTML (by hash).
  const hashes = new Set<string>()
  const scan = (file: string) => {
    if (!existsSync(file)) return
    for (const m of readFileSync(file, 'utf8').matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g))
      if (m[1].trim()) hashes.add(`'sha256-${createHash('sha256').update(m[1]).digest('base64')}'`)
  }
  for (const p of PRERENDERED) scan(path.join(dist, p === '/' ? 'index.html' : `${p.slice(1)}/index.html`))
  scan(path.join(dist, 'spa.html'))
  scan(path.join(dist, 'index.html'))
  const csp = [
    "default-src 'self'",
    `script-src 'self' ${[...hashes].join(' ')}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "frame-src 'self' blob: https://www.youtube-nocookie.com https://www.youtube.com https://www.google.com https://maps.google.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
  ].join('; ')

  app.use((_req, res, next) => { res.setHeader('Content-Security-Policy', csp); next() })
  app.use('/assets', express.static(path.join(dist, 'assets'), { immutable: true, maxAge: '365d', index: false }))
  app.get('/site-data.json', (_req, res, next) => { res.setHeader('Cache-Control', 'no-cache'); next() })
  app.use(express.static(dist, { index: false, maxAge: '1h', dotfiles: 'deny' }))
  app.get(/.*/, (req, res) => {
    const clean = req.path.replace(/\/+$/, '') || '/'
    const pre = clean === '/' ? 'index.html' : `${clean.slice(1)}/index.html`
    const file = PRERENDERED.includes(clean) && existsSync(path.join(dist, pre)) ? pre : existsSync(path.join(dist, 'spa.html')) ? 'spa.html' : 'index.html'
    res.setHeader('Cache-Control', 'no-cache')
    if (clean.startsWith('/admin')) res.setHeader('X-Robots-Tag', 'noindex, nofollow')
    res.sendFile(path.join(dist, file))
  })
}
