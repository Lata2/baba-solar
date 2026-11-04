/**
 * BROWSER DATA STORE
 * ─────────────────────────────────────────────────────────────────────────
 * The whole dataset (website content, plans, services, projects, reviews, images, enquiries,
 * quotations, invoices, settings) is one JSON document kept in IndexedDB — it holds far more
 * than localStorage (uploaded images are stored as compressed data URLs inside it).
 *
 *  • Reads are synchronous from an in-memory copy loaded once at boot (`initStore()`).
 *  • Writes go through `transaction()`: the change is applied in memory, written to IndexedDB,
 *    and rolled back if the write fails — so a failed save never leaves half-saved data.
 *  • Other tabs are told about every write over a BroadcastChannel and reload (SiteSync).
 *  • Falls back to localStorage, then memory only, if IndexedDB is unavailable.
 *
 * Limitations: data lives in this browser on this device only; clearing site data deletes it.
 * Use Settings → Backup to export a JSON copy. A future backend replaces this module + mockApi.
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
  Proposal,
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
import { normalizeEnquiry } from '@/lib/enquiries';


/** Pre-IndexedDB releases kept everything under this localStorage key (migrated on first load). */
export const MOCK_DB_KEY = 'baba-solars:mock-db';
/** 6: enquiry fields (origin, address, capacity…), proposals, industrial tariff, plan tiers. */
export const MOCK_SCHEMA = 6;
const LEGACY_SESSION_KEY = 'baba-solars:mock-session';
const IDB_NAME = 'baba-solars';
const IDB_STORE = 'kv';
const IDB_KEY = 'db';
export const SYNC_CHANNEL = 'baba-solars-sync';

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
  proposals: Proposal[];
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
    version: 'seed', // matches prerendered pages (data-published="seed") so they hydrate; changes on the first edit
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
    proposals: [],
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
let backend: 'idb' | 'local' | 'memory' = 'memory';
let idb: IDBDatabase | null = null;
let channel: BroadcastChannel | null = null;
/** Identifies this tab in sync messages so it ignores its own writes. */
const TAB_ID = Math.random().toString(36).slice(2);

const isBrowser = () => typeof window !== 'undefined';

function openIdb(): Promise<IDBDatabase | null> {
  if (!isBrowser() || typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function idbRequest<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    if (!idb) return reject(new Error('IndexedDB is not open'));
    const tx = idb.transaction(IDB_STORE, mode);
    const req = run(tx.objectStore(IDB_STORE));
    tx.oncomplete = () => resolve(req.result as T);
    tx.onerror = () => reject(tx.error ?? req.error);
    tx.onabort = () => reject(tx.error ?? new Error('Write aborted'));
  });
}

function localGet(): string | null {
  try {
    return window.localStorage.getItem(MOCK_DB_KEY);
  } catch {
    return null;
  }
}

/** Bring a stored dataset up to the current schema; null if it cannot be used. */
function migrate(parsed: MockDb | null | undefined): MockDb | null {
  if (!parsed || typeof parsed !== 'object' || !(parsed.schema >= 2 && parsed.schema <= MOCK_SCHEMA)) return null;
  parsed.users = [];
  for (const k of ['enquiries', 'proposals', 'quotations', 'invoices'] as const) if (!Array.isArray(parsed[k])) parsed[k] = [];
  // Schema 6: older enquiries get origin/address/notes…; unknown values fall back safely.
  parsed.enquiries = parsed.enquiries.filter((e) => e && typeof e.id === 'string').map(normalizeEnquiry);
  parsed.counters ??= {};
  parsed.content = migrateCompanyContacts(
    mergeDefaults(withContentDefaults(seed.content as SiteContent), withContentDefaults(parsed.content)),
  );
  parsed.business = migrateCompanyContacts(mergeDefaults(seedBusiness, parsed.business));
  // Schema 6: the calculator/pricing label "Business" is now "Commercial" (only if never customised).
  if (parsed.content.pricingPage?.tabs?.commercial?.label === 'Business') parsed.content.pricingPage.tabs.commercial.label = 'Commercial';
  // Correct only the original seeded company values; retain any deliberate settings edits.
  if (parsed.business.gstin === '22ABCDE1234F1Z5') parsed.business.gstin = seedBusiness.gstin;
  if (parsed.business.pan === 'ABCDE1234F') parsed.business.pan = seedBusiness.pan;
  if (parsed.business.phone === LEGACY_COMPANY_CONTACT.phone) parsed.business.phone = COMPANY_CONTACT.phone;
  if (parsed.business.email === LEGACY_COMPANY_CONTACT.email) parsed.business.email = COMPANY_CONTACT.email;
  if (parsed.business.address === LEGACY_COMPANY_CONTACT.businessAddress) parsed.business.address = COMPANY_CONTACT.businessAddress;
  parsed.schema = MOCK_SCHEMA;
  return parsed;
}

