import type {
  AdminUser, CollectionKey, Company, CompanySnapshot, Database, Enquiry, InvoiceTemplate, LineItem, Permission, PublicCollectionKey, Quotation, SiteContent,
} from '@/types'
import { mockApi } from '@/mocks/mockApi'
import { localAuthApi } from './localAuth'

export { ApiError } from './errors'

/**
 * SERVICE LAYER — every read and write in the app goes through `api`.
 * ─────────────────────────────────────────────────────────────────────────
 * Today every method is implemented in the browser (src/mocks/mockApi.ts over IndexedDB) and
 * the admin sign-in is a frontend-only check (src/services/localAuth.ts). To add a backend,
 * implement the same methods over HTTP and swap them in here — pages and hooks don't change.
 */
/** Website form input. `createdAt` (optional) keeps the same submission time in admin, Sheet, email and WhatsApp. */
export type EnquiryInput = Omit<Enquiry, 'id' | 'status' | 'createdAt'> & { createdAt?: string }
/** Admin create/edit of an enquiry (manual, WhatsApp, phone, other external). */
export type EnquirySave = Omit<Enquiry, 'createdAt'> & { createdAt?: string }
export interface EnquiryImportResult { imported: number; failed: Array<{ row: number; errors: string[] }>; ids: string[] }
/** Website calculator "Request this quote": saved as an enquiry with the estimate attached. */
export type QuotationRequestInput = Pick<Quotation, 'customerName' | 'phone' | 'email' | 'city' | 'propertyType' | 'systemType' | 'capacityKw' | 'monthlyBill'>
  & { roofType?: Quotation['roofType']; tariff?: number; companyId?: string | null; quality?: Quotation['quality']; stateCode?: string; discomId?: string; monthlyUnits?: number; tariffVerified?: boolean; submissionId?: string; createdAt?: string }
/** Kept for older imports. */
export type QuotationInput = QuotationRequestInput

export const PUBLIC_COLLECTION_KEYS: PublicCollectionKey[] = ['pricingPlans', 'capacityPlans', 'services', 'projects', 'testimonials', 'faqs', 'heroSlides', 'gallery']
export const ADMIN_COLLECTION_KEYS: CollectionKey[] = ['enquiries', 'proposals', 'quotations']
export const COLLECTION_KEYS: CollectionKey[] = [...PUBLIC_COLLECTION_KEYS, ...ADMIN_COLLECTION_KEYS]

export type PublicSite = { version: string; content: SiteContent; companies: Company[] } & Pick<Database, PublicCollectionKey>
export interface DataSnapshot { schemaVersion: number; exportedAt: string; data: Record<string, unknown> }
export interface AuthProfile { user: AdminUser; permissions: Permission[] }
export interface UploadResult { url: string; path: string; mime: string; size: number }
export interface PricedPackage { company: CompanySnapshot; items: LineItem[]; price: number; exact: boolean; basis: string; panelCount: number }

export type QuotationSave = Omit<Quotation, 'id' | 'createdAt' | 'updatedAt' | 'quoteNumber' | 'source' | 'company' | 'subtotal' | 'taxableAmount' | 'cgst' | 'sgst' | 'igst' | 'taxTotal' | 'roundOff' | 'grandTotal' | 'taxBreakup' | 'estimatedCost' | 'netCost' | 'supplyType' | 'subsidy' | 'stateSubsidy' | 'annualGenerationKwh' | 'discount' | 'items' | 'quoteDate' | 'validUntil'> & {
  /** null = calculate from the subsidy rules */
  subsidy: number | null
  stateSubsidy: number | null
  annualGenerationKwh: number | null
  discount: number
  items: LineItem[]
  quoteDate: string
  validUntil: string | null
}

export interface InvoiceQuery {
  q?: string
  status?: 'draft' | 'issued' | 'cancelled'
  paymentStatus?: 'unpaid' | 'partial' | 'paid' | 'overdue'
  from?: string
  to?: string
  page?: number
  pageSize?: number
  sort?: 'date_desc' | 'date_asc' | 'amount_desc' | 'amount_asc' | 'due_asc'
}

export type PdfTemplate = InvoiceTemplate

export const api = { ...mockApi, ...localAuthApi }
export type Api = typeof api

export function publishedVersion() { return api.publishedVersion() }

/** Build-time prerender: a complete Database from the seed (leads are never public). */
export async function databaseFromSnapshot(data: Partial<Database>): Promise<Database> {
  const { withContentDefaults } = await import('@/data/settings-defaults')
  return { enquiries: [], proposals: [], quotations: [], ...data, content: withContentDefaults(data.content ?? {}) } as Database
}
