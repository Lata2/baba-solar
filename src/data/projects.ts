import type { Project } from '@/types'
import { img } from './media'

export const seedProjects: Project[] = [
  { id: 'prj-1', title: 'Sharma residence', location: 'Deopuri, Raipur', category: 'residential', capacityKw: 3, completedOn: '2026-08',
    summary: 'Elevated structure over a terrace garden so the family keeps using the space below.', highlights: ['Bill cut from ₹3,100 to ₹290', 'Subsidy credited in 34 days'], imageUrl: img('monoPanels', 1200), featured: true, status: 'published' },
  { id: 'prj-2', title: 'Shri Ganesh Rice Mill', location: 'Dhamtari', category: 'industrial', capacityKw: 50, completedOn: '2026-05',
    summary: 'Tin-shed mounting with walkways for safe cleaning across a large mill roof.', highlights: ['~6,200 units a month', 'Payback in about 4 years'], imageUrl: img('groundMounted', 1200), featured: true, status: 'published' },
  { id: 'prj-3', title: 'Green Valley Public School', location: 'Nava Raipur', category: 'commercial', capacityKw: 25, completedOn: '2026-03',
    summary: 'Installed over the summer break with a generation display in the school lobby.', highlights: ['Covers ~80% of daytime load', 'Live monitoring for staff'], imageUrl: img('commercialRoofIndia', 1200), featured: true, status: 'published' },
  { id: 'prj-4', title: 'Verma duplex', location: 'Bhilai', category: 'residential', capacityKw: 5, completedOn: '2026-01',
    summary: 'Split arrays on two roof levels to avoid a water tank shadow.', highlights: ['Wi-Fi monitoring', 'Net meter in 3 weeks'], imageUrl: img('houseWithSolar', 1200), featured: false, status: 'published' },
  { id: 'prj-5', title: 'City Care Clinic', location: 'Shankar Nagar, Raipur', category: 'commercial', capacityKw: 10, completedOn: '2025-11',
    summary: 'Hybrid system that keeps the clinic\'s essential equipment running during outages.', highlights: ['4 hours of backup', 'Zero downtime install'], imageUrl: img('roofRows', 1200), featured: false, status: 'published' },
  { id: 'prj-6', title: 'AMC – Ashoka Heights society', location: 'Durg', category: 'maintenance', capacityKw: 40, completedOn: '2026-09',
    summary: 'Monthly cleaning and quarterly inspection for a 40 kW common-area system.', highlights: ['Generation up 18% after first wash', 'Found and fixed two hot spots'], imageUrl: img('technicianWorking', 1200), featured: false, status: 'published' },
  { id: 'prj-7', title: 'Patel farmhouse', location: 'Mahasamund', category: 'residential', capacityKw: 7.5, completedOn: '2025-09',
    summary: 'Off-grid system with battery bank for a farmhouse with no reliable grid supply.', highlights: ['Runs a 1 HP pump', 'No diesel generator needed'], imageUrl: img('panelBlueSky', 1200), featured: false, status: 'published' },
  { id: 'prj-8', title: 'Inverter repair – Telibandha', location: 'Raipur', category: 'maintenance', capacityKw: 3, completedOn: '2026-07',
    summary: 'Diagnosed an earth-fault trip on a system installed by another vendor and restored generation.', highlights: ['Fixed in one visit'], imageUrl: img('manOnRoof', 1200), featured: false, status: 'draft' },
]
