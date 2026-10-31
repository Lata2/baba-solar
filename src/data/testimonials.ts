import type { Testimonial } from '@/types'

export const seedTestimonials: Testimonial[] = [
  { id: 't1', name: 'Rajesh Sharma', location: 'Deopuri, Raipur', system: '3 kW home', rating: 5,
    quote: 'They explained the subsidy properly and filed everything themselves. Our bill in summer was under ₹300.' },
  { id: 't2', name: 'Anita Verma', location: 'Bhilai', system: '5 kW home', rating: 5,
    quote: 'The team noticed our water tank would shade the panels and changed the layout. Small detail, big difference.' },
  { id: 't3', name: 'Mukesh Agrawal', location: 'Dhamtari', system: '50 kW rice mill', rating: 5,
    quote: 'Work finished on time and they planned around our milling hours. Monthly generation reports are useful.' },
  { id: 't4', name: 'Dr. Priya Nair', location: 'Shankar Nagar', system: '10 kW hybrid', rating: 4,
    quote: 'Backup has been reliable during outages. Response on a minor inverter alert was quick.' },
  { id: 't5', name: 'Society committee', location: 'Ashoka Heights, Durg', system: 'AMC, 40 kW', rating: 5,
    quote: 'Generation went up visibly after their first cleaning. The visit reports are clear and honest.' },
]
