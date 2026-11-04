import { describe, expect, it } from 'vitest'
import { seedCompanies } from '@/mocks/seed/companies'
import { DEFAULT_BREAKDOWN, breakdownTotal, packageLines, packagePrice, panelCount } from '@/lib/pricing'
import { computeTotals } from '@/lib/totals'

/** The client's price list, verbatim. */
const PRICE_LIST: Record<string, Record<number, [number, number]>> = {
  'co-waaree': { 3: [160000, 210000], 5: [260000, 330000], 8: [480000, 550000], 10: [580000, 730000] },
  'co-adani': { 3: [170000, 220000], 5: [270000, 350000], 8: [490000, 570000], 10: [590000, 740000] },
  'co-tata': { 3: [170000, 220000], 5: [270000, 350000], 8: [490000, 570000], 10: [590000, 740000] },
}

describe('company-wise package prices', () => {
  for (const [id, sizes] of Object.entries(PRICE_LIST)) {
    const c = seedCompanies.find((x) => x.id === id)!
    for (const [kw, [normal, premium]] of Object.entries(sizes)) {
      it(`${c.name} ${kw} kW → Normal ₹${normal}, Premium ₹${premium}`, () => {
        expect(packagePrice(c, Number(kw), 'normal')).toMatchObject({ price: normal, exact: true })
        expect(packagePrice(c, Number(kw), 'premium')).toMatchObject({ price: premium, exact: true })
      })
    }
  }

  it('interpolates between packages and extrapolates per kW outside', () => {
    const w = seedCompanies[0]
    expect(packagePrice(w, 4, 'normal')).toMatchObject({ price: 210000, exact: false }) // half-way 3 → 5
    expect(packagePrice(w, 6.5, 'premium')!.price).toBe(440000) // half-way 5 → 8
    expect(packagePrice(w, 2, 'normal')!.price).toBe(107000) // 160000/3 × 2, nearest ₹1000
    expect(packagePrice(w, 15, 'normal')!.price).toBe(870000) // 58000 per kW
    expect(packagePrice(w, 0, 'normal')).toBeNull()
  })

  it('breakdown shares total 100 %', () => {
    expect(breakdownTotal(DEFAULT_BREAKDOWN.normal)).toBe(100)
    expect(breakdownTotal(DEFAULT_BREAKDOWN.premium)).toBe(100)
  })

  it('itemised quotation lines add up to the package price exactly (GST included)', () => {
    for (const c of seedCompanies) for (const p of c.packages) for (const q of ['normal', 'premium'] as const) {
      for (const supplyType of ['intra', 'inter'] as const) {
        const lines = packageLines(c, p.capacityKw, q, p[q], DEFAULT_BREAKDOWN[q], supplyType)
        const t = computeTotals(lines, { supplyType, roundOff: true })
        expect(t.grandTotal, `${c.name} ${p.capacityKw} ${q} ${supplyType}`).toBe(p[q])
        expect(Math.abs(t.roundOff)).toBeLessThanOrEqual(0.01)
      }
    }
  })

  it('module line uses the quality panel wattage and count', () => {
    const w = seedCompanies[0]
    expect(panelCount(5, 540)).toBe(10)
    expect(panelCount(3, 580)).toBe(6)
    const lines = packageLines(w, 5, 'premium', 330000, DEFAULT_BREAKDOWN.premium)
    expect(lines[0]).toMatchObject({ quantity: 9, unit: 'NOS', gstRate: 5 })
    expect(lines[0].name).toContain('580 Wp')
  })
})
