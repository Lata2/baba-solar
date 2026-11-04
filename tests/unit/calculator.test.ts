import { describe, expect, it } from 'vitest'
import { DEFAULT_CALCULATOR } from '@/data/settings-defaults'
import { computeBill, connectionCategory } from '@/lib/electricityBill'
import { calculateSolar, effectiveYield, type CalculatorInput } from '@/lib/calculator'
import { defaultDiscom, discomsFor, resolveTariff } from '@/lib/tariffRegistry'
import type { ElectricityTariffSettings } from '@/types'

const S = DEFAULT_CALCULATOR
const E = S.electricity
const BARE: ElectricityTariffSettings = { ...E, fppasPercent: 0, dutyDomesticPercent: 0, dutyNonDomesticPercent: 0, dutyIndustrialPercent: 0, halfBill: { ...E.halfBill, enabled: false }, roundTo: 1 }
const base: CalculatorInput = { propertyType: 'residential', systemType: 'on-grid', roofType: 'rcc', tariff: 0, monthlyBill: 0 }

describe('industrial tariff (CSERC FY 2026-27, LV-5 & HV-3)', () => {
  it('chooses LV-5.2.1 up to 25 HP (18.7 kW), LV-5.2.2 above, HV-3 above the 150 kW LV limit', () => {
    expect(connectionCategory('industrial', 18.7, E)).toBe('lv5.2.1')
    expect(connectionCategory('industrial', 18.8, E)).toBe('lv5.2.2')
    expect(connectionCategory('industrial', 150, E)).toBe('lv5.2.2')
    expect(connectionCategory('industrial', 151, E)).toBe('hv3')
  })
  it('LV-5.2.1: 1,000 units, 15 kW = 1,000 × ₹6.35 + 15 × ₹120 demand', () => {
    const b = computeBill(1000, { propertyType: 'industrial', loadKw: 15 }, BARE)
    expect(b.energyCharges).toBe(6350)
    expect(b.fixedCharges).toBe(1800)
    expect(b.total).toBe(8150)
  })
  it('LV-5.2.2: 5,000 units, 40 kW = 5,000 × ₹7.10 + 40 × ₹150 demand', () => {
    const b = computeBill(5000, { propertyType: 'industrial', loadKw: 40 }, BARE)
    expect(b.energyCharges).toBe(35500)
    expect(b.fixedCharges).toBe(6000)
  })
  it('HV-3 11 kV: 30,000 units, 200 kVA = 30,000 × ₹7.85 + 200 × ₹400', () => {
    const b = computeBill(30000, { propertyType: 'industrial', loadKw: 200 }, BARE)
    expect(b.category).toBe('hv3')
    expect(b.energyCharges).toBe(235500)
    expect(b.fixedCharges).toBe(80000)
  })
  it('FPPAS and duty are added on energy charges; no half-bill rebate for industry', () => {
    const b = computeBill(5000, { propertyType: 'industrial', loadKw: 40 }, E)
    expect(b.fppas).toBe(3550)
    expect(b.duty).toBe(6035)
    expect(b.rebate).toBe(0)
    expect(b.payable).toBe(51090) // 51,085 rounded to ₹10
  })
})

