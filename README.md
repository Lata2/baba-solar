# Baba Solars — Website & Admin Panel (frontend-only)

React 19 · Vite 8 · TypeScript · Tailwind CSS 4 · TanStack Query · React Router · jsPDF · ExcelJS

The public website and the admin panel run entirely in the browser. **There is no backend, API, database,
Firebase or external auth service.** Admin data is stored in the browser (IndexedDB), and the code is
organised so a backend can be added later without touching the pages.

---

## 1. Setup

Requirements: Node.js **20.19+** (or 22.12+) and npm 10+.

```bash
npm install
npm run dev          # http://localhost:5173  (admin: http://localhost:5173/admin)
```

### Admin login

| | |
|---|---|
| URL | `/admin` (redirects to `/admin/login`) |
| Email | `admin@babasolars.com` |
| Password | `Admin@123` |

Wrong credentials show an error. The session survives refreshes and is shared by tabs, renews while the
admin panel is in use, expires after 12 hours idle, and ends on **Log out** (every tab).
To change the credentials for a build, set `VITE_ADMIN_EMAIL` / `VITE_ADMIN_PASSWORD` (see `.env.example`)
or edit `src/config/auth.ts`.

## 2. Build & deploy

```bash
npm run build        # type-check + production build → dist/  (single-page app, dist/spa.html shell)
npm run build:ssg    # same + prerendered HTML for the 11 public pages (best for SEO / first paint)
npm run preview      # serve dist/ at http://localhost:4173 like a production host
```

Upload `dist/` to any static host. `vercel.json` (Vercel) and `public/_redirects` + `public/_headers`
(Netlify / Cloudflare Pages) already route every URL to the app and cache `/assets/*` for a year.

### Checks

```bash
npm run typecheck    # TypeScript
npm test             # unit tests (calculator & tariffs, leads workflow, import, pricing, GST, subsidy, PDF/Excel data, sign-in)
npm run build && npm run preview          # then, in a second terminal:
npx playwright install chromium           # first time only
npm run test:e2e        # browser test: login/logout, CRUD, uploads, persistence, website updates, responsive
npm run test:e2e:flows  # browser test: mobile menu, calculator, Normal/Premium, enquiries, import, proposals, quotations, billing
```

## 3. What the admin panel manages

| Section | What you can do | Where it shows on the website |
|---|---|---|
| Dashboard | Enquiry, proposal, quotation and billing stats; follow-ups due; website content counts; latest activity | — |
| Enquiries | Website, WhatsApp, phone, walk-in, referral, social, other and manual leads. Manual form, view/edit/delete, 8 statuses, follow-up date, search, filters (status, source), sorting, pagination. Excel/CSV import (column matching, preview, inline edit/remove rows, validation, duplicate check, result counts) and Excel export. Create a proposal or quotation from any enquiry | Contact/service forms and calculator "Request this quote" feed it |
| Proposals | From an enquiry (details copied) or blank; manual enquiries get a draft automatically. Auto numbers (BS/PRP/FY/0001), system, products/materials/charges, scope, terms, validity, status, PDF (preview, download, print), duplicate, delete, convert to quotation | — |
| Quotations | From an enquiry, from a proposal or blank; company price-list fill, custom items, discounts, GST; edit & re-generate; PDF & Excel; status & validity; link to enquiry/proposal kept; convert to invoice | — |
| Billing | Invoices with any custom item, catalog items, quick-add labour / installation / transport / fasteners / cables / other charges, discount, GST, payments, PDF & Excel | — |
| Products & rates | Products, materials, services, labour & other charges with HSN, unit, rate, GST; search, filter, sort, pagination, view/edit/delete, Excel export | Used by "Add from catalog" everywhere |
| Offers | Offers (default: Diwali 2026, 1–25 Nov) — add / edit / delete / enable-disable, title, description, kW slabs & gifts, **posters** (upload, order, link to a slab), **start/end dates**, terms, booking amount, lucky draw text, button text. Status shows Live / Scheduled / Ended / Disabled | First section of the home page (poster slider + gift cards), **/offers** page with all posters, marquee on every page, gold "Offers" button in the header. Hidden automatically outside its dates |
| Pricing | Price plans, **Normal & Premium plans** (names, price text, features, comparison rows, drone-cleaning switch), capacity plans, pricing page text | Pricing page, home page |
| Services | Add, edit, delete, search, filter by group, publish/hide | Services page, footer, contact form |
| Power plants (projects) | Add, edit, delete, photo upload, feature on home page | Power Plants page, home page |
| Reviews & FAQs | Testimonials and FAQs with search, status and category filters, reorder | Home, FAQ, pricing and service pages |
| Banner slides, Gallery | Photo upload with preview, captions, order, publish/hide | Home hero slider, gallery |
| Site content | Tabs for business & contact details, home, services, about, CTA, offer bar & brands, backup | Header, footer, contact page, every page |
| Settings | Business/GST details, logo & SEO, calculator (tariffs incl. industrial, generation factors, per-state yield, indicative tariffs) & subsidy rules, package breakdown | Calculator, PDFs, SEO tags |

