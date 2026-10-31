import { mkdir } from 'node:fs/promises'
import { ConfigError, loadConfig } from './config'
import { createLogger } from './logger'
import { createApp } from './app'
import { jsonUserRepository } from './auth/users'
import { passwordProblem } from './auth/passwords'
import { jsonDocumentRepository } from './storage/documentRepository'
import { localFileStorage } from './storage/fileStorage'
import { loadEnvFile } from './envFile'

/**
 * Baba Solars server: secure admin login, document storage (C:\Quotation and Billing on the office
 * PC), Google Drive backup and the built website — all on one origin.
 *   npm run server        (after `npm run build`)
 */
async function main() {
  loadEnvFile()
  const log = createLogger()
  let cfg
  try { cfg = loadConfig() } catch (e) {
    if (e instanceof ConfigError) { console.error(`Configuration error: ${e.message}`); process.exit(1) }
    throw e
  }
  await mkdir(cfg.dataDir, { recursive: true, mode: 0o700 })
  const users = jsonUserRepository(cfg.dataDir)
  const docs = jsonDocumentRepository(cfg.dataDir)
  const files = localFileStorage(cfg.documentsRoot)

  try { await files.ensureLayout() } catch (e) {
    console.error(`Cannot create the document folders in "${cfg.documentsRoot}": ${(e as Error).message}\nSet DOCUMENTS_ROOT to a folder this account can write to.`)
    process.exit(1)
  }

  if (!(await users.list()).length) {
    const a = cfg.bootstrapAdmin
    if (!a) {
      console.error('No admin user exists yet. Set ADMIN_EMAIL and ADMIN_PASSWORD in server/.env for the first start (or run: npm run server:create-user).')
      process.exit(1)
    }
    const problem = passwordProblem(a.password, a.email)
    if (problem) { console.error(`ADMIN_PASSWORD is too weak: ${problem}`); process.exit(1) }
    await users.create({ name: a.name, email: a.email, role: 'admin', password: a.password })
    log.warn('admin_created', { email: a.email, note: 'Remove ADMIN_PASSWORD from server/.env now.' })
  }

  const { app, drive } = createApp({ cfg, log, users, docs, files })
  const server = app.listen(cfg.port, cfg.host, () => {
    log.info('server_started', {
      url: `http://${cfg.host === '0.0.0.0' ? 'localhost' : cfg.host}:${cfg.port}`, documentsRoot: cfg.documentsRoot,
      drive: cfg.google ? 'configured' : 'off (no GOOGLE_CLIENT_ID)', agent: cfg.agentTokens.length ? 'enabled' : 'off', frontend: cfg.serveFrontend,
    })
  })
  drive.start()
  const stop = () => { drive.stop(); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 5000).unref() }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
}

void main()
