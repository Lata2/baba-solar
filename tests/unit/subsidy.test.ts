import { describe, expect, it } from 'vitest'
import { DEFAULT_CALCULATOR } from '@/data/settings-defaults'
import { computeSubsidy, validateSubsidySettings, stateAmount, CHHATTISGARH_RULE } from '@/lib/subsidy'
import { calculateSolar } from '@/lib/calculator'
import { deriveInvoiceSubsidy, deriveQuotation } from '@/mocks/logic'
import { createSeedDb } from '@/mocks/store'
import type { InvoiceInput } from '@/types'
import type { QuotationSave } from '@/services/api'

const s = DEFAULT_CALCULATOR
const home = (kw: number, extra: Partial<Parameters<typeof computeSubsidy>[0]> = {}) =>
  computeSubsidy({ capacityKw: kw, propertyType: 'residential', systemType: 'on-grid', stateCode: '22', ...extra }, s)

describe('PM Surya Ghar central subsidy', () => {
  it.each([
    [1, 30000], [2, 60000], [3, 78000], [4, 78000], [10, 78000],
  ])('%s kW → ₹%s', (kw, amount) => expect(home(kw).central).toBe(amount))
  it('is pro-rata for part kW (official ₹/kW rates)', () => {
    expect(home(1.5).central).toBe(45000)
    expect(home(2.5).central).toBe(69000)
  })
  it('special category states get the higher rate', () => {
    const r = home(3, { stateCode: '18' }) // Assam
    expect(r.central).toBe(85800)
    expect(r.specialCategory).toBe(true)
    expect(r.state).toBe(0) // no state scheme configured for Assam
  })
  it('housing societies: ₹18,000/kW up to 500 kW, no CG household top-up', () => {
    const r = computeSubsidy({ capacityKw: 20, propertyType: 'housing-society', systemType: 'on-grid', stateCode: '22' }, s)
    expect(r.central).toBe(360000)
    expect(r.state).toBe(0)
  })
})

describe('Chhattisgarh state subsidy and combined totals', () => {
  it.each([
    [1, 15000, 45000], [2, 30000, 90000], [3, 30000, 108000], [5, 30000, 108000],
  ])('%s kW → state ₹%s, combined ₹%s', (kw, state, total) => {
    const r = home(kw)
    expect(r.state).toBe(state)
    expect(r.total).toBe(total)
    expect(r.stateScheme).toBe('Chhattisgarh State Subsidy')
  })
  it('1.5 kW stays on the 1 kW slab; below 1 kW gets no state top-up', () => {
    expect(home(1.5).state).toBe(15000)
    expect(home(0.5).state).toBe(0)
    expect(home(0.5).notes.join(' ')).toMatch(/starts at 1 kW/)
  })
  it('uses the default state (Chhattisgarh) when none is given', () => {
    expect(computeSubsidy({ capacityKw: 3, propertyType: 'residential', systemType: 'on-grid' }, s).total).toBe(108000)
  })
  it('other states get only the central subsidy', () => expect(home(3, { stateCode: '27' }).total).toBe(78000))
})

describe('eligibility and caps', () => {
  it('commercial and off-grid get nothing, with a reason', () => {
    const c = computeSubsidy({ capacityKw: 10, propertyType: 'commercial', systemType: 'on-grid', stateCode: '22' }, s)
    expect(c.total).toBe(0)
    expect(c.notes[0]).toMatch(/Commercial/)
    expect(home(3, { systemType: 'off-grid' }).total).toBe(0)
  })
  it('hybrid follows the setting', () => {
    expect(home(3, { systemType: 'hybrid' }).total).toBe(108000)
    expect(computeSubsidy({ capacityKw: 3, propertyType: 'residential', systemType: 'hybrid', stateCode: '22' }, { ...s.subsidy, hybridEligible: false }).total).toBe(0)
  })
  it('never exceeds the system cost (central first, then state)', () => {
    const r = home(3, { systemCost: 90000 })
    expect(r.central).toBe(78000)
    expect(r.state).toBe(12000)
    expect(r.netCost).toBe(0)
  })
  it('disabled state rule → central only', () => {
    expect(computeSubsidy({ capacityKw: 3, propertyType: 'residential', systemType: 'on-grid', stateCode: '22' },
      { ...s.subsidy, states: [{ ...CHHATTISGARH_RULE, enabled: false }] }).total).toBe(78000)
  })
  it('slab order in settings does not matter', () => {
    expect(stateAmount(2, { ...CHHATTISGARH_RULE, slabs: [{ fromKw: 2, amount: 30000 }, { fromKw: 1, amount: 15000 }] })).toBe(30000)
  })
})

