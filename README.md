# Baba Solars — Website, Admin Panel, Quotation & Billing

React 19 · Vite 8 · TypeScript · Tailwind CSS 4 · TanStack Query · React Router · jsPDF · ExcelJS
**+ optional Node.js server** (Express 5, TypeScript via `tsx`) for secure login, document storage and Google Drive backup.

What was analysed, the bugs found and what was built: **[IMPLEMENTATION.md](IMPLEMENTATION.md)**.
How the in-browser data layer works: [MOCK_DATA.md](MOCK_DATA.md).

---

## 1. Two ways to run it

| | **Static mode** | **Server mode** |
|---|---|---|
| Build | `npm run build` | `npm run build:server` + `npm run server` |
| Admin access | Local-only gate; any validly formatted email and non-empty password opens the panel. Not authentication. | Server-verified accounts (scrypt hashes, HttpOnly session cookie, CSRF, rate limits, roles) |
| Quotation / invoice data | Browser data layer; not suitable for sensitive production records | Browser data layer plus server document records; full server-side CRUD is still required before storing sensitive production records |
| PDF + Excel files | saved into a folder you pick once (Chrome/Edge permission) | saved by the server into `C:\Quotation and Billing\Quotations` and `\Billing` |
| Google Drive backup | — (needs the server: the OAuth secret can never be in website code) | automatic, to **babasolars76@gmail.com** |
| Hosting | any static host (Vercel, Netlify) | the office PC, or a VPS (+ Windows sync agent for `C:\`) |

## 2. Requirements

- Node.js **20.19+** or **22.12+** (`node -v`), npm 10+
- Office PC: Windows 10/11, **Google Chrome or Microsoft Edge**

```bash
npm install
```

## 3. Static mode (no authentication server)

```bash
npm run dev            # http://localhost:5173
npm run build          # static site in dist/  → upload to Vercel / Netlify / any host
```

The admin login is a local-only convenience gate: it accepts any validly formatted email and non-empty password, stores only an 8-hour JavaScript-readable session marker cookie, and does not verify identity. Anyone who can reach the site can access or bypass it. Do not enter real credentials or use customer or financial records in static mode. Use server mode for real authentication. Online enquiry and quote submissions are unavailable without a delivery API and are not saved in the browser. The current content/data adapter still uses browser storage; do not put customer or financial records into it.

Saving files to `C:\` in server mode: Admin → **Saved documents** → *Choose folder* → pick `C:\` (a `Quotation and Billing` folder with
`Quotations` and `Billing` is created) or an existing `Quotation and Billing` folder → *Allow*. From then on every saved
quotation/invoice writes its PDF and Excel there. The browser may ask again after it restarts (browser security rule).

## 4. Server mode — option A: everything on the office Windows PC (simplest)

Documents go straight into `C:\Quotation and Billing\Quotations\<Client>\` and `...\Billing\<Client>\`.

```powershell
cd baba-solars
npm install
copy server\.env.example server\.env
npm run server:keygen          # prints TOKEN_ENCRYPTION_KEY and an agent token
notepad server\.env            # set ADMIN_EMAIL, ADMIN_PASSWORD (first start), TOKEN_ENCRYPTION_KEY, Google values (section 6)
npm run build:server           # builds the website in server mode
npm run server                 # → http://localhost:8787  (admin: http://localhost:8787/admin)
```

- The first start creates the admin from `ADMIN_EMAIL` / `ADMIN_PASSWORD` → **then delete `ADMIN_PASSWORD` from `server\.env`**.
- Start automatically at Windows log-in: `powershell -ExecutionPolicy Bypass -File server\install-windows-service.ps1`
- More users: Admin → Users (or `npm run server:create-user`). Passwords: ≥ 10 chars, 3 of upper/lower/digit/symbol.
- Other computers in the office: set `HOST=0.0.0.0` and `APP_ORIGIN=http://<pc-ip>:8787` (LAN only; use HTTPS for anything public).

## 5. Server mode — option B: VPS + Windows sync agent

The server runs on the VPS (documents in e.g. `/var/lib/babasolars/Quotation and Billing` + Google Drive). The office PC runs
a small **sync agent** that mirrors every file into `C:\Quotation and Billing` (download-only, SHA-256 checked, never deletes your files).

VPS (Ubuntu example, behind Nginx/Caddy with HTTPS):

```bash
npm ci && npm run build:server
cp server/.env.example server/.env   # APP_ORIGIN=https://babasolars.in  HOST=127.0.0.1  TRUST_PROXY=true
                                      # DOCUMENTS_ROOT=/var/lib/babasolars/Quotation and Billing  DATA_DIR=/var/lib/babasolars/data
                                      # AGENT_TOKENS=<from npm run server:keygen>
npm run server                        # run under systemd / pm2; reverse-proxy https://babasolars.in → 127.0.0.1:8787
```

Office PC (agent):

```powershell
copy agent\agent.env.example agent\agent.env   # SERVER_URL=https://babasolars.in  AGENT_TOKEN=<same token>
node agent\sync-agent.mjs --once               # test
powershell -ExecutionPolicy Bypass -File agent\install-windows.ps1   # run at every log-in
```

## 6. Google Drive backup (babasolars76@gmail.com)

1. https://console.cloud.google.com → new project → **APIs & Services → Library → Google Drive API → Enable**.
2. **OAuth consent screen**: External, app name "Baba Solars Admin", add `babasolars76@gmail.com` as a test user
   (or publish the app). Scopes: `openid`, `email`, `.../auth/drive.file`.
3. **Credentials → Create credentials → OAuth client ID → Web application**.
   Authorised redirect URI: `<APP_ORIGIN>/api/drive/oauth/callback` (e.g. `http://localhost:8787/api/drive/oauth/callback`).
4. Put `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `TOKEN_ENCRYPTION_KEY` in `server/.env`, restart the server.
5. Admin → **Saved documents → Connect Google Drive** → sign in **as babasolars76@gmail.com** (other accounts are refused).

Drive layout: `Quotation and Billing/Quotations/<Client>/BS-QT-2026-27-0001 - Client.pdf|.xlsx` and `.../Billing/...`.
One Drive file per document (re-saves update it; unchanged files are skipped by checksum), failed uploads retry with
back-off (30 s → 6 h, `DRIVE_MAX_ATTEMPTS`), then show as *failed* with a **Retry** button. Only the `drive.file` scope is
requested, so the app can see only the files it created. The refresh token is stored encrypted (AES-256-GCM) on the server.

## 7. Subsidy rules (calculator, quotations, billing, PDF, Excel)

| Size | PM Surya Ghar (central) | Chhattisgarh state | Combined |
|---|---|---|---|
| 1 kW | ₹30,000 | ₹15,000 | ₹45,000 |
| 2 kW | ₹60,000 | ₹30,000 | ₹90,000 |
| 3 kW and above | ₹78,000 (max) | ₹30,000 | ₹1,08,000 |

Homes and grid-connected (on-grid / hybrid) systems only; commercial and off-grid get none; housing societies ₹18,000/kW
(no household state top-up); special-category states ₹33,000/₹19,800 (max ₹85,800). Part kW is pro-rata for the central
subsidy (1.5 kW → ₹45,000); the state slab applies from 1 kW and 2 kW. Subsidy never exceeds the system cost.
**All of it is editable state-wise** in Admin → Settings → Calculator → Subsidy (add a state, slabs, eligible connections,
"last verified" date). Invoices keep the full GST total payable; the subsidy is shown as information with the net cost,
because under PM Surya Ghar the Government credits it to the customer's bank account.

## 8. Commands

| Command | What it does |
|---|---|
| `npm run dev` / `npm run dev:server` | dev server (static / server mode; server mode proxies `/api` → `:8787`, add `http://localhost:5173` to `APP_ORIGIN`) |
| `npm run build` / `npm run build:server` | production build into `dist/` (static / server mode) |
| `npm run build:ssg` | static build + prerendered public pages |
| `npm run server` | Baba Solars server (serves `dist/` + `/api`) |
| `npm run server:keygen` / `server:create-user` | generate secrets / add or reset a user |
| `npm run agent` | Windows sync agent (VPS mode) |
| `npm run typecheck` | TypeScript for the website and the server |
| `npm test` | 127 unit + server integration tests (subsidy, GST, PDF data, Excel, auth, CSRF, uploads, Drive, agent) |
| `npm run test:e2e` | browser tests (start `npm run preview` first; `BASE_URL=http://localhost:4173`) |

## 9. Environment variables

- **Website (`.env`, `.env.server`)** — public only: `VITE_SITE_URL`, `VITE_SERVER_MODE`, `VITE_API_BASE_URL`. Never secrets.
- **Server (`server/.env`)** — see `server/.env.example`: `APP_ORIGIN`, `PORT`, `HOST`, `TRUST_PROXY`, `COOKIE_SECURE`,
  `ADMIN_EMAIL`/`ADMIN_NAME`/`ADMIN_PASSWORD` (first start), `DOCUMENTS_ROOT` (default `C:\Quotation and Billing` on Windows),
  `CLIENT_SUBFOLDERS`, `DATA_DIR`, `MAX_UPLOAD_MB`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`,
  `DRIVE_ACCOUNT_EMAIL`, `DRIVE_ROOT_FOLDER`, `TOKEN_ENCRYPTION_KEY`, `DRIVE_POLL_SECONDS`, `DRIVE_MAX_ATTEMPTS`,
  `AGENT_TOKENS`, `SERVE_FRONTEND`, `SESSION_HOURS`, `SESSION_IDLE_MINUTES`.
- **Agent (`agent/agent.env`)**: `SERVER_URL`, `AGENT_TOKEN`, `LOCAL_ROOT`, `POLL_SECONDS`.

Back up `DATA_DIR` (users, document registry, record copies, encrypted Drive token) and the documents folder.

## 10. Project structure

```
src/
  lib/subsidy.ts      ← subsidy engine (central + state-wise rules) used everywhere
  excel/              ← .xlsx quotations / invoices (ExcelJS, lazy-loaded)
  pdf/                ← jsPDF documents (subsidy breakdown in pdf/subsidy.ts)
  services/api.ts     ← the only data entry point (browser data layer; server auth in server mode)
  services/documents/ ← document storage layer: serverStore | browserFolderStore (add a Firebase store here later)
  services/http.ts    ← API client (CSRF header, same-origin cookies)
  mocks/              ← in-browser data layer (quotation/invoice rules in logic.ts)
  admin/pages/DocumentsPage.tsx ← Saved documents + Google Drive status
server/
  index.ts app.ts config.ts http.ts        ← boot, security headers/CSP, CSRF, rate limits, RBAC
  auth/                                     ← users (scrypt), sessions
  routes/                                   ← /api/auth, /users, /documents, /drive, /agent
  storage/                                  ← JSON repositories + local file storage (swap for a DB later)
  drive/                                    ← Google OAuth (PKCE), Drive client, encrypted token, retry worker
agent/sync-agent.mjs                        ← Windows mirror to C:\Quotation and Billing
tests/unit  tests/server  tests/e2e.mjs
```
