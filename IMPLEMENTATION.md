# Implementation notes — Quotation, Billing, Subsidy, Storage & Backup

Date: 30 Oct 2026. Stack kept: React 19 + Vite 8 + TypeScript + Tailwind 4 + TanStack Query + jsPDF. No redesign —
new screens reuse the existing admin components (AdminPageHeader, DataTable, Card, Badge, Modal, Toggle…).

## 1. What the analysis found

**Architecture.** Frontend only. Every read/write goes through `src/services/api.ts`, implemented by `src/mocks/mockApi.ts`
over a localStorage "database". Business rules (numbering per FY, GST split, subsidy, payments) live in `src/mocks/logic.ts`.
PDFs (4 invoice templates, 3 quotation templates) are generated in the browser with jsPDF. Login was a demo login with
plaintext passwords in the JavaScript bundle; roles only hid UI.

**Bugs / incomplete features fixed**

| # | Problem | Fix |
|---|---|---|
| 1 | Unresolved git merge-conflict markers in `README.md`, `public/_headers` and `public/sitemap.xml` (sitemap was invalid XML; headers file broken on Netlify/Cloudflare) | Resolved; sitemap validated |
| 2 | State subsidy was one flat amount (₹0), not by size or state | State-wise slab rules (Chhattisgarh ₹15k / ₹30k) |
| 3 | Quotation editor did not cap the state subsidy at the cost; editing an existing quote froze its subsidy even when size changed | Auto/manual flag stored per quote; one capped engine |
| 4 | Home-page calculator showed central subsidy but "You pay" subtracted central + state (inconsistent) | Breakdown shows both |
| 5 | Pricing admin "Use PM Surya Ghar slab" ignored the admin's own subsidy settings | Uses saved settings + state |
| 6 | Billing had no subsidy support; no Excel export; generated documents were not stored anywhere | Implemented (below) |
| 7 | CSV export allowed spreadsheet formula injection (`=`, `+`, `-`, `@`) | Neutralised (`csvSafe`), also in Excel |
| 8 | `jspdf` 3.x had critical advisories (PDF/JS injection, path traversal); `exceljs`→`uuid` moderate | jsPDF 4.2.1 (same output, all PDF tests pass), uuid override → `npm audit`: 0 vulnerabilities |
| 9 | `package-lock.json` deleted in the working tree | Regenerated |
| 10 | Quote requests from the calculator always used Chhattisgarh | Uses the state chosen in the calculator |

## 2. Subsidy (verified)

Sources checked on 30 Oct 2026: MNRE PM Surya Ghar CFA — ₹30,000/kW for the first 2 kW, ₹18,000 for the 3rd kW, max ₹78,000;
special category states ₹33,000 / ₹19,800; RWA/GHS ₹18,000/kW up to 500 kW; capex model, DCR modules, registered vendor,
grid-connected. Chhattisgarh additional state assistance for domestic consumers: ₹15,000 (1 kW), ₹30,000 (2 kW and above),
paid through CSPDCL — combined ₹45,000 / ₹90,000 / ₹1,08,000. Rules change, so every number is editable and the settings
show a "last verified" date.

`src/lib/subsidy.ts → computeSubsidy()` is used by: website calculator (new state selector + full breakdown), home calculator,
pricing table, PM Surya Ghar page table, quotation editor + server-side derivation, invoice derivation, PDF (`pdf/subsidy.ts`)
and Excel. Tests: `tests/unit/subsidy.test.ts` (user's table, part-kW, special category, societies, commercial, off-grid,
hybrid toggle, cost cap, disabled rule, validation, quotation/invoice integration).

## 3. Quotation and Billing modules

Kept as two separate modules (Admin → Quotations, Admin → Billing) with create / edit / preview / print / download PDF.
Added: **Download Excel**, **Save PDF & Excel** (row action + PDF dialog), automatic saving of both files after every
create/edit, quotation → invoice conversion and every payment change. Invoices got an optional subsidy section
(capacity, property, system type, auto/manual) printed as a breakdown; the GST total stays the amount payable.
Excel: business header, document details, client, system, items (HSN, qty, rate, discount, taxable, GST, amount), GST
totals, subsidy breakdown, amount in words, terms, bank details, payments, GST summary sheet; no formulas from user text.

