/**
 * End-to-end check of the frontend-only build (Playwright, Chromium).
 *   npm run build && npm run preview          # http://localhost:4173
 *   BASE_URL=http://localhost:4173 npm run test:e2e   (first time: npx playwright install chromium)
 * Covers: public enquiry → admin, protected routes, login/logout, CRUD with validation,
 * search, image upload, IndexedDB persistence after reload, website reflecting admin edits,
 * responsive layouts (no horizontal scroll) and console errors.
 */
import { chromium } from 'playwright'

const BASE = process.env.BASE_URL || 'http://localhost:4173'
const ok = (c, m) => { console.log((c ? '✓ ' : '✗ ') + m); if (!c) process.exitCode = 1 }

const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {})
try {

  const ctx = await browser.newContext({ viewport: { width: 1366, height: 860 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' && !/ERR_TUNNEL|Failed to load resource/.test(m.text())) errors.push(`${page.url()} ${m.text().slice(0, 300)}`); });
  page.on('pageerror', (e) => errors.push(`[pageerror] ${page.url()} ${e.message}`));
  const toastWait = () => page.waitForTimeout(700);

  // Public enquiry first (anonymous)
  await page.goto(BASE + '/contact');
  await page.fill('#contact-name', 'Ravi Verma');
  await page.fill('#contact-phone', '9876543210');
  await page.selectOption('#contact-service', { index: 1 });
  await page.fill('#contact-message', 'Need a 3 kW rooftop system for my house.');
  await page.click('form button[type=submit]');
  await page.waitForSelector('text=Thank you, Ravi');
  ok(true, 'contact enquiry submitted');

  // Protected route redirect
  await page.goto(BASE + '/admin/services');
  await page.waitForURL('**/admin/login');
  ok(true, 'protected route redirects to login');
  await page.fill('input[type=email]', 'admin@babasolars.com');
  await page.fill('input[autocomplete=current-password]', 'Admin@123');
  await page.click('button[type=submit]');
  await page.waitForURL('**/admin/services');
  ok(true, 'login returns to requested page');

  // Service add
  await page.click('button:has-text("Add service")');
  await page.getByLabel('Service name').fill('Solar Water Pump Setup');
  await page.getByLabel('Summary').fill('Pumps for farms powered by the sun.');
  await page.getByLabel('Starting price text').fill('From ₹95,000');
  await page.locator('[role=dialog] button:has-text("Published")').click().catch(() => {});
  await page.locator('[role=dialog] footer button[type=submit]').click();
  await toastWait();
  ok(await page.locator('text=Solar Water Pump Setup').count() > 0, 'service added in admin');

  // validation
  await page.click('button:has-text("Add service")');
  await page.locator('[role=dialog] footer button[type=submit]').click();
  await page.waitForTimeout(300);
  ok(await page.locator('[role=dialog] [role=alert]').count() > 0, 'service form validation shows errors');
  await page.keyboard.press('Escape');

  // search
  await page.fill('input[placeholder="Search services"]', 'water pump');
  await page.waitForTimeout(200);
  ok(await page.locator('tbody tr').count() === 1, 'search filters services');

  // Project with image upload
  await page.goto(BASE + '/admin/projects');
  await page.click('button:has-text("Add project")');
  await page.getByLabel('Project name').fill('Test Farmhouse Plant');
  await page.locator('[role=dialog]').getByLabel(/^Location/).fill('Bilaspur');
  await page.locator('[role=dialog] input[type=file]').setInputFiles(new URL('../public/og-image.png', import.meta.url).pathname);
  await page.waitForFunction(() => [...document.querySelectorAll('[role=dialog] input')].some((i) => i.value.startsWith('data:image/')), null, { timeout: 10000 });
  const url = await page.evaluate(() => [...document.querySelectorAll('[role=dialog] input')].find((i) => i.value.startsWith('data:image/')).value);
  ok(true, `image uploaded & compressed (${url.slice(0, 15)}…, ${Math.round(url.length / 1024)} KB)`);
  await page.locator('[role=dialog] button:has-text("Published")').click().catch(() => {});
  await page.locator('[role=dialog] footer button[type=submit]').click();
  await toastWait();
  ok(await page.locator('text=Test Farmhouse Plant').count() > 0, 'project added');

  // Review
  await page.goto(BASE + '/admin/reviews-faqs');
  await page.click('button:has-text("Add review")');
  await page.getByLabel('Customer name').fill('Sunita Patel');
  await page.locator('[role=dialog]').getByLabel(/^Review/).fill('Excellent installation, bill is almost zero now.');
  await page.locator('[role=dialog] footer button[type=submit]').click();
  await toastWait();
  ok(await page.locator('text=Sunita Patel').count() > 0, 'review added');

  // Contact info
  await page.goto(BASE + '/admin/content');
  await page.getByLabel(/^Phone/).fill('+91 99999 11111');
  await page.locator('button:has-text("Save")').last().click();
  await page.waitForTimeout(1000);

  // Enquiry visible
  await page.goto(BASE + '/admin/enquiries');
  await page.waitForTimeout(600);
  ok(await page.locator('text=Ravi Verma').count() > 0, 'website enquiry visible in admin');

  // Reload persistence
  await page.reload(); await page.waitForTimeout(800);
  await page.goto(BASE + '/admin/services'); await page.waitForTimeout(600);
  ok(await page.locator('text=Solar Water Pump Setup').count() > 0, 'service persists after reload');

  // Public site reflects
  await page.goto(BASE + '/services'); await page.waitForTimeout(800);
  ok(await page.locator('text=Solar Water Pump Setup').count() > 0, 'service visible on public site');
  await page.goto(BASE + '/projects'); await page.waitForTimeout(800);
  ok(await page.locator('text=Test Farmhouse Plant').count() > 0, 'project visible on public site');
  ok(await page.locator('img[src^="data:image/"]').count() > 0, 'uploaded image rendered on public site');
  await page.goto(BASE + '/'); await page.waitForTimeout(1000);
  ok(await page.locator('text=99999 11111').count() > 0, 'new phone visible on website');
  ok(await page.locator('text=Sunita Patel').count() > 0, 'review visible on home page');

  // Fresh tab in same context sees data
  const p2 = await ctx.newPage();
  await p2.goto(BASE + '/admin/projects'); await p2.waitForTimeout(800);
  ok(await p2.locator('text=Test Farmhouse Plant').count() > 0, 'second tab still signed in and sees data');

  // Delete service
  await page.goto(BASE + '/admin/services'); await page.waitForTimeout(500);
  await page.click('button[aria-label*="Delete"][aria-label*="Solar Water Pump"]').catch(async () => {
    const row = page.locator('tr', { hasText: 'Solar Water Pump Setup' });
    await row.locator('button').last().click();
  });
  await page.locator('[role=dialog] button:has-text("Delete")').last().click();
  await toastWait();
  ok(await page.locator('text=Solar Water Pump Setup').count() === 0, 'service deleted');

  // Logout
  await page.click('button:has-text("Log out")');
  await page.waitForURL('**/admin/login');
  await page.goto(BASE + '/admin'); await page.waitForURL('**/admin/login');
  ok(true, 'logout ends session');
  console.log(errors.length ? 'CONSOLE ERRORS:\n' + errors.join('\n') : 'no console errors');

  // Responsive: no sideways scrolling on phone, tablet and desktop widths.
  for (const width of [360, 768, 1280]) {
    const c = await browser.newContext({ viewport: { width, height: 800 } })
    const p = await c.newPage()
    for (const path of ['/', '/services', '/pricing', '/projects', '/contact', '/admin/login']) {
      await p.goto(BASE + path); await p.waitForTimeout(500)
      const overflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
      ok(overflow <= 0, `${width}px ${path} fits the screen`)
    }
    await c.close()
  }
} finally {
  await browser.close()
}
