import { describe, expect, it } from 'vitest';
import { computeTotals } from '@/lib/totals';
import { SO_3844, SO_3861 } from '@/mocks/seed/salesOrders';
import { amountInWords } from '@/pdf/words';
import { financialYear, nextNumber, paymentState } from '@/mocks/logic';
import { calculateSolar, estimateSubsidy } from '@/lib/calculator';
import { DEFAULT_CALCULATOR } from '@/data/settings-defaults';
import { catalogLine } from '@/lib/catalog';
import { seedCatalog } from '@/mocks/seed/catalog';
import { seedBusiness } from '@/mocks/seed/business';
import { deriveInvoice } from '@/mocks/logic';
import type { InvoiceInput } from '@/types';
import { mergeDefaults } from '@/lib/schemas';
import { ApiError } from '@/services/errors';
import { createSeedDb } from '@/mocks/store';
import { invoicePdf, quotationPdf } from '@/pdf';
import { inflateSync } from 'node:zlib';
import {
  COMPANY_CONTACT,
  LEGACY_COMPANY_CONTACT,
  migrateCompanyContacts,
} from '@/config/company';
import { seedContent } from '@/data/content';
import { mailHref, telHref, whatsappHref } from '@/lib/format';

describe('GST engine reproduces the TallyPrime sales orders', () => {
  it('SO 3844 (3 kW kit)', () => {
    const t = computeTotals(SO_3844, { supplyType: 'intra', roundOff: true });
    expect(t.taxableAmount).toBe(233384);
    expect(t.cgst).toBe(7346.76);
    expect(t.sgst).toBe(7346.76);
    expect(t.roundOff).toBe(0.48);
    expect(t.grandTotal).toBe(248078);
    expect(amountInWords(t.grandTotal, 'INR')).toBe(
      'INR Two Lakh Forty Eight Thousand Seventy Eight Only',
    );
  });
  it('SO 3861 (5 kW kit)', () => {
    const t = computeTotals(SO_3861, { supplyType: 'intra', roundOff: true });
    expect(t.taxableAmount).toBe(388316);
    expect(t.cgst).toBe(11223.44);
    expect(t.sgst).toBe(11223.44);
    expect(t.roundOff).toBe(0.12);
    expect(t.grandTotal).toBe(410763);
    expect(amountInWords(t.grandTotal, 'INR')).toBe(
      'INR Four Lakh Ten Thousand Seven Hundred Sixty Three Only',
    );
  });
  it('inter-state uses IGST and discounts are applied before tax', () => {
    const t = computeTotals(
      [
        {
          id: 'a',
          name: 'AMC',
          description: '',
          hsn: '998719',
          unit: 'YEAR',
          quantity: 2,
          rate: 5000,
          discountPct: 10,
          gstRate: 18,
        },
      ],
      {
        supplyType: 'inter',
        discountType: 'amount',
        discountValue: 1000,
        roundOff: true,
      },
    );
    expect(t.taxableAmount).toBe(8000);
    expect(t.igst).toBe(1440);
    expect(t.cgst).toBe(0);
    expect(t.grandTotal).toBe(9440);
  });
  it('recalculates decimal quantity, price, line and invoice discounts without stale or NaN totals', () => {
    const items = [
      {
        ...catalogLine(seedCatalog[0]),
        quantity: 1.5,
        rate: 1000,
        discountPct: 10,
      },
      {
        ...catalogLine(seedCatalog.find((item) => item.id === 'svc-amc')!),
        quantity: 2,
        rate: 250.25,
      },
    ];
    const t = computeTotals(items, {
      supplyType: 'intra',
      discountType: 'amount',
      discountValue: 100,
      roundOff: false,
    });
    expect(t.subtotal).toBe(2000.5);
    expect(t.itemDiscount).toBe(150);
    expect(t.overallDiscount).toBe(100);
    expect(t.taxableAmount).toBe(1750.5);
    expect(t.grandTotal).toBe(1899.57);
    expect(
      [t.subtotal, t.cgst, t.sgst, t.igst, t.grandTotal].every(Number.isFinite),
    ).toBe(true);
    const changed = computeTotals([{ ...items[0], quantity: 3, rate: 2000 }], {
      supplyType: 'inter',
      roundOff: false,
    });
    expect(changed.igst).toBe(270);
    expect(changed.cgst).toBe(0);
    expect(changed.sgst).toBe(0);
  });
  it('catalog selection snapshots item name, SKU, selling price, unit and GST', () => {
    const selected = catalogLine({ ...seedCatalog[0], sku: 'PV-001' });
    expect(selected).toMatchObject({
      name: seedCatalog[0].name,
      sku: 'PV-001',
      rate: seedCatalog[0].rate,
      unit: seedCatalog[0].unit,
      gstRate: seedCatalog[0].gstRate,
      quantity: 1,
    });
  });
});

