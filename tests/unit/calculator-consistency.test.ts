import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { api } from '@/services/api'
import { db, resetStore } from '@/mocks/store'
import { calculateSolar, systemCost } from '@/lib/calculator'
import { computeBill } from '@/lib/electricityBill'
import { computeSubsidy } from '@/lib/subsidy'
import { DEFAULT_CALCULATOR as S } from '@/data/settings-defaults'

/**
 * Hand-checked scenarios and cross-screen consistency (calculator ↔ saved quote ↔ pricing page).
 * Sources: CSERC Tariff Schedule FY 2026-27 (CSPDCL), MNRE PM Surya Ghar CFA, Govt. of Chhattisgarh top-up,
 * CG half-bill scheme (50 % on the first 200 units up to 400 units/month, extended to 31 Mar 2027).
 */
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
beforeEach(async () => {
  const store: Record<string, string> = {}
  const localStorage = { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = String(v) }, removeItem: (k: string) => { delete store[k] } }
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage, location: { protocol: 'http:' }, dispatchEvent: () => true } })
  await resetStore()
})
afterEach(() => {
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow); else Reflect.deleteProperty(globalThis, 'window')
})

const base = { tariff: 0, systemType: 'on-grid' as const, roofType: 'rcc' as const, stateCode: '22', country: 'IN' }

describe('CSPDCL domestic bill (worked by hand)', () => {
  it('300 units, 3 kW load: telescopic energy, fixed, FPPAS, duty, half-bill rebate', () => {
    const b = computeBill(300, { propertyType: 'residential' }, S.electricity)
    // 100×4.40 + 100×4.50 + 100×6.00
    expect(b.energyCharges).toBe(1490)
    expect(b.fixedCharges).toBe(60) // 3 kW × ₹20
    expect(b.fppas).toBe(149) // 10 % of energy
    expect(b.duty).toBe(163.9) // 11 % of energy
    // 50 % × (first-200-unit energy 890 + its FPPAS 89 + fixed share 60×200/300)
    expect(b.rebate).toBe(509.5)
    expect(b.payable).toBe(1350) // rounded to ₹10
  })
  it('401 units: no rebate (above the 400-unit limit)', () => {
    expect(computeBill(401, { propertyType: 'residential' }, S.electricity).rebate).toBe(0)
  })
})

describe('subsidy (central + Chhattisgarh)', () => {
  it.each([
    [1, 30000, 15000],
    [1.5, 45000, 15000],
    [2, 60000, 30000],
    [3, 78000, 30000],
    [10, 78000, 30000],
  ])('%s kW home → central %s + state %s', (kw, central, state) => {
    const r = computeSubsidy({ capacityKw: kw, propertyType: 'residential', systemType: 'on-grid', stateCode: '22' }, S)
    expect([r.central, r.state]).toEqual([central, state])
  })
  it('special category state (J&K): ₹33,000/kW + ₹19,800, cap ₹85,800; no CG top-up', () => {
    const r = computeSubsidy({ capacityKw: 4, propertyType: 'residential', systemType: 'on-grid', stateCode: '01' }, S)
    expect([r.central, r.state]).toEqual([85800, 0])
  })
  it('commercial and off-grid get nothing', () => {
    expect(computeSubsidy({ capacityKw: 5, propertyType: 'commercial', systemType: 'on-grid', stateCode: '22' }, S).total).toBe(0)
    expect(computeSubsidy({ capacityKw: 3, propertyType: 'residential', systemType: 'off-grid', stateCode: '22' }, S).total).toBe(0)
  })
})

describe('calculator scenarios', () => {
  it('₹2,500 bill in Raipur → 3 kW, ₹1.71 L, ₹1.08 L subsidy, ₹63,000 net', () => {
    const r = calculateSolar({ ...base, monthlyBill: 2500, propertyType: 'residential' }, S)
    expect(r.capacityKw).toBe(3)
    expect(r.costMid).toBe(171000) // 3 × ₹57,000
    expect(r.subsidy + r.stateSubsidy).toBe(108000)
    expect(r.netCost).toBe(63000)
    expect(r.monthlyGeneration).toBe(383) // 3 kW × 4.2 × 365 ÷ 12
    expect(r.paybackYears).toBeGreaterThan(2)
    expect(r.paybackYears).toBeLessThan(3.5)
  })
  it('results are stable across bills (bigger bill → never a smaller system)', () => {
    let prev = 0
    for (let bill = 500; bill <= 20000; bill += 250) {
      const kw = calculateSolar({ ...base, monthlyBill: bill, propertyType: 'residential' }, S).capacityKw
      expect(kw).toBeGreaterThanOrEqual(prev)
      prev = kw
    }
  })
  it('hybrid and roof type change the price by their factors', () => {
    expect(systemCost(3, 'hybrid', 'rcc', S)).toBeCloseTo(171000 * 1.45)
    expect(systemCost(3, 'on-grid', 'ground', S)).toBeCloseTo(171000 * 1.08)
  })
})

describe('same numbers on every screen', () => {
  it('a calculator quote request saves the price the visitor saw (incl. hybrid & roof factors)', async () => {
    const shown = calculateSolar({ ...base, monthlyBill: 3000, propertyType: 'residential', systemType: 'hybrid', roofType: 'tin' }, S)
    const saved = await api.submitQuotation({
      customerName: 'Test Person', phone: '9876543210', email: '', city: 'Raipur', propertyType: 'residential', systemType: 'hybrid',
      roofType: 'tin', capacityKw: shown.capacityKw, monthlyBill: 3000, stateCode: '22', submissionId: 'calc-1',
    })
    expect(saved.estimate?.estimatedCost).toBe(shown.costMid)
    expect(saved.estimate?.netCost).toBe(shown.netCost)
    // Same submission again (double click / retry) → no duplicate
    await api.submitQuotation({ customerName: 'Test Person', phone: '9876543210', email: '', city: 'Raipur', propertyType: 'residential', systemType: 'hybrid', roofType: 'tin', capacityKw: shown.capacityKw, monthlyBill: 3000, submissionId: 'calc-1' })
    expect(db().enquiries.filter((e) => e.submissionId === 'calc-1')).toHaveLength(1)
  })
  it('published home plans on the pricing page show the same subsidy as the calculator', () => {
    const calc = db().content.calculator
    for (const p of db().pricingPlans.filter((x) => x.category === 'residential' && x.capacityKw && x.status === 'published')) {
      const r = computeSubsidy({ capacityKw: p.capacityKw!, propertyType: 'residential', systemType: 'on-grid' }, calc)
      expect([p.id, p.subsidy]).toEqual([p.id, r.total])
    }
  })
})
