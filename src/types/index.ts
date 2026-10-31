/** Domain types shared by the public site, admin panel and API layer. */

export type PublishStatus = 'published' | 'draft';

export type IconName =
  | 'sun'
  | 'home'
  | 'building'
  | 'factory'
  | 'battery'
  | 'droplets'
  | 'wrench'
  | 'shield'
  | 'clipboard'
  | 'gauge'
  | 'plug'
  | 'leaf'
  | 'file'
  | 'zap'
  | 'award'
  | 'users'
  | 'headset'
  | 'drone'
  | 'calendar'
  | 'sparkles';

export type PlanCategory = 'residential' | 'commercial' | 'maintenance';

export interface PricingPlan {
  id: string;
  name: string;
  category: PlanCategory;
  /** System size in kW; null for service plans like AMC */
  capacityKw: number | null;
  priceMin: number;
  priceMax: number;
  /** Estimated central subsidy in INR (0 if not applicable) */
  subsidy: number;
  /** e.g. "per visit", "per year". Empty for one-time system prices */
  priceUnit: string;
  idealFor: string;
  monthlyGeneration: string;
  roofArea: string;
  features: string[];
  featured: boolean;
  /** Ribbon text when featured. Empty = automatic ("Most chosen" / "Included free"). */
  badge: string;
  /** Button label. Empty = the default from Pricing page text. */
  ctaLabel: string;
  status: PublishStatus;
  order: number;
  updatedAt: string;
}

export type CapacitySegment = 'residential' | 'commercial' | 'industrial';

export interface SpecRow {
  label: string;
  value: string;
}

/** "Solar plans by capacity" cards on the Pricing page (specs only, price on survey). */
export interface CapacityPlan {
  id: string;
  segment: CapacitySegment;
  name: string;
  subtitle: string;
  /** Display text, e.g. "3 kW" or "10 kW – 50 kW" */
  capacity: string;
  specs: SpecRow[];
  features: string[];
  featured: boolean;
  /** Ribbon shown on a featured card */
  badge: string;
  /** Line above the button, e.g. "Price: on free site survey" */
  priceNote: string;
  ctaLabel: string;
  status: PublishStatus;
  order: number;
  updatedAt: string;
}

export type ServiceGroup = 'installation' | 'maintenance' | 'support';

export interface Service {
  id: string;
  slug: string;
  title: string;
  group: ServiceGroup;
  icon: IconName;
  summary: string;
  description: string;
  includes: string[];
  startingPrice: string;
  /** Optional ribbon shown on the card, e.g. "New" or "Free for 6 months" */
  highlight?: string;
  status: PublishStatus;
  order: number;
}

export type ProjectCategory =
  | 'residential'
  | 'commercial'
  | 'industrial'
  | 'maintenance';

export interface Project {
  id: string;
  title: string;
  location: string;
  category: ProjectCategory;
  capacityKw: number;
  /** YYYY-MM */
  completedOn: string;
  summary: string;
  highlights: string[];
  /** Optional photo URL. A generated illustration is shown when empty. */
  imageUrl: string;
  featured: boolean;
  status: PublishStatus;
}

export interface Testimonial {
  id: string;
  name: string;
  location: string;
  system: string;
  rating: number;
  quote: string;
  status?: PublishStatus;
  order?: number;
}

export interface Faq {
  id: string;
  category: 'general' | 'pricing' | 'subsidy' | 'maintenance';
  question: string;
  answer: string;
  status?: PublishStatus;
  order?: number;
}

export type EnquiryStatus = 'new' | 'contacted' | 'closed';
export type EnquirySource = 'contact' | 'calculator' | 'pricing' | 'service';

export interface Enquiry {
  id: string;
  name: string;
  phone: string;
  email: string;
  city: string;
  service: string;
  message: string;
  source: EnquirySource;
  status: EnquiryStatus;
  createdAt: string;
}

