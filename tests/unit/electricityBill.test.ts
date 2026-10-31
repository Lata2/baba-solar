import { describe, expect, it } from 'vitest'
import { DEFAULT_CALCULATOR } from '@/data/settings-defaults'
import { computeBill, connectionCategory, slabCharges, telescopicFixed, unitsFromBill } from '@/lib/electricityBill'
import { calculateSolar, validateCalculatorInput } from '@/lib/calculator'
import type { ElectricityTariffSettings } from '@/types'

const E = DEFAULT_CALCULATOR.electricity
/** Same assumptions as electricitybillcalculator.in: energy + fixed only (FPPAS, duty, subsidy entered separately = 0). */
const BARE: ElectricityTariffSettings = { ...E, fppasPercent: 0, dutyDomesticPercent: 0, dutyNonDomesticPercent: 0, halfBill: { ...E.halfBill, enabled: false }, roundTo: 1 }
const home = { propertyType: 'residential' as const }
const shop = { propertyType: 'commercial' as const }

describe('CSERC FY 2026-27 tariff schedule (worked examples from the order)', () => {
  it('energy charges are telescopic — 150 units = 100 × 4.40 + 50 × 4.50', () => {
    const lines = slabCharges(150, E.domesticEnergy)
    expect(lines.map((l) => [l.units, l.rate])).toEqual([[100, 4.4], [50, 4.5]])
    expect(computeBill(150, home, BARE).energyCharges).toBe(665)
  })
  it('LV-1 fixed charge is telescopic on load — 7 kW = 5 × ₹20 + 2 × ₹30', () => {
    expect(telescopicFixed(7, E.domesticFixed)).toBe(160)
    expect(telescopicFixed(12, E.domesticFixed)).toBe(5 * 20 + 5 * 30 + 2 * 50)
    expect(telescopicFixed(2.5, E.domesticFixed)).toBe(50)
  })
  it('fixed charge is a monthly minimum at zero consumption', () => {
    expect(computeBill(0, { ...home, loadKw: 2 }, BARE).total).toBe(40)
    expect(computeBill(0, { ...shop, loadKw: 4 }, BARE).total).toBe(240)
  })
})

describe('cross-check with electricitybillcalculator.in (energy + fixed, no FPPAS/duty/subsidy)', () => {
  const cases: [string, typeof home | typeof shop, number, number, number, number][] = [
    // label, type, units, load, energy, fixed
    ['Domestic 350 units, 3 kW', home, 350, 3, 1790, 60],
    ['Domestic 786 units, 4 kW', home, 786, 4, 440 + 450 + 1200 + 1400 + 186 * 8.8, 80],
    ['Domestic 100 units, 1 kW', home, 100, 1, 440, 20],
    ['LV-2.1 250 units, 3 kW', shop, 250, 3, 650 + 150 * 7.6, 180],
    ['LV-2.2 ≤15 kW: 500 units, 10 kW', shop, 500, 10, 400 * 7.5 + 100 * 9, 1300],
    ['LV-2.2 >15 kW: 1000 units, 20 kW', shop, 1000, 20, 8400, 4200],
  ]
  for (const [label, type, units, load, energy, fixed] of cases)
    it(label, () => {
      const b = computeBill(units, { ...type, loadKw: load }, BARE)
      expect(b.energyCharges).toBeCloseTo(energy, 2)
      expect(b.fixedCharges).toBe(fixed)
      expect(b.total).toBeCloseTo(energy + fixed, 2)
    })
  it('picks the category from property type and load', () => {
    expect(connectionCategory('residential', 12)).toBe('lv1')
    expect(connectionCategory('commercial', 5)).toBe('lv2.1')
    expect(connectionCategory('commercial', 15)).toBe('lv2.2a')
    expect(connectionCategory('commercial', 15.5)).toBe('lv2.2b')
  })
})

describe('full domestic bill (FPPAS 10 %, duty 11 %, half-bill rebate, ₹10 rounding)', () => {
  it('150 units, 2 kW — everything under 200 units is halved, duty is not', () => {
    const b = computeBill(150, { ...home, loadKw: 2 }, E)
    expect(b).toMatchObject({ energyCharges: 665, fixedCharges: 40, fppas: 66.5, duty: 73.15, rebate: 385.75 })
    expect(b.total).toBe(458.9)
    expect(b.payable).toBe(460)
  })
  it('300 units, 3 kW — rebate only on the first 200 units (fixed charge pro-rata)', () => {
    const b = computeBill(300, { ...home, loadKw: 3 }, E)
    expect(b.energyCharges).toBe(1490)
    expect(b.fppas).toBe(149)
    expect(b.duty).toBe(163.9)
    expect(b.rebate).toBe(509.5) // 50 % × (890 + 89 + 60 × 200/300)
    expect(b.total).toBe(1353.4)
    expect(b.payable).toBe(1350)
  })
  it('no rebate above 400 units, so the bill jumps at 401', () => {
    const at400 = computeBill(400, home, E)
    const at401 = computeBill(401, home, E)
    expect(at400.rebate).toBeGreaterThan(0)
    expect(at401.rebate).toBe(0)
    expect(at401.total).toBeGreaterThan(at400.total)
  })
  it('rebate is for homes only — not businesses or housing societies', () => {
    expect(computeBill(150, shop, E).rebate).toBe(0)
    expect(computeBill(150, { propertyType: 'housing-society' }, E).rebate).toBe(0)
  })
  it('non-domestic duty uses the non-domestic rate', () => {
    const b = computeBill(250, { ...shop, loadKw: 3 }, E)
    expect(b.dutyPercent).toBe(17)
    expect(b.duty).toBeCloseTo(1790 * 0.17, 2)
  })
  it('FPPAS and fixed charge from the visitor override the defaults', () => {
    const b = computeBill(300, { ...home, loadKw: 3, fppasPercent: 0, fixedChargesOverride: 100 }, { ...E, halfBill: { ...E.halfBill, enabled: false } })
    expect(b.fppas).toBe(0)
    expect(b.fixedCharges).toBe(100)
  })
})

