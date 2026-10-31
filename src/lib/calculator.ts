import type { CalculatorSettings, PropertyType, RoofType, SystemType } from '@/types'
import { DEFAULT_CALCULATOR } from '@/data/settings-defaults'
import { computeBill, unitsFromBill, type BillBreakdown, type BillOptions } from '@/lib/electricityBill'
import { centralAmount, centralEligible, computeSubsidy, type SubsidyResult } from '@/lib/subsidy'

/**
 * Solar estimate logic (pure functions). The assumptions come from the admin panel
 * (Settings → Calculator), and the server runs the SAME formula (backend
 * src/lib/calculator.ts) when a quote request arrives — keep both files in sync.
 */
export const CALC_ASSUMPTIONS = DEFAULT_CALCULATOR

export interface CalculatorInput {
  mode?: 'bill' | 'units'
  monthlyBill: number
  monthlyUnits?: number | null
  fixedCharges?: number | null
  /** Custom flat ₹/unit. 0 / empty → CSPDCL slab tariff from settings (recommended). */
  tariff: number
  /** FPPAS % printed on the bill. Empty → settings default. */
  fppasPercent?: number | null
  propertyType: PropertyType
  systemType: SystemType
  roofType: RoofType
  capacityOverride?: number | null
  sanctionedLoadKw?: number | null
  roofAreaSqft?: number | null
  /** Exact system price (e.g. a company package price) instead of the per-kW estimate. */
  costOverride?: number | null
  /** GST state code of the site (state subsidy). Empty → settings default (Chhattisgarh). */
  stateCode?: string | null
}

export interface CalculatorResult {
  monthlyUnits: number
  recommendedKw: number
  capacityKw: number
  costMin: number
  costMax: number
  costMid: number
  /** Central subsidy (PM Surya Ghar CFA). */
  subsidy: number
  /** State subsidy (e.g. Chhattisgarh). */
  stateSubsidy: number
  /** Full subsidy breakdown (schemes, eligibility notes). */
  subsidyDetail: SubsidyResult
  /** System cost − central − state subsidy. */
  netCost: number
  annualUnits: number
  monthlyGeneration: number
  annualSavings: number
  monthlySavings: number
  newMonthlyBill: number
  paybackYears: number
  lifetimeSavings: number
  roi25: number
  co2TonnesPerYear: number
  roofAreaSqft: number
  maxKwForRoof: number | null
  /** Cumulative savings at the end of each year (25 values) for the chart. */
  cumulative: number[]
  warnings: string[]
  /** Current monthly bill (₹): the amount entered, or worked out from the units. */
  billNow: number
  /** Average ₹ per unit of the current bill. */
  effectiveTariff: number
  /** CSPDCL bill breakdown now and with solar (null when a custom flat tariff is used). */
  billBreakdown: BillBreakdown | null
  billWithSolar: BillBreakdown | null
}

const roundToHalf = (n: number) => Math.round(n * 2) / 2
const floorToHalf = (n: number) => Math.floor(n * 2) / 2

export function costPerKw(kw: number, s: CalculatorSettings = DEFAULT_CALCULATOR): number {
  for (const slab of s.costSlabs) if (slab.upToKw === null || kw <= slab.upToKw) return slab.pricePerKw
  return s.costSlabs[s.costSlabs.length - 1].pricePerKw
}

export function subsidyEligible(propertyType: PropertyType, systemType: SystemType, s: CalculatorSettings = DEFAULT_CALCULATOR): boolean {
  return centralEligible(propertyType, systemType, s.subsidy)
}

/** Central PM Surya Ghar CFA only (see src/lib/subsidy.ts for central + state). */
export function estimateSubsidy(kw: number, propertyType: PropertyType, systemType: SystemType, s: CalculatorSettings = DEFAULT_CALCULATOR, stateCode?: string | null): number {
  return centralAmount(kw, propertyType, systemType, s.subsidy, stateCode)
}