describe('documents & payments', () => {
  const invoiceInput: InvoiceInput = {
    documentTitle: 'Tax Invoice',
    reference: '',
    invoiceDate: '2026-10-25',
    dueDate: null,
    template: 'classic',
    status: 'issued',
    quotationId: null,
    customerName: 'Test Customer',
    phone: '',
    email: '',
    address: '',
    city: 'Raipur',
    state: 'Chhattisgarh',
    stateCode: '22',
    gstin: '',
    items: [catalogLine(seedCatalog[0])],
    discountType: 'amount',
    discountValue: 0,
    paymentMethod: '',
    notes: '',
    terms: '',
    initialPayment: null,
  };
  it('numbers documents per Indian financial year', () => {
    expect(financialYear('2026-03-31')).toBe('2025-26');
    expect(financialYear('2026-04-01')).toBe('2026-27');
    const counters: Record<string, number> = {};
    expect(nextNumber(counters, 'invoice', 'BS/INV', '2026-10-25')).toBe(
      'BS/INV/2026-27/0001',
    );
    expect(nextNumber(counters, 'invoice', 'BS/INV', '2026-11-01')).toBe(
      'BS/INV/2026-27/0002',
    );
    expect(nextNumber(counters, 'invoice', 'BS/INV', '2027-04-02')).toBe(
      'BS/INV/2027-28/0001',
    );
  });
  it('payment status', () => {
    expect(paymentState(11800, [])).toMatchObject({
      paymentStatus: 'unpaid',
      amountDue: 11800,
    });
    expect(
      paymentState(11800, [
        {
          id: 'p',
          date: '2026-10-25',
          amount: 5000,
          method: 'upi',
          reference: '',
          note: '',
        },
      ]),
    ).toMatchObject({ paymentStatus: 'partial', amountDue: 6800 });
    expect(
      paymentState(11800, [
        {
          id: 'p',
          date: '2026-10-25',
          amount: 11800,
          method: 'cash',
          reference: '',
          note: '',
        },
      ]),
    ).toMatchObject({ paymentStatus: 'paid', amountDue: 0 });
  });
  it('server-side invoice derivation is stable after editing/reopening and separates taxes by supply state', () => {
    const localState = deriveInvoice(invoiceInput, [], seedBusiness);
    const reopenedInput = {
      ...invoiceInput,
      items: invoiceInput.items.map((item) => ({ ...item })),
    };
    expect(deriveInvoice(reopenedInput, [], seedBusiness)).toEqual(localState);
    const interstate = deriveInvoice(
      { ...reopenedInput, stateCode: '27', state: 'Maharashtra' },
      [],
      seedBusiness,
    );
    expect(interstate.supplyType).toBe('inter');
    expect(interstate.cgst).toBe(0);
    expect(interstate.sgst).toBe(0);
    expect(interstate.igst).toBeGreaterThan(0);
  });
  it('server rejects missing/invalid invoice prices and recalculates totals itself', () => {
    const getFailure = (input: InvoiceInput) => {
      try {
        deriveInvoice(input, [], seedBusiness);
      } catch (error) {
        return error;
      }
      throw new Error('Expected invoice validation to fail');
    };
    expect(
      getFailure({
        ...invoiceInput,
        items: [{ ...invoiceInput.items[0], rate: 0 }],
      }),
    ).toMatchObject({
      fieldErrors: { 'items.0.rate': expect.stringContaining('selling price') },
    } satisfies Partial<ApiError>);
    expect(
      getFailure({
        ...invoiceInput,
        items: [{ ...invoiceInput.items[0], quantity: Number.NaN }],
      }),
    ).toMatchObject({
      fieldErrors: { 'items.0.quantity': expect.stringContaining('Quantity') },
    } satisfies Partial<ApiError>);
    const result = deriveInvoice(
      {
        ...invoiceInput,
        items: [{ ...invoiceInput.items[0], rate: 10, quantity: 3 }],
      },
      [],
      seedBusiness,
    );
    expect(result.subtotal).toBe(30);
    expect(result.grandTotal).toBe(32);
  });
  it('company identifiers default centrally and legacy settings are upgraded without losing edits', () => {
    const migrated = mergeDefaults(seedBusiness, {
      address: 'User-edited address',
      cin: undefined,
    });
    expect(seedBusiness).toMatchObject({
      legalName: 'Baba Solars',
      gstin: '22ABSCS7495K1ZG',
      cin: 'U35105CT2026PTC019726',
    });
    expect(migrated).toMatchObject({
      legalName: 'Baba Solars',
      gstin: '22ABSCS7495K1ZG',
      cin: 'U35105CT2026PTC019726',
      address: 'User-edited address',
    });
  });
  it('uses official contact details and Click-to-Chat URL in seeds and legacy migration', () => {
    expect(COMPANY_CONTACT).toMatchObject({
      phone: '92039 00410',
      email: 'babasolars76@gmail.com',
      address:
        'Deopuri, House No. 03, Shri Balaji Golden Palace, Behind Shri Upadhyay Furniture, Deopuri, Raipur, Chhattisgarh – 492015, India',
      whatsapp: '919203900410',
      hours: '10:30 AM – 5:30 PM',
    });
    expect(seedContent).toMatchObject({
      phone: COMPANY_CONTACT.phone,
      email: COMPANY_CONTACT.email,
      address: COMPANY_CONTACT.address,
      whatsapp: COMPANY_CONTACT.whatsapp,
      hours: COMPANY_CONTACT.hours,
    });
    expect(seedBusiness).toMatchObject({
      phone: COMPANY_CONTACT.phone,
      email: COMPANY_CONTACT.email,
      address: COMPANY_CONTACT.businessAddress,
    });
    expect(telHref(COMPANY_CONTACT.phone)).toBe('tel:+919203900410');
    expect(mailHref(COMPANY_CONTACT.email)).toBe(
      'mailto:babasolars76@gmail.com?subject=Solar%20enquiry',
    );
    expect(whatsappHref(COMPANY_CONTACT.whatsapp)).toBe(
      'https://wa.me/919203900410',
    );
    expect(
      migrateCompanyContacts({
        phone: LEGACY_COMPANY_CONTACT.phone,
        email: LEGACY_COMPANY_CONTACT.email,
        address: LEGACY_COMPANY_CONTACT.address,
        whatsapp: LEGACY_COMPANY_CONTACT.whatsapp,
      }),
    ).toMatchObject({
      phone: COMPANY_CONTACT.phone,
      email: COMPANY_CONTACT.email,
      address: COMPANY_CONTACT.address,
      whatsapp: COMPANY_CONTACT.whatsapp,
    });
    expect(
      migrateCompanyContacts({
        address: LEGACY_COMPANY_CONTACT.businessAddress,
      }),
    ).toMatchObject({ address: COMPANY_CONTACT.businessAddress });
    expect(
      migrateCompanyContacts({ hours: LEGACY_COMPANY_CONTACT.hours }),
    ).toMatchObject({ hours: COMPANY_CONTACT.hours });
    expect(
      migrateCompanyContacts({ hours: 'Sunday 12:00 PM – 4:00 PM' }),
    ).toMatchObject({ hours: 'Sunday 12:00 PM – 4:00 PM' });
  });
  it('prints centrally configured company name, GSTIN and CIN in invoice and quotation PDFs', async () => {
    const db = createSeedDb();
    const context = { business: db.business, content: db.content };
    const invoice = await invoicePdf(db.invoices[0], context);
    const quotation = await quotationPdf(db.quotations[0], context);
    for (const pdf of [invoice, quotation]) {
      const bytes = Buffer.from(await pdf.arrayBuffer());
      const raw = bytes.toString('latin1');
      const contents =
        raw +
        [...raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)]
          .map((match) => {
            try {
              return inflateSync(Buffer.from(match[1], 'latin1')).toString(
                'latin1',
              );
            } catch {
              return '';
            }
          })
          .join('\n');
      expect(contents).toContain('Baba Solars');
      expect(contents).toContain('22ABSCS7495K1ZG');
      expect(contents).toContain('U35105CT2026PTC019726');
    }
  });
});

