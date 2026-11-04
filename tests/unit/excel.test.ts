import { describe, expect, it } from 'vitest'
import ExcelJS from 'exceljs'
import { createSeedDb } from '@/mocks/store'
import { quotationXlsx, invoiceXlsx } from '@/excel'
import { deriveInvoice, deriveQuotation } from '@/mocks/logic'
import type { Invoice, InvoiceInput, Quotation } from '@/types'
import type { QuotationSave } from '@/services/api'

async function read(blob: Blob) {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(await blob.arrayBuffer())
  const ws = wb.worksheets[0]
  const cells: Array<string | number> = []
  ws.eachRow((row) => row.eachCell((c) => cells.push(c.value as string | number)))
  return { wb, ws, cells, text: cells.map(String).join(' | ') }
}

const db = createSeedDb()
const ctx = { business: db.business, content: db.content }

describe('Excel quotation', () => {
  const save: QuotationSave = {
    status: 'pending', quoteDate: '2026-10-30', validUntil: '2026-11-14', customerName: '=HYPERLINK("http://x")', phone: '9876543210',
    email: 'r@example.com', city: 'Raipur', address: 'Shankar Nagar', state: 'Chhattisgarh', gstin: '', consumerNumber: '1000123', discom: 'CSPDCL',
    sanctionedLoadKw: 3, propertyType: 'residential', systemType: 'on-grid', roofType: 'rcc', capacityKw: 3, monthlyBill: 2500, companyId: null,
    quality: 'normal', packagePrice: null, discount: 0, subsidy: null, stateSubsidy: null, annualGenerationKwh: null,
    items: [
      { id: 'a', name: 'Solar kit 3 kW', description: 'Modules + inverter', hsn: '8541', unit: 'Set', quantity: 1, rate: 142857.14, discountPct: 0, gstRate: 5 },
      { id: 'b', name: 'Installation', description: '', hsn: '9954', unit: 'Job', quantity: 1, rate: 8474.58, discountPct: 0, gstRate: 18 },
    ],
    paymentTerms: '50% advance\nBalance on commissioning', terms: 'Subject to site survey', notes: '',
  }
  const q = { ...save, ...deriveQuotation(save, { business: db.business, calc: db.content.calculator, companies: db.companies }), id: 'q1', quoteNumber: 'BS/QT/2026-27/0007', createdAt: '', source: 'admin' } as Quotation

  it('contains client, system, items, totals, subsidy breakdown and final amount', async () => {
    const { text, cells } = await read(await quotationXlsx(q, ctx))
    expect(text).toContain('BS/QT/2026-27/0007')
    expect(text).toContain('3 kWp')
    expect(text).toContain('Solar kit 3 kW')
    expect(text).toContain('SUBSIDY BREAKDOWN')
    expect(text).toContain('Chhattisgarh State Subsidy')
    expect(cells).toContain(q.grandTotal)
    expect(cells).toContain(78000)
    expect(cells).toContain(30000)
    expect(text).toContain('Less: Central subsidy')
    expect(cells).toContain(q.grandTotal! - 108000)
    expect(q.netCost).toBe(q.grandTotal! - 108000)
  })
  it('never writes formulas from user text (injection guard)', async () => {
    const { ws } = await read(await quotationXlsx(q, ctx))
    let formulas = 0
    ws.eachRow((row) => row.eachCell((c) => { if (c.type === ExcelJS.ValueType.Formula) formulas++ }))
    expect(formulas).toBe(0)
    const nameCell = (await read(await quotationXlsx(q, ctx))).cells.find((c) => String(c).includes('HYPERLINK'))
    expect(String(nameCell).startsWith("'")).toBe(true)
  })
})

describe('Excel invoice', () => {
  it('has GST totals, payments, subsidy and a GST summary sheet', async () => {
    const input: InvoiceInput = {
      documentTitle: 'Tax Invoice', reference: 'BS/QT/2026-27/0007', invoiceDate: '2026-10-30', dueDate: '2026-11-14', template: 'classic', status: 'issued',
      quotationId: null, customerName: 'Ramesh Sharma', phone: '9876543210', email: '', address: '', city: 'Raipur', state: 'Chhattisgarh', stateCode: '22',
      gstin: '', discountType: 'amount', discountValue: 0, paymentMethod: 'upi', notes: '', terms: '', initialPayment: null,
      items: [{ id: 'a', name: 'Solar kit 3 kW', description: '', hsn: '8541', unit: 'Set', quantity: 1, rate: 152380.95, discountPct: 0, gstRate: 5 }],
      subsidy: { show: true, auto: true, capacityKw: 3, propertyType: 'residential', systemType: 'on-grid', central: null, state: null },
    }
    const payments = [{ id: 'p', date: '2026-10-30', amount: 50000, method: 'upi' as const, reference: 'UTR1', note: '' }]
    const d = deriveInvoice(input, payments, db.business, db.content.calculator)
    const inv = { ...input, ...d, id: 'i1', invoiceNumber: 'BS/INV/2026-27/0003', payments, isOverdue: false, createdAt: '', updatedAt: '' } as Invoice
    const { wb, text, cells } = await read(await invoiceXlsx(inv, ctx))
    expect(text).toContain('BS/INV/2026-27/0003')
    expect(cells).toContain(inv.grandTotal)
    expect(cells).toContain(inv.amountDue)
    expect(inv.subsidy?.total).toBe(108000)
    expect(cells).toContain(inv.grandTotal - 108000)
    expect(wb.getWorksheet('GST summary')?.rowCount).toBe(2)
  })
})
