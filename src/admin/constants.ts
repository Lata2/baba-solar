import type { EnquiryStatus, QuotationStatus } from '@/types'
import type { BadgeTone } from '@/components/ui'

export const enquiryTone: Record<EnquiryStatus, BadgeTone> = { new: 'warning', contacted: 'info', closed: 'neutral' }
export const quotationTone: Record<QuotationStatus, BadgeTone> = { pending: 'warning', sent: 'info', accepted: 'success', rejected: 'danger' }
