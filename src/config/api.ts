/**
 * DATA SOURCE
 * ─────────────────────────────────────────────────────────────────────────
 * Two ways to run the admin panel:
 *
 *  • Static mode (default, `npm run build`): no server. Website content, quotations and invoices live
 *    in this browser (src/mocks). Admin uses an unverified local-only access gate, not authentication.
 *    Documents can be saved to a folder on this computer with browser permission (Chrome / Edge).
 *
 *  • Server mode (`npm run build:server`, VITE_SERVER_MODE=true): the Baba Solars server (server/)
 *    handles secure login, user management, the C:\Quotation and Billing folders and Google Drive
 *    backup. Quotation / invoice data stays in the existing data layer (no database yet).
 *
 * Only public values go here — everything in VITE_* is bundled into the browser code.
 */
export const SERVER_MODE = import.meta.env.VITE_SERVER_MODE === 'true'
/** '' = same origin as the website (recommended: the server hosts the built site). */
export const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '')
export const DATA_SOURCE = SERVER_MODE ? ('server' as const) : ('mock' as const)
