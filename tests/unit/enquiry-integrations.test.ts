import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/services/api'
import { db, resetStore } from '@/mocks/store'
import { normalizeEnquiry, validateEnquiry, enquiryTypeOf } from '@/lib/enquiries'
import { validateContact, type ContactValues } from '@/lib/contactForm'
import {
  QUEUE_KEY,
  buildPayload,
  buildWhatsAppText,
  enqueue,
  flushQueue,
  newSubmissionId,
  readQueue,
  submitWebsiteEnquiry,
  whatsappEnquiryUrl,
} from '@/services/enquiryIntegrations'
import { DIWALI_OFFER, activeOffers, daysLeft, normalizeOffer, offerDateRange, offerSrcSet, offerStatus, validateOffer } from '@/lib/offers'
import type { Enquiry } from '@/types'

/**
 * Contact form → admin store → Google Sheet / email (Apps Script) → WhatsApp, with the retry queue.
 * Runs in node: window/localStorage/fetch are small fakes.
 */
const URL_OK = 'https://script.google.com/macros/s/TEST/exec'
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
let store: Record<string, string>
let opened: Array<{ url: string }>
let popupBlocked = false

function fakeWindow() {
  return {
    localStorage: { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = String(v) }, removeItem: (k: string) => { delete store[k] } },
    location: { protocol: 'http:', href: 'http://localhost/contact' },
    dispatchEvent: () => true,
    addEventListener: () => {},
    setTimeout,
    open: (url: string) => {
      if (popupBlocked) return null
      const w = { closed: false, opener: {}, location: { replace: (u: string) => { w.url = u } }, url, close: () => { w.closed = true } }
      opened.push(w)
      return w
    },
  }
}

beforeEach(async () => {
  store = {}
  opened = []
  popupBlocked = false
  Object.defineProperty(globalThis, 'window', { configurable: true, value: fakeWindow() })
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { cookie: '' } })
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true } })
  await resetStore()
})
afterEach(() => {
  for (const [k, d] of [['window', originalWindow], ['document', originalDocument], ['navigator', originalNavigator]] as const) {
    if (d) Object.defineProperty(globalThis, k, d); else Reflect.deleteProperty(globalThis, k)
  }
})

/** Fake Apps Script: remembers rows/emails by submissionId like the real script. */
function fakeAppsScript(opts: { failEmail?: boolean; offline?: boolean } = {}) {
  const rows = new Map<string, unknown>()
  const emails = new Set<string>()
  const calls: Array<{ action: string; id: string }> = []
  const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
    if (opts.offline) throw new TypeError('Failed to fetch')
    const body = JSON.parse(String(init.body))
    calls.push({ action: body.action, id: body.data.submissionId })
    if (body.token !== 'tok') return new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }))
    if (body.action === 'sheet') {
      const dup = rows.has(body.data.submissionId)
      rows.set(body.data.submissionId, body.data)
      return new Response(JSON.stringify({ ok: true, result: dup ? 'duplicate' : 'added' }))
    }
    if (opts.failEmail) return new Response(JSON.stringify({ ok: false, error: 'Service invoked too many times: email' }))
    emails.add(body.data.submissionId)
    return new Response(JSON.stringify({ ok: true, result: 'sent' }))
  })
  return { rows, emails, calls, fetchImpl: fetchImpl as unknown as typeof fetch }
}

const values = (over: Partial<ContactValues> = {}): ContactValues => ({
  name: 'Ravi Verma', phone: '', email: '', city: 'Raipur', enquiryType: 'home', kw: '', service: '', message: 'Need solar for my house roof.', ...over,
})

function payloadFor(over: Partial<Parameters<typeof buildPayload>[0]> = {}) {
  return buildPayload({
    submissionId: newSubmissionId(), createdAt: '2026-11-03T18:30:00.000Z', name: 'Ravi Verma', phone: '9876543210', email: '',
    enquiryType: 'home', capacityKw: 5, message: 'Need 5 kW', city: 'Raipur', service: 'Home solar enquiry', source: 'contact', ...over,
  })
}

const save = (p: ReturnType<typeof payloadFor>, extra: Partial<Enquiry> = {}) => () =>
  api.submitEnquiry({
    name: p.name, phone: p.mobile, email: p.email, city: p.city, service: p.service, message: p.message, source: 'contact',
    enquiryType: p.enquiryType === 'Commercial' ? 'commercial' : 'home', capacityKw: p.requiredKw ? Number(p.requiredKw) : null,
    submissionId: p.submissionId, createdAt: p.createdAt, ...extra,
  })

