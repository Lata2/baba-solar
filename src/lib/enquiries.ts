import type { Enquiry, EnquiryOrigin, EnquirySource, EnquiryStatus, EnquiryType, FieldErrors, PropertyType } from '@/types'

/** Enquiry rules shared by the website forms, the admin panel and the Excel import. Pure functions. */

export const ENQUIRY_STATUSES: Array<{ value: EnquiryStatus; label: string }> = [
  { value: 'new', label: 'New' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'site-visit', label: 'Site visit' },
  { value: 'proposal', label: 'Proposal' },
  { value: 'quoted', label: 'Quoted' },
  { value: 'won', label: 'Won' },
  { value: 'lost', label: 'Lost' },
  { value: 'closed', label: 'Closed' },
]
export const ENQUIRY_STATUS_LABEL = Object.fromEntries(ENQUIRY_STATUSES.map((s) => [s.value, s.label])) as Record<EnquiryStatus, string>

export const ENQUIRY_SOURCES: Array<{ value: EnquirySource; label: string; origin: EnquiryOrigin }> = [
  { value: 'contact', label: 'Website – contact form', origin: 'website' },
  { value: 'calculator', label: 'Website – calculator', origin: 'website' },
  { value: 'pricing', label: 'Website – pricing page', origin: 'website' },
  { value: 'service', label: 'Website – service page', origin: 'website' },
  { value: 'whatsapp', label: 'WhatsApp', origin: 'admin' },
  { value: 'phone', label: 'Phone call', origin: 'admin' },
  { value: 'walk-in', label: 'Walk-in / office', origin: 'admin' },
  { value: 'referral', label: 'Referral', origin: 'admin' },
  { value: 'social', label: 'Social media', origin: 'admin' },
  { value: 'other', label: 'Other external', origin: 'admin' },
  { value: 'manual', label: 'Manual entry', origin: 'admin' },
  { value: 'import', label: 'Excel import', origin: 'import' },
]
export const SOURCE_LABEL = Object.fromEntries(ENQUIRY_SOURCES.map((s) => [s.value, s.label])) as Record<EnquirySource, string>
/** Sources an admin can pick in the manual form. */
export const ADMIN_SOURCES = ENQUIRY_SOURCES.filter((s) => s.origin === 'admin')
export const WEBSITE_SOURCES: EnquirySource[] = ENQUIRY_SOURCES.filter((s) => s.origin === 'website').map((s) => s.value)

export const originOf = (source: EnquirySource): EnquiryOrigin => ENQUIRY_SOURCES.find((s) => s.value === source)?.origin ?? 'admin'

/** 10-digit Indian mobile from any common format (+91, 0-prefix, spaces). Returns '' if not valid. */
export function normalizeMobile(v: unknown): string {
  let d = String(v ?? '').replace(/\D/g, '')
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2)
  else if (d.length === 11 && d.startsWith('0')) d = d.slice(1)
  return /^[6-9]\d{9}$/.test(d) ? d : ''
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
export const isValidEmail = (v: string) => EMAIL.test(v.trim())

export const ENQUIRY_TYPES: Array<{ value: EnquiryType; label: string }> = [
  { value: 'home', label: 'Home' },
  { value: 'commercial', label: 'Commercial' },
]
export const ENQUIRY_TYPE_LABEL: Record<EnquiryType, string> = { home: 'Home', commercial: 'Commercial' }

/** Home / Commercial for any enquiry. Older records (no enquiryType) fall back to their property type. */
export function enquiryTypeOf(e: Pick<Enquiry, 'enquiryType' | 'propertyType'>): EnquiryType | null {
  if (e.enquiryType) return e.enquiryType
  if (e.propertyType === 'residential' || e.propertyType === 'housing-society') return 'home'
  if (e.propertyType === 'commercial' || e.propertyType === 'industrial') return 'commercial'
  return null
}

/** Capacity in kW from the enquiry or the attached calculator estimate (null when unknown). */
export const enquiryKw = (e: Pick<Enquiry, 'capacityKw' | 'estimate'>): number | null => e.capacityKw ?? e.estimate?.capacityKw ?? null
const PROPERTY_TYPES: PropertyType[] = ['residential', 'housing-society', 'commercial', 'industrial']

