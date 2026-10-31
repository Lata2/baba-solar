import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Server configuration from environment variables (see server/.env.example).
 * Secrets (OAuth client secret, encryption key, agent token) live ONLY here — never in VITE_* vars.
 */
export interface ServerConfig {
  env: 'production' | 'development' | 'test'
  host: string
  port: number
  /** Public origin of the admin app, e.g. https://babasolars.in — used for CSRF Origin checks and OAuth redirects. */
  appOrigins: string[]
  /** Folder for users, sessions, document registry and the Drive token. */
  dataDir: string
  /** Root of local document storage: "C:\Quotation and Billing" on Windows. */
  documentsRoot: string
  /** true → one sub-folder per client inside Quotations / Billing. */
  clientSubfolders: boolean
  serveFrontend: boolean
  distDir: string
  trustProxy: boolean
  cookieSecure: boolean
  sessionHours: number
  sessionIdleMinutes: number
  maxUploadMb: number
  bootstrapAdmin: { email: string; password: string; name: string } | null
  agentTokens: string[]
  google: {
    clientId: string
    clientSecret: string
    redirectUri: string
    accountEmail: string
    rootFolderName: string
    encryptionKey: Buffer | null
  } | null
  drive: { pollSeconds: number; maxAttempts: number }
}

export class ConfigError extends Error {}

const bool = (v: string | undefined, d: boolean) => (v === undefined || v === '' ? d : /^(1|true|yes|on)$/i.test(v))
const int = (v: string | undefined, d: number, min: number, max: number) => {
  if (v === undefined || v === '') return d
  const n = Number(v)
  if (!Number.isInteger(n) || n < min || n > max) throw new ConfigError(`Expected a whole number between ${min} and ${max}, got "${v}".`)
  return n
}

export const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export function defaultDocumentsRoot(platform = process.platform, dataDir = path.join(PROJECT_ROOT, 'server-data')) {
  return platform === 'win32' ? 'C:\\Quotation and Billing' : path.join(dataDir, 'Quotation and Billing')
}

export function loadConfig(e: NodeJS.ProcessEnv = process.env): ServerConfig {
  const env = (e.NODE_ENV === 'production' ? 'production' : e.NODE_ENV === 'test' ? 'test' : 'development') as ServerConfig['env']
  const port = int(e.PORT, 8787, 1, 65535)
  const dataDir = path.resolve(e.DATA_DIR || path.join(PROJECT_ROOT, 'server-data'))
  const appOrigins = (e.APP_ORIGIN || `http://localhost:${port}`).split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean)
  for (const o of appOrigins) if (!/^https?:\/\/[^/\s]+$/.test(o)) throw new ConfigError(`APP_ORIGIN "${o}" must look like https://example.com (no path).`)

  let google: ServerConfig['google'] = null
  if (e.GOOGLE_CLIENT_ID || e.GOOGLE_CLIENT_SECRET) {
    if (!e.GOOGLE_CLIENT_ID || !e.GOOGLE_CLIENT_SECRET) throw new ConfigError('Set both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (or neither to switch Drive backup off).')
    const key = e.TOKEN_ENCRYPTION_KEY ? Buffer.from(e.TOKEN_ENCRYPTION_KEY, 'base64') : null
    if (!key || key.length !== 32) throw new ConfigError('TOKEN_ENCRYPTION_KEY must be 32 random bytes in base64 (generate: npm run server:keygen).')
    google = {
      clientId: e.GOOGLE_CLIENT_ID,
      clientSecret: e.GOOGLE_CLIENT_SECRET,
      redirectUri: e.GOOGLE_REDIRECT_URI || `${appOrigins[0]}/api/drive/oauth/callback`,
      accountEmail: (e.DRIVE_ACCOUNT_EMAIL || 'babasolars76@gmail.com').trim().toLowerCase(),
      rootFolderName: e.DRIVE_ROOT_FOLDER || 'Quotation and Billing',
      encryptionKey: key,
    }
  }

  const agentTokens = (e.AGENT_TOKENS || '').split(',').map((s) => s.trim()).filter(Boolean)
  for (const t of agentTokens) if (t.length < 32) throw new ConfigError('Each AGENT_TOKENS entry must be at least 32 characters (generate: npm run server:keygen).')

  const bootstrapAdmin = e.ADMIN_EMAIL && e.ADMIN_PASSWORD
    ? { email: e.ADMIN_EMAIL.trim().toLowerCase(), password: e.ADMIN_PASSWORD, name: e.ADMIN_NAME || 'Administrator' }
    : null

  const secureDefault = appOrigins.every((o) => o.startsWith('https://'))
  return {
    env,
    host: e.HOST || (env === 'production' ? '0.0.0.0' : '127.0.0.1'),
    port,
    appOrigins,
    dataDir,
    documentsRoot: path.resolve(e.DOCUMENTS_ROOT || defaultDocumentsRoot(process.platform, dataDir)),
    clientSubfolders: bool(e.CLIENT_SUBFOLDERS, true),
    serveFrontend: bool(e.SERVE_FRONTEND, true),
    distDir: path.resolve(e.DIST_DIR || path.join(PROJECT_ROOT, 'dist')),
    trustProxy: bool(e.TRUST_PROXY, false),
    cookieSecure: bool(e.COOKIE_SECURE, secureDefault),
    sessionHours: int(e.SESSION_HOURS, 8, 1, 72),
    sessionIdleMinutes: int(e.SESSION_IDLE_MINUTES, 120, 5, 24 * 60),
    maxUploadMb: int(e.MAX_UPLOAD_MB, 15, 1, 50),
    bootstrapAdmin,
    agentTokens,
    google,
    drive: { pollSeconds: int(e.DRIVE_POLL_SECONDS, 20, 1, 3600), maxAttempts: int(e.DRIVE_MAX_ATTEMPTS, 8, 1, 50) },
  }
}
