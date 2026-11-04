import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { api } from '@/services/api'
import { db, resetStore } from '@/mocks/store'
import { createId } from '@/lib/id'

/** API-level workflow: enquiry → proposal → quotation → invoice, plus backup/restore, in node (in-memory store). */
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
beforeEach(async () => {
  const store: Record<string, string> = {}
  const localStorage = { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = String(v) }, removeItem: (k: string) => { delete store[k] } }
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage, location: { protocol: 'http:' }, dispatchEvent: () => true } })
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { cookie: '' } })
  await resetStore()
  await api.login('admin@babasolars.com', 'Admin@123')
})
afterEach(() => {
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow); else Reflect.deleteProperty(globalThis, 'window')
  if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument); else Reflect.deleteProperty(globalThis, 'document')
})

const manual = () => ({ id: createId('enq'), name: 'Kiran Sahu', phone: '9876500001', email: '', city: 'Raipur', service: '5 kW home', message: '', source: 'manual' as const, status: 'new' as const, capacityKw: 5, propertyType: 'residential' as const })

describe('lead workflow', () => {
  it('manual enquiry creates a linked draft proposal; WhatsApp enquiry does not unless asked', async () => {
    const r = await api.saveEnquiry(manual(), { createProposal: true })
    expect(r.proposal).not.toBeNull()
    expect(r.proposal!.enquiryId).toBe(r.enquiry.id)
    expect(r.proposal!.proposalNumber).toMatch(/^BS\/PRP\/\d{4}-\d{2}\/0001$/)
    expect(db().enquiries.find((e) => e.id === r.enquiry.id)!.status).toBe('proposal')
    const w = await api.saveEnquiry({ ...manual(), id: createId('enq'), phone: '9876500002', source: 'whatsapp' })
    expect(w.proposal).toBeNull()
    expect(w.enquiry.origin).toBe('admin')
  })

  it('proposal → quotation keeps enquiry + proposal links; numbers are unique; convert only once', async () => {
    const { enquiry, proposal } = await api.saveEnquiry(manual(), { createProposal: true })
    const dup = await api.duplicateProposal(proposal!.id)
    expect(dup.proposalNumber).not.toBe(proposal!.proposalNumber)
    const q = await api.convertProposal(proposal!.id)
    expect(q).toMatchObject({ enquiryId: enquiry.id, proposalId: proposal!.id, status: 'pending' })
    expect(q.quoteNumber).toMatch(/^BS\/QT\//)
    expect(db().proposals.find((p) => p.id === proposal!.id)!.status).toBe('converted')
    expect(db().enquiries.find((e) => e.id === enquiry.id)!.status).toBe('quoted')
    await expect(api.convertProposal(proposal!.id)).rejects.toMatchObject({ code: 'conflict' })
  })

  it('custom items and charges flow into a quotation and an invoice', async () => {
    const { proposal } = await api.saveEnquiry(manual(), { createProposal: true })
    const items = [
      { id: 'a', name: 'Solar kit', description: '', hsn: '85414300', unit: 'SET', quantity: 1, rate: 250000, discountPct: 0, gstRate: 5 },
      { id: 'b', name: 'Extra nuts & bolts', description: '', hsn: '73181500', unit: 'LOT', quantity: 1, rate: 1200, discountPct: 0, gstRate: 18 },
      { id: 'c', name: 'Transportation', description: '', hsn: '996511', unit: 'LOT', quantity: 1, rate: 3000, discountPct: 0, gstRate: 18 },
    ]
    const { id: _i, proposalNumber: _n, createdAt: _c, updatedAt: _u, subtotal: _s, taxableAmount: _t, taxTotal: _x, grandTotal: _g, subsidy: _sb, stateSubsidy: _ss, netCost: _nc, annualGenerationKwh: _a, ...input } = proposal!
    const saved = await api.saveProposal(proposal!.id, { ...input, items, discount: 500 })
    expect(saved.taxableAmount).toBeCloseTo(254200 - 500, 0)
    const q = await api.convertProposal(saved.id)
    expect(q.items).toHaveLength(3)
    const inv = await api.convertToInvoice(q.id)
    expect(inv.items.map((i) => i.name)).toContain('Transportation')
    expect(inv.grandTotal).toBeCloseTo(q.grandTotal!, 0)
  })

  it('rejects invalid input with field errors and saves nothing', async () => {
    const before = db().enquiries.length
    await expect(api.saveEnquiry({ ...manual(), phone: '123', name: '' })).rejects.toMatchObject({ code: 'validation', fieldErrors: { phone: expect.any(String), name: expect.any(String) } })
    expect(db().enquiries.length).toBe(before)
  })

  it('Excel import saves valid rows and reports failed ones', async () => {
    const res = await api.importEnquiries([
      { name: 'Row One', phone: '9876500011', service: 'Solar' },
      { name: 'X', phone: '1', service: '' },
    ])
    expect(res.imported).toBe(1)
    expect(res.failed).toEqual([{ row: 2, errors: expect.any(Array) }])
    expect(db().enquiries.find((e) => e.name === 'Row One')!.origin).toBe('import')
  })

  it('calculator quote request becomes a website enquiry with the estimate', async () => {
    const e = await api.submitQuotation({ customerName: 'Web User', phone: '9876500099', email: '', city: 'Raipur', propertyType: 'residential', systemType: 'on-grid', capacityKw: 3, monthlyBill: 2500, stateCode: '22' })
    expect(e).toMatchObject({ source: 'calculator', origin: 'website', status: 'new' })
    expect(e.estimate).toMatchObject({ capacityKw: 3, subsidy: 108000 })
  })

  it('backup includes proposals and restores them', async () => {
    await api.saveEnquiry(manual(), { createProposal: true })
    const snap = await api.exportSnapshot({ includeLeads: true })
    expect((snap.data.proposals as unknown[]).length).toBe(1)
    await resetStore()
    await api.login('admin@babasolars.com', 'Admin@123')
    expect(db().proposals).toHaveLength(0)
    const r = await api.importSnapshot(snap)
    expect(r.imported).toEqual(expect.arrayContaining(['enquiries', 'proposals']))
    expect(db().proposals).toHaveLength(1)
    await expect(api.importSnapshot({ data: { proposals: [{ nope: 1 }] } })).rejects.toMatchObject({ code: 'validation' })
  })
})
