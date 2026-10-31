/**
 * Browser data adapter for site content and business records. Authentication and user management
 * are available only through the server API; this adapter fails closed for those operations.
 */
import type {
  BusinessSettings,
  CatalogItem,
  CollectionItem,
  CollectionKey,
  Company,
  Database,
  Enquiry,
  Invoice,
  InvoiceInput,
  InvoiceTemplate,
  OrderedCollectionKey,
  Payment,
  Permission,
  Quality,
  Quotation,
  QuotationStatus,
  QuotationTemplate,
  Role,
  SiteContent,
  StaffUser,
} from '@/types';
import type {
  AuthProfile,
  DataSnapshot,
  EnquiryInput,
  InvoiceQuery,
  PricedPackage,
  PublicSite,
  QuotationRequestInput,
  QuotationSave,
  UploadResult,
} from '@/services/api';
import { ApiError } from '@/services/errors';
import { SERVER_MODE } from '@/config/api';
import { serverSession } from '@/services/session';
import { localSession } from '@/services/localSession';
import { migrateCompanyContacts } from '@/config/company';
import { calculateSolar } from '@/lib/calculator';
import {
  hasErrors,
  mergeDefaults,
  normalizeCapacityPlan,
  normalizePricingPlan,
  validateContent,
  validateItem,
} from '@/lib/schemas';
import {
  packageLines,
  packagePrice,
  panelCount,
  snapshotOf,
} from '@/lib/pricing';
import { permissionsFor } from '@/lib/rbac';
import { validateSubsidySettings } from '@/lib/subsidy';
import { createId } from '@/lib/id';
import { addDaysISO, todayISO } from '@/lib/files';
import { stateCodeOf, stateName } from '@/lib/states';
import {
  db,
  MOCK_SCHEMA,
  persist,
  transaction,
  type MockDb,
} from './store';
import {
  deriveInvoice,
  deriveQuotation,
  isOverdue,
  nextNumber,
  paymentState,
} from './logic';

const PUBLIC_KEYS = [
  'pricingPlans',
  'capacityPlans',
  'services',
  'projects',
  'testimonials',
  'faqs',
  'heroSlides',
  'gallery',
] as const;
const STAMPED: CollectionKey[] = ['pricingPlans', 'capacityPlans'];

const delay = (ms = import.meta.env.MODE === 'test' ? 0 : 160) =>
  new Promise((r) => setTimeout(r, ms));
const clone = <T>(v: T): T => structuredClone(v);
const now = () => new Date().toISOString();

function currentUser() {
  const user = SERVER_MODE ? serverSession.get() : localSession.currentUser();
  return user
    ? ({ ...user, isActive: true, lastLoginAt: null, createdAt: '', updatedAt: '' } as MockDb['users'][number])
    : null;
}
function require(permission: Permission) {
  const u = currentUser();
  if (!u)
    throw new ApiError('Please sign in.', {
      code: 'unauthorized',
      status: 401,
    });
  if (!permissionsFor(u.role).includes(permission))
    throw new ApiError('You do not have permission to do this.', {
      code: 'forbidden',
      status: 403,
    });
  return u;
}
const isStaff = () => !!currentUser();
const serverAuthenticationRequired = () => new ApiError(
  'This action requires the secure server authentication service.',
  { code: 'network', status: 503 },
);

const published = <T extends { status?: string; order?: number }>(list: T[]) =>
  list.filter((x) => (x.status ?? 'published') === 'published');
const ordered = <T extends { order?: number }>(list: T[]) =>
  [...list].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
const withOverdue = (inv: Invoice): Invoice => ({
  ...inv,
  isOverdue: isOverdue(inv),
});

async function loadPdf() {
  return import('@/pdf');
}
async function loadExcel() {
  return import('@/excel');
}
function pdfContext() {
  const d = db();
  return { business: clone(d.business), content: clone(d.content) };
}

