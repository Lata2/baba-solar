import type { BrandSettings, CalculatorSettings, SeoSettings, SiteContent } from '@/types'
import { mergeDefaults } from '@/lib/schemas'
import { CHHATTISGARH_RULE, SPECIAL_CATEGORY_STATE_CODES, SUBSIDY_RULES_CHECKED_ON } from '@/lib/subsidy'

/** Defaults for content sections added with the backend (used only if an older data file lacks them). */
export const DEFAULT_CALCULATOR: CalculatorSettings = {
  unitsPerKwPerDay: 4.2, defaultTariff: 6.8, exportTariff: 0, tariffEscalation: 3, panelDegradation: 0.5, co2KgPerUnit: 0.82, sqftPerKw: 90, priceBand: 7, maxKw: 500,
  // CSPDCL LV tariff — CSERC Tariff Schedule FY 2026-27, applicable from 1 July 2026.
  electricity: {
    enabled: true,
    label: 'CSPDCL FY 2026-27',
    domesticEnergy: [{ upToUnits: 100, rate: 4.4 }, { upToUnits: 200, rate: 4.5 }, { upToUnits: 400, rate: 6.0 }, { upToUnits: 600, rate: 7.0 }, { upToUnits: null, rate: 8.8 }],
    domesticFixed: [{ upToKw: 5, perKw: 20 }, { upToKw: 10, perKw: 30 }, { upToKw: null, perKw: 50 }],
    lv21Energy: [{ upToUnits: 100, rate: 6.5 }, { upToUnits: 400, rate: 7.6 }, { upToUnits: null, rate: 9.1 }],
    lv21FixedPerKw: 60,
    lv22SmallEnergy: [{ upToUnits: 400, rate: 7.5 }, { upToUnits: null, rate: 9.0 }],
    lv22SmallDemandPerKw: 130,
    lv22LargeEnergy: [{ upToUnits: null, rate: 8.4 }],
    lv22LargeDemandPerKw: 210,
    fppasPercent: 10,
    dutyDomesticPercent: 11,
    dutyNonDomesticPercent: 17,
    halfBill: { enabled: true, percent: 50, unitsCovered: 200, maxUnits: 400 },
    defaultLoadKw: { domestic: 3, commercial: 5 },
    roundTo: 10,
  },
  costSlabs: [{ upToKw: 2, pricePerKw: 62000 }, { upToKw: 5, pricePerKw: 57000 }, { upToKw: 10, pricePerKw: 53000 }, { upToKw: 50, pricePerKw: 47000 }, { upToKw: null, pricePerKw: 43000 }],
  systemFactor: { 'on-grid': 1, hybrid: 1.45, 'off-grid': 1.6 },
  roofFactor: { rcc: 1, tin: 1.04, ground: 1.08 },
  // PM Surya Ghar CFA (MNRE) + state top-ups. Rates verified on SUBSIDY_RULES_CHECKED_ON; editable in Settings → Calculator.
  subsidy: {
    enabled: true, perKwUpTo2: 30000, perKwThird: 18000, cap: 78000,
    specialCategory: { perKwUpTo2: 33000, perKwThird: 19800, cap: 85800 },
    specialCategoryStates: SPECIAL_CATEGORY_STATE_CODES,
    housingSocietyPerKw: 18000, housingSocietyMaxKw: 500, hybridEligible: true,
    defaultStateCode: '22',
    states: [CHHATTISGARH_RULE],
    verifiedOn: SUBSIDY_RULES_CHECKED_ON,
  },
  disclaimer: '',
}

export const DEFAULT_BRAND: BrandSettings = { logoUrl: '', logoMarkUrl: '', faviconUrl: '', primaryColor: '' }

const page = { title: '', description: '' }
export const DEFAULT_SEO: SeoSettings = {
  siteTitle: '', siteDescription: '', keywords: '', ogImage: '', siteUrl: '', googleSiteVerification: '',
  pages: { home: page, about: page, services: page, pricing: page, calculator: page, projects: page, gallery: page, faqs: page, contact: page, droneCleaning: page, suryaGhar: page },
}

export function withContentDefaults(c: Partial<SiteContent>): SiteContent {
  return mergeDefaults({ brand: DEFAULT_BRAND, seo: DEFAULT_SEO, calculator: DEFAULT_CALCULATOR } as unknown as SiteContent, c)
}