async function readStored(): Promise<MockDb | null> {
  if (backend === 'idb') {
    try {
      return migrate(await idbRequest<MockDb | undefined>('readonly', (s) => s.get(IDB_KEY)));
    } catch {
      return null;
    }
  }
  if (backend === 'local') {
    try {
      const raw = localGet();
      return raw ? migrate(JSON.parse(raw) as MockDb) : null;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Load the dataset once, before the app renders. Order: IndexedDB → (one-time) the old
 * localStorage copy → the bundled seed.
 */
let initPromise: Promise<void> | null = null;
export function initStore(): Promise<void> {
  initPromise ??= (async () => {
    if (!isBrowser()) return;
    try { window.localStorage.removeItem(LEGACY_SESSION_KEY); } catch { /* ignore */ }
    idb = await openIdb();
    backend = idb ? 'idb' : localStorageWorks() ? 'local' : 'memory';
    let loaded = await readStored();
    if (!loaded && backend === 'idb') {
      // One-time move from the localStorage copy used by earlier releases.
      try {
        const raw = localGet();
        loaded = raw ? migrate(JSON.parse(raw) as MockDb) : null;
      } catch { loaded = null; }
    }
    cache = loaded ?? createSeedDb();
    try {
      await persist();
      if (backend === 'idb') window.localStorage.removeItem(MOCK_DB_KEY);
    } catch { /* keep working in memory; the next save reports the problem */ }
    if (typeof BroadcastChannel !== 'undefined') channel = new BroadcastChannel(SYNC_CHANNEL);
  })();
  return initPromise;
}

function localStorageWorks(): boolean {
  try {
    window.localStorage.setItem('baba-solars:probe', '1');
    window.localStorage.removeItem('baba-solars:probe');
    return true;
  } catch {
    return false;
  }
}

/** Where data is kept in this browser (shown in Settings → Backup). */
export const storageBackend = () => backend;

/** The current dataset. Synchronous: `initStore()` has already loaded it in the browser. */
export function db(): MockDb {
  if (!cache) cache = createSeedDb(); // prerender, unit tests, or a call before boot
  return cache;
}

/** Write the in-memory dataset to browser storage. Rejects with a friendly error when storage is full. */
async function persist(): Promise<void> {
  if (!cache || !isBrowser()) return;
  try {
    if (backend === 'idb') await idbRequest('readwrite', (s) => s.put(cache, IDB_KEY));
    else if (backend === 'local') window.localStorage.setItem(MOCK_DB_KEY, JSON.stringify(cache));
  } catch (e) {
    const full = e instanceof DOMException && /quota/i.test(e.name + e.message);
    throw new ApiError(
      full
        ? 'Browser storage is full. Delete some uploaded images or old records, or export a backup and remove unneeded data.'
        : 'Could not save in this browser. Check that site storage is allowed (not private browsing) and try again.',
      { code: 'storage' },
    );
  }
}

/**
 * Run a write. The change is applied in memory and saved; on any error (validation or storage)
 * the previous data is restored, so a failed save changes nothing.
 */
export async function transaction<T>(fn: (d: MockDb) => T, { site = false } = {}): Promise<T> {
  const d = db();
  const backup = structuredClone(d);
  try {
    const result = fn(d);
    if (site) d.version = new Date().toISOString();
    await persist();
    try { channel?.postMessage({ type: 'db-changed', from: TAB_ID, site }); } catch { /* ignore */ }
    return result;
  } catch (e) {
    cache = backup;
    throw e;
  }
}

/** Re-read from storage (another tab saved). */
export async function reloadFromStorage(): Promise<void> {
  const fresh = await readStored();
  if (fresh) cache = fresh;
}

/** Messages from other tabs (used by SiteSync). Returns an unsubscribe function. */
export function onExternalChange(listener: () => void): () => void {
  if (!isBrowser() || typeof BroadcastChannel === 'undefined') return () => {};
  const ch = new BroadcastChannel(SYNC_CHANNEL);
  ch.onmessage = (e: MessageEvent<{ type?: string; from?: string }>) => {
    if (e.data?.type === 'db-changed' && e.data.from !== TAB_ID) listener();
  };
  return () => ch.close();
}

/** Delete every saved change and start again from the bundled content (Settings → Backup). */
export async function resetStore(): Promise<void> {
  cache = createSeedDb();
  await persist();
  try { channel?.postMessage({ type: 'db-changed', from: TAB_ID, site: true }); } catch { /* ignore */ }
}