describe('contact form validation', () => {
  it('accepts mobile only, email only, or both', () => {
    expect(validateContact(values({ phone: '9876543210' }))).toEqual({})
    expect(validateContact(values({ email: 'ravi@example.com' }))).toEqual({})
    expect(validateContact(values({ phone: '+91 98765 43210', email: 'ravi@example.com' }))).toEqual({})
  })
  it('errors when both mobile and email are empty', () => {
    expect(validateContact(values()).phone).toMatch(/mobile number or email/i)
  })
  it('checks mobile is 10 digits and email format; name & message required; kW optional', () => {
    expect(validateContact(values({ phone: '12345' })).phone).toMatch(/10-digit/)
    expect(validateContact(values({ phone: '9876543210', email: 'bad@' })).email).toBeTruthy()
    const e = validateContact(values({ name: '', message: '', phone: '9876543210' }))
    expect(Object.keys(e).sort()).toEqual(['message', 'name'])
    expect(validateContact(values({ phone: '9876543210', kw: '5' }))).toEqual({})
  })
})

describe('admin store (existing enquiry flow)', () => {
  it('old enquiries keep working and still show; new fields are optional', () => {
    const old = normalizeEnquiry({ id: 'enq-1', name: 'Sunita Patel', phone: '9827012345', email: '', city: 'Raipur', service: 'Home rooftop installation', message: '', source: 'contact', status: 'new', createdAt: '2026-10-13T11:20:00.000Z' } as Enquiry)
    expect(old.name).toBe('Sunita Patel')
    expect(old.submissionId).toBeUndefined()
    expect(enquiryTypeOf(old)).toBeNull()
    expect(validateEnquiry(old)).toEqual({})
  })

  it('saves type, kW and submissionId; email-only allowed; same submissionId is saved once', async () => {
    const p = payloadFor({ phone: '', email: 'ravi@example.com', enquiryType: 'commercial', capacityKw: 10 })
    const first = await save(p)()
    const again = await save(p)()
    expect(again.id).toBe(first.id)
    const saved = db().enquiries.filter((e) => e.submissionId === p.submissionId)
    expect(saved).toHaveLength(1)
    expect(saved[0]).toMatchObject({ email: 'ravi@example.com', phone: '', enquiryType: 'commercial', capacityKw: 10, propertyType: 'commercial', origin: 'website' })
    // Still editable by the admin (validation accepts email-only)
    expect(validateEnquiry(saved[0])).toEqual({})
    // Survives the storage migration/normalisation
    expect(normalizeEnquiry(saved[0])).toMatchObject({ submissionId: p.submissionId, enquiryType: 'commercial' })
  })

  it('rejects when both mobile and email are missing', async () => {
    await expect(api.submitEnquiry({ name: 'Ravi', phone: '', email: '', city: '', service: 'x', message: '', source: 'contact' })).rejects.toMatchObject({ code: 'validation' })
  })
})

