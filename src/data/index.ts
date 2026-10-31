import type { Database } from '@/types'
import { seedContent } from './content'
import { seedPricingPlans } from './pricing'
import { seedCapacityPlans } from './referencePlans'
import { seedServices } from './services'
import { seedProjects } from './projects'
import { seedTestimonials } from './testimonials'
import { seedFaqs } from './faqs'
import { seedEnquiries, seedQuotations } from './enquiries'
import { seedGallery, seedHeroSlides } from './media-seeds'

/** Fresh copy of the bundled site seed data. */
export function createSeedDatabase(): Database {
  return structuredClone({
    pricingPlans: seedPricingPlans,
    capacityPlans: seedCapacityPlans,
    services: seedServices,
    projects: seedProjects,
    testimonials: seedTestimonials,
    faqs: seedFaqs,
    heroSlides: seedHeroSlides,
    gallery: seedGallery,
    enquiries: seedEnquiries,
    quotations: seedQuotations,
    content: seedContent,
  })
}
