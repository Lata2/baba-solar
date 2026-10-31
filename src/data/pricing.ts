import type { PricingPlan } from '@/types'

const now = '2026-10-01T10:00:00.000Z'

/** Estimated prices only. Final quote depends on site survey. */
type SeedPlan = Omit<PricingPlan, 'badge' | 'ctaLabel'> & Partial<Pick<PricingPlan, 'badge' | 'ctaLabel'>>

const plans: SeedPlan[] = [
  {
    id: 'plan-1kw', name: '1 kW Home Starter', category: 'residential', capacityKw: 1,
    priceMin: 60000, priceMax: 70000, subsidy: 30000, priceUnit: '',
    idealFor: 'Small homes with bills up to ₹1,000/month',
    monthlyGeneration: '110–130 units', roofArea: '80–100 sq ft',
    features: ['2 × 550 Wp mono PERC / TOPCon panels', '1 kW on-grid inverter', 'GI mounting structure', 'Net-meter application support'],
    featured: false, status: 'published', order: 1, updatedAt: now,
  },
  {
    id: 'plan-2kw', name: '2 kW Home', category: 'residential', capacityKw: 2,
    priceMin: 115000, priceMax: 130000, subsidy: 60000, priceUnit: '',
    idealFor: 'Bills of ₹1,500–2,000/month',
    monthlyGeneration: '220–260 units', roofArea: '160–200 sq ft',
    features: ['4 × 550 Wp panels', '2 kW on-grid inverter', 'Earthing and lightning arrester', 'Subsidy filing on PM Surya Ghar'],
    featured: false, status: 'published', order: 2, updatedAt: now,
  },
  {
    id: 'plan-3kw', name: '3 kW Family Home', category: 'residential', capacityKw: 3,
    priceMin: 165000, priceMax: 185000, subsidy: 78000, priceUnit: '',
    idealFor: 'Most 2–3 BHK homes, bills of ₹2,000–3,500/month',
    monthlyGeneration: '330–390 units', roofArea: '240–300 sq ft',
    features: ['6 × 550 Wp panels', '3 kW on-grid inverter with Wi-Fi monitoring', 'Elevated structure option', 'Maximum subsidy slab', '6 months free cleaning'],
    featured: true, status: 'published', order: 3, updatedAt: now,
  },
  {
    id: 'plan-5kw', name: '5 kW Large Home', category: 'residential', capacityKw: 5,
    priceMin: 270000, priceMax: 300000, subsidy: 78000, priceUnit: '',
    idealFor: 'Larger homes with ACs, bills of ₹4,000–6,000/month',
    monthlyGeneration: '550–650 units', roofArea: '400–500 sq ft',
    features: ['9–10 × 550 Wp panels', '5 kW on-grid inverter', 'Wi-Fi app monitoring', 'Net metering and DISCOM liaison'],
    featured: false, status: 'published', order: 4, updatedAt: now,
  },
  {
    id: 'plan-10kw', name: '10 kW Villa / Shop', category: 'commercial', capacityKw: 10,
    priceMin: 520000, priceMax: 580000, subsidy: 0, priceUnit: '',
    idealFor: 'Showrooms, clinics, villas and small offices',
    monthlyGeneration: '1,100–1,300 units', roofArea: '800–1,000 sq ft',
    features: ['18–19 × 550 Wp panels', '10 kW three-phase inverter', 'Generation reports', 'Accelerated depreciation guidance'],
    featured: false, status: 'published', order: 5, updatedAt: now,
  },
  {
    id: 'plan-25kw', name: '25 kW Commercial', category: 'commercial', capacityKw: 25,
    priceMin: 1150000, priceMax: 1300000, subsidy: 0, priceUnit: '',
    idealFor: 'Schools, hospitals, small factories',
    monthlyGeneration: '2,800–3,200 units', roofArea: '2,000–2,500 sq ft',
    features: ['Tier-1 bifacial panels', 'String inverters with remote monitoring', 'Structural load check', 'Annual performance report'],
    featured: false, status: 'published', order: 6, updatedAt: now,
  },
  {
    id: 'plan-six-month-care', name: '6-Month Free Care Plan', category: 'maintenance', capacityKw: null,
    priceMin: 0, priceMax: 0, subsidy: 0, priceUnit: 'with every new installation',
    idealFor: 'Every new Baba Solars installation',
    monthlyGeneration: '', roofArea: '',
    features: ['Free panel cleaning for the first 6 months', 'Performance check', 'Prompt after-sales support', 'Upgrade to AMC or drone cleaning after 6 months'],
    featured: true, status: 'published', order: 7, updatedAt: now,
  },
  {
    id: 'plan-clean', name: 'One-time cleaning', category: 'maintenance', capacityKw: null,
    priceMin: 499, priceMax: 999, subsidy: 0, priceUnit: 'per visit',
    idealFor: 'Systems up to 5 kW',
    monthlyGeneration: '', roofArea: '',
    features: ['Soft-brush wash with low-TDS water', 'Visual check of panels and wiring', 'Before / after generation reading'],
    featured: false, status: 'published', order: 8, updatedAt: now,
  },
  {
    id: 'plan-amc-basic', name: 'AMC Basic', category: 'maintenance', capacityKw: null,
    priceMin: 2999, priceMax: 4499, subsidy: 0, priceUnit: 'per year',
    idealFor: 'Homes up to 5 kW',
    monthlyGeneration: '', roofArea: '',
    features: ['4 cleanings a year', '1 electrical health check', 'Inverter error diagnosis', 'Phone support'],
    featured: false, status: 'published', order: 9, updatedAt: now,
  },
  {
    id: 'plan-amc-plus', name: 'AMC Plus', category: 'maintenance', capacityKw: null,
    priceMin: 5999, priceMax: 7999, subsidy: 0, priceUnit: 'per year',
    idealFor: 'Homes and shops up to 10 kW',
    monthlyGeneration: '', roofArea: '',
    features: ['Monthly cleaning', '2 thermal and electrical inspections', 'Priority repair within 48 hours', 'Labour on repairs included'],
    featured: false, status: 'published', order: 10, updatedAt: now,
  },
  {
    id: 'plan-hybrid-3', name: '3 kW Hybrid with battery', category: 'residential', capacityKw: 3,
    priceMin: 240000, priceMax: 285000, subsidy: 0, priceUnit: '',
    idealFor: 'Homes with frequent power cuts',
    monthlyGeneration: '330–390 units', roofArea: '240–300 sq ft',
    features: ['Hybrid inverter', '5 kWh lithium battery', 'Backup for lights, fans and fridge'],
    featured: false, status: 'draft', order: 11, updatedAt: now,
  },
]

/** Badge / button text left empty = the automatic defaults from Pricing page text. */
export const seedPricingPlans: PricingPlan[] = plans.map((p) => ({ badge: '', ctaLabel: '', ...p }))