## 4. Storage

`src/services/documents/` is a storage layer with one interface (`DocumentStore`):

- **serverStore** — `POST /api/documents` (multipart). The server validates (magic bytes, real PDF/XLSX structure, no PDF
  JavaScript/launch actions, size limit, metadata whitelist, drafts refused), names files Windows-safely
  (`BS-QT-2026-27-0001 - Ramesh Sharma.pdf`), writes atomically into `<root>/Quotations|Billing/<Client>/`, never duplicates
  (same number = same file, client rename = move), refuses a number that belongs to another record, and keeps a JSON copy
  of the record. Root defaults to `C:\Quotation and Billing` on Windows (created at start).
- **browserFolderStore** — no server: File System Access API in Chrome/Edge; the user grants a folder once (browsers do not
  allow silent C:\ access). Same naming and dedupe rules.
- **VPS**: files stay on the server + Drive; `agent/sync-agent.mjs` mirrors them to `C:\Quotation and Billing` on the office PC.

Future database: implement `UserRepository` / `DocumentRepository` (server/storage) and/or a new `DocumentStore`
(Firestore, SQL) — routes and pages don't change. Nothing existing was made database-dependent.

## 5. Google Drive

Server-side only (`server/drive/`): OAuth 2.0 authorization code + PKCE + one-time state, `login_hint` and a hard check that
the account is `DRIVE_ACCOUNT_EMAIL`, `drive.file` scope, refresh token encrypted with AES-256-GCM, folders created once
and cached, one Drive file per document key (appProperties lookup recovers a lost registry), MD5 compare skips unchanged
uploads, retries with exponential back-off, revoked token → "connect again" without losing the queue.
Tested end-to-end against an in-memory fake of Google's endpoints (`tests/server/fakeGoogle.ts`). A live connection needs
your Google Cloud OAuth client (README §6) — it cannot be created on your behalf.

## 6. Security

Server: scrypt password hashes (N=2¹⁵), password policy, constant-time compare and dummy hashing for unknown emails,
per-IP and per-account login limits, server-side sessions (only SHA-256 of the token stored) in an httpOnly, SameSite=Strict,
Secure (on HTTPS) cookie, idle + absolute expiry, sessions revoked on password/role change and logout-everywhere, CSRF token
bound to the session + Origin check + JSON/multipart-only bodies, RBAC enforced on every route (same `rbac.ts` as the UI),
documents only via authenticated attachment downloads, strict CSP for the site (inline scripts by hash) and `default-src 'none'`
for the API, HSTS, nosniff, frame and permissions policies, path-traversal-proof storage, agent token read-only.
Secrets exist only in `server/.env`; `VITE_*` contains public values only. React escapes all rendered text (XSS).

Remaining limitation (by design, "no database yet"): website content, prices, enquiries and the working copy of quotations /
invoices still live in the browser data layer. In server mode the server keeps a copy of every saved quotation/invoice and
merges it into any browser after sign-in, and all files are on disk + Drive; full multi-user editing of the same records at
the same time needs the future database.

## 7. Tests run

- `npm run typecheck` — website + server: clean.
- `npm test` — 124 tests, all passing: subsidy (27), Excel (3), agent path safety (7), the existing pricing / GST /
  documents / electricity-bill suites, and server integration (31: auth, lockout, cookies, CSRF, origin, roles, upload validation, naming, dedupe, rename, conflict,
  downloads, Drive connect/wrong account/forged state/folders/dedupe/recovery/retry/max attempts/revocation, agent API).
- Existing Playwright suite (mock mode): 15/16 — the one failure is the sandbox blocking `wa.me`; the link is correct.
- Server-mode browser runs: login, create/edit quotation (auto-saved files), rename client (files moved), convert to invoice,
  payment, Documents page, users with password policy, subsidy setting change reaching the calculator, fresh browser restore
  + continued numbering, 390 px layouts, logout → 401. Generated PDF and Excel opened and checked visually.
- Sync agent against the running server: 4 files mirrored byte-identical; second run downloads nothing.
