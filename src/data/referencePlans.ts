import type { CapacityPlan } from '@/types'

/**
 * Solar plans by capacity, as published on the reference site's "Our Services" page
 * (https://salikgreenrenubleenergy.com/our-services/, checked Oct 2026).
 *
 * Previously hard-coded in the ReferencePlans component; now seed data for the
 * `capacityPlans` collection, editable in Admin → Pricing → Capacity plans.
 * The reference site publishes NO system prices, so every card says "Price on site survey".
 */
export const REFERENCE_PLANS_SOURCE = 'https://salikgreenrenubleenergy.com/our-services/'

const now = '2026-10-01T10:00:00.000Z'
const PRICE_NOTE = 'Price: on free site survey'

export const seedCapacityPlans: CapacityPlan[] = [
  {
    id: 'ref-3kw', segment: 'residential', name: '3 kW Solar System', subtitle: 'Small family / 2–3 BHK home', capacity: '3 kW',
    specs: [
      { label: 'Generation', value: 'Approx. 12–15 units/day (360–450 units/month)' },
      { label: 'Roof area', value: 'Approx. 300 sq ft, shadow-free' },
      { label: 'Monthly savings', value: '₹2,500 – ₹4,000' },
      { label: 'Ideal for', value: 'Homes using 300–400 units a month' },
    ],
    features: [], featured: true, badge: 'For 2–3 BHK homes', priceNote: PRICE_NOTE, ctaLabel: 'Get price',
    status: 'published', order: 1, updatedAt: now,
  },
  {
    id: 'ref-5kw', segment: 'residential', name: '5 kW Solar System', subtitle: 'Medium family / large house', capacity: '5 kW',
    specs: [
      { label: 'Generation', value: 'Approx. 20–22 units/day (600–650 units/month)' },
      { label: 'Roof area', value: 'Approx. 500 sq ft' },
      { label: 'Monthly savings', value: '₹4,500 – ₹6,500' },
      { label: 'Ideal for', value: 'Homes running ACs, refrigerators, water pumps and heavy appliances' },
    ],
    features: [], featured: false, badge: '', priceNote: PRICE_NOTE, ctaLabel: 'Get price',
    status: 'published', order: 2, updatedAt: now,
  },
  {
    id: 'ref-10kw', segment: 'residential', name: '10 kW Solar System', subtitle: 'Large independent house / joint family', capacity: '10 kW',
    specs: [
      { label: 'Generation', value: 'Approx. 40–45 units/day (1,200+ units/month)' },
      { label: 'Roof area', value: 'Approx. 1,000 sq ft' },
      { label: 'Monthly savings', value: '₹9,000 – ₹12,000+' },
      { label: 'Ideal for', value: 'Large bungalows or joint families' },
    ],
    features: [], featured: false, badge: '', priceNote: PRICE_NOTE, ctaLabel: 'Get price',
    status: 'published', order: 3, updatedAt: now,
  },
  {
    id: 'ref-commercial', segment: 'commercial', name: 'Commercial Solar System', subtitle: 'Offices, shops & showrooms', capacity: '10 kW – 50 kW',
    specs: [
      { label: 'Sizing', value: 'Customisable as per load' },
      { label: 'Generation', value: 'About 4 units per kW per day' },
      { label: 'Payback', value: 'Cost recovered within 3 to 4 years' },
    ],
    features: ['Depreciation benefits', 'Lower commercial tariff rates', 'Uninterrupted daytime power supply'],
    featured: false, badge: '', priceNote: PRICE_NOTE, ctaLabel: 'Get price',
    status: 'published', order: 4, updatedAt: now,
  },
  {
    id: 'ref-industrial', segment: 'industrial', name: 'Industrial Solar Power Plant', subtitle: 'Factories & warehouses', capacity: '50 kW – 500 kW+',
    specs: [{ label: 'Capacity range', value: '50 kW to 500 kW+' }],
    features: [
      'Wind- and weather-resistant structural mounting',
      'Large reduction in monthly overhead electricity cost',
      'High-capacity inverter with professional grid synchronisation',
    ],
    featured: false, badge: '', priceNote: PRICE_NOTE, ctaLabel: 'Get price',
    status: 'published', order: 5, updatedAt: now,
  },
]
