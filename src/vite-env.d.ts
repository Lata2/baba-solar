/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Backend origin, e.g. https://api.babasolars.in — see src/config/api.ts */
  readonly VITE_API_BASE_URL?: string
  /** "true" → use the Baba Solars server (secure login, document storage, Drive backup) */
  readonly VITE_SERVER_MODE?: string
  /** Public website URL used for canonical links and SEO, e.g. https://babasolars.in */
  readonly VITE_SITE_URL?: string
}
interface ImportMeta { readonly env: ImportMetaEnv }
