/**
 * Build-time prerender entry (Node). scripts/prerender.mjs renders every public route to
 * static HTML with the published data (public/site-data.json), so the first paint needs no
 * JavaScript: faster FCP/LCP and full content for search engines. In the browser, main.tsx
 * then renders the same app over it.
 */
import { prerender } from 'react-dom/static'
import { StaticRouter } from 'react-router'
import type { Database } from '@/types'
import { AppProviders } from './App'
import { AppRoutes, PUBLIC_PAGES } from './routes/AppRoutes'
import { createQueryClient, seedSite } from './queries'
import { SeoCollectorContext, seoTags, type SeoTags } from './hooks/useSeo'
import { databaseFromSnapshot } from './services/api'

export const ROUTES = Object.keys(PUBLIC_PAGES)

/** Public website data from the centralized mock seed (no backend yet). */
export async function seedData(): Promise<{ data: Partial<Database>; version: string }> {
  const { createSeedDb } = await import('./mocks/store')
  const d = createSeedDb()
  const pick = (list: Array<{ status?: string }>) => list.filter((x) => (x.status ?? 'published') === 'published')
  return {
    version: 'seed',
    data: {
      content: d.content, pricingPlans: pick(d.pricingPlans), capacityPlans: pick(d.capacityPlans), services: pick(d.services), projects: pick(d.projects),
      testimonials: pick(d.testimonials), faqs: pick(d.faqs), heroSlides: pick(d.heroSlides), gallery: pick(d.gallery), companies: d.companies,
    } as unknown as Partial<Database>,
  }
}

export async function render(url: string, data: Partial<Database>): Promise<{ html: string; seo: SeoTags }> {
  const db = await databaseFromSnapshot(data)
  const queryClient = createQueryClient()
  seedSite(queryClient, db)
  await PUBLIC_PAGES[url].preload()
  const seo: { tags: SeoTags | null } = { tags: null }
  const { prelude } = await prerender(
    <SeoCollectorContext value={seo}>
      <StaticRouter location={url}>
        <AppProviders queryClient={queryClient}>
          <AppRoutes />
        </AppProviders>
      </StaticRouter>
    </SeoCollectorContext>,
    // Never "outline" big Suspense boundaries into late-revealed chunks: emit the page inline,
    // so it paints in one go and hydrates against exactly this markup.
    { progressiveChunkSize: Number.POSITIVE_INFINITY },
  )
  const html = await new Response(prelude as unknown as ReadableStream).text()
  queryClient.clear() // drop cache timers so Node can exit
  return { html, seo: seo.tags ?? seoTags({ path: url }, db.content) }
}