export type QuotationStatus = 'pending' | 'sent' | 'accepted' | 'rejected';
export type SystemType = 'on-grid' | 'hybrid' | 'off-grid';
export type PropertyType = 'residential' | 'commercial' | 'housing-society';
export type RoofType = 'rcc' | 'tin' | 'ground';

/** One price line on a quotation or invoice (amounts are computed by the server). */
export interface LineItem {
  id: string;
  name: string;
  sku?: string;
  description: string;
  hsn: string;
  unit: string;
  quantity: number;
  rate: number;
  discountPct: number;
  gstRate: number;
}

export interface TaxBreakup {
  gstRate: number;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
}

export interface CompanySnapshot {
  id: string;
  name: string;
  quality?: Quality;
  panelModel: string;
  panelTechnology: string;
  panelWattage: number;
  panelWarrantyYears: number;
  performanceWarrantyYears: number;
  inverterBrand: string;
  inverterModel: string;
  inverterWarrantyYears: number;
  structureDetails: string;
  workmanshipWarrantyYears: number;
}

export interface Quotation {
  id: string;
  quoteNumber?: string | null;
  source?: 'website' | 'admin';
  quoteDate?: string;
  validUntil?: string | null;
  customerName: string;
  phone: string;
  email: string;
  city: string;
  address?: string;
  state?: string;
  gstin?: string;
  consumerNumber?: string;
  discom?: string;
  sanctionedLoadKw?: number | null;
  propertyType: PropertyType;
  systemType: SystemType;
  roofType?: RoofType;
  capacityKw: number;
  monthlyBill: number;
  annualGenerationKwh?: number;
  companyId?: string | null;
  company?: CompanySnapshot | null;
  /** Material quality tier chosen for the package. */
  quality?: Quality;
  /** Package price from the company price list (incl. GST) when the quote was priced. */
  packagePrice?: number | null;
  items?: LineItem[];
  supplyType?: 'intra' | 'inter';
  discount?: number;
  subtotal?: number;
  taxableAmount?: number;
  cgst?: number;
  sgst?: number;
  igst?: number;
  taxTotal?: number;
  roundOff?: number;
  grandTotal?: number;
  taxBreakup?: TaxBreakup[];
  /** Total system cost incl. GST (or the calculator estimate when there are no lines). */
  estimatedCost: number;
  /** Central subsidy (PM Surya Ghar CFA). */
  subsidy: number;
  stateSubsidy?: number;
  /** Name of the state scheme used for `stateSubsidy`, e.g. "Chhattisgarh State Subsidy". */
  stateSubsidyScheme?: string | null;
  /** true: subsidy follows the rules in Settings (recalculated on every save). */
  subsidyAuto?: boolean;
  netCost: number;
  paymentTerms?: string;
  terms?: string;
  status: QuotationStatus;
  notes: string;
  createdAt: string;
  updatedAt?: string;
}

/** Visual layouts supported by quotation PDFs (Tally is invoice-specific). */
export type QuotationTemplate = 'classic' | 'modern' | 'minimal';

export interface Stat {
  value: string;
  label: string;
}

export interface HeroSlide {
  id: string;
  /** Small line above the heading, e.g. "6 months free cleaning" */
  kicker: string;
  title: string;
  subtitle: string;
  imageUrl: string;
  ctaLabel: string;
  ctaLink: string;
  status: PublishStatus;
  order: number;
}

export type GalleryCategory =
  | 'installation'
  | 'residential'
  | 'commercial'
  | 'cleaning';

export interface GalleryImage {
  id: string;
  imageUrl: string;
  caption: string;
  category: GalleryCategory;
  status: PublishStatus;
  order: number;
}

export interface Highlight {
  icon: IconName;
  title: string;
  text: string;
}

/** A simple title + text item used by many editable lists. */
export interface TextItem {
  id: string;
  title: string;
  text: string;
}

/** Card with photo and link (home "Our Solar Solutions"). */
export interface LinkCard extends TextItem {
  image: string;
  link: string;
}

export interface AreaCard {
  id: string;
  name: string;
  text: string;
  image: string;
}

