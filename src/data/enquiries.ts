import type { Enquiry, Quotation } from '@/types'

export const seedEnquiries: Enquiry[] = [
  { id: 'enq-1', name: 'Sunita Patel', phone: '9827012345', email: 'sunita.p@example.com', city: 'Raipur', service: 'Home rooftop installation',
    message: 'We have a 1,200 sq ft terrace. Bill is around ₹2,800. Please call after 5 pm.', source: 'contact', status: 'new', createdAt: '2026-10-13T11:20:00.000Z' },
  { id: 'enq-2', name: 'Amit Choudhary', phone: '9893054321', email: 'amit.c@example.com', city: 'Durg', service: 'Panel cleaning',
    message: '5 kW system, not cleaned in 6 months. Need a visit this week.', source: 'service', status: 'contacted', createdAt: '2026-10-10T08:05:00.000Z' },
  { id: 'enq-3', name: 'Rohit Sahu', phone: '9755011122', email: '', city: 'Bhilai', service: 'Repair and inverter service',
    message: 'Inverter shows "Grid fault" every afternoon.', source: 'contact', status: 'closed', createdAt: '2026-10-02T14:40:00.000Z' },
]

export const seedQuotations: Quotation[] = [
  { id: 'qt-1', customerName: 'Kavita Dewangan', phone: '9406012345', email: 'kavita.d@example.com', city: 'Raipur', propertyType: 'residential',
    systemType: 'on-grid', capacityKw: 3, monthlyBill: 2600, estimatedCost: 174000, subsidy: 78000, netCost: 96000, status: 'pending', notes: '', createdAt: '2026-10-12T09:30:00.000Z' },
  { id: 'qt-2', customerName: 'Sai Traders', phone: '9425098765', email: 'accounts@saitraders.example', city: 'Nava Raipur', propertyType: 'commercial',
    systemType: 'on-grid', capacityKw: 15, monthlyBill: 14000, estimatedCost: 720000, subsidy: 0, netCost: 720000, status: 'sent', notes: 'Sent revised quote with bifacial panels.', createdAt: '2026-10-06T16:10:00.000Z' },
]