describe('tariff registry', () => {
  it('Chhattisgarh defaults to CSPDCL and uses the verified slab tariff', () => {
    expect(defaultDiscom('22')).toBe('cspdcl')
    const t = resolveTariff({ stateCode: '22', propertyType: 'residential' }, S)
    expect(t).toMatchObject({ mode: 'slab', verified: true, notes: [] })
    expect(t.sourceUrl).toMatch(/^https:\/\/cserc\.gov\.in\//)
  })
  it('every state offers "Other / not sure"', () => {
    for (const code of ['22', '27', '09', '35']) expect(discomsFor(code).at(-1)!.id).toBe('other')
  })
  it('a DISCOM without verified data is indicative and says it needs confirmation', () => {
    const t = resolveTariff({ stateCode: '27', discomId: 'msedcl', propertyType: 'commercial' }, S)
    expect(t.mode).toBe('indicative')
    expect(t.verified).toBe(false)
    expect(t.flatRate).toBe(S.indicativeTariff.commercial)
    expect(t.notes.join(' ')).toMatch(/needs confirmation/)
  })
  it('"Other / not sure" in Chhattisgarh is not treated as verified', () => {
    expect(resolveTariff({ stateCode: '22', discomId: 'other', propertyType: 'residential' }, S).verified).toBe(false)
  })
  it('another country is never shown as verified', () => {
    const t = resolveTariff({ country: 'OTHER', stateCode: '22', propertyType: 'residential' }, S)
    expect(t.verified).toBe(false)
    expect(t.notes[0]).toMatch(/outside India/)
  })
  it('indicative defaults equal the documented CSPDCL averages (keeps the settings comment true)', () => {
    const noRebate = { ...E, halfBill: { ...E.halfBill, enabled: false } }
    const avg = (u: number, p: 'residential' | 'commercial' | 'industrial', kw: number, e = E) => computeBill(u, { propertyType: p, loadKw: kw }, e).total / u
    expect(avg(300, 'residential', 3, noRebate)).toBeCloseTo(S.indicativeTariff.residential, 1)
    expect(avg(1000, 'commercial', 10)).toBeCloseTo(S.indicativeTariff.commercial, 1)
    expect(avg(5000, 'industrial', 40)).toBeCloseTo(S.indicativeTariff.industrial, 1)
  })
})

describe('generation: location, roof direction, shading, losses', () => {
  it('south, no shade = the base yield', () => {
    expect(effectiveYield(S, { stateCode: '22' })).toBe(S.unitsPerKwPerDay)
  })
  it('east-facing and moderate shading reduce output multiplicatively', () => {
    const y = effectiveYield(S, { stateCode: '22', roofDirection: 'east', shading: 'moderate' })
    expect(y).toBeCloseTo(4.2 * 0.86 * 0.82, 3)
  })
  it('extra losses and per-state yield are applied', () => {
    const s = { ...S, generation: { ...S.generation, extraLossPercent: 10, yieldByState: { '08': 5 } } }
    expect(effectiveYield(s, { stateCode: '08' })).toBeCloseTo(4.5, 3)
    expect(effectiveYield(s, { stateCode: '22' })).toBeCloseTo(4.2 * 0.9, 3)
  })
  it('a shaded / east roof needs a bigger system for the same units', () => {
    const a = calculateSolar({ ...base, mode: 'units', monthlyUnits: 600, stateCode: '22' })
    const b = calculateSolar({ ...base, mode: 'units', monthlyUnits: 600, stateCode: '22', roofDirection: 'east', shading: 'moderate' })
    expect(b.recommendedKw).toBeGreaterThan(a.recommendedKw)
    expect(b.annualUnits / b.capacityKw).toBeLessThan(a.annualUnits / a.capacityKw)
  })
})

describe('end-to-end estimates', () => {
  it('Raipur home, 300 units: 2.5 kW, central + Chhattisgarh subsidy, payback < 25 yrs', () => {
    const r = calculateSolar({ ...base, mode: 'units', monthlyUnits: 300, stateCode: '22', discomId: 'cspdcl' })
    expect(r.recommendedKw).toBe(2.5)
    expect(r.subsidy).toBe(2 * 30000 + 0.5 * 18000)
    expect(r.stateSubsidy).toBe(30000)
    expect(r.netCost).toBe(r.costMid - r.subsidy - r.stateSubsidy)
    expect(r.paybackYears).toBeGreaterThan(0)
    expect(r.paybackYears).toBeLessThan(25)
    expect(r.tariffSource.verified).toBe(true)
  })
  it('3 kW home gets the ₹78,000 central cap', () => {
    const r = calculateSolar({ ...base, mode: 'units', monthlyUnits: 400, stateCode: '22', capacityOverride: 3 })
    expect(r.subsidy).toBe(78000)
  })
  it('commercial and industrial get no subsidy and are not capped by sanctioned load', () => {
    for (const propertyType of ['commercial', 'industrial'] as const) {
      const r = calculateSolar({ ...base, propertyType, mode: 'units', monthlyUnits: 3000, sanctionedLoadKw: 10, stateCode: '22' })
      expect(r.subsidy + r.stateSubsidy).toBe(0)
      expect(r.capacityKw).toBeGreaterThan(10)
      expect(r.subsidyDetail.notes.join(' ')).toMatch(/not eligible/)
    }
  })
  it('industrial bill mode works from the bill amount, keeping the demand charge (not bill ÷ one rate)', () => {
    const r = calculateSolar({ ...base, propertyType: 'industrial', monthlyBill: 60000, sanctionedLoadKw: 40, stateCode: '22' })
    expect(r.billBreakdown!.category).toBe('lv5.2.2')
    expect(r.monthlyUnits).toBeLessThan(60000 / 7.1)
    expect(r.billWithSolar!.fixedCharges).toBe(6000)
  })
  it('payback: cumulative savings first exceed the net cost in the payback year', () => {
    const r = calculateSolar({ ...base, mode: 'units', monthlyUnits: 500, stateCode: '22' })
    const year = Math.ceil(r.paybackYears)
    expect(r.cumulative[year - 1]).toBeGreaterThanOrEqual(r.netCost)
    if (year >= 2) expect(r.cumulative[year - 2]).toBeLessThan(r.netCost)
  })
  it('environmental benefit = generation × grid emission factor', () => {
    const r = calculateSolar({ ...base, mode: 'units', monthlyUnits: 300, stateCode: '22' })
    expect(r.co2TonnesPerYear).toBeCloseTo((r.annualUnits * S.co2KgPerUnit) / 1000, 1)
  })
  it('a state without verified data still estimates, flagged as needing confirmation', () => {
    const r = calculateSolar({ ...base, monthlyBill: 3100, stateCode: '27', discomId: 'msedcl' })
    expect(r.billBreakdown).toBeNull()
    expect(r.monthlyUnits).toBe(Math.round(3100 / S.indicativeTariff.residential))
    expect(r.tariffSource.verified).toBe(false)
    expect(r.assumptions[0]).toMatch(/needs confirmation/)
  })
  it('zero input does not crash and returns a minimum size with a warning', () => {
    const r = calculateSolar({ ...base, mode: 'units', monthlyUnits: 0 })
    expect(r.capacityKw).toBe(1)
    expect(r.warnings.join(' ')).toMatch(/Enter your bill/)
  })
})