/** Validation used by the admin form, the import preview and the API. */
export function validateEnquiry(e: Partial<Enquiry>): FieldErrors {
  const out: FieldErrors = {}
  if ((e.name ?? '').trim().length < 2) out.name = 'Enter the customer name.'
  // Mobile OR email is required (website enquiries may come with only an email). A mobile that is filled in must be valid.
  const hasPhone = String(e.phone ?? '').trim() !== ''
  if (hasPhone && !normalizeMobile(e.phone)) out.phone = 'Enter a valid 10-digit Indian mobile number.'
  else if (!hasPhone && !(e.email ?? '').trim()) out.phone = 'Enter a mobile number or an email address.'
  if (e.email && !EMAIL.test(e.email.trim())) out.email = 'Enter a valid email address.'
  if (e.enquiryType && !ENQUIRY_TYPES.some((t) => t.value === e.enquiryType)) out.enquiryType = 'Choose Home or Commercial.'
  if (!(e.service ?? '').trim()) out.service = 'Enter the requirement (what the customer needs).'
  if (e.status && !ENQUIRY_STATUSES.some((s) => s.value === e.status)) out.status = 'Choose a valid status.'
  if (e.source && !ENQUIRY_SOURCES.some((s) => s.value === e.source)) out.source = 'Choose a valid source.'
  if (e.propertyType && !PROPERTY_TYPES.includes(e.propertyType)) out.propertyType = 'Choose a valid property type.'
  if (e.capacityKw != null && !(Number.isFinite(e.capacityKw) && e.capacityKw >= 0 && e.capacityKw <= 100000)) out.capacityKw = 'Capacity must be between 0 and 100,000 kW.'
  if (e.monthlyBill != null && !(Number.isFinite(e.monthlyBill) && e.monthlyBill >= 0)) out.monthlyBill = 'Bill must be 0 or more.'
  if (e.pincode && !/^\d{6}$/.test(e.pincode)) out.pincode = 'PIN code must be 6 digits.'
  if (e.followUpOn && !/^\d{4}-\d{2}-\d{2}$/.test(e.followUpOn)) out.followUpOn = 'Use a valid date.'
  return out
}

const str = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max)

/** Fill fields that older records (schema ≤ 5) don't have and clean values. */
export function normalizeEnquiry(e: Partial<Enquiry> & { id: string }): Enquiry {
  const source = (ENQUIRY_SOURCES.some((s) => s.value === e.source) ? e.source : 'other') as EnquirySource
  const status = (ENQUIRY_STATUSES.some((s) => s.value === e.status) ? e.status : 'new') as EnquiryStatus
  const num = (v: unknown) => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v))
  return {
    id: e.id,
    name: str(e.name, 120),
    phone: normalizeMobile(e.phone) || str(e.phone, 20),
    email: str(e.email, 200),
    city: str(e.city, 120),
    service: str(e.service, 200),
    message: str(e.message, 4000),
    source,
    status,
    createdAt: e.createdAt || new Date().toISOString(),
    origin: e.origin ?? originOf(source),
    address: str(e.address, 300),
    state: str(e.state, 60),
    pincode: str(e.pincode, 6),
    propertyType: e.propertyType && PROPERTY_TYPES.includes(e.propertyType) ? e.propertyType : undefined,
    capacityKw: num(e.capacityKw),
    monthlyBill: num(e.monthlyBill),
    notes: str(e.notes, 4000),
    followUpOn: e.followUpOn || null,
    estimate: e.estimate ?? null,
    updatedAt: e.updatedAt ?? e.createdAt,
    // Integrations release: kept when present; older records simply don't have them.
    ...(e.submissionId ? { submissionId: str(e.submissionId, 64) } : {}),
    ...(e.enquiryType === 'home' || e.enquiryType === 'commercial' ? { enquiryType: e.enquiryType } : {}),
  }
}

export interface DuplicateMatch {
  /** Index of the row in the incoming list */
  index: number
  /** Why it looks like a duplicate */
  reason: string
  existingId?: string
}

/**
 * Possible duplicates: same mobile as an existing enquiry or as an earlier row in the same
 * import, or the same email. Returns one match per incoming row at most.
 */
export function findDuplicates(incoming: Array<Pick<Enquiry, 'phone' | 'email' | 'name'>>, existing: Array<Pick<Enquiry, 'id' | 'phone' | 'email' | 'name'>>): DuplicateMatch[] {
  const byPhone = new Map<string, Pick<Enquiry, 'id' | 'name'>>()
  const byEmail = new Map<string, Pick<Enquiry, 'id' | 'name'>>()
  for (const e of existing) {
    const p = normalizeMobile(e.phone)
    if (p) byPhone.set(p, e)
    if (e.email) byEmail.set(e.email.trim().toLowerCase(), e)
  }
  const seenPhone = new Map<string, number>()
  const seenEmail = new Map<string, number>()
  const out: DuplicateMatch[] = []
  incoming.forEach((row, index) => {
    const p = normalizeMobile(row.phone)
    const m = (row.email ?? '').trim().toLowerCase()
    const hit = (p && byPhone.get(p)) || (m && byEmail.get(m))
    if (hit) out.push({ index, reason: `Same ${p && byPhone.get(p) ? 'mobile' : 'email'} as existing enquiry from ${hit.name}`, existingId: hit.id })
    else if (p && seenPhone.has(p)) out.push({ index, reason: `Same mobile as row ${seenPhone.get(p)! + 1} in this file` })
    else if (m && seenEmail.has(m)) out.push({ index, reason: `Same email as row ${seenEmail.get(m)! + 1} in this file` })
    if (p && !seenPhone.has(p)) seenPhone.set(p, index)
    if (m && !seenEmail.has(m)) seenEmail.set(m, index)
  })
  return out
}