export function calculateSolar(input: CalculatorInput, s: CalculatorSettings = DEFAULT_CALCULATOR): CalculatorResult {
  const warnings: string[] = []
  const e = s.electricity
  // Slab tariff (CSPDCL) unless the visitor typed their own flat ₹/unit or the admin switched it off.
  const flat = !e?.enabled || input.tariff > 0
  const tariff = input.tariff > 0 ? input.tariff : s.defaultTariff
  const fixedInput = input.fixedCharges != null && input.fixedCharges > 0 ? input.fixedCharges : null
  const fixed = fixedInput ?? 0
  const billOpts: BillOptions = {
    propertyType: input.propertyType,
    loadKw: input.sanctionedLoadKw,
    fppasPercent: input.fppasPercent,
    fixedChargesOverride: fixedInput,
  }
  /** Exact (unrounded) monthly bill for a consumption. */
  const billOf = (u: number) => (flat ? u * tariff + fixed : computeBill(u, billOpts, e).total)
  const monthlyUnits = input.mode === 'units'
    ? Math.max(0, input.monthlyUnits ?? 0)
    : flat
      ? Math.max(0, (Math.max(0, input.monthlyBill) - fixed) / tariff)
      : unitsFromBill(Math.max(0, input.monthlyBill), billOpts, e)

  const maxKwForRoof = input.roofAreaSqft && input.roofAreaSqft > 0 ? floorToHalf(input.roofAreaSqft / s.sqftPerKw) : null
  let recommendedKw = Math.min(s.maxKw, Math.max(1, roundToHalf(monthlyUnits / (s.unitsPerKwPerDay * 30))))
  if (input.sanctionedLoadKw && input.sanctionedLoadKw > 0 && input.propertyType !== 'commercial' && recommendedKw > input.sanctionedLoadKw) {
    recommendedKw = Math.max(1, floorToHalf(input.sanctionedLoadKw))
    warnings.push(`Size limited to your sanctioned load of ${input.sanctionedLoadKw} kW. Apply to the DISCOM for a load increase to install more.`)
  }
  if (maxKwForRoof !== null && maxKwForRoof >= 1 && recommendedKw > maxKwForRoof) {
    recommendedKw = maxKwForRoof
    warnings.push(`Your roof space fits about ${maxKwForRoof} kW.`)
  }
  const capacityKw = Math.min(s.maxKw, input.capacityOverride && input.capacityOverride > 0 ? input.capacityOverride : recommendedKw)
  if (maxKwForRoof !== null && capacityKw > maxKwForRoof) warnings.push(`${capacityKw} kW needs about ${Math.round(capacityKw * s.sqftPerKw)} sq ft of shadow-free roof; you entered ${input.roofAreaSqft} sq ft.`)
  if (input.sanctionedLoadKw && capacityKw > input.sanctionedLoadKw && input.propertyType !== 'commercial' && input.capacityOverride) {
    warnings.push(`${capacityKw} kW is above your sanctioned load (${input.sanctionedLoadKw} kW); a load increase may be required.`)
  }

  const exact = !!(input.costOverride && input.costOverride > 0)
  const costMid = exact ? input.costOverride! : capacityKw * costPerKw(capacityKw, s) * s.systemFactor[input.systemType] * s.roofFactor[input.roofType]
  const band = exact ? 0 : s.priceBand / 100
  const costMin = exact ? Math.round(costMid) : Math.round((costMid * (1 - band)) / 1000) * 1000
  const costMax = exact ? Math.round(costMid) : Math.round((costMid * (1 + band)) / 1000) * 1000
  const subsidyDetail = computeSubsidy({ capacityKw, propertyType: input.propertyType, systemType: input.systemType, stateCode: input.stateCode, systemCost: Math.round(costMid) }, s)
  const subsidy = subsidyDetail.central
  const stateSubsidy = subsidyDetail.state
  const netCost = Math.max(0, Math.round(costMid - subsidy - stateSubsidy))

  const annualUnits = capacityKw * s.unitsPerKwPerDay * 365
  const annualConsumption = monthlyUnits * 12
  const billBefore = billOf(monthlyUnits)
  const escalation = s.tariffEscalation / 100
  const degradation = s.panelDegradation / 100

  let lifetimeSavings = 0
  let cumulativeSum = 0
  let paybackYears = 0
  let firstYear = 0
  const cumulative: number[] = []
  for (let year = 0; year < 25; year++) {
    const gen = annualUnits * (1 - degradation) ** year
    const exported = Math.max(0, gen - annualConsumption)
    // Saving = bill without solar − bill on the net units still drawn from the grid (slab-wise,
    // so solar removes the costliest top-slab units first and fixed charges stay).
    const netMonthly = Math.max(0, monthlyUnits - gen / 12)
    const billSaving = Math.max(0, billBefore - billOf(netMonthly)) * 12
    const saving = billSaving * (1 + escalation) ** year + exported * s.exportTariff
    if (year === 0) firstYear = saving
    if (!paybackYears && saving > 0 && cumulativeSum + saving >= netCost) paybackYears = year + (netCost - cumulativeSum) / saving
    cumulativeSum += saving
    lifetimeSavings += saving
    cumulative.push(Math.round(cumulativeSum))
  }
  if (monthlyUnits === 0) warnings.push('Enter your bill or monthly units to estimate savings.')

  const monthlyGeneration = annualUnits / 12
  const netUnits = Math.max(0, monthlyUnits - monthlyGeneration)
  const billBreakdown = flat ? null : computeBill(monthlyUnits, billOpts, e)
  const billWithSolar = flat ? null : computeBill(netUnits, billOpts, e)
  const newMonthlyBill = billWithSolar ? billWithSolar.payable : netUnits * tariff + fixed
  const billNow = input.mode === 'units'
    ? (billBreakdown ? billBreakdown.payable : monthlyUnits * tariff + fixed)
    : Math.max(0, input.monthlyBill)

  return {
    monthlyUnits: Math.round(monthlyUnits),
    recommendedKw,
    capacityKw,
    costMin,
    costMax,
    costMid: Math.round(costMid),
    subsidy,
    stateSubsidy,
    subsidyDetail,
    netCost,
    annualUnits: Math.round(annualUnits),
    monthlyGeneration: Math.round(monthlyGeneration),
    annualSavings: Math.round(firstYear),
    monthlySavings: Math.round(firstYear / 12),
    newMonthlyBill: Math.round(newMonthlyBill),
    paybackYears: Math.round(paybackYears * 10) / 10,
    lifetimeSavings: Math.round(lifetimeSavings),
    roi25: netCost > 0 ? Math.round(((lifetimeSavings - netCost) / netCost) * 100) : 0,
    co2TonnesPerYear: Math.round((annualUnits * s.co2KgPerUnit) / 100) / 10,
    roofAreaSqft: Math.round(capacityKw * s.sqftPerKw),
    maxKwForRoof,
    cumulative,
    warnings,
    billNow: Math.round(billNow),
    effectiveTariff: monthlyUnits > 0 ? Math.round((billNow / monthlyUnits) * 100) / 100 : 0,
    billBreakdown,
    billWithSolar,
  }
}

