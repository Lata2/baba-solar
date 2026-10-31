/**
 * Regenerates public/site-data.json (the PUBLISHED data every visitor reads) from the
 * bundled seed data in src/data. Run only when you want to reset the published content
 * to the defaults in code:   npm run data:seed
 * Normal publishing uses Admin → Site content → Data & publishing → "Download site-data.json".
 */
import { writeFile } from 'node:fs/promises'
import { createServer } from 'vite'

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' })
try {
  const { createSeedDatabase } = await server.ssrLoadModule('/src/data/index.ts')
  const { SNAPSHOT_SCHEMA_VERSION } = await server.ssrLoadModule('/src/services/api.ts')
  const data = createSeedDatabase()
  delete data.enquiries
  delete data.quotations
  const snapshot = { schemaVersion: SNAPSHOT_SCHEMA_VERSION, exportedAt: new Date().toISOString(), data }
  await writeFile(new URL('../public/site-data.json', import.meta.url), JSON.stringify(snapshot, null, 2) + '\n')
  console.log('✓ public/site-data.json written from src/data seeds')
} finally {
  await server.close()
}