Saved customers are reused everywhere: "Use saved customer" in enquiry, proposal, quotation and invoice forms
searches every customer from enquiries, proposals and quotations (by mobile number).

## 3a. Solar calculator — how it works

`src/lib/calculator.ts` (pure, unit-tested in `tests/unit/calculator.test.ts`) with tariffs in
`src/lib/electricityBill.ts` and the location registry in `src/lib/tariffRegistry.ts`.

* **Consumer type** Residential (optional housing-society), Commercial, Industrial — separate tariff categories.
* **Location**: country → state → DISCOM. **Only CSPDCL (Chhattisgarh) is a verified tariff**, from the
  CSERC Tariff Schedule FY 2026-27 (applicable 1 July 2026, checked 1 Nov 2026):
  LV-1 domestic, LV-2.1 / LV-2.2 non-domestic, LV-5.2.1 / LV-5.2.2 industry and HV-3 11 kV industry.
  Bills include telescopic slabs, fixed/demand charges (monthly minimum), FPPAS and electricity duty,
  less the state half-bill (M-Urja) rebate where eligible, rounded to ₹10 — never "bill ÷ one rate".
* **Every other state/DISCOM and other countries** use an *indicative* ₹/unit (Settings → Calculator) and the
  website shows **"Estimate needs confirmation"**. These values are averages of the verified CSPDCL bill, not
  other DISCOMs' tariffs. To add a verified DISCOM, add its rates and set `tariff` on it in `tariffRegistry.ts`.
* **Generation**: units/kW/day (4.2, south-facing, no shade, after ~20 % standard losses; optional per-state
  values) × roof-direction factor × shading factor × (1 − extra losses). These are engineering assumptions,
  editable in Settings, and listed under the result.
* **Results**: system size, cost range or company package price, central + state subsidy, net cost, generation,
  bill now/with solar, savings, payback, 25-year savings, CO₂, roof area.
* The tariff is never typed on the website. Values that are not in the tariff order — FPPAS (changes
  monthly), electricity duty (set by the Electricity Duty Act) — are configurable and should be checked
  against a recent bill.

Every form validates before saving (required fields, phone/email/GSTIN formats, price ranges…) and shows the
errors next to the fields. Lists have empty states, pages show loading skeletons, and failed saves roll back
and explain what went wrong. New items are published by default; use the eye icon to hide one.

## 4. How it works (and how to add a backend later)

```
src/
  config/auth.ts              ← admin credentials (frontend-only, see limitations)
  services/api.ts             ← THE single data entry point used by every page/hook
  services/localAuth.ts       ← login / session / logout  (swap for HTTP auth later)
  mocks/mockApi.ts            ← all data methods (CRUD, validation, quotes, invoices, uploads, backup)
  mocks/store.ts              ← IndexedDB persistence, rollback on failed writes, tab sync
  mocks/seed/                 ← the original website content (first run & "Reset")
  queries/                    ← TanStack Query hooks (cache, invalidation, optimistic updates)
  pages/public/               ← website pages (code-split per route)
  admin/                      ← admin layout, pages and form components (separate chunks)
  components/                 ← shared UI (Button, Field, Modal, Card…) and website sections
  lib/                        ← pure logic: pricing, GST totals, subsidy, calculator, validation
  pdf/, excel/                ← document generation (loaded only when needed)
```

