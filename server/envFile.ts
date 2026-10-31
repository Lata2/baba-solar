import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { PROJECT_ROOT } from './config'

/** Loads server/.env (KEY=value lines) without overriding variables already set in the environment. */
export function loadEnvFile(file = process.env.SERVER_ENV_FILE || path.join(PROJECT_ROOT, 'server', '.env')) {
  if (!existsSync(file)) return
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const i = line.indexOf('=')
    if (i < 1) continue
    const key = line.slice(0, i).trim()
    let value = line.slice(i + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
    if (process.env[key] === undefined) process.env[key] = value
  }
}