export const mockApi = {
  publishedVersion: () => db().version,

  // ─── Public website ──────────────────────────────────────────────────────
  async loadSite(): Promise<PublicSite> {
    await delay(60);
    const d = db();
    const staff = isStaff();
    const site = {
      version: d.version,
      content: clone(d.content),
      companies: clone(ordered(d.companies)),
    } as PublicSite;
    for (const k of PUBLIC_KEYS)
      (site as unknown as Record<string, unknown>)[k] = clone(
        staff ? ordered(d[k] as never[]) : ordered(published(d[k] as never[])),
      );
    return site;
  },

  async getCollection<K extends CollectionKey>(key: K): Promise<Database[K]> {
    await delay(40);
    if (key === 'enquiries') require('leads:read');
    if (key === 'quotations') require('quotations:read');
    const list = db()[key] as Array<{
      status?: string;
      order?: number;
      createdAt?: string;
    }>;
    if (key === 'enquiries' || key === 'quotations')
      return clone(
        [...list].sort((a, b) =>
          (b.createdAt ?? '').localeCompare(a.createdAt ?? ''),
        ),
      ) as Database[K];
    return clone(
      isStaff() ? ordered(list) : ordered(published(list)),
    ) as Database[K];
  },

  async getContent(): Promise<SiteContent> {
    await delay(40);
    return clone(db().content);
  },

  async upsertItem<K extends CollectionKey>(
    key: K,
    item: CollectionItem<K>,
  ): Promise<CollectionItem<K>> {
    await delay();
    if (key === 'enquiries') require('leads:write');
    else if (key === 'quotations') require('quotations:write');
    else require('content:write');
    const errors = validateItem(key, item);
    if (hasErrors(errors))
      throw new ApiError('Some fields need attention. Nothing was saved.', {
        code: 'validation',
        fieldErrors: errors,
      });
    return transaction(
      (d) => {
        const list = d[key] as Array<
          CollectionItem<K> & { id: string; order?: number }
        >;
        const existing = list.find((x) => x.id === item.id);
        let saved = { ...(existing ?? {}), ...item } as CollectionItem<K> & {
          id: string;
          order?: number;
        };
        if (STAMPED.includes(key)) saved = { ...saved, updatedAt: now() };
        if (
          key === 'services' &&
          list.some(
            (x) =>
              x.id !== saved.id &&
              (x as unknown as { slug: string }).slug ===
                (saved as unknown as { slug: string }).slug,
          )
        ) {
          throw new ApiError('Another service already uses this URL slug.', {
            code: 'conflict',
            fieldErrors: {
              slug: 'Another service already uses this URL slug.',
            },
          });
        }
        if (!existing && 'order' in saved === false)
          saved.order = Math.max(0, ...list.map((x) => x.order ?? 0)) + 1;
        (d as unknown as Record<string, unknown>)[key] = existing
          ? list.map((x) => (x.id === saved.id ? saved : x))
          : [...list, saved];
        return clone(saved);
      },
      { site: !['enquiries', 'quotations'].includes(key) },
    );
  },

  async removeItem(key: CollectionKey, id: string): Promise<void> {
    await delay();
    require(
      key === 'enquiries'
        ? 'leads:write'
        : key === 'quotations'
          ? 'quotations:write'
          : 'content:write',
    );
    transaction(
      (d) => {
        (d as unknown as Record<string, Array<{ id: string }>>)[key] = (
          d[key] as Array<{ id: string }>
        ).filter((x) => x.id !== id);
      },
      { site: true },
    );
  },

  async reorder<K extends OrderedCollectionKey>(
    key: K,
    ids: string[],
  ): Promise<Database[K]> {
    await delay();
    require('content:write');
    return transaction(
      (d) => {
        const list = d[key] as Array<{ id: string; order?: number }>;
        const same =
          ids.length === list.length &&
          new Set(ids).size === ids.length &&
          list.every((x) => ids.includes(x.id));
        if (!same)
          throw new ApiError(
            'The list changed in another tab. It has been refreshed — please try again.',
            { code: 'conflict' },
          );
        const byId = new Map(list.map((x) => [x.id, x]));
        const next = ids.map((id, i) => ({ ...byId.get(id)!, order: i + 1 }));
        (d as unknown as Record<string, unknown>)[key] = next;
        return clone(next) as unknown as Database[K];
      },
      { site: true },
    );
  },

  async updateContent(patch: Partial<SiteContent>): Promise<SiteContent> {
    await delay();
    require('content:write');
    return transaction(
      (d) => {
        const current = d.content;
        const next = { ...current } as Record<string, unknown>;
        for (const [k, v] of Object.entries(patch)) {
          if (k === 'updatedAt') continue;
          const cur = (current as unknown as Record<string, unknown>)[k];
          next[k] =
            v &&
            typeof v === 'object' &&
            !Array.isArray(v) &&
            cur &&
            typeof cur === 'object'
              ? mergeDefaults(cur, v)
              : v;
        }
        const content = next as unknown as SiteContent;
        if (patch.whatsapp !== undefined)
          content.whatsapp = patch.whatsapp.replace(/\D/g, '');
        const touched = new Set(Object.keys(patch));
        const errors = Object.fromEntries(
          Object.entries(validateContent(content)).filter(([p]) =>
            touched.has(p.split('.')[0]),
          ),
        );
        if (patch.calculator) {
          const c = content.calculator;
          if (!(c.unitsPerKwPerDay > 0 && c.unitsPerKwPerDay <= 8))
            errors['calculator.unitsPerKwPerDay'] =
              'Use a value between 0 and 8.';
          if (!(c.defaultTariff > 0))
            errors['calculator.defaultTariff'] = 'Tariff must be more than 0.';
          const el = c.electricity;
          if (el) {
            const slabSets = [
              'domesticEnergy',
              'lv21Energy',
              'lv22SmallEnergy',
              'lv22LargeEnergy',
            ] as const;
            for (const key of slabSets) {
              let prev = 0;
              el[key].forEach((sl, i) => {
                if (!(sl.rate > 0))
                  errors[`calculator.electricity.${key}.${i}.rate`] =
                    'Rate must be more than 0.';
                if (sl.upToUnits !== null && sl.upToUnits <= prev)
                  errors[`calculator.electricity.${key}.${i}.upToUnits`] =
                    'Slabs must go up.';
                if (sl.upToUnits !== null) prev = sl.upToUnits;
              });
            }
            for (const key of [
              'fppasPercent',
              'dutyDomesticPercent',
              'dutyNonDomesticPercent',
            ] as const)
              if (!(el[key] >= 0 && el[key] <= 100))
                errors[`calculator.electricity.${key}`] =
                  'Use a percentage between 0 and 100.';
            if (!(el.halfBill.percent >= 0 && el.halfBill.percent <= 100))
              errors['calculator.electricity.halfBill.percent'] =
                'Use a percentage between 0 and 100.';
            if (el.halfBill.unitsCovered > el.halfBill.maxUnits)
              errors['calculator.electricity.halfBill.unitsCovered'] =
                'Cannot be more than the eligibility limit.';
            if (!(el.defaultLoadKw.domestic > 0 && el.defaultLoadKw.commercial > 0))
              errors['calculator.electricity.defaultLoadKw.domestic'] =
                'Default loads must be more than 0.';
          }
          let last = 0;
          c.costSlabs.forEach((s, i) => {
            if (!(s.pricePerKw > 0))
              errors[`calculator.costSlabs.${i}.pricePerKw`] =
                'Price must be more than 0.';
            if (s.upToKw !== null && s.upToKw <= last)
              errors[`calculator.costSlabs.${i}.upToKw`] =
                'Slabs must go up in size.';
            if (s.upToKw === null && i < c.costSlabs.length - 1)
              errors[`calculator.costSlabs.${i}.upToKw`] =
                'Only the last slab can be open-ended.';
            if (s.upToKw !== null) last = s.upToKw;
          });
          Object.assign(errors, validateSubsidySettings(c.subsidy));
        }
        if (hasErrors(errors))
          throw new ApiError('Some fields need attention. Nothing was saved.', {
            code: 'validation',
            fieldErrors: errors,
          });
        content.updatedAt = now();
        d.content = content;
        return clone(content);
      },
      { site: true },
    );
  },

  async submitEnquiry(_input: EnquiryInput): Promise<Enquiry> {
    throw new ApiError(
      'Online enquiry delivery is unavailable. Please use the contact details on this page instead.',
      { code: 'network', status: 503 },
    );
  },

  async submitQuotation(_input: QuotationRequestInput): Promise<Quotation> {
    throw new ApiError(
      'Online quote requests are unavailable. Please use the contact details on this page instead.',
      { code: 'network', status: 503 },
    );
  },

  // ─── Auth & users (mock) ─────────────────────────────────────────────────
  async login(_email: string, _password: string): Promise<AuthProfile> {
    throw serverAuthenticationRequired();
  },
  async logout(): Promise<void> {},
  async logoutEverywhere(): Promise<void> {},
  async me(): Promise<AuthProfile> {
    throw serverAuthenticationRequired();
  },
  async changePassword(_currentPassword: string, _newPassword: string): Promise<{ ok: true }> {
    throw serverAuthenticationRequired();
  },
  async listUsers(): Promise<StaffUser[]> {
    throw serverAuthenticationRequired();
  },
  async createUser(_user: { name: string; email: string; role: Role; password: string }): Promise<StaffUser> {
    throw serverAuthenticationRequired();
  },
  async updateUser(
    _id: string,
    _patch: Partial<{ name: string; role: Role; isActive: boolean; password: string }>,
  ): Promise<StaffUser> {
    throw serverAuthenticationRequired();
  },
  async deleteUser(_id: string): Promise<void> { throw serverAuthenticationRequired() },

  // ─── Business settings ───────────────────────────────────────────────────
  async getBusiness(): Promise<BusinessSettings> {
    await delay(40);
    require('business:read');
    return clone(db().business);
  },
  async updateBusiness(
    patch: Partial<BusinessSettings>,
  ): Promise<BusinessSettings> {
    await delay();
    require('business:write');
    return transaction((d) => {
      const next = mergeDefaults(d.business, patch) as BusinessSettings;
      if (patch.packageBreakdown)
        next.packageBreakdown = patch.packageBreakdown;
      const e: Record<string, string> = {};
      if (!next.legalName.trim())
        e.legalName = 'Enter the legal business name.';
      if (
        next.gstin &&
        !/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(next.gstin)
      )
        e.gstin = 'Enter a valid 15-character GSTIN, e.g. 22AAAAA0000A1Z5.';
      if (next.gstin && next.gstin.slice(0, 2) !== next.stateCode)
        e.gstin = 'GSTIN state code does not match the business state.';
      if (next.bank.ifsc && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(next.bank.ifsc))
        e['bank.ifsc'] = 'Enter a valid IFSC, e.g. SBIN0001234.';
      if (!/^[A-Za-z0-9/-]{1,16}$/.test(next.invoice.prefix))
        e['invoice.prefix'] = 'Use letters, numbers, / and - only.';
      if (!/^[A-Za-z0-9/-]{1,16}$/.test(next.quotation.prefix))
        e['quotation.prefix'] = 'Use letters, numbers, / and - only.';
      for (const q of ['normal', 'premium'] as const) {
        const total = next.packageBreakdown[q].reduce(
          (s, r) => s + Number(r.share || 0),
          0,
        );
        if (Math.abs(total - 100) > 0.5)
          e[`packageBreakdown.${q}`] =
            `${q === 'normal' ? 'Normal' : 'Premium'} shares add up to ${total.toFixed(1)}% — they must total 100%.`;
      }
      if (Object.keys(e).length)
        throw new ApiError('Some fields need attention. Nothing was saved.', {
          code: 'validation',
          fieldErrors: e,
        });
      next.updatedAt = now();
      d.business = next;
      return clone(next);
    });
  },

  // ─── Companies & package prices ──────────────────────────────────────────
  async listCompanies(): Promise<Company[]> {
    await delay(40);
    return clone(ordered(db().companies));
  },
  async saveCompany(c: Company): Promise<Company> {
    await delay();
    require('companies:write');
    const e: Record<string, string> = {};
    if (!c.name.trim()) e.name = 'Enter a company name.';
    const sizes = new Set<number>();
    c.packages.forEach((p, i) => {
      if (!(p.capacityKw > 0))
        e[`packages.${i}.capacityKw`] = 'Size must be more than 0.';
      else if (sizes.has(p.capacityKw))
        e[`packages.${i}.capacityKw`] = 'This size is listed twice.';
      sizes.add(p.capacityKw);
      if (!(p.normal > 0))
        e[`packages.${i}.normal`] = 'Enter the Normal price.';
      if (!(p.premium > 0))
        e[`packages.${i}.premium`] = 'Enter the Premium price.';
      else if (p.premium < p.normal)
        e[`packages.${i}.premium`] =
          'Premium is usually not cheaper than Normal — check the price.';
    });
    if (!c.packages.length) e.packages = 'Add at least one package size.';
    for (const q of ['normal', 'premium'] as const)
      if (
        !(
          c.qualities[q].panelWattage >= 50 &&
          c.qualities[q].panelWattage <= 1000
        )
      )
        e[`qualities.${q}.panelWattage`] = 'Panel wattage should be 50–1000 W.';
    if (Object.keys(e).length)
      throw new ApiError('Some fields need attention. Nothing was saved.', {
        code: 'validation',
        fieldErrors: e,
      });
    return transaction(
      (d) => {
        const saved = {
          ...c,
          packages: [...c.packages].sort((a, b) => a.capacityKw - b.capacityKw),
          updatedAt: now(),
        };
        const exists = d.companies.some((x) => x.id === c.id);
        if (!exists)
          saved.order = Math.max(0, ...d.companies.map((x) => x.order)) + 1;
        d.companies = exists
          ? d.companies.map((x) => (x.id === c.id ? saved : x))
          : [...d.companies, saved];
        return clone(saved);
      },
      { site: true },
    );
  },
  async deleteCompany(id: string): Promise<void> {
    await delay();
    require('companies:write');
    transaction(
      (d) => {
        d.companies = d.companies.filter((c) => c.id !== id);
      },
      { site: true },
    );
  },
  /** Company + size + quality → price from the price list and an itemised bill of materials. */
  async priceQuote(
    companyId: string,
    capacityKw: number,
    quality: Quality,
    supplyType: 'intra' | 'inter' = 'intra',
  ): Promise<PricedPackage> {
    await delay(80);
    const d = db();
    const c = d.companies.find((x) => x.id === companyId);
    if (!c) throw new ApiError('Company not found.', { code: 'not_found' });
    const p = packagePrice(c, capacityKw, quality);
    if (!p)
      throw new ApiError('This company has no package prices yet.', {
        code: 'bad_request',
      });
    return {
      company: snapshotOf(c, quality),
      price: p.price,
      exact: p.exact,
      basis: p.basis,
      panelCount: panelCount(capacityKw, c.qualities[quality].panelWattage),
      items: packageLines(
        c,
        capacityKw,
        quality,
        p.price,
        d.business.packageBreakdown[quality],
        supplyType,
      ),
    };
  },

  // ─── Product catalog (billing) ───────────────────────────────────────────
  async listCatalog(): Promise<CatalogItem[]> {
    await delay(40);
    require('invoices:read');
    return clone(db().catalog);
  },
  async saveCatalogItem(item: CatalogItem): Promise<CatalogItem> {
    await delay();
    require('invoices:write');
    const e: Record<string, string> = {};
    if (!item.name.trim()) e.name = 'Enter a product name.';
    if (!Number.isFinite(item.rate) || item.rate <= 0)
      e.rate = 'Enter a selling price greater than 0.';
    if (!Number.isFinite(item.gstRate) || item.gstRate < 0 || item.gstRate > 28)
      e.gstRate = 'GST must be 0–28%.';
    if (Object.keys(e).length)
      throw new ApiError('Some fields need attention.', {
        code: 'validation',
        fieldErrors: e,
      });
    return transaction((d) => {
      d.catalog = d.catalog.some((x) => x.id === item.id)
        ? d.catalog.map((x) => (x.id === item.id ? item : x))
        : [...d.catalog, item];
      return clone(item);
    });
  },
  async deleteCatalogItem(id: string): Promise<void> {
    await delay();
    require('invoices:write');
    transaction((d) => {
      d.catalog = d.catalog.filter((x) => x.id !== id);
    });
  },

  // ─── Quotations ──────────────────────────────────────────────────────────
  async getQuotation(id: string): Promise<Quotation> {
    await delay(40);
    require('quotations:read');
    const q = db().quotations.find((x) => x.id === id);
    if (!q) throw new ApiError('Quotation not found.', { code: 'not_found' });
    return clone(q);
  },
  async saveQuotation(id: string, input: QuotationSave): Promise<Quotation> {
    await delay();
    const user = require('quotations:write');
    return transaction((d) => {
      const existing = d.quotations.find((x) => x.id === id);
      const derived = deriveQuotation(input, {
        business: d.business,
        calc: d.content.calculator,
        companies: d.companies,
        existing,
      });
      if (existing) {
        const next: Quotation = {
          ...existing,
          ...input,
          ...derived,
          validUntil: input.validUntil ?? existing.validUntil,
          updatedAt: now(),
        };
        d.quotations = d.quotations.map((x) => (x.id === id ? next : x));
        return clone(next);
      }
      const date = input.quoteDate || todayISO();
      const q: Quotation = {
        ...input,
        ...derived,
        id,
        source: 'admin',
        quoteDate: date,
        quoteNumber: nextNumber(
          d.counters,
          'quotation',
          d.business.quotation.prefix,
          date,
        ),
        validUntil:
          input.validUntil ??
          addDaysISO(date, d.business.quotation.validityDays),
        paymentTerms:
          input.paymentTerms || d.business.quotation.defaultPaymentTerms,
        terms: input.terms || d.business.quotation.defaultTerms,
        notes: input.notes,
        createdAt: now(),
        updatedAt: now(),
      };
      void user;
      d.quotations = [q, ...d.quotations];
      return clone(q);
    });
  },
  async setQuotationStatus(
    id: string,
    status: QuotationStatus,
  ): Promise<Quotation> {
    await delay();
    require('quotations:write');
    return transaction((d) => {
      const q = d.quotations.find((x) => x.id === id);
      if (!q) throw new ApiError('Quotation not found.', { code: 'not_found' });
      q.status = status;
      q.updatedAt = now();
      return clone(q);
    });
  },
  async quotationPdf(id: string, template?: QuotationTemplate): Promise<Blob> {
    const q = await mockApi.getQuotation(id);
    return (await loadPdf()).quotationPdf(q, pdfContext(), template);
  },
  /** Excel workbook of a saved quotation (same figures as the PDF). */
  async quotationXlsx(id: string): Promise<Blob> {
    const q = await mockApi.getQuotation(id);
    return (await loadExcel()).quotationXlsx(q, pdfContext());
  },
  async quotationPreviewPdf(
    input: QuotationSave,
    id?: string,
    template?: QuotationTemplate,
  ): Promise<Blob> {
    require('quotations:read');
    const d = db();
    const existing = id ? d.quotations.find((x) => x.id === id) : undefined;
    const derived = deriveQuotation(input, {
      business: d.business,
      calc: d.content.calculator,
      companies: d.companies,
      existing,
    });
    const date = input.quoteDate || todayISO();
    const q: Quotation = {
      ...input,
      ...derived,
      id: existing?.id ?? 'preview',
      source: existing?.source ?? 'admin',
      quoteNumber: existing?.quoteNumber ?? 'DRAFT',
      quoteDate: date,
      validUntil:
        input.validUntil ?? addDaysISO(date, d.business.quotation.validityDays),
      paymentTerms:
        input.paymentTerms || d.business.quotation.defaultPaymentTerms,
      terms: input.terms || d.business.quotation.defaultTerms,
      createdAt: existing?.createdAt ?? now(),
      updatedAt: now(),
    };
    return (await loadPdf()).quotationPdf(q, pdfContext(), template);
  },
  async convertToInvoice(id: string): Promise<Invoice> {
    await delay();
    require('invoices:write');
    const d = db();
    const q = d.quotations.find((x) => x.id === id);
    if (!q) throw new ApiError('Quotation not found.', { code: 'not_found' });
    if (!q.items?.length)
      throw new ApiError(
        'Price the quotation first (choose a company, size and quality) before converting it to an invoice.',
        { code: 'bad_request' },
      );
    const stateCode =
      (q.gstin && /^\d{2}/.test(q.gstin) ? q.gstin.slice(0, 2) : '') ||
      stateCodeOf(q.state ?? '') ||
      d.business.stateCode;
    const inv = await mockApi.createInvoice({
      documentTitle: 'Tax Invoice',
      reference: q.quoteNumber ?? '',
      invoiceDate: todayISO(),
      dueDate: null,
      template: d.business.invoice.defaultTemplate,
      status: 'issued',
      quotationId: q.id,
      customerName: q.customerName,
      phone: q.phone,
      email: q.email,
      address: q.address ?? '',
      city: q.city,
      state: stateName(stateCode) || (q.state ?? ''),
      stateCode,
      gstin: q.gstin ?? '',
      items: clone(q.items),
      discountType: 'amount',
      discountValue: q.discount ?? 0,
      paymentMethod: '',
      notes:
        `Against quotation ${q.quoteNumber ?? ''}. ${d.business.invoice.defaultNotes}`.trim(),
      terms: '',
      initialPayment: null,
      // Carry the quotation's subsidy over (shown as information; the invoice total is not reduced).
      subsidy: {
        show:
          d.business.quotation.showSubsidy &&
          q.subsidy + (q.stateSubsidy ?? 0) > 0,
        auto: q.subsidyAuto ?? false,
        capacityKw: q.capacityKw,
        propertyType: q.propertyType,
        systemType: q.systemType,
        central: q.subsidy,
        state: q.stateSubsidy ?? 0,
      },
    });
    transaction((x) => {
      const qq = x.quotations.find((y) => y.id === id);
      if (qq) {
        qq.status = 'accepted';
        qq.updatedAt = now();
      }
    });
    return inv;
  },

  // ─── Invoices ────────────────────────────────────────────────────────────
  async listInvoices(q: InvoiceQuery) {
    await delay(80);
    require('invoices:read');
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 20;
    const text = (q.q ?? '').toLowerCase();
    let rows = db()
      .invoices.map(withOverdue)
      .filter(
        (inv) =>
          (!q.status || inv.status === q.status) &&
          (!q.paymentStatus ||
            (q.paymentStatus === 'overdue'
              ? inv.isOverdue
              : inv.paymentStatus === q.paymentStatus)) &&
          (!q.from || inv.invoiceDate >= q.from) &&
          (!q.to || inv.invoiceDate <= q.to) &&
          (!text ||
            `${inv.invoiceNumber} ${inv.customerName} ${inv.phone} ${inv.gstin} ${inv.city} ${inv.reference}`
              .toLowerCase()
              .includes(text)),
      );
    const sorters: Record<
      NonNullable<InvoiceQuery['sort']>,
      (a: Invoice, b: Invoice) => number
    > = {
      date_desc: (a, b) =>
        b.invoiceDate.localeCompare(a.invoiceDate) ||
        b.createdAt.localeCompare(a.createdAt),
      date_asc: (a, b) =>
        a.invoiceDate.localeCompare(b.invoiceDate) ||
        a.createdAt.localeCompare(b.createdAt),
      amount_desc: (a, b) => b.grandTotal - a.grandTotal,
      amount_asc: (a, b) => a.grandTotal - b.grandTotal,
      due_asc: (a, b) =>
        (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'),
    };
    rows = rows.sort(sorters[q.sort ?? 'date_desc']);
    const live = rows.filter((r) => r.status !== 'cancelled');
    const sum = (f: (i: Invoice) => number) =>
      Math.round(live.reduce((s, i) => s + f(i), 0) * 100) / 100;
    return {
      items: clone(rows.slice((page - 1) * pageSize, page * pageSize)),
      total: rows.length,
      page,
      pageSize,
      summary: {
        count: live.length,
        billed: sum((i) => i.grandTotal),
        paid: sum((i) => i.amountPaid),
        due: sum((i) => i.amountDue),
      },
    };
  },
  async getInvoice(id: string): Promise<Invoice> {
    await delay(40);
    require('invoices:read');
    const inv = db().invoices.find((x) => x.id === id);
    if (!inv) throw new ApiError('Invoice not found.', { code: 'not_found' });
    return clone(withOverdue(inv));
  },
  async createInvoice(input: InvoiceInput): Promise<Invoice> {
    await delay();
    require('invoices:write');
    return transaction((d) => {
      const payments: Payment[] = input.initialPayment
        ? [{ id: createId('pay'), ...input.initialPayment }]
        : [];
      const derived = deriveInvoice(input, payments, d.business, d.content.calculator);
      const { initialPayment: _ip, ...rest } = input;
      const inv: Invoice = {
        ...rest,
        ...derived,
        id: createId('inv'),
        payments,
        invoiceNumber: nextNumber(
          d.counters,
          'invoice',
          d.business.invoice.prefix,
          input.invoiceDate,
        ),
        dueDate:
          input.dueDate ??
          addDaysISO(input.invoiceDate, d.business.invoice.defaultDueDays),
        terms: input.terms || d.business.invoice.defaultTerms,
        paymentMethod: input.paymentMethod || payments[0]?.method || '',
        isOverdue: false,
        createdAt: now(),
        updatedAt: now(),
      };
      d.invoices = [inv, ...d.invoices];
      return clone(withOverdue(inv));
    });
  },
  async updateInvoice(id: string, input: InvoiceInput): Promise<Invoice> {
    await delay();
    require('invoices:write');
    return transaction((d) => {
      const existing = d.invoices.find((x) => x.id === id);
      if (!existing)
        throw new ApiError('Invoice not found.', { code: 'not_found' });
      if (input.initialPayment)
        throw new ApiError(
          'Payments cannot be added through invoice edits. Record them from the invoice payment panel.',
          { code: 'bad_request' },
        );
      const payments = [...existing.payments];
      const derived = deriveInvoice(input, payments, d.business, d.content.calculator);
      const { initialPayment: _ip, ...rest } = input;
      const next: Invoice = {
        ...existing,
        ...rest,
        ...derived,
        payments,
        updatedAt: now(),
      };
      d.invoices = d.invoices.map((x) => (x.id === id ? next : x));
      return clone(withOverdue(next));
    });
  },
  async deleteInvoice(id: string): Promise<void> {
    await delay();
    require('invoices:delete');
    transaction((d) => {
      d.invoices = d.invoices.filter((x) => x.id !== id);
    });
  },
  async addPayment(id: string, p: Omit<Payment, 'id'>): Promise<Invoice> {
    await delay();
    require('invoices:write');
    return transaction((d) => {
      const inv = d.invoices.find((x) => x.id === id);
      if (!inv) throw new ApiError('Invoice not found.', { code: 'not_found' });
      if (inv.status === 'cancelled')
        throw new ApiError('This invoice is cancelled.', {
          code: 'bad_request',
        });
      if (!Number.isFinite(p.amount) || !(p.amount > 0))
        throw new ApiError('Enter the amount received.', {
          code: 'validation',
          fieldErrors: { amount: 'Enter the amount received.' },
        });
      if (p.amount > inv.amountDue + 0.001)
        throw new ApiError(
          `Amount is more than the balance due (₹${inv.amountDue}).`,
          { code: 'bad_request' },
        );
      inv.payments = [...inv.payments, { id: createId('pay'), ...p }];
      Object.assign(inv, paymentState(inv.grandTotal, inv.payments), {
        paymentMethod: p.method,
        updatedAt: now(),
      });
      return clone(withOverdue(inv));
    });
  },
  async removePayment(id: string, paymentId: string): Promise<Invoice> {
    await delay();
    require('invoices:write');
    return transaction((d) => {
      const inv = d.invoices.find((x) => x.id === id);
      if (!inv) throw new ApiError('Invoice not found.', { code: 'not_found' });
      inv.payments = inv.payments.filter((x) => x.id !== paymentId);
      Object.assign(inv, paymentState(inv.grandTotal, inv.payments), {
        updatedAt: now(),
      });
      return clone(withOverdue(inv));
    });
  },
  async invoicePdf(id: string, template?: InvoiceTemplate): Promise<Blob> {
    const inv = await mockApi.getInvoice(id);
    return (await loadPdf()).invoicePdf(inv, pdfContext(), template);
  },
  /** Excel workbook of a saved invoice (same figures as the PDF). */
  async invoiceXlsx(id: string): Promise<Blob> {
    const inv = await mockApi.getInvoice(id);
    return (await loadExcel()).invoiceXlsx(inv, pdfContext());
  },
  async invoicePreviewPdf(input: InvoiceInput, id?: string): Promise<Blob> {
    require('invoices:read');
    const d = db();
    const existing = id ? d.invoices.find((x) => x.id === id) : undefined;
    const payments = [
      ...(existing?.payments ?? []),
      ...(input.initialPayment
        ? [{ id: 'preview', ...input.initialPayment }]
        : []),
    ];
    const derived = deriveInvoice(input, payments, d.business, d.content.calculator);
    const { initialPayment: _ip, ...rest } = input;
    const inv: Invoice = {
      ...rest,
      ...derived,
      payments,
      id: existing?.id ?? 'preview',
      invoiceNumber: existing?.invoiceNumber ?? 'DRAFT',
      dueDate:
        input.dueDate ??
        addDaysISO(input.invoiceDate, d.business.invoice.defaultDueDays),
      terms: input.terms || d.business.invoice.defaultTerms,
      paymentMethod: input.paymentMethod || payments[0]?.method || '',
      isOverdue: false,
      createdAt: existing?.createdAt ?? now(),
      updatedAt: now(),
    };
    return (await loadPdf()).invoicePdf(inv, pdfContext(), input.template);
  },

  // ─── Uploads (mock: compressed data URL stored with the data) ────────────
  async uploadImage(file: File): Promise<UploadResult> {
    require('uploads:write');
    if (!/^image\/(png|jpe?g|webp|gif|avif)$/i.test(file.type))
      throw new ApiError('Choose a PNG, JPG, WebP, GIF or AVIF image.', {
        code: 'validation',
      });
    if (file.size > 8 * 1024 * 1024)
      throw new ApiError('Images must be 8 MB or smaller.', {
        code: 'payload_too_large',
      });
    const url = await compressImage(file, 1600);
    if (url.length > 900_000)
      throw new ApiError(
        'This image is too large for demo storage even after compression. Use a smaller image or an https:// link.',
        { code: 'payload_too_large' },
      );
    return {
      url,
      path: url.slice(0, 40),
      mime: url.slice(5, url.indexOf(';')),
      size: Math.round(url.length * 0.75),
    };
  },

  // ─── Backup, restore, demo reset ─────────────────────────────────────────
  async exportSnapshot({ includeLeads = false } = {}): Promise<DataSnapshot> {
    await delay();
    require('backup:manage');
    const d = clone(db()) as Partial<MockDb>;
    delete d.users;
    if (!includeLeads) {
      delete d.enquiries;
      delete d.quotations;
      delete d.invoices;
      delete d.counters;
    }
    return {
      schemaVersion: MOCK_SCHEMA,
      exportedAt: now(),
      data: d as Record<string, unknown>,
    };
  },
  async importSnapshot(snapshot: unknown): Promise<{ imported: string[] }> {
    await delay();
    require('backup:manage');
    const snap = snapshot as Partial<DataSnapshot>;
    if (
      !snap ||
      typeof snap !== 'object' ||
      typeof snap.data !== 'object' ||
      snap.data === null
    )
      throw new ApiError('This is not a Baba Solars data file.', {
        code: 'validation',
      });
    const data = snap.data as Record<string, unknown>;
    const LIST_KEYS = [
      ...PUBLIC_KEYS,
      'enquiries',
      'quotations',
      'invoices',
      'companies',
      'catalog',
    ] as const;
    return transaction(
      (d) => {
        const imported: string[] = [];
        for (const k of LIST_KEYS) {
          const list = data[k];
          if (list === undefined) continue;
          if (
            !Array.isArray(list) ||
            !list.every(
              (x) => x && typeof (x as { id?: unknown }).id === 'string',
            )
          )
            throw new ApiError(`"${k}" in the file is not a valid list.`, {
              code: 'validation',
            });
          let rows = list as never[];
          if (k === 'pricingPlans')
            rows = (list as never[]).map(normalizePricingPlan) as never[];
          if (k === 'capacityPlans')
            rows = (list as never[]).map(normalizeCapacityPlan) as never[];
          (d as unknown as Record<string, unknown>)[k] = rows;
          imported.push(k);
        }
        if (data.content && typeof data.content === 'object') {
          d.content = migrateCompanyContacts(
            mergeDefaults(d.content, data.content),
          );
          imported.push('content');
        }
        if (data.business && typeof data.business === 'object') {
          d.business = migrateCompanyContacts(
            mergeDefaults(d.business, data.business),
          );
          imported.push('business');
        }
        if (data.counters && typeof data.counters === 'object')
          d.counters = {
            ...d.counters,
            ...(data.counters as Record<string, number>),
          };
        if (!imported.length)
          throw new ApiError('The file contains no site data.', {
            code: 'validation',
          });
        return { imported };
      },
      { site: true },
    );
  },
  /**
   * Server mode: merge the quotation / invoice copies kept by the server (saved with their files)
   * into this browser — a new PC or cleared browser gets its records back. Newer copy wins, and the
   * numbering counters move past every restored number so new documents never reuse one.
   */
  async restoreRecords(
    snapshots: Array<{ kind: 'quotation' | 'billing'; record: unknown }>,
  ): Promise<{ restored: number }> {
    const canQ = !!currentUser() && permissionsFor(currentUser()!.role).includes('quotations:write');
    const canI = !!currentUser() && permissionsFor(currentUser()!.role).includes('invoices:write');
    const isQuote = (r: unknown): r is Quotation => !!r && typeof (r as Quotation).id === 'string' && typeof (r as Quotation).quoteNumber === 'string' && typeof (r as Quotation).customerName === 'string' && Array.isArray((r as Quotation).items ?? []);
    const isInvoice = (r: unknown): r is Invoice => !!r && typeof (r as Invoice).id === 'string' && typeof (r as Invoice).invoiceNumber === 'string' && Array.isArray((r as Invoice).items) && Array.isArray((r as Invoice).payments);
    const bump = (counters: Record<string, number>, type: 'quotation' | 'invoice', num: string) => {
      const m = /(\d{4}-\d{2})\/(\d+)$/.exec(num);
      if (m) counters[`${type}:${m[1]}`] = Math.max(counters[`${type}:${m[1]}`] ?? 0, Number(m[2]));
    };
    const newer = (a?: string, b?: string) => (a ?? '') > (b ?? '');
    return transaction((d) => {
      let restored = 0;
      for (const s of snapshots) {
        if (s.kind === 'quotation' && canQ && isQuote(s.record)) {
          const r = clone(s.record);
          const i = d.quotations.findIndex((x) => x.id === r.id);
          if (i < 0) { d.quotations = [r, ...d.quotations]; restored++; }
          else if (newer(r.updatedAt, d.quotations[i].updatedAt)) { d.quotations[i] = r; restored++; }
          bump(d.counters, 'quotation', r.quoteNumber!);
        } else if (s.kind === 'billing' && canI && isInvoice(s.record)) {
          const r = clone(s.record);
          const i = d.invoices.findIndex((x) => x.id === r.id);
          if (i < 0) { d.invoices = [r, ...d.invoices]; restored++; }
          else if (newer(r.updatedAt, d.invoices[i].updatedAt)) { d.invoices[i] = r; restored++; }
          bump(d.counters, 'invoice', r.invoiceNumber);
        }
      }
      return { restored };
    });
  },
  /** Calculator helper for pages that need the full result with company pricing. */
  calculate: calculateSolar,
  _persist: persist,
};

/** Downscale + re-encode an image in the browser so it fits in localStorage. */
async function compressImage(file: File, maxSize: number): Promise<string> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap)
    throw new ApiError('This file is not a readable image.', {
      code: 'validation',
    });
  const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  // PNG keeps transparency (logos); photos become JPEG.
  const keepPng =
    file.type === 'image/png' && canvas.width * canvas.height <= 800 * 800;
  return canvas.toDataURL(keepPng ? 'image/png' : 'image/jpeg', 0.82);
}
