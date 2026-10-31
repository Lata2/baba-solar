/**
 * Browser checks for the static frontend build (no authentication backend).
 *
 *   npm run build && npx vite preview --port 4173
 *   BASE_URL=http://localhost:4173 npm run test:e2e
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://localhost:4173';
const PRICES = {
  Waaree: { 3: [160000, 210000], 5: [260000, 330000], 8: [480000, 550000], 10: [580000, 730000] },
  'Adani Solar': { 3: [170000, 220000], 5: [270000, 350000], 8: [490000, 570000], 10: [590000, 740000] },
  'Tata Power Solar': { 3: [170000, 220000], 5: [270000, 350000], 8: [490000, 570000], 10: [590000, 740000] },
};
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
});
const results = [];
const consoleProblems = [];
const EXTERNAL =
  /images\.unsplash\.com|fonts\.(googleapis|gstatic)\.com|i\.ytimg\.com|google\.com\/maps|ERR_TUNNEL|ERR_CONNECTION|net::ERR|Failed to load resource/i;

const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
context.on('page', (page) => {
  page.on('console', (message) => {
    if (message.type() === 'error' && !EXTERNAL.test(message.text()))
      consoleProblems.push(`${page.url()} — ${message.text()}`);
  });
  page.on('pageerror', (error) =>
    consoleProblems.push(`[pageerror] ${page.url()} — ${error.message}`),
  );
});
const page = await context.newPage();

async function test(name, fn) {
  const started = Date.now();
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  ✓ ${name} (${Date.now() - started} ms)`);
  } catch (error) {
    results.push({ name, ok: false });
    console.log(`  ✗ ${name}\n      ${error.message.split('\n').slice(0, 4).join('\n      ')}`);
  }
}

const expect = (condition, message) => {
  if (!condition) throw new Error(message);
};
const inr = (amount) => '₹' + amount.toLocaleString('en-IN');

await test('public pages render', async () => {
  for (const path of ['/', '/pricing', '/calculator', '/services', '/projects', '/about', '/contact']) {
    await page.goto(BASE + path);
    await page.getByRole('heading', { level: 1 }).first().waitFor({ timeout: 15000 });
  }
  await page.goto(`${BASE}/no-such-page`);
  await page.getByText("This page doesn't exist").first().waitFor();
});

await test('official contact details and safe external links are present', async () => {
  await page.goto(`${BASE}/contact`);
  await page.getByText('92039 00410', { exact: true }).first().waitFor();
  await page.getByText('babasolars76@gmail.com', { exact: true }).first().waitFor();
  expect(await page.locator('a[href="tel:+919203900410"]').count() > 0, 'phone link should use the official number');
  expect(await page.locator('a[href^="mailto:babasolars76@gmail.com"]').count() > 0, 'email link should use the official address');
  for (const width of [1366, 390]) {
    await page.setViewportSize({ width, height: 844 });
    for (const path of ['/', '/about', '/services', '/contact', '/pricing']) {
      await page.goto(BASE + path);
      const call = page.getByRole('link', { name: 'Call Baba Solars at 92039 00410' });
      await call.waitFor({ state: 'visible' });
      expect(await call.getAttribute('href') === 'tel:+919203900410', `incorrect call link on ${path}`);
      const whatsapp = page.getByRole('link', { name: 'Chat with Baba Solars on WhatsApp' });
      await whatsapp.waitFor({ state: 'visible' });
      expect(await whatsapp.getAttribute('href') === 'https://wa.me/919203900410', `incorrect WhatsApp link on ${path}`);
      expect(await whatsapp.getAttribute('target') === '_blank', 'WhatsApp should open in a new tab');
      expect(await whatsapp.getAttribute('rel') === 'noopener noreferrer', 'WhatsApp target must be protected');
    }
  }
});

await test('pricing page shows the current company price list', async () => {
  await page.goto(`${BASE}/pricing`);
  for (const [qualityIndex, quality] of [[0, 'Normal'], [1, 'Premium']]) {
    await page.locator('fieldset', { hasText: 'Material quality' }).first().getByText(quality, { exact: true }).click();
    for (const [company, sizes] of Object.entries(PRICES)) {
      for (const [kw, prices] of Object.entries(sizes)) {
        await page.getByRole('link', { name: `${company} ${kw} kW ${quality}: ${inr(prices[qualityIndex])}` })
          .first().waitFor({ timeout: 5000 });
      }
    }
  }
});

await test('calculator deep link uses the exact package price and subsidy', async () => {
  await page.goto(`${BASE}/calculator?company=co-waaree&kw=5&quality=premium`);
  await page.getByText(inr(330000)).first().waitFor({ timeout: 10000 });
  await page.getByText(inr(78000)).first().waitFor();
  await page.getByText(inr(30000)).first().waitFor();
  await page.getByText(inr(222000)).first().waitFor();
});

await test('calculator and contact forms do not fake a successful submission or persist contact data', async () => {
  await page.goto(`${BASE}/calculator`);
  await page.getByLabel('Average monthly electricity bill').fill('100');
  await page.getByRole('alert').filter({ hasText: 'at least ₹300' }).first().waitFor();
  await page.getByLabel('Average monthly electricity bill').fill('3000');
  await page.getByText('Recommended system').waitFor();
  await page.getByRole('button', { name: 'Get a written quote' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Full name').fill('E2E Calculator Lead');
  await dialog.getByLabel('Mobile number').fill('9876512345');
  await dialog.getByRole('button', { name: 'Send quote request' }).click();
  await dialog.getByText(/Online quote requests are unavailable/).waitFor({ timeout: 10000 });

  await page.goto(`${BASE}/contact`);
  await page.getByRole('button', { name: /send/i }).first().click();
  await page.getByRole('alert').first().waitFor();
  await page.locator('#contact-name').fill('E2E Contact Person');
  await page.locator('#contact-phone').fill('9827012345');
  await page.locator('#contact-service').selectOption({ index: 1 });
  await page.getByLabel('Tell us a little more').fill('Please call me about a 5 kW system.');
  await page.getByRole('button', { name: /send/i }).first().click();
  await page.getByText(/Online enquiry delivery is unavailable/).first().waitFor({ timeout: 10000 });
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('baba-solars:mock-db') ?? '{}'));
  expect(saved.quotations.length === 0, 'quote request data should not be stored in browser storage');
  expect(saved.enquiries.length === 0, 'contact data should not be stored in browser storage');
});

await test('local admin gate opens the panel, restores its cookie, and signs out', async () => {
  await page.goto(BASE);
  await page.evaluate(() => localStorage.setItem(
    'baba-solars:mock-session',
    JSON.stringify({ userId: 'legacy-user', exp: Date.now() + 60_000 }),
  ));
  await page.evaluate(() => {
    const key = 'baba-solars:mock-db';
    const stored = JSON.parse(localStorage.getItem(key) ?? '{}');
    stored.users = [{
      id: 'legacy-user',
      name: 'Legacy user',
      email: 'legacy@example.com',
      password: 'legacy-only-value',
    }];
    stored.enquiries = [{ id: 'legacy-enquiry', phone: '9876512345' }];
    stored.quotations = [{ id: 'legacy-quote', customerName: 'Legacy Customer' }];
    stored.invoices = [{ id: 'legacy-invoice', customerName: 'Legacy Customer' }];
    localStorage.setItem(key, JSON.stringify(stored));
  });
  await page.reload();
  const legacyAuth = await page.evaluate(() => ({
    session: localStorage.getItem('baba-solars:mock-session'),
    data: JSON.parse(localStorage.getItem('baba-solars:mock-db') ?? '{}'),
  }));
  expect(legacyAuth.session === null, 'legacy browser session should be cleared');
  expect(legacyAuth.data.users.length === 0, 'legacy browser user/password records should be cleared');
  expect(legacyAuth.data.enquiries.length === 0, 'legacy enquiry records should be cleared');
  expect(legacyAuth.data.quotations.length === 0, 'legacy quotation records should be cleared');
  expect(legacyAuth.data.invoices.length === 0, 'legacy invoice records should be cleared');

  for (const path of ['/admin', '/admin/billing', '/admin/users']) {
    await page.goto(BASE + path);
    await page.getByRole('heading', { name: 'Baba Solars admin' }).waitFor();
    await page.getByText(/does not verify your password/i).waitFor();
    expect(await page.getByLabel('Email').count() === 1, 'local gate should ask for an email');
    expect(await page.getByLabel('Password').count() === 1, 'local gate should ask for a non-empty password');
    expect(await page.getByRole('button', { name: 'Sign in' }).count() === 1, 'local gate should offer sign in');
    expect(await page.getByText(/demo mode|mock data|reset demo/i).count() === 0, 'login must not show development messaging');
  }

  await page.goto(`${BASE}/admin`);
  await page.getByLabel('Email').fill('local-preview@example.com');
  await page.getByLabel('Password').fill('not-verified');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('heading', { name: 'Dashboard' }).waitFor();
  expect(await page.evaluate(() => document.cookie.includes('baba-solars-local-admin=active')), 'local session should use its short-lived cookie marker');
  expect(await page.getByRole('link', { name: 'Users' }).count() === 0, 'user management should remain unavailable without the server');

  await page.reload();
  await page.getByRole('heading', { name: 'Dashboard' }).waitFor();
  await page.getByRole('button', { name: 'Log out' }).click();
  await page.getByRole('heading', { name: 'Baba Solars admin' }).waitFor();
  expect(await page.evaluate(() => document.cookie.includes('baba-solars-local-admin=active')) === false, 'logout should remove the local session cookie');
});

await test('responsive pages have no horizontal overflow on phone, tablet, and desktop', async () => {
  for (const [width, height] of [[390, 844], [768, 1024], [1366, 900]]) {
    await page.setViewportSize({ width, height });
    for (const path of ['/', '/pricing', '/calculator', '/contact', '/admin/login']) {
      await page.goto(BASE + path);
      await page.getByRole('heading', { level: 1 }).first().waitFor({ timeout: 15000 });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow <= 1, `${path} at ${width}px scrolls sideways by ${overflow}px`);
    }
  }
});

await browser.close();
const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (consoleProblems.length)
  console.log(`\nConsole errors (${consoleProblems.length}):\n  ${consoleProblems.slice(0, 15).join('\n  ')}`);
process.exit(failed.length || consoleProblems.length ? 1 : 0);