export interface TimelineItem {
  id: string;
  year: string;
  text: string;
}

export interface PricingTabText {
  label: string;
  note: string;
}

export interface PricingPageContent {
  heroTitle: string;
  heroIntro: string;
  capacityKicker: string;
  capacityTitle: string;
  capacityIntro: string;
  rangesKicker: string;
  rangesTitle: string;
  tabsLabel: string;
  tabs: Record<PlanCategory, PricingTabText>;
  featuredBadge: string;
  freeBadge: string;
  freePriceLabel: string;
  ctaLabel: string;
  emptyTitle: string;
  emptyMessage: string;
  disclaimerTitle: string;
  disclaimerText: string;
  calculatorTitle: string;
  faqTitle: string;
  ctaBandTitle: string;
}

export interface HomeContent {
  sixMonthKicker: string;
  sixMonthTitle: string;
  sixMonthIntro: string;
  sixMonthButton: string;
  trustKicker: string;
  solutionsKicker: string;
  solutionsTitle: string;
  solutionsIntro: string;
  solutionsLinkLabel: string;
  solutions: LinkCard[];
  maintenanceKicker: string;
  maintenanceTitle: string;
  maintenanceText: string;
  maintenancePoints: string[];
  maintenancePrimaryLabel: string;
  maintenancePrimaryLink: string;
  maintenanceSecondaryLabel: string;
  maintenanceSecondaryLink: string;
  missionKicker: string;
  missionTitle: string;
  missionText: string;
  missionButton: string;
  whyKicker: string;
  whyTitle: string;
  whyUs: TextItem[];
  calculatorKicker: string;
  calculatorTitle: string;
  calculatorIntro: string;
  areasKicker: string;
  areasTitle: string;
  areas: AreaCard[];
  partnersTitle: string;
  benefits: TextItem[];
  videoText: string;
  photoText: string;
  testimonialsKicker: string;
  testimonialsTitle: string;
}

export interface AboutContent {
  heroTitle: string;
  heroIntro: string;
  storyTitle: string;
  story: string[];
  missionTitle: string;
  missionText: string;
  principlesTitle: string;
  principlesIntro: string;
  principles: TextItem[];
  timelineTitle: string;
  timeline: TimelineItem[];
  ctaTitle: string;
}

export interface ServicesPageContent {
  heroTitle: string;
  heroIntro: string;
  groups: Record<ServiceGroup, { title: string; intro: string }>;
  dustTitle: string;
  dustText: string;
  dustButton: string;
  dustStats: Stat[];
}

export interface CtaContent {
  title: string;
  text: string;
  primaryLabel: string;
  primaryLink: string;
  whatsappLabel: string;
}

export interface SiteContent {
  businessName: string;
  tagline: string;
  heroTitle: string;
  heroSubtitle: string;
  phone: string;
  whatsapp: string;
  email: string;
  address: string;
  hours: string;
  announcement: string;
  announcementEnabled: boolean;
  stats: Stat[];
  serviceAreas: string[];
  highlights: Highlight[];
  partners: string[];
  /** YouTube link for the "Watch our recent installation" section. Empty shows a photo instead. */
  videoUrl: string;
  social: {
    facebook: string;
    instagram: string;
    youtube: string;
    linkedin?: string;
  };
  /** Google Maps link for the address (optional). */
  mapUrl?: string;
  home: HomeContent;
  pricingPage: PricingPageContent;
  servicesPage: ServicesPageContent;
  about: AboutContent;
  cta: CtaContent;
  brand: BrandSettings;
  seo: SeoSettings;
  calculator: CalculatorSettings;
  updatedAt?: string;
}

export interface BrandSettings {
  /** Full logo for the header and documents. Empty = built-in logo. */
  logoUrl: string;
  /** Square icon used in the footer, loader and admin. Empty = built-in icon. */
  logoMarkUrl: string;
  faviconUrl: string;
  primaryColor: string;
}

