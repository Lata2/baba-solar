#!/usr/bin/env node
/**
 * Baba Solars — Windows document sync agent
 * ─────────────────────────────────────────────────────────────────────────────
 * When the Baba Solars server runs on a VPS, quotations and bills are stored on the VPS (and in
 * Google Drive). This agent runs on the office Windows PC and keeps an exact copy in
 *     C:\Quotation and Billing\Quotations\<Client>\…
 *     C:\Quotation and Billing\Billing\<Client>\…
 *
 * It only DOWNLOADS (read-only token), checks every file's SHA-256, writes atomically, and never
 * deletes your local files. No npm packages needed — Node.js 20+ only.
 *
 *   node agent/sync-agent.mjs            keep running (checks every POLL_SECONDS)
 *   node agent/sync-agent.mjs --once     one sync, then exit (for Task Scheduler)
 *
 * Settings: agent/agent.env (copy agent/agent.env.example) or environment variables.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

function loadEnv(file) {
  if (!existsSync(file)) return
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#') || !line.includes('=')) continue
    const i = line.indexOf('=')
    const k = line.slice(0, i).trim()
    let v = line.slice(i + 1).trim()
    if (/^(['"]).*\1$/.test(v)) v = v.slice(1, -1)
    if (process.env[k] === undefined) process.env[k] = v
  }
}
loadEnv(process.env.AGENT_ENV_FILE || path.join(here, 'agent.env'))

const SERVER = (process.env.SERVER_URL || '').replace(/\/+$/, '')
const TOKEN = process.env.AGENT_TOKEN || ''
const ROOT = path.resolve(process.env.LOCAL_ROOT || (process.platform === 'win32' ? 'C:\\Quotation and Billing' : path.join(here, 'Quotation and Billing')))
const POLL = Math.max(15, Number(process.env.POLL_SECONDS || 60))
const STATE_FILE = process.env.AGENT_STATE_FILE || path.join(here, '.agent-state.json')
const ONCE = process.argv.includes('--once')

const log = (msg, extra = '') => console.log(`${new Date().toISOString()}  ${msg}${extra ? `  ${extra}` : ''}`)
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

/** relativePath from the server ("Quotations/Client/File.pdf") → absolute path inside ROOT, refusing anything that escapes it. */
export function localPathFor(root, relativePath) {
  const parts = String(relativePath).split('/')
  if (!parts.length || parts.some((p) => !p || p === '.' || p === '..' || /[<>:"\\|?*\u0000-\u001f]/.test(p))) throw new Error(`Unsafe path from server: ${relativePath}`)
  if (!['Quotations', 'Billing'].includes(parts[0])) throw new Error(`Unexpected folder from server: ${parts[0]}`)
  const full = path.resolve(root, ...parts)
  if (!full.startsWith(path.resolve(root) + path.sep)) throw new Error(`Path escapes the folder: ${relativePath}`)
  return full
}

async function api(p, raw = false) {
  const res = await fetch(`${SERVER}/api/agent${p}`, { headers: { Authorization: `Bearer ${TOKEN}` }, signal: AbortSignal.timeout(120_000) })
  if (res.status === 401) throw Object.assign(new Error('The server rejected the agent token (check AGENT_TOKEN).'), { fatal: true })
  if (!res.ok) throw new Error(`Server answered ${res.status} for ${p}`)
  return raw ? Buffer.from(await res.arrayBuffer()) : res.json()
}

async function loadState() {
  try { return JSON.parse(await readFile(STATE_FILE, 'utf8')) } catch { return { files: {} } }
}
async function saveState(state) {
  const tmp = `${STATE_FILE}.tmp`
  await writeFile(tmp, JSON.stringify(state, null, 2))
  await rename(tmp, STATE_FILE)
}

async function localHash(file) {
  try { return sha256(await readFile(file)) } catch { return null }
}

export async function syncOnce() {
  const state = await loadState()
  for (const f of ['Quotations', 'Billing']) await mkdir(path.join(ROOT, f), { recursive: true })
  const { documents } = await api('/manifest')
  let downloaded = 0, unchanged = 0, failed = 0
  for (const d of documents) {
    try {
      const target = localPathFor(ROOT, d.relativePath)
      const known = state.files[d.id]
      if (known?.sha256 === d.sha256 && known.path === target && (await localHash(target)) === d.sha256) { unchanged++; continue }
      if ((await localHash(target)) === d.sha256) { state.files[d.id] = { sha256: d.sha256, path: target }; unchanged++; continue }
      const data = await api(`/files/${encodeURIComponent(d.id)}`, true)
      if (sha256(data) !== d.sha256) throw new Error('checksum mismatch (download damaged) — will retry')
      await mkdir(path.dirname(target), { recursive: true })
      const tmp = `${target}.${process.pid}.part`
      await writeFile(tmp, data)
      await rm(target, { force: true })
      await rename(tmp, target)
      // The client was renamed on the server: the old local copy moved to a new name. Keep the
      // old file only if the user changed it locally; otherwise remove the outdated duplicate.
      if (known?.path && known.path !== target && (await localHash(known.path)) === known.sha256) await rm(known.path, { force: true })
      state.files[d.id] = { sha256: d.sha256, path: target }
      downloaded++
      log('saved', path.relative(ROOT, target))
    } catch (e) {
      failed++
      log('failed', `${d.relativePath}: ${e.message}`)
    }
  }
  state.lastSyncAt = new Date().toISOString()
  await saveState(state)
  log(`sync done — ${downloaded} downloaded, ${unchanged} up to date, ${failed} failed`, `→ ${ROOT}`)
  return { downloaded, unchanged, failed }
}

function checkConfig() {
  if (!/^https?:\/\//.test(SERVER) || TOKEN.length < 32) {
    console.error('Set SERVER_URL (e.g. https://babasolars.in) and AGENT_TOKEN (same as AGENT_TOKENS on the server) in agent/agent.env')
    process.exit(1)
  }
  if (SERVER.startsWith('http://') && !/^http:\/\/(localhost|127\.0\.0\.1)(:|$)/.test(SERVER)) {
    console.error('Use https:// for a remote server — the agent token must not travel unencrypted.')
    process.exit(1)
  }
}

async function main() {
  checkConfig()
  log(`Baba Solars sync agent — ${SERVER} → ${ROOT}`)
  let wait = POLL
  for (;;) {
    try {
      const r = await syncOnce()
      wait = r.failed ? Math.min(POLL * 4, 900) : POLL
    } catch (e) {
      log('sync error', e.message)
      if (e.fatal) process.exit(2)
      wait = Math.min(wait * 2, 900) // server unreachable: back off, keep trying
    }
    if (ONCE) return
    await new Promise((r) => setTimeout(r, wait * 1000))
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void main()