describe('submission flow', () => {
  it('everything works: admin saved, Sheet + email sent, WhatsApp opened with the right number', async () => {
    const as = fakeAppsScript()
    const p = payloadFor()
    const r = await submitWebsiteEnquiry(p, save(p), { url: URL_OK, token: 'tok', fetchImpl: as.fetchImpl })
    expect(r).toMatchObject({ admin: 'saved', sheet: 'sent', email: 'sent', whatsapp: 'opened', delivered: true })
    expect(r.whatsappUrl.startsWith('https://wa.me/919203900410?text=')).toBe(true)
    expect(opened).toHaveLength(1)
    expect(as.rows.size).toBe(1)
    expect(readQueue()).toHaveLength(0)
  })

  it('wrong Sheet URL / offline: admin enquiry still saved, Sheet + email go to the retry queue', async () => {
    const as = fakeAppsScript({ offline: true })
    const p = payloadFor()
    const r = await submitWebsiteEnquiry(p, save(p), { url: 'https://script.google.com/macros/s/WRONG/exec', token: 'tok', fetchImpl: as.fetchImpl })
    expect(r).toMatchObject({ admin: 'saved', sheet: 'queued', email: 'queued', delivered: true })
    expect(db().enquiries.some((e) => e.submissionId === p.submissionId)).toBe(true)
    expect(readQueue().map((q) => q.key).sort()).toEqual([`email:${p.submissionId}`, `sheet:${p.submissionId}`])
  })

  it('email failing does not affect the Sheet or the admin save', async () => {
    const as = fakeAppsScript({ failEmail: true })
    const p = payloadFor()
    const r = await submitWebsiteEnquiry(p, save(p), { url: URL_OK, token: 'tok', fetchImpl: as.fetchImpl })
    expect(r).toMatchObject({ admin: 'saved', sheet: 'sent', email: 'queued' })
    expect(as.rows.size).toBe(1)
    expect(readQueue().map((q) => q.action)).toEqual(['email'])
  })

  it('admin save failing (storage error) does not stop Sheet, email or WhatsApp', async () => {
    const as = fakeAppsScript()
    const p = payloadFor()
    const r = await submitWebsiteEnquiry(p, () => Promise.reject(new Error('QuotaExceededError')), { url: URL_OK, token: 'tok', fetchImpl: as.fetchImpl })
    expect(r).toMatchObject({ admin: 'failed', sheet: 'sent', email: 'sent', whatsapp: 'opened', delivered: true })
  })

  it('validation error from the admin save stops everything (nothing sent)', async () => {
    const as = fakeAppsScript()
    const p = payloadFor({ phone: '', email: '' })
    await expect(submitWebsiteEnquiry(p, save(p), { url: URL_OK, token: 'tok', fetchImpl: as.fetchImpl })).rejects.toMatchObject({ code: 'validation' })
    expect(as.calls).toHaveLength(0)
  })

  it('popup blocked → WhatsApp "blocked" so the form shows the fallback button', async () => {
    popupBlocked = true
    const as = fakeAppsScript()
    const p = payloadFor()
    const r = await submitWebsiteEnquiry(p, save(p), { url: URL_OK, token: 'tok', fetchImpl: as.fetchImpl })
    expect(r.whatsapp).toBe('blocked')
    expect(r.whatsappUrl).toContain('wa.me/919203900410')
  })

  it('no Apps Script URL configured → Sheet/email skipped, nothing queued', async () => {
    const p = payloadFor()
    const r = await submitWebsiteEnquiry(p, save(p), { url: '', token: 'tok' })
    expect(r).toMatchObject({ admin: 'saved', sheet: 'skipped', email: 'skipped' })
    expect(readQueue()).toHaveLength(0)
  })

  it('duplicate submit (same submissionId twice) → one admin record and one Sheet row', async () => {
    const as = fakeAppsScript()
    const p = payloadFor()
    await submitWebsiteEnquiry(p, save(p), { url: URL_OK, token: 'tok', fetchImpl: as.fetchImpl })
    await submitWebsiteEnquiry(p, save(p), { url: URL_OK, token: 'tok', fetchImpl: as.fetchImpl })
    expect(db().enquiries.filter((e) => e.submissionId === p.submissionId)).toHaveLength(1)
    expect(as.rows.size).toBe(1)
  })
})

describe('retry queue', () => {
  it('offline → stays queued; back online → sent once and removed', async () => {
    const p = payloadFor()
    const offline = fakeAppsScript({ offline: true })
    await submitWebsiteEnquiry(p, save(p), { url: URL_OK, token: 'tok', fetchImpl: offline.fetchImpl })
    expect(readQueue()).toHaveLength(2)
    expect(JSON.parse(store[QUEUE_KEY])).toHaveLength(2) // persisted in localStorage

    ;(globalThis.navigator as { onLine: boolean }).onLine = false
    await flushQueue({ url: URL_OK, token: 'tok', fetchImpl: offline.fetchImpl })
    expect(readQueue()).toHaveLength(2)
    expect(readQueue()[0].attempts).toBeGreaterThan(1)

    ;(globalThis.navigator as { onLine: boolean }).onLine = true
    const online = fakeAppsScript()
    const res = await flushQueue({ url: URL_OK, token: 'tok', fetchImpl: online.fetchImpl })
    expect(res).toEqual({ sent: 2, pending: 0 })
    expect(online.rows.size).toBe(1)
    expect(online.emails.size).toBe(1)
    expect(store[QUEUE_KEY]).toBeUndefined()
  })

  it('one queue entry per submission + action (no duplicates)', () => {
    const p = payloadFor()
    enqueue('sheet', p, 'x')
    enqueue('sheet', p, 'y')
    expect(readQueue()).toHaveLength(1)
    expect(readQueue()[0]).toMatchObject({ attempts: 2, lastError: 'y' })
  })
})