describe('bill → units (inverse)', () => {
  it('round-trips every consumption level', () => {
    for (const type of [home, shop])
      for (const u of [25, 120, 199, 250, 380, 450, 650, 1200, 5000]) {
        const total = computeBill(u, type, E).total
        expect(Math.abs(unitsFromBill(total, type, E) - u)).toBeLessThanOrEqual(0.1)
      }
  })
  it('a bill inside the jump at 400/401 units maps to 400 units', () => {
    const t400 = computeBill(400, home, E).total
    const t401 = computeBill(400.01, home, E).total
    expect(unitsFromBill((t400 + t401) / 2, home, E)).toBe(400)
  })
  it('a bill at or below the minimum charge means 0 units', () => {
    expect(unitsFromBill(10, home, E)).toBe(0)
    expect(unitsFromBill(0, home, E)).toBe(0)
  })
})

describe('solar calculator uses the slab bill', () => {
  const base = { propertyType: 'residential' as const, systemType: 'on-grid' as const, roofType: 'rcc' as const, tariff: 0 }
  it('units mode: bill now is the CSPDCL bill, savings = bill now − bill on net units', () => {
    const r = calculateSolar({ ...base, mode: 'units', monthlyBill: 0, monthlyUnits: 300, sanctionedLoadKw: 3, capacityOverride: 2 })
    expect(r.billNow).toBe(1350)
    const gen = (2 * DEFAULT_CALCULATOR.unitsPerKwPerDay * 365) / 12
    const expected = (computeBill(300, { ...home, loadKw: 3 }, E).total - computeBill(300 - gen, { ...home, loadKw: 3 }, E).total) * 12
    expect(r.annualSavings).toBe(Math.round(expected))
    expect(r.newMonthlyBill).toBe(computeBill(300 - gen, { ...home, loadKw: 3 }, E).payable)
    expect(r.billWithSolar!.fixedCharges).toBe(60) // fixed charge stays with solar
  })
  it('bill mode: ₹3,000 bill → units from the slab tariff, not ₹3,000 ÷ flat rate', () => {
    const r = calculateSolar({ ...base, monthlyBill: 3000 })
    const exact = unitsFromBill(3000, home, E)
    expect(r.monthlyUnits).toBe(Math.round(exact))
    expect(Math.abs(computeBill(exact, home, E).total - 3000)).toBeLessThan(1)
    expect(r.monthlyUnits).not.toBe(Math.round(3000 / DEFAULT_CALCULATOR.defaultTariff))
  })
  it('full offset leaves only the fixed charge (minimum bill)', () => {
    const r = calculateSolar({ ...base, mode: 'units', monthlyBill: 0, monthlyUnits: 300, sanctionedLoadKw: 5, capacityOverride: 5 })
    expect(r.billWithSolar!.units).toBe(0)
    expect(r.newMonthlyBill).toBe(computeBill(0, { ...home, loadKw: 5 }, E).payable)
  })
  it('a custom flat tariff keeps the old flat-rate behaviour', () => {
    const r = calculateSolar({ ...base, monthlyBill: 3400, tariff: 6.8, fixedCharges: 0 })
    expect(r.monthlyUnits).toBe(500)
    expect(r.billBreakdown).toBeNull()
  })
  it('admin can switch the slab tariff off', () => {
    const s = { ...DEFAULT_CALCULATOR, electricity: { ...E, enabled: false } }
    expect(calculateSolar({ ...base, monthlyBill: 3400 }, s).monthlyUnits).toBe(500)
  })
  it('validation: blank tariff is allowed, bad values are not', () => {
    const v = { ...base, monthlyBill: 2000 }
    expect(validateCalculatorInput(v)).toEqual({})
    expect(validateCalculatorInput({ ...v, tariff: 40 }).tariff).toBeTruthy()
    expect(validateCalculatorInput({ ...v, fppasPercent: 80 }).fppasPercent).toBeTruthy()
  })
})
