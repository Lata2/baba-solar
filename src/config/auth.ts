/**
 * FRONTEND-ONLY ADMIN SIGN-IN
 * ─────────────────────────────────────────────────────────────────────────
 * There is no backend yet, so the admin email and password are checked in the browser.
 *
 * ⚠ LIMITATION — this is NOT secure authentication:
 *   • These values are compiled into the public JavaScript bundle; anyone can read them.
 *   • The session is a value in localStorage that a technical user can create by hand.
 *   • Admin data lives in this browser only, so the gate protects convenience, not data.
 * Replace `localAuthApi` (src/services/localAuth.ts) with a real server login before going live.
 *
 * Override for a build with VITE_ADMIN_EMAIL / VITE_ADMIN_PASSWORD (still public in the bundle).
 */
export const ADMIN_ACCOUNT = {
  email: (import.meta.env.VITE_ADMIN_EMAIL?.trim() || 'admin@babasolars.com').toLowerCase(),
  password: import.meta.env.VITE_ADMIN_PASSWORD || 'Admin@123',
  name: 'Admin',
} as const

/** How long a sign-in lasts in this browser (renewed while the admin panel is in use). */
export const SESSION_HOURS = 12