Pages never touch storage directly: they call TanStack Query hooks, which call `api.*`. Each `api` method
is async and already shaped like an HTTP endpoint (`getCollection`, `upsertItem`, `removeItem`, `reorder`,
`updateContent`, `uploadImage`, `submitEnquiry`, …). To add a backend, implement the same methods with
`fetch` and assign them in `src/services/api.ts`; components, hooks and validation stay as they are.

### Storage

| Data | Where | Why |
|---|---|---|
| Website content, plans, services, projects, reviews, FAQs, slides, gallery, enquiries, quotations, invoices, settings | **IndexedDB** (`baba-solars` database) | Large capacity, holds uploaded images |
| Uploaded images | Inside the same IndexedDB record, resized to max 1600 px and re-encoded as WebP (JPEG fallback), max ~2 MB each | No file server available |
| Admin session | **localStorage** (`baba-solars:admin-session`) | Small, shared by tabs |
| Small UI preferences | localStorage | Per-browser convenience |

Data saved by an older version in localStorage is moved into IndexedDB automatically on first load.
Admin → Site content → **Backup & restore** downloads a JSON backup, restores one, shows storage usage,
and can reset everything to the original content.

## 5. Frontend-only limitations — please read

- **Calculator tariffs**: only CSPDCL is verified. Other locations are indicative and labelled so. Duty % and
  FPPAS % are configured assumptions; the half-bill rebate is valid until 31 Mar 2027 (CG cabinet, Oct 2026).
- **Login is not secure authentication.** The email and password are in the public JavaScript bundle, and
  the session is a value in localStorage that a technical user could create. It keeps casual visitors out
  of the admin screens; it does not protect data. Real security needs server-side login.
- **Data lives in one browser on one device.** Edits made in the admin panel appear on the website only in
  the same browser where they were made. Other visitors, phones and computers see the original bundled
  content until a backend is added. There is no automatic sync between users or devices.
- **Enquiries and quote requests stay in the visitor's browser.** The admin sees them only if they were sent
  from the same browser. That is why the success screens ask visitors to send their details on WhatsApp,
  which does reach the business.
- **Clearing browser data deletes everything** (and some browsers may evict storage under pressure — the
  app asks the browser to keep it persistent after login). Download backups regularly.
- **Images** are stored as compressed data inside IndexedDB; very large photos are rejected after
  compression. Hundreds of photos will slow saves down — a backend with file storage is the long-term fix.
- **Quotation/invoice records are business data**; without a backend they are not access-controlled or
  backed up anywhere except your downloaded backups and the optional "Saved documents" folder.
- Seed photos on the website are linked from `images.unsplash.com`; replace them with your own photos
  through the admin panel.

## 6. Environment variables (optional)

All `VITE_*` values are public (compiled into the browser bundle). See `.env.example`.

| Variable | Purpose |
|---|---|
| `VITE_SITE_URL` | Canonical URL for SEO tags (default `https://babasolars.in`) |
| `VITE_ADMIN_EMAIL`, `VITE_ADMIN_PASSWORD` | Override the frontend-only admin login |
| `VITE_APPS_SCRIPT_URL` | Google Apps Script Web App URL — website enquiries → Google Sheet + admin email (see **SETUP.md**) |
| `VITE_APPS_SCRIPT_TOKEN` | Shared token checked by the Apps Script (`API_TOKEN` Script Property) |
| `VITE_ENQUIRY_WHATSAPP` | Optional WhatsApp number for enquiries (default `919203900410`) |
| `VITE_ENQUIRY_DELIVERY` | `client` (default): the browser sends the Sheet row + email. `server`: a backend (e.g. a Firebase Cloud Function) does it on enquiry create |