export type SeoPageKey =
  | 'home'
  | 'about'
  | 'services'
  | 'pricing'
  | 'calculator'
  | 'projects'
  | 'gallery'
  | 'faqs'
  | 'contact'
  | 'droneCleaning'
  | 'suryaGhar';

export interface SeoSettings {
  siteTitle: string;
  siteDescription: string;
  keywords: string;
  ogImage: string;
  siteUrl: string;
  googleSiteVerification: string;
  pages: Record<SeoPageKey, { title: string; description: string }>;
}

export interface CostSlab {
  upToKw: number | null;
  pricePerKw: number;
}

/** Assumptions behind the solar calculator — editable in Admin → Settings → Calculator. */
/** Telescopic energy slab: `rate` ₹/kWh for units above the previous slab up to `upToUnits` (null = no limit). */
export interface TariffSlab {
  upToUnits: number | null;
  rate: number;
}

/** CSPDCL LV tariff used to turn a bill into units and to work out the bill with solar. */
export interface ElectricityTariffSettings {
  /** Off = old behaviour (one flat ₹/unit = defaultTariff). */
  enabled: boolean;
  /** Shown on the website, e.g. "CSPDCL FY 2026-27". */
  label: string;
  domesticEnergy: TariffSlab[];
  /** LV-1 fixed charge, telescopic on sanctioned load (₹ per kW per month). */
  domesticFixed: { upToKw: number | null; perKw: number }[];
  lv21Energy: TariffSlab[];
  lv21FixedPerKw: number;
  lv22SmallEnergy: TariffSlab[];
  lv22SmallDemandPerKw: number;
  lv22LargeEnergy: TariffSlab[];
  lv22LargeDemandPerKw: number;
  /** FPPAS, % of energy charges. */
  fppasPercent: number;
  /** Electricity duty, % of energy charges. */
  dutyDomesticPercent: number;
  dutyNonDomesticPercent: number;
  /** Bijli Bill Half / M-Urja rebate for LV-1 homes. */
  halfBill: {
    enabled: boolean;
    percent: number;
    unitsCovered: number;
    maxUnits: number;
  };
  /** Load assumed when the visitor does not enter a sanctioned load. */
  defaultLoadKw: { domestic: number; commercial: number };
  /** Bills are rounded to the nearest ₹ multiple (CSPDCL LV: 10). */
  roundTo: number;
}

export interface CalculatorSettings {
  unitsPerKwPerDay: number;
  defaultTariff: number;
  electricity: ElectricityTariffSettings;
  exportTariff: number;
  /** Percent per year */
  tariffEscalation: number;
  /** Percent per year */
  panelDegradation: number;
  co2KgPerUnit: number;
  sqftPerKw: number;
  /** ± percent around the midpoint price */
  priceBand: number;
  maxKw: number;
  costSlabs: CostSlab[];
  systemFactor: Record<SystemType, number>;
  roofFactor: Record<RoofType, number>;
  subsidy: SubsidySettings;
  disclaimer: string;
}

/** One step of a state top-up scheme: `amount` applies from `fromKw` upwards (highest step reached wins). */
export interface StateSubsidySlab {
  fromKw: number;
  amount: number;
}

/** State subsidy scheme, e.g. Chhattisgarh ₹15,000 for 1 kW / ₹30,000 for 2 kW and above. */
export interface StateSubsidyRule {
  id: string;
  /** GST state code, e.g. "22" */
  stateCode: string;
  schemeName: string;
  agency: string;
  enabled: boolean;
  slabs: StateSubsidySlab[];
  /** Connections that qualify (central eligibility rules also apply). */
  propertyTypes: PropertyType[];
  note: string;
}

export interface SubsidySettings {
  enabled: boolean;
  /** PM Surya Ghar CFA for homes (general category states). */
  perKwUpTo2: number;
  perKwThird: number;
  cap: number;
  /** Higher CFA for special category states/UTs. */
  specialCategory: { perKwUpTo2: number; perKwThird: number; cap: number };
  specialCategoryStates: string[];
  housingSocietyPerKw: number;
  housingSocietyMaxKw: number;
  hybridEligible: boolean;
  /** State used when a quote/calculation has no state (Baba Solars: Chhattisgarh "22"). */
  defaultStateCode: string;
  states: StateSubsidyRule[];
  /** Date the rates were last checked against government notifications. */
  verifiedOn: string;
}