describe('settings validation', () => {
  it('accepts the defaults', () => expect(validateSubsidySettings(s.subsidy)).toEqual({}))
  it('flags duplicates, empty names and bad slabs', () => {
    const e = validateSubsidySettings({ ...s.subsidy, states: [CHHATTISGARH_RULE, { ...CHHATTISGARH_RULE, id: 'x', schemeName: ' ', slabs: [{ fromKw: 0, amount: -1 }] }] })
    expect(e['calculator.subsidy.states.1.stateCode']).toBeTruthy()
    expect(e['calculator.subsidy.states.1.schemeName']).toBeTruthy()
    expect(e['calculator.subsidy.states.1.slabs.0.fromKw']).toBeTruthy()
    expect(e['calculator.subsidy.states.1.slabs.0.amount']).toBeTruthy()
  })
})

describe('calculator, quotation and invoice use the same rules', () => {
  it('calculator: 3 kW Waaree-like price → central 78k + state 30k, final payable', () => {
    const r = calculateSolar({ monthlyBill: 3000, tariff: 0, propertyType: 'residential', systemType: 'on-grid', roofType: 'rcc', capacityOverride: 3, costOverride: 160000, stateCode: '22' }, s)
    expect(r.subsidy).toBe(78000)
    expect(r.stateSubsidy).toBe(30000)
    expect(r.netCost).toBe(52000)
  })

  const db = createSeedDb()
  const base: QuotationSave = {
    status: 'pending', quoteDate: '2026-10-30', validUntil: null, customerName: 'Ramesh Sharma', phone: '9876543210', email: '', city: 'Raipur',
    address: '', state: 'Chhattisgarh', gstin: '', consumerNumber: '', discom: 'CSPDCL', sanctionedLoadKw: null, propertyType: 'residential',
    systemType: 'on-grid', roofType: 'rcc', capacityKw: 2, monthlyBill: 2000, companyId: null, quality: 'normal', packagePrice: null,
    items: [{ id: 'l1', name: '2 kW kit', description: '', hsn: '8541', unit: 'Nos', quantity: 1, rate: 120000, discountPct: 0, gstRate: 0 }],
    discount: 0, subsidy: null, stateSubsidy: null, annualGenerationKwh: null, paymentTerms: '', terms: '', notes: '',
  }
  const ctx = { business: db.business, calc: db.content.calculator, companies: db.companies }

  it('quotation (auto): 2 kW in Chhattisgarh → ₹60,000 + ₹30,000', () => {
    const d = deriveQuotation(base, ctx)
    expect([d.subsidy, d.stateSubsidy, d.netCost, d.subsidyAuto]).toEqual([60000, 30000, 30000, true])
    expect(d.stateSubsidyScheme).toBe('Chhattisgarh State Subsidy')
  })
  it('quotation (manual) keeps typed amounts but caps them at the cost', () => {
    const d = deriveQuotation({ ...base, subsidy: 100000, stateSubsidy: 50000 }, ctx)
    expect([d.subsidy, d.stateSubsidy, d.netCost, d.subsidyAuto]).toEqual([100000, 20000, 0, false])
  })
  it('quotation for a customer outside Chhattisgarh gets central only', () => {
    expect(deriveQuotation({ ...base, state: 'Maharashtra' }, ctx).stateSubsidy).toBe(0)
  })
  it('invoice: total unchanged, subsidy shown with net cost', () => {
    const input = { stateCode: '22', subsidy: { show: true, auto: true, capacityKw: 3, propertyType: 'residential', systemType: 'on-grid', central: null, state: null } } as unknown as InvoiceInput
    const sub = deriveInvoiceSubsidy(input, 160000, db.content.calculator)!
    expect([sub.central, sub.state, sub.total, sub.netCost]).toEqual([78000, 30000, 108000, 52000])
    expect(deriveInvoiceSubsidy({ ...input, subsidy: null } as InvoiceInput, 160000, db.content.calculator)).toBeNull()
  })
})
