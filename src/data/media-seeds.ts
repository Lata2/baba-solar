import type { GalleryImage, HeroSlide } from '@/types'
import { img } from './media'

export const seedHeroSlides: HeroSlide[] = [
  {
    id: 'slide-drone', kicker: 'New: drone solar panel cleaning',
    title: 'Drone cleaning for big rooftops and solar plants',
    subtitle: 'Faster, safer cleaning for hard-to-reach arrays, with before/after photos and generation readings.',
    imageUrl: img('aerialRows', 2000), ctaLabel: 'Book drone cleaning', ctaLink: '/drone-cleaning', status: 'published', order: 1,
  },
  {
    id: 'slide-1', kicker: 'Accelerating the clean energy transition',
    title: 'Rooftop solar for every home and business in Chhattisgarh',
    subtitle: 'Design, installation, net metering and PM Surya Ghar subsidy support, handled end to end by our Raipur team.',
    imageUrl: img('houseWithSolar', 2000), ctaLabel: 'Book a free site survey', ctaLink: '/contact', status: 'published', order: 2,
  },
  {
    id: 'slide-2', kicker: '6-month free service plan',
    title: 'Six months of free cleaning & care with every new installation',
    subtitle: 'Free panel cleaning, performance checks and after-sales support for your first six months.',
    imageUrl: img('cleaningBrush', 2000), ctaLabel: 'See the 6-month plan', ctaLink: '/pricing#maintenance', status: 'published', order: 3,
  },
  {
    id: 'slide-3', kicker: 'Commercial & industrial power plants',
    title: 'Cut operating costs for offices, schools and factories',
    subtitle: 'High-capacity rooftop plants from 10 kW upward, engineered for safety and a 25-year life.',
    imageUrl: img('commercialRoofIndia', 2000), ctaLabel: 'View our power plants', ctaLink: '/projects', status: 'published', order: 5,
  },
  {
    id: 'slide-4', kicker: 'PM Surya Ghar · scheme period till 31 March 2027',
    title: 'Get up to ₹78,000 subsidy on your home solar system',
    subtitle: 'PM Surya Ghar: Muft Bijli Yojana. We help with the portal, net metering and subsidy follow-up.',
    imageUrl: img('monoPanels', 2000), ctaLabel: 'Check eligibility & apply', ctaLink: '/pm-surya-ghar', status: 'published', order: 4,
  },
]

export const seedGallery: GalleryImage[] = [
  { id: 'g1', imageUrl: img('installerOnRoof', 1200), caption: 'Panel mounting on a residential roof', category: 'installation', status: 'published', order: 1 },
  { id: 'g2', imageUrl: img('houseWithSolar', 1200), caption: 'Rooftop system on a family home', category: 'residential', status: 'published', order: 2 },
  { id: 'g3', imageUrl: img('commercialRoofIndia', 1200), caption: 'Commercial rooftop plant', category: 'commercial', status: 'published', order: 3 },
  { id: 'g4', imageUrl: img('cleaningBrush', 1200), caption: 'Panel cleaning under the 6-month free care plan', category: 'cleaning', status: 'published', order: 4 },
  { id: 'g5', imageUrl: img('crewOnRoof', 1200), caption: 'Our installation crew at work', category: 'installation', status: 'published', order: 5 },
  { id: 'g6', imageUrl: img('roofRows', 1200), caption: 'Multi-row array on a flat roof', category: 'commercial', status: 'published', order: 6 },
  { id: 'g7', imageUrl: img('monoPanels', 1200), caption: 'Monocrystalline panels, close up', category: 'residential', status: 'published', order: 7 },
  { id: 'g8', imageUrl: img('carryingPanel', 1200), caption: 'Carrying panels up for installation', category: 'installation', status: 'published', order: 8 },
  { id: 'g9', imageUrl: img('rooftopInstalled', 1200), caption: 'Finished rooftop installation', category: 'residential', status: 'published', order: 9 },
  { id: 'g10', imageUrl: img('manOnRoof', 1200), caption: 'Post-installation inspection', category: 'cleaning', status: 'published', order: 10 },
  { id: 'g11', imageUrl: img('aerialRows', 1200), caption: 'Ground-mounted plant, aerial view', category: 'commercial', status: 'published', order: 11 },
  { id: 'g12', imageUrl: img('holdingPanel', 1200), caption: 'New panels ready to fit', category: 'installation', status: 'published', order: 12 },
]