describe('WhatsApp message', () => {
  it('only includes filled-in fields', () => {
    const p = payloadFor({ email: '', capacityKw: null, message: '' })
    const t = buildWhatsAppText(p)
    expect(t).toContain('Name: Ravi Verma')
    expect(t).toContain('Mobile: 9876543210')
    expect(t).toContain('Type: Home')
    expect(t).toMatch(/Time: 04 Nov 2026, 12:00 am/i)
    expect(t).not.toContain('Email:')
    expect(t).not.toContain('kW')
    expect(t).not.toContain('Message:')
    expect(whatsappEnquiryUrl(p)).toBe(`https://wa.me/919203900410?text=${encodeURIComponent(t)}`)
  })
  it('submission ids are UUIDs', () => {
    expect(newSubmissionId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })
})

describe('offers (Admin → Offers)', () => {
  beforeEach(async () => { await api.login('admin@babasolars.com', 'Admin@123') })

  it('default content has the Diwali offer, enabled', async () => {
    const content = db().content
    expect(content.offers).toHaveLength(1)
    expect(content.offers[0]).toMatchObject({ id: DIWALI_OFFER.id, enabled: true, bookingAmount: 2000 })
    expect(content.offers[0].slabs.map((s) => s.capacity)).toEqual(['3 kW', '5 kW', '10 kW'])
    // Matches the official posters: 1–25 Nov 2026, all five posters, each slab poster linked.
    expect(content.offers[0]).toMatchObject({ validFrom: '2026-11-01', validUntil: '2026-11-25' })
    expect(content.offers[0].images).toHaveLength(5)
    expect(content.offers[0].images.filter((i) => i.slabId).map((i) => i.slabId)).toEqual(['slab-3kw', 'slab-5kw', 'slab-10kw'])
  })

  it('offer dates decide what the website shows', () => {
    const o = normalizeOffer({ ...DIWALI_OFFER })
    expect(offerStatus(o, '2026-10-31')).toBe('scheduled')
    expect(offerStatus(o, '2026-11-01')).toBe('live')
    expect(offerStatus(o, '2026-11-25')).toBe('live')
    expect(offerStatus(o, '2026-11-26')).toBe('ended')
    expect(offerStatus({ ...o, enabled: false }, '2026-11-10')).toBe('disabled')
    expect(activeOffers([o], '2026-11-26')).toEqual([])
    expect(daysLeft(o, '2026-11-25')).toBe(1)
    expect(daysLeft(o, '2026-11-04')).toBe(22)
    expect(offerDateRange(o)).toBe('1 Nov – 25 Nov 2026')
    expect(validateOffer({ ...o, validFrom: '2026-11-10', validUntil: '2026-11-01' })).toHaveProperty('validUntil')
  })

  it('posters: older saved Diwali offers get them back; bad images are rejected', () => {
    const { images: _i, validFrom: _f, validUntil: _u, terms: _t, ...old } = DIWALI_OFFER
    expect(normalizeOffer(old).images).toHaveLength(5)
    expect(normalizeOffer({ ...old, images: [] }).images).toEqual([]) // admin removed them on purpose
    expect(normalizeOffer({ id: 'x', title: 'X' }).images).toEqual([])
    const bad = normalizeOffer({ id: 'x', title: 'X', images: [{ id: 'a', url: 'javascript:alert(1)', alt: '' }] })
    expect(validateOffer(bad)).toMatchObject({ 'images.0.url': expect.any(String), 'images.0.alt': expect.any(String) })
    expect(offerSrcSet(DIWALI_OFFER.images[1])).toBe('/images/offers/diwali-2026-3kw-160w.webp 160w, /images/offers/diwali-2026-3kw-320w.webp 320w, /images/offers/diwali-2026-3kw-480w.webp 480w, /images/offers/diwali-2026-3kw-640w.webp 640w, /images/offers/diwali-2026-3kw-800w.webp 800w, /images/offers/diwali-2026-3kw-1032w.webp 1032w')
  })

  it('add, edit, disable and delete are saved in the site content', async () => {
    const extra = normalizeOffer({ id: 'offer-x', title: 'Holi offer', slabs: [{ id: 's', capacity: '3 kW', gifts: 'Mixer' }], bookingAmount: 1000 })
    await api.updateContent({ offers: [...db().content.offers, extra] })
    expect(db().content.offers.map((o) => o.id)).toEqual([DIWALI_OFFER.id, 'offer-x'])
    await api.updateContent({ offers: db().content.offers.map((o) => (o.id === 'offer-x' ? { ...o, enabled: false, title: 'Holi offer 2' } : o)) })
    expect(db().content.offers[1]).toMatchObject({ enabled: false, title: 'Holi offer 2' })
    await api.updateContent({ offers: db().content.offers.filter((o) => o.id !== DIWALI_OFFER.id) })
    expect(db().content.offers.map((o) => o.id)).toEqual(['offer-x'])
    // Other content untouched
    expect(db().content.businessName).toBe('Baba Solars')
  })

  it('validates title and slabs (server side too)', async () => {
    expect(validateOffer(normalizeOffer({ title: '', slabs: [{ id: 'a', capacity: '3 kW', gifts: '' }] }))).toMatchObject({ title: expect.any(String), 'slabs.0.gifts': expect.any(String) })
    await expect(api.updateContent({ offers: [normalizeOffer({ id: 'bad', title: '' })] })).rejects.toMatchObject({ code: 'validation' })
    expect(db().content.offers[0].id).toBe(DIWALI_OFFER.id) // rolled back
  })
})
