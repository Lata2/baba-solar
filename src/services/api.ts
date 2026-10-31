import type {
  AdminUser, CollectionKey, Company, CompanySnapshot, Database, Enquiry, InvoiceTemplate, LineItem, Permission, PublicCollectionKey, Quotation, SiteContent,
} from '@/types'
import { mockApi } from '@/mocks/mockApi'
import { SERVER_MODE } from '@/config/api'
import { serverAuthApi } from './serverApi'

export { ApiError } from './errors'

/**
 * SERVICE LAYER — every read and write in the app goes through `api`.
 * ─────────────────────────────────────────────────────────────────────────
 * Site content and business-data operations currently use the in-browser data adapter. In
 * server mode, authentication and user management are replaced with the HTTP service. Static
 * mode uses a local-only, unverified cookie gate for preview access; it is not authentication.
 */
export type EnquiryInput = Omit<Enquiry, 'id' | 'status' | 'createdAt'>
export type QuotationRequestInput = Pick<Quotation, 'customerName' | 'phone' | 'email' | 'city' | 'propertyType' | 'systemType' | 'capacityKw' | 'monthlyBill'>
  & { roofType?: Quotation['roofType']; tariff?: number; companyId?: string | null; quality?: Quotation['quality']; stateCode?: string }
/** Kept for older imports. */
export type QuotationInput = QuotationRequestInput

export const PUBLIC_COLLECTION_KEYS: PublicCollectionKey[] = ['pricingPlans', 'capacityPlans', 'services', 'projects', 'testimonials', 'faqs', 'heroSlides', 'gallery']
export const ADMIN_COLLECTION_KEYS: CollectionKey[] = ['enquiries', 'quotations']
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

/**
 * Server mode: login, sessions and users come from the Baba Solars server (secure); everything else
 * keeps using the existing in-browser data layer, now authorised by the server-confirmed role.
 */
export const api: typeof mockApi = SERVER_MODE ? { ...mockApi, ...serverAuthApi } : mockApi
export type Api = typeof mockApi

export function publishedVersion() { return api.publishedVersion() }

/** Build-time prerender: a complete Database from the seed (leads are never public). */
export async function databaseFromSnapshot(data: Partial<Database>): Promise<Database> {
  const { withContentDefaults } = await import('@/data/settings-defaults')
  return { enquiries: [], quotations: [], ...data, content: withContentDefaults(data.content ?? {}) } as Database
}