describe('solar calculator', () => {
  it('PM Surya Ghar subsidy slabs', () => {
    expect(estimateSubsidy(2, 'residential', 'on-grid')).toBe(60000);
    expect(estimateSubsidy(3, 'residential', 'on-grid')).toBe(78000);
    expect(estimateSubsidy(10, 'residential', 'on-grid')).toBe(78000);
    expect(estimateSubsidy(10, 'housing-society', 'on-grid')).toBe(180000);
    expect(estimateSubsidy(5, 'commercial', 'on-grid')).toBe(0);
    expect(estimateSubsidy(5, 'residential', 'off-grid')).toBe(0);
  });
  it('uses a company package price when given', () => {
    const r = calculateSolar(
      {
        monthlyBill: 4200,
        tariff: 6.8,
        propertyType: 'residential',
        systemType: 'on-grid',
        roofType: 'rcc',
        capacityOverride: 5,
        costOverride: 330000,
      },
      DEFAULT_CALCULATOR,
    );
    expect(r.costMid).toBe(330000);
    expect(r.costMin).toBe(330000);
    // central PM Surya Ghar ₹78,000 + Chhattisgarh state ₹30,000 (default state)
    expect(r.netCost).toBe(330000 - 78000 - 30000);
    expect(r.paybackYears).toBeGreaterThan(3);
  });
  it('no consumption → no savings', () => {
    expect(
      calculateSolar({
        monthlyBill: 0,
        tariff: 6.8,
        propertyType: 'residential',
        systemType: 'on-grid',
        roofType: 'rcc',
      }).annualSavings,
    ).toBe(0);
  });
});