/** Input limits used by the calculator forms. */
export const CALC_LIMITS = { billMin: 300, billMax: 1_000_000, unitsMax: 200_000, tariffMin: 1, tariffMax: 25, fppasMax: 50 }

export function validateCalculatorInput(i: CalculatorInput): Record<string, string> {
  const e: Record<string, string> = {}
  if (i.mode === 'units') {
    if (!(Number(i.monthlyUnits) > 0)) e.monthlyUnits = 'Enter your monthly units (kWh) from the bill.'
    else if (Number(i.monthlyUnits) > CALC_LIMITS.unitsMax) e.monthlyUnits = 'That is more than we can estimate online — please contact us.'
  } else if (!(i.monthlyBill >= CALC_LIMITS.billMin)) e.monthlyBill = `Enter a monthly bill of at least ₹${CALC_LIMITS.billMin}.`
  else if (i.monthlyBill > CALC_LIMITS.billMax) e.monthlyBill = 'That is more than we can estimate online — please contact us.'
  if (i.tariff && !(i.tariff >= CALC_LIMITS.tariffMin && i.tariff <= CALC_LIMITS.tariffMax)) e.tariff = `Tariff should be between ₹${CALC_LIMITS.tariffMin} and ₹${CALC_LIMITS.tariffMax} per unit.`
  if (i.fppasPercent != null && !(i.fppasPercent >= 0 && i.fppasPercent <= CALC_LIMITS.fppasMax)) e.fppasPercent = `FPPAS should be between 0 and ${CALC_LIMITS.fppasMax}%.`
  if (i.fixedCharges && i.fixedCharges < 0) e.fixedCharges = 'Cannot be negative.'
  if (i.mode !== 'units' && i.fixedCharges && i.fixedCharges >= i.monthlyBill) e.fixedCharges = 'Fixed charges must be less than the bill.'
  if (i.sanctionedLoadKw != null && i.sanctionedLoadKw < 0) e.sanctionedLoadKw = 'Cannot be negative.'
  if (i.roofAreaSqft != null && i.roofAreaSqft < 0) e.roofAreaSqft = 'Cannot be negative.'
  return e
}
