/**
 * In-browser site/business data adapter. It persists its dataset in this browser; authentication
 * credentials and sessions are never part of this store. Do not use it for sensitive production
 * records; those require a server-side data API and access controls.
 */
import type {
  BusinessSettings,
  CapacityPlan,
  CatalogItem,
  Company,
  Enquiry,
  Faq,
  GalleryImage,
  HeroSlide,
  Invoice,
  PricingPlan,
  Project,
  Quotation,
  Service,
  SiteContent,
  Testimonial,
} from '@/types';
import siteData from './seed/site-data.json';
import { withContentDefaults } from '@/data/settings-defaults';
import {
  mergeDefaults,
  normalizeCapacityPlan,
  normalizePricingPlan,
} from '@/lib/schemas';
import { seedCompanies } from './seed/companies';
import { seedCatalog } from './seed/catalog';
import { seedBusiness } from './seed/business';
import {
  COMPANY_CONTACT,
  LEGACY_COMPANY_CONTACT,
  migrateCompanyContacts,
} from '@/config/company';
import type { MockUser } from './seed/users';
import { buildDemoDocuments } from './seed/demo';
import { ApiError } from '@/services/errors';

export const MOCK_DB_KEY = 'baba-solars:mock-db';
export const MOCK_SCHEMA = 5;
const LEGACY_SESSION_KEY = 'baba-solars:mock-session';

export interface MockDb {
  schema: number;
  /** Changes whenever public website data changes (used like a published version). */
  version: string;
  content: SiteContent;
  pricingPlans: PricingPlan[];
  capacityPlans: CapacityPlan[];
  services: Service[];
  projects: Project[];
  testimonials: Testimonial[];
  faqs: Faq[];
  heroSlides: HeroSlide[];
  gallery: GalleryImage[];
  enquiries: Enquiry[];
  quotations: Quotation[];
  invoices: Invoice[];
  companies: Company[];
  catalog: CatalogItem[];
  business: BusinessSettings;
  users: MockUser[];
  counters: Record<string, number>;
}

type SeedJson = { data: Record<string, unknown> };
const seed = (siteData as SeedJson).data;
const withStatus = <T extends { status?: string; order?: number }>(list: T[]) =>
  list.map((x, i) => ({ status: 'published', order: i + 1, ...x }));

export function createSeedDb(): MockDb {
  const base: MockDb = structuredClone({
    schema: MOCK_SCHEMA,
    version: new Date().toISOString(),
    content: withContentDefaults(seed.content as SiteContent),
    pricingPlans: (seed.pricingPlans as PricingPlan[]).map(
      normalizePricingPlan,
    ),
    capacityPlans: (seed.capacityPlans as CapacityPlan[]).map(
      normalizeCapacityPlan,
    ),
    services: seed.services as Service[],
    projects: seed.projects as Project[],
    testimonials: withStatus(seed.testimonials as Testimonial[]),
    faqs: withStatus(seed.faqs as Faq[]),
    heroSlides: seed.heroSlides as HeroSlide[],
    gallery: seed.gallery as GalleryImage[],
    enquiries: [],
    quotations: [],
    invoices: [],
    companies: seedCompanies,
    catalog: seedCatalog,
    business: seedBusiness,
    users: [],
    counters: {},
  });
  if (import.meta.env.MODE === 'test') buildDemoDocuments(base);
  return base;
}

let cache: MockDb | null = null;
let legacyAuthDataCleared = false;

/** Remove credentials and client sessions saved by older frontend releases. */
export function clearLegacyAuthData(): void {
  if (legacyAuthDataCleared || typeof window === 'undefined') return;
  legacyAuthDataCleared = true;
  try {
    window.localStorage.removeItem(LEGACY_SESSION_KEY);
    const raw = window.localStorage.getItem(MOCK_DB_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Partial<MockDb>;
    const hasLegacyRecords = [parsed.enquiries, parsed.quotations, parsed.invoices]
      .some((records) => Array.isArray(records) && records.length > 0);
    if (
      parsed.users?.length
      || hasLegacyRecords
    ) {
      parsed.users = [];
      parsed.enquiries = [];
      parsed.quotations = [];
      parsed.invoices = [];
      window.localStorage.setItem(MOCK_DB_KEY, JSON.stringify(parsed));
    }
  } catch {
    // Authentication never reads browser storage, even if cleanup is unavailable.
  }
}

function storageGet(): string | null {
  try {
    return window.localStorage.getItem(MOCK_DB_KEY);
  } catch {
    return null;
  }
}

/** The current database (loaded once, seeded on first use or after a schema change). */
export function db(): MockDb {
  clearLegacyAuthData();
  if (cache) return cache;
  if (typeof window === 'undefined') return (cache = createSeedDb()); // prerender / tests
  const raw = storageGet();
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as MockDb;
      if (parsed.schema >= 2 && parsed.schema <= MOCK_SCHEMA) {
        parsed.users = [];
        parsed.content = migrateCompanyContacts(
          mergeDefaults(
            withContentDefaults(seed.content as SiteContent),
            withContentDefaults(parsed.content),
          ),
        );
        parsed.business = mergeDefaults(seedBusiness, parsed.business);
        parsed.business = migrateCompanyContacts(parsed.business);
        // Correct only the original seeded company values; retain any deliberate settings edits.
        if (parsed.business.gstin === '22ABCDE1234F1Z5')
          parsed.business.gstin = seedBusiness.gstin;
        if (parsed.business.pan === 'ABCDE1234F')
          parsed.business.pan = seedBusiness.pan;
        if (parsed.business.phone === LEGACY_COMPANY_CONTACT.phone)
          parsed.business.phone = COMPANY_CONTACT.phone;
        if (parsed.business.email === LEGACY_COMPANY_CONTACT.email)
          parsed.business.email = COMPANY_CONTACT.email;
        if (parsed.business.address === LEGACY_COMPANY_CONTACT.businessAddress)
          parsed.business.address = COMPANY_CONTACT.businessAddress;
        parsed.schema = MOCK_SCHEMA;
        cache = parsed;
        persist();
        return (cache = parsed);
      }
    } catch {
      /* corrupt → reseed */
    }
  }
  cache = createSeedDb();
  persist();
  return cache;
}

/** Save to localStorage. Throws a friendly error when the browser storage is full. */
export function persist(): void {
  if (!cache || typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(MOCK_DB_KEY, JSON.stringify(cache));
  } catch {
    throw new ApiError(
      'Browser storage is full. Remove large uploaded images or export and clear unneeded site content.',
      { code: 'storage' },
    );
  }
}

/** Run a write; on any error the in-memory data is restored, so a failed save changes nothing. */
export function transaction<T>(fn: (d: MockDb) => T, { site = false } = {}): T {
  const d = db();
  const backup = structuredClone(d);
  try {
    const result = fn(d);
    if (site) d.version = new Date().toISOString();
    persist();
    return result;
  } catch (e) {
    cache = backup;
    throw e;
  }
}

/** Re-read from localStorage (another tab saved). */
export function reloadFromStorage() {
  cache = null;
}
