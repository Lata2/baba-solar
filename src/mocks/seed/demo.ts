import type { Invoice, InvoiceInput, Payment, Quotation } from '@/types'
import type { QuotationSave } from '@/services/api'
import type { MockDb } from '../store'
import { deriveInvoice, deriveQuotation, nextNumber } from '../logic'
import { packageLines, packagePrice } from '@/lib/pricing'
import { addDaysISO, todayISO } from '@/lib/files'

/** Test fixtures used to exercise document PDF rendering and business calculations. */
export function buildDemoDocuments(d: MockDb) {
  const today = todayISO()
  const iso = (days: number) => `${addDaysISO(today, days)}T10:30:00.000Z`
  const ctx = () => ({ business: d.business, calc: d.content.calculator, companies: d.companies })
  const makeQuote = (id: string, input: QuotationSave, created: string, source: 'website' | 'admin' = 'admin'): Quotation => {
    const derived = deriveQuotation(input, ctx())
    return {
      ...input, ...derived, id, source, quoteNumber: nextNumber(d.counters, 'quotation', d.business.quotation.prefix, created.slice(0, 10)),
      validUntil: input.validUntil ?? addDaysISO(created.slice(0, 10), d.business.quotation.validityDays), createdAt: created, updatedAt: created,
    } as Quotation
  }
  const priced = (companyId: string, kw: number, quality: 'normal' | 'premium') => {
    const company = d.companies.find((item) => item.id === companyId)!
    const price = packagePrice(company, kw, quality)!
    return { items: packageLines(company, kw, quality, price.price, d.business.packageBreakdown[quality]), packagePrice: price.price }
  }
  const base = (over: Partial<QuotationSave>): QuotationSave => ({
    status: 'pending', quoteDate: today, validUntil: null, customerName: '', phone: '', email: '', city: 'Raipur', address: '', state: 'Chhattisgarh', gstin: '',
    consumerNumber: '', discom: 'CSPDCL', sanctionedLoadKw: null, propertyType: 'residential', systemType: 'on-grid', roofType: 'rcc', capacityKw: 3, monthlyBill: 2500,
    companyId: null, quality: 'normal', packagePrice: null, items: [], discount: 0, subsidy: null, stateSubsidy: null, annualGenerationKwh: null,
    paymentTerms: d.business.quotation.defaultPaymentTerms, terms: d.business.quotation.defaultTerms, notes: '', ...over,
  })

  const quote = makeQuote('qt-test', base({
    customerName: 'Test Customer', phone: '9131100223', companyId: 'co-waaree', quality: 'premium',
    ...priced('co-waaree', 5, 'premium'),
  }), iso(-2))
  d.quotations = [quote]

  const invoiceInput: InvoiceInput = {
    documentTitle: 'Tax Invoice', reference: quote.quoteNumber ?? '', invoiceDate: today, dueDate: null, template: 'classic',
    status: 'issued', quotationId: quote.id, customerName: quote.customerName, phone: quote.phone, email: '',
    address: '', city: 'Raipur', state: 'Chhattisgarh', stateCode: '22', gstin: '', items: quote.items ?? [],
    discountType: 'amount', discountValue: 0, paymentMethod: '', notes: d.business.invoice.defaultNotes, terms: '', initialPayment: null,
  }
  const payments: Payment[] = []
  const derived = deriveInvoice(invoiceInput, payments, d.business)
  const { initialPayment: _initialPayment, ...invoiceFields } = invoiceInput
  const invoice: Invoice = {
    ...invoiceFields, ...derived, id: 'inv-test', payments,
    invoiceNumber: nextNumber(d.counters, 'invoice', d.business.invoice.prefix, today),
    dueDate: addDaysISO(today, d.business.invoice.defaultDueDays),
    terms: d.business.invoice.defaultTerms, paymentMethod: '', isOverdue: false,
    createdAt: iso(-1), updatedAt: iso(-1),
  }
  d.invoices = [invoice]
}
