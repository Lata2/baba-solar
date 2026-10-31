# Browser data adapter and security boundaries

The React app keeps a browser data adapter for bundled website content and business workflows. It is not a replacement for a backend database.

## What is available

| Area | Current behavior |
|---|---|
| Public website | Seeded content and calculations are available without signing in. |
| Admin access | Static builds offer a local-only access gate. It accepts a validly formatted email and any non-empty password; neither is verified or stored. Server builds verify credentials through the API. |
| Session | Static mode stores only a short-lived session marker in a JavaScript-readable cookie (8 hours); it is editable and bypassable, not authentication. Server mode issues an HttpOnly cookie. Neither mode stores authentication tokens in localStorage. |
| User management | Available only through the server API; hidden in static mode. Browser-side user/password records have been removed; old seeded user records are cleared on data migration. |
| Site and business data | The current data adapter persists its dataset in this browser under `baba-solars:mock-db`. It is not suitable for personal, customer, financial, or other sensitive production data. |
| Documents | PDF/Excel files can be saved using browser folder permissions or the server document service. Server-side record snapshots are available for quotations and invoices. |

The adapter still provides client-side validation, document calculations, PDF generation, and preview behavior. A backend API/database is required for shared, durable, access-controlled content and business records.

## Security limitations and deployment guidance

1. **Do not deploy the static build as a secure admin application.** Its local-only access gate does not verify a password; anyone who can reach the site can create a session or bypass it. It is for local preview only.
2. **The static session cookie is not secure authentication.** JavaScript can read and modify it. HttpOnly must be set by a server; this cookie uses SameSite=Lax and Secure on HTTPS, but those attributes do not make a client-side session trustworthy. State-changing requests in server mode use the server-provided CSRF token held in memory.
3. **Do not put sensitive records in the browser data adapter.** It uses localStorage for non-authentication app data and that storage is readable by JavaScript on the same origin. Full server-side CRUD and authorization are needed before handling sensitive business data.
4. **Real authentication requires the server.** Server mode verifies password hashes, enforces roles, rate limits sign-in, and supports session revocation. The API's cookie security depends on HTTPS and correct `APP_ORIGIN`/proxy configuration; see [README.md](./README.md).
5. **The service/API boundary is ready for additional backend endpoints**, but site content, leads, quotes, and billing records are not all backed by server CRUD yet. Do not interpret local persistence as server backup or cross-device synchronization.
6. **Prerendered pages use bundled seed content.** Client-side data changes do not update prerendered pages for other visitors.
7. **Online enquiry and quote delivery is not implemented.** Forms show an explicit unavailable error and do not save contact details in localStorage. Email, SMS and payment gateway delivery are not implemented.

## Pricing rules implemented

- Exact price at a listed package size; between sizes → linear interpolation; outside → per-kW rate of the nearest package; rounded to ₹1,000. Prices are GST inclusive.
- The bill of materials is split by percentages (`Settings → Package breakdown`, must total 100 %). GST is extracted per line (kit / modules / inverter / MC4 at 5 %, structure, cables, earthing, installation at 18 %) and the last line absorbs rounding, so the grand total equals the price list exactly.
- Normal = 540 Wp Mono PERC bifacial; Premium = 580 Wp N-type TOPCon (from the sales orders). Editable per company.

## Planned API boundary

| `api.` method | Endpoint |
|---|---|
| `loadSite`, `publishedVersion` | `GET /site`, `GET /site/version` |
| `getCollection`, `upsertItem`, `removeItem`, `reorder` | `GET/POST/PUT/DELETE /collections/:name[/:id]`, `POST /collections/:name/reorder` |
| `getContent`, `updateContent` | `GET/PUT /content` |
| `submitEnquiry`, `submitQuotation` | `POST /public/enquiries`, `POST /public/quote-requests` |
| `login`, `logout`, `logoutEverywhere`, `me`, `changePassword` | `POST /auth/login`, `/auth/logout`, `/auth/logout-all`, `GET /auth/me`, `POST /auth/password` |
| `listUsers`, `createUser`, `updateUser`, `deleteUser` | `/users` CRUD |
| `getBusiness`, `updateBusiness` | `GET/PUT /settings/business` |
| `listCompanies`, `saveCompany`, `deleteCompany`, `priceQuote` | `/companies` CRUD, `GET /companies/:id/price?kw=&quality=&supply=` |
| `listCatalog`, `saveCatalogItem`, `deleteCatalogItem` | `/catalog` CRUD |
| `getQuotation`, `saveQuotation`, `setQuotationStatus`, `convertToInvoice` | `/quotations` CRUD, `PATCH /quotations/:id/status`, `POST /quotations/:id/invoice` |
| `quotationPdf`, `quotationPreviewPdf` | `GET /quotations/:id/pdf`, `POST /quotations/preview-pdf` |
| `listInvoices`, `getInvoice`, `createInvoice`, `updateInvoice`, `deleteInvoice` | `/invoices` CRUD with `?q=&status=&from=&to=&sort=&page=` |
| `addPayment`, `removePayment` | `POST/DELETE /invoices/:id/payments[/:pid]` |
| `invoicePdf`, `invoicePreviewPdf` | `GET /invoices/:id/pdf?template=`, `POST /invoices/preview-pdf` |
| `uploadImage` | `POST /uploads` (multipart) |
| `exportSnapshot`, `importSnapshot` | `GET /backup`, `POST /backup` |
| `calculate` | Browser pure function, with server-side recalculation for quote requests |