export interface Database {
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
  content: SiteContent;
}

export type CollectionKey = Exclude<keyof Database, 'content'>;
export type CollectionItem<K extends CollectionKey> = Database[K][number];

/** Collections whose items have an `order` field and can be re-ordered in the admin panel. */
export type OrderedCollectionKey =
  | 'pricingPlans'
  | 'capacityPlans'
  | 'services'
  | 'heroSlides'
  | 'gallery'
  | 'testimonials'
  | 'faqs';

/** Collections shown on the public website (loaded for every visitor). Leads are admin-only. */
export type PublicCollectionKey = Exclude<
  CollectionKey,
  'enquiries' | 'quotations'
>;

/** Field-level validation errors, keyed by field path (e.g. "priceMax", "features.2"). */
export type FieldErrors = Record<string, string>;

// ─── Back-office (admin only) ───────────────────────────────────────────────
export type Role = 'admin' | 'editor' | 'sales';
export type Permission =
  | 'content:read'
  | 'content:write'
  | 'uploads:write'
  | 'leads:read'
  | 'leads:write'
  | 'companies:read'
  | 'companies:write'
  | 'quotations:read'
  | 'quotations:write'
  | 'invoices:read'
  | 'invoices:write'
  | 'invoices:delete'
  | 'business:read'
  | 'business:write'
  | 'users:manage'
  | 'backup:manage';

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: Role;
}
export interface StaffUser extends AdminUser {
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type Quality = 'normal' | 'premium';

/** Installed price of one package size for both quality tiers. */
export interface PackagePrice {
  capacityKw: number;
  normal: number;
  premium: number;
}

/** Equipment that defines a quality tier for a company. */
export interface QualitySpec {
  label: string;
  panelModel: string;
  panelTechnology: string;
  panelWattage: number;
  inverterBrand: string;
  inverterModel: string;
  structure: string;
  panelWarrantyYears: number;
  performanceWarrantyYears: number;
  inverterWarrantyYears: number;
}

/** Solar brand with its package price list (Admin → Companies & rates). */
export interface Company {
  id: string;
  name: string;
  description: string;
  logoUrl: string;
  isActive: boolean;
  order: number;
  /** true: package prices are the final price incl. GST (the client price list). */
  pricesIncludeGst: boolean;
  packages: PackagePrice[];
  qualities: Record<Quality, QualitySpec>;
  workmanshipWarrantyYears: number;
  /** Items included with every kit (printed on quotations). */
  kitIncludes: string[];
  updatedAt?: string;
}

/** How a package price is itemised on a quotation (share of the price per component). */
export interface BreakdownRow {
  key:
    | 'modules'
    | 'inverter'
    | 'structure'
    | 'cables'
    | 'protection'
    | 'installation'
    | 'transport';
  name: string;
  /** Percent of the package price */
  share: number;
  gstRate: number;
  hsn: string;
}

export interface CatalogItem {
  id: string;
  name: string;
  sku?: string;
  description: string;
  hsn: string;
  unit: string;
  rate: number;
  gstRate: number;
  category: 'kit' | 'bos' | 'service';
}

export type InvoiceTemplate = 'classic' | 'modern' | 'minimal' | 'tally';
export type DocumentTitle =
  | 'Tax Invoice'
  | 'Proforma Invoice'
  | 'Sales Order'
  | 'Bill of Supply';
export type InvoiceStatus = 'draft' | 'issued' | 'cancelled';
export type PaymentStatus = 'unpaid' | 'partial' | 'paid';
export type PaymentMethod =
  | 'cash'
  | 'upi'
  | 'bank_transfer'
  | 'cheque'
  | 'card'
  | 'loan'
  | 'other';

export interface Payment {
  id: string;
  date: string;
  amount: number;
  method: PaymentMethod;
  reference: string;
  note: string;
}

export interface Invoice {
  id: string;
  invoiceNumber: string;
  documentTitle: DocumentTitle;
  /** Buyer's order no. / reference (Tally "Buyer's Ref."). */
  reference: string;
  invoiceDate: string;
  dueDate: string | null;
  quotationId: string | null;
  template: InvoiceTemplate;
  status: InvoiceStatus;
  customerName: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  state: string;
  stateCode: string;
  gstin: string;
  placeOfSupply: string;
  supplyType: 'intra' | 'inter';
  items: LineItem[];
  discountType: 'amount' | 'percent';
  discountValue: number;
  subtotal: number;
  itemDiscount: number;
  overallDiscount: number;
  taxableAmount: number;
  cgst: number;
  sgst: number;
  igst: number;
  taxTotal: number;
  roundOff: number;
  grandTotal: number;
  taxBreakup: TaxBreakup[];
  amountPaid: number;
  amountDue: number;
  paymentStatus: PaymentStatus;
  paymentMethod: PaymentMethod | '';
  payments: Payment[];
  notes: string;
  terms: string;
  isOverdue: boolean;
  /** PM Surya Ghar / state subsidy information printed on the invoice (optional). */
  subsidy?: InvoiceSubsidy | null;
  createdAt: string;
  updatedAt: string;
}

/** Subsidy details entered on an invoice. `central`/`state` null = calculate from the rules. */
export interface InvoiceSubsidyInput {
  show: boolean;
  auto: boolean;
  capacityKw: number;
  propertyType: PropertyType;
  systemType: SystemType;
  central: number | null;
  state: number | null;
}

/** Subsidy as stored and printed: the invoice total stays the GST amount payable; subsidy is credited to the customer by the Government. */
export interface InvoiceSubsidy extends Omit<InvoiceSubsidyInput, 'central' | 'state'> {
  central: number;
  state: number;
  total: number;
  /** Invoice grand total − total subsidy. */
  netCost: number;
  centralScheme: string;
  stateScheme: string | null;
}

export interface InvoiceInput {
  documentTitle: DocumentTitle;
  reference: string;
  invoiceDate: string;
  dueDate: string | null;
  template: InvoiceTemplate;
  status: InvoiceStatus;
  quotationId: string | null;
  customerName: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  state: string;
  stateCode: string;
  gstin: string;
  items: LineItem[];
  discountType: 'amount' | 'percent';
  discountValue: number;
  paymentMethod: PaymentMethod | '';
  notes: string;
  terms: string;
  initialPayment?: Omit<Payment, 'id'> | null;
  subsidy?: InvoiceSubsidyInput | null;
}

export interface InvoiceList {
  items: Invoice[];
  total: number;
  page: number;
  pageSize: number;
  summary: { count: number; billed: number; paid: number; due: number };
}

export interface BusinessSettings {
  legalName: string;
  tradeName: string;
  gstin: string;
  cin: string;
  pan: string;
  address: string;
  city: string;
  state: string;
  stateCode: string;
  pincode: string;
  phone: string;
  email: string;
  website: string;
  logoUrl: string;
  signatoryName: string;
  signatoryTitle: string;
  mnreRegistration: string;
  bank: {
    accountName: string;
    accountNumber: string;
    ifsc: string;
    bankName: string;
    branch: string;
    upiId: string;
  };
  invoice: {
    prefix: string;
    defaultTemplate: InvoiceTemplate;
    defaultDueDays: number;
    roundOff: boolean;
    defaultNotes: string;
    defaultTerms: string;
  };
  quotation: {
    prefix: string;
    validityDays: number;
    showSubsidy: boolean;
    defaultPaymentTerms: string;
    defaultTerms: string;
    inclusions: string[];
    exclusions: string[];
  };
  /** Component split used to itemise package prices, per quality tier. */
  packageBreakdown: Record<Quality, BreakdownRow[]>;
  updatedAt?: string;
}
