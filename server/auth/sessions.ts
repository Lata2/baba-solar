import path from 'node:path'
import { createHash, randomBytes } from 'node:crypto'
import { JsonStore } from '../storage/jsonStore'

/**
 * Server-side sessions. The browser only holds a random token in an httpOnly cookie; the server
 * stores its SHA-256, so a leaked sessions.json cannot be replayed. Absolute + idle expiry.
 */
export interface SessionRecord {
  id: string // sha256(token)
  userId: string
  csrf: string
  createdAt: number
  lastSeenAt: number
  expiresAt: number
  ip: string
  userAgent: string
}

export const SESSION_COOKIE = 'bs_session'
const sha = (s: string) => createHash('sha256').update(s).digest('hex')

export class SessionStore {
  private store: JsonStore<{ sessions: SessionRecord[] }>
  private lastPersistedSeen = new Map<string, number>()
  constructor(dataDir: string, private hours: number, private idleMinutes: number) {
    this.store = new JsonStore(path.join(dataDir, 'sessions.json'), () => ({ sessions: [] }))
  }

  async create(userId: string, ip: string, userAgent: string) {
    const token = randomBytes(32).toString('base64url')
    const now = Date.now()
    const rec: SessionRecord = {
      id: sha(token), userId, csrf: randomBytes(24).toString('base64url'), createdAt: now, lastSeenAt: now,
      expiresAt: now + this.hours * 3600_000, ip, userAgent: userAgent.slice(0, 200),
    }
    await this.store.update((d) => {
      d.sessions = d.sessions.filter((s) => this.alive(s, now))
      d.sessions.push(rec)
    })
    return { token, session: rec }
  }

  private alive(s: SessionRecord, now: number) {
    return s.expiresAt > now && now - s.lastSeenAt < this.idleMinutes * 60_000
  }

  /** Valid session for a cookie token (also slides the idle timer). */
  async get(token: string | undefined): Promise<SessionRecord | null> {
    if (!token || token.length > 100) return null
    const id = sha(token)
    const now = Date.now()
    const s = (await this.store.read()).sessions.find((x) => x.id === id)
    if (!s) return null
    if (!this.alive(s, now)) { await this.destroy(token); return null }
    // Persist "last seen" at most once a minute per session.
    if (now - (this.lastPersistedSeen.get(id) ?? s.lastSeenAt) > 60_000) {
      this.lastPersistedSeen.set(id, now)
      await this.store.update((d) => { const x = d.sessions.find((y) => y.id === id); if (x) x.lastSeenAt = now })
      s.lastSeenAt = now
    }
    return s
  }

  async destroy(token: string) {
    const id = sha(token)
    await this.store.update((d) => { d.sessions = d.sessions.filter((s) => s.id !== id) })
  }

  async destroyForUser(userId: string, exceptId?: string) {
    await this.store.update((d) => { d.sessions = d.sessions.filter((s) => s.userId !== userId || s.id === exceptId) })
  }
}