## 7. Website enquiry integrations & offers

Step-by-step setup (Hinglish): **[SETUP.md](./SETUP.md)**. Apps Script source: `apps-script/Code.js`.

Contact form **and the calculator's "Request this quote"** → (1) Admin → Enquiries → (2) Google Sheet → (3) admin email → (4) WhatsApp `wa.me/919203900410`.
Each step has its own try/catch; failed Sheet/email calls wait in a localStorage retry queue and are re-sent on the
next page load or when the browser comes back online. Every enquiry has a `submissionId` (UUID), so retries and
double clicks never create duplicates. Code: `src/services/enquiryIntegrations.ts`, form rules `src/lib/contactForm.ts`,
offers `src/lib/offers.ts`, `src/components/common/OfferSection.tsx` + `OfferRibbon.tsx` (the only Diwali-themed components), `src/pages/public/OffersPage.tsx`, `src/admin/pages/OffersAdminPage.tsx`.

### Offer posters
Shipped posters live in `public/images/offers/` as WebP copies at 160 / 320 / 480 / 640 / 800 / full width
(`<name>-<width>w.webp`) plus a full-quality JPG (`<name>.jpg`, used by "Download" on /offers). An offer stores
each poster as `{ url, alt, width, height, variants[], slabId }`, so a poster can equally be a shipped file, an
uploaded image or — later — a Firebase Storage URL. Only the lead poster loads with high priority (preloaded in
`<head>`); the other slides, thumbnails and gift-card images load after the page.

## 8. Ready for Firebase (next phase)

Nothing Firebase-specific is installed yet. The seams are in place:

| Today (browser) | Firebase later | What changes |
|---|---|---|
| `src/mocks/mockApi.ts` via `src/services/api.ts` | Firestore / Cloud Functions implementing the same `api` methods | Only `src/services/api.ts` |
| Enquiry saved by `api.submitEnquiry` / `api.submitQuotation` with a `submissionId` | `enquiries/{submissionId}` document (idempotent by id) | The two api methods |
| Sheet + email sent by the browser (Apps Script) | Cloud Function on document create → Sheet + email | Set `VITE_ENQUIRY_DELIVERY=server`; forms unchanged |
| `api.uploadImage` returns a compressed data URL | Firebase Storage download URL | Only `uploadImage`; every image field already accepts https URLs |
| Site content incl. offers in one record | One Firestore document | None — offers are normalised by `src/lib/offers.ts` |
| Login in `src/services/localAuth.ts` | Firebase Auth | `localAuthApi` |

Shipped images under `/images/…` keep working after the move (they are static files of the site).

## 9. Calculation sources (checked 4 Nov 2026)

* CSPDCL tariff: CSERC Tariff Schedule FY 2026-27 (from 1 July 2026) — every LV-1/LV-2/LV-5/HV-3 rate in
  `src/data/settings-defaults.ts` matches the schedule.
* PM Surya Ghar CFA (MNRE): ₹30,000/kW for the first 2 kW + ₹18,000 for the 3rd kW, max ₹78,000; special
  category states ₹33,000 + ₹19,800 (max ₹85,800); RWAs ₹18,000/kW up to 500 kW; no CFA above 3 kW per home.
* Chhattisgarh top-up: ₹15,000 for 1 kW, ₹30,000 for 2 kW and above (domestic).
* CG half-bill: 50 % on the first 200 units for homes using up to 400 units/month, valid to 31 Mar 2027
  (cabinet, 27 Oct 2026).
* Company price slabs (₹62k → ₹43k per kW), generation 4.2 units/kW/day, FPPAS 10 %, duty 11/17 % are business
  inputs / assumptions, editable in Settings → Calculator.
* `tests/unit/calculator-consistency.test.ts` holds hand-worked bills and subsidies and checks that the
  calculator, a saved quote request and the pricing page show the same numbers.
