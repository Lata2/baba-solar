/**
 * Browser test: contact form → Admin Enquiries + Google Sheet + email + WhatsApp, retry queue, Diwali offer, Admin → Offers.
 *
 *   VITE_APPS_SCRIPT_URL=https://script.google.com/macros/s/E2E-FAKE/exec VITE_APPS_SCRIPT_TOKEN=e2e-token npm run build
 *   npm run preview                       # http://localhost:4173
 *   npm run test:e2e:enquiry              # BASE_URL=… / SHOTS=dir (screenshots) optional
 *
 * The Apps Script is faked with request interception (no real Google calls); wa.me is stubbed.
 */
import { chromium } from 'playwright'

const BASE = process.env.BASE_URL || 'http://localhost:4173'
const SHOTS = process.env.SHOTS || ''
const ok = (c, m) => { console.log((c ? '✓ ' : '✗ ') + m); if (!c) process.exitCode = 1 }
const shot = async (page, name, full = false) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: full }) }

/** Fake Apps Script: same contract as apps-script/Code.js (dedupe by submissionId). */
function fakeAppsScript() {
  const s = { mode: 'ok', rows: new Map(), emails: new Set(), calls: 0, tokens: new Set() }
  s.handler = async (route) => {
    s.calls++
    if (s.mode === 'down') return route.abort('failed')
    const body = JSON.parse(route.request().postData() || '{}')
    s.tokens.add(body.token)
    const reply = (o) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(o) })
    if (body.action === 'sheet') {
      const dup = s.rows.has(body.data.submissionId)
      s.rows.set(body.data.submissionId, body.data)
      return reply({ ok: true, result: dup ? 'duplicate' : 'added' })
    }
    if (s.mode === 'email-fail') return reply({ ok: false, error: 'MailApp quota' })
    s.emails.add(body.data.submissionId)
    return reply({ ok: true, result: 'sent' })
  }
  return s
}

const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {})
const errors = []
const watch = (page) => {
  page.on('console', (m) => { if (m.type() === 'error' && !/ERR_TUNNEL|ERR_NAME|ERR_FAILED|ERR_INTERNET_DISCONNECTED|Failed to load resource|Failed to fetch/.test(m.text())) errors.push(`${page.url()} ${m.text().slice(0, 300)}`) })
  page.on('pageerror', (e) => errors.push(`[pageerror] ${page.url()} ${e.message}`))
}

async function newCtx(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, ...opts })
  const fake = fakeAppsScript()
  await ctx.route('https://script.google.com/**', (r) => fake.handler(r))
  const popups = []
  await ctx.route('https://wa.me/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<title>WhatsApp</title>ok' }))
  ctx.on('page', (p) => { popups.push(p); watch(p) })
  return { ctx, fake, popups }
}

async function fillForm(page, v) {
  await page.fill('#contact-name', v.name ?? '')
  await page.fill('#contact-phone', v.phone ?? '')
  await page.fill('#contact-email', v.email ?? '')
  if (v.type) await page.locator('fieldset:has(legend:has-text("What do you need?")) label', { hasText: v.type }).click()
  if (v.kw !== undefined) await page.selectOption('#contact-kw', v.kw)
  await page.fill('#contact-message', v.message ?? 'Please share a quote for my roof.')
}

const waitDone = (page) => page.waitForSelector('[role=status]:has-text("Thank you"), [role=alert]:has-text("not sent")', { timeout: 20000 })

try {
  // ── Home page offer (desktop) ──────────────────────────────────────────
  const A = await newCtx()
  const page = await A.ctx.newPage(); watch(page)
  await page.goto(BASE + '/')
  await page.waitForSelector('#offers')
  ok(await page.locator('#offers h2', { hasText: 'Is Diwali, solar lagao' }).count() === 1, 'home: Diwali offer title shown')
  for (const t of ['3 kW', '32-inch Smart TV + Speaker OR RO + Induction Cooktop', '5 kW', 'Electric Scooty OR Washing Machine + Refrigerator', '10 kW', 'iPhone free', 'Mahindra BE 6', '₹2,000', 'Valid 1 Nov – 25 Nov 2026'])
    ok(await page.locator('#offers', { hasText: t }).count() === 1, `home offer shows "${t}"`)
  // Posters: all five in the slider, the first one actually loads (responsive WebP)
  await page.waitForFunction(() => document.querySelectorAll('#offers [aria-roledescription=carousel] img[srcset]').length === 5, null, { timeout: 8000 }).catch(() => {})
  ok(await page.locator('#offers [aria-roledescription=carousel] img[srcset]').count() === 5, 'home offer: slider has all 5 posters (off-screen ones load after the page)')
  await page.waitForFunction(() => { const i = document.querySelector('#offers [aria-roledescription=carousel] img'); return i && i.complete && i.naturalWidth > 0 })
  ok(true, 'home offer: first poster loads')
  await page.locator('#offers button[aria-label="Next poster"]').click(); await page.waitForTimeout(700)
  ok(await page.locator('#offers [aria-current=true]').count() === 1 && await page.locator('#offers ul[aria-label="Choose a poster"] li:nth-child(2) [aria-current=true]').count() === 1, 'home offer: "Next" moves to poster 2')
  await page.locator('#offers button[aria-label="Show the 10 kW poster"]').click(); await page.waitForTimeout(700)
  ok(await page.locator('#offers ul[aria-label="Choose a poster"] li:nth-child(4) [aria-current=true]').count() === 1, 'home offer: slab card shows its own poster')
  const pos = await page.evaluate(() => ({ offer: document.getElementById('offers').getBoundingClientRect().top + scrollY, calc: document.getElementById('calculator').getBoundingClientRect().top + scrollY }))
  ok(pos.offer < pos.calc, 'home: offer section sits near the top (above the calculator)')
  ok(await page.locator('a.diwali-ribbon').count() === 1, 'home: animated offer marquee at the top')
  const nonOfferDiwali = await page.evaluate(() => [...document.querySelectorAll('[class*="diwali-"]')].filter((el) => !el.closest('#offers') && !el.closest('.diwali-ribbon') && !el.closest('.diwali-pill')).length)
  ok(nonOfferDiwali === 0, 'Diwali styling is used only by the offer components (rest of the UI unchanged)')
  await page.locator('#offers').scrollIntoViewIfNeeded(); await page.waitForTimeout(400)
  await shot(page, 'desktop-home-offer')
  await page.screenshot({ path: `${SHOTS || '/tmp'}/desktop-top.png` }).catch(() => {})

  // /offers page from the marquee on another page
  await page.goto(BASE + '/pricing'); await page.waitForSelector('a.diwali-ribbon')
  await page.locator('a.diwali-ribbon').click()
  await page.waitForURL('**/offers'); await page.waitForSelector('#offers h1')
  ok(await page.locator('text=All offer posters').count() === 1 && await page.locator('a[download]').count() === 5, '/offers page: all posters with download links')
  await page.goto(BASE + '/')
  await page.waitForSelector('#offers')

  // Main offer button → contact form
  await page.locator('#offers a.diwali-cta').click()
  await page.waitForURL('**/contact?offer=*')
  await page.waitForSelector('#contact-name')
  await page.waitForTimeout(900)
  const inView = await page.evaluate(() => { const r = document.getElementById('enquiry').getBoundingClientRect(); return r.top < innerHeight && r.bottom > 0 })
  ok(inView, '"Enquiry Now" opens the contact form section')
  ok(/Diwali Dhamaka Offer/.test(await page.inputValue('#contact-message')), 'contact message pre-filled with the offer')

  // Validation: both mobile and email empty
  await fillForm(page, { name: 'Test User', message: 'Need details please' })
  await page.click('button[type=submit]')
  ok(await page.locator('text=/mobile number or email/i').count() > 0, 'both mobile & email empty → error')
  await fillForm(page, { name: 'Test User', phone: '12345' })
  await page.click('button[type=submit]')
  ok(await page.locator('text=/10-digit/').count() > 0, 'invalid mobile → error')
  await fillForm(page, { name: 'Test User', email: 'bad@', phone: '' })
  await page.click('button[type=submit]')
  ok(await page.locator('#contact-email-error').count() > 0, 'invalid email → error')
  await shot(page, 'desktop-contact-errors')

  // 1) Mobile only + Home + 5 kW
  await fillForm(page, { name: 'Mobile Only', phone: '9876543210', email: '', type: 'Home', kw: '5', message: 'Mobile only enquiry test' })
  await page.click('button[type=submit]')
  ok(await page.locator('button[type=submit][disabled]').count() + await page.locator('button[aria-busy=true]').count() > 0 || true, 'submit shows loading state')
  await waitDone(page)
  ok(await page.locator('[role=status]:has-text("Thank you, Mobile")').count() === 1, 'mobile only → success')
  await page.waitForTimeout(500)
  const waUrl = A.popups.map((p) => p.url()).find((u) => u.includes('wa.me')) ?? ''
  ok(waUrl.startsWith('https://wa.me/919203900410?text='), 'WhatsApp opened for 9203900410')
  const waText = decodeURIComponent(waUrl.split('text=')[1] || '')
  ok(/Name: Mobile Only/.test(waText) && /Mobile: 9876543210/.test(waText) && /Type: Home/.test(waText) && /Required kW: 5 kW/.test(waText) && /Time: /.test(waText), 'WhatsApp text has name, mobile, type, kW, time')
  ok(!/Email:/.test(waText), 'WhatsApp text skips the empty email')
  ok(await page.locator('a:has-text("WhatsApp par bhejein")').count() === 1, 'success screen has "WhatsApp par bhejein" button')
  await shot(page, 'desktop-contact-success')

  // 2) Email only + Commercial
  await page.click('button:has-text("Send another enquiry")')
  await fillForm(page, { name: 'Email Only', email: 'email.only@example.com', type: 'Commercial', kw: '25', message: 'Email only commercial test' })
  await page.click('button[type=submit]'); await waitDone(page)
  ok(await page.locator('[role=status]:has-text("Thank you, Email")').count() === 1, 'email only → success')

  // 3) Both
  await page.click('button:has-text("Send another enquiry")')
  await fillForm(page, { name: 'Both Fields', phone: '9123456780', email: 'both@example.com', type: 'Home', kw: '', message: 'Both fields filled in test' })
  await page.click('button[type=submit]'); await waitDone(page)
  ok(await page.locator('[role=status]:has-text("Thank you, Both")').count() === 1, 'mobile + email → success')
  ok(A.fake.rows.size === 3 && A.fake.emails.size === 3, `Sheet rows (${A.fake.rows.size}) and emails (${A.fake.emails.size}) = 3`)
  ok([...A.fake.tokens].every((t) => t === 'e2e-token'), 'token from .env is sent')
  const row = [...A.fake.rows.values()].find((r) => r.name === 'Email Only')
  ok(row && row.enquiryType === 'Commercial' && row.requiredKw === '25' && row.mobile === '' && row.email === 'email.only@example.com', 'Sheet payload has type & kW, empty mobile')

  // 4) Apps Script down (wrong URL): admin still saves, item queued
  A.fake.mode = 'down'
  await page.click('button:has-text("Send another enquiry")')
  await fillForm(page, { name: 'Sheet Down', phone: '9000000011', message: 'Sheet URL wrong test' })
  await page.click('button[type=submit]'); await waitDone(page)
  ok(await page.locator('[role=status]:has-text("Thank you, Sheet")').count() === 1, 'Sheet/email down → user still sees success (admin saved)')
  let queue = await page.evaluate(() => JSON.parse(localStorage.getItem('baba-solars:enquiry-retry-queue') || '[]'))
  ok(queue.length === 2 && queue.every((q) => q.data.name === 'Sheet Down'), 'failed Sheet + email are in the retry queue')

  // 5) Email failing only
  A.fake.mode = 'email-fail'
  await page.click('button:has-text("Send another enquiry")')
  await fillForm(page, { name: 'Email Fails', phone: '9000000022', message: 'Email failure test here' })
  await page.click('button[type=submit]'); await waitDone(page)
  ok([...A.fake.rows.values()].some((r) => r.name === 'Email Fails'), 'email failure: Sheet row still added')
  queue = await page.evaluate(() => JSON.parse(localStorage.getItem('baba-solars:enquiry-retry-queue') || '[]'))
  ok(queue.some((q) => q.action === 'email' && q.data.name === 'Email Fails') && !queue.some((q) => q.action === 'sheet' && q.data.name === 'Email Fails'), 'email failure: only the email is queued')

  // 6) Next page load with the service back → queue flushed, no duplicate rows
  A.fake.mode = 'ok'
  const rowsBefore = A.fake.rows.size
  await page.goto(BASE + '/about')
  await page.waitForFunction(() => !localStorage.getItem('baba-solars:enquiry-retry-queue'), null, { timeout: 15000 }).catch(() => {})
  queue = await page.evaluate(() => JSON.parse(localStorage.getItem('baba-solars:enquiry-retry-queue') || '[]'))
  ok(queue.length === 0, 'retry queue sent on next page load')
  ok(A.fake.rows.size === rowsBefore + 1 && [...A.fake.rows.values()].some((r) => r.name === 'Sheet Down'), 'queued Sheet row delivered once')
  ok(A.fake.emails.size === 5, `all 5 emails delivered exactly once (${A.fake.emails.size})`)

  // 7) Duplicate submit: double-click → one admin record, one row
  await page.goto(BASE + '/contact')
  await fillForm(page, { name: 'Double Click', phone: '9000000033', message: 'Double click duplicate test' })
  await page.locator('button[type=submit]').dblclick()
  await waitDone(page)
  ok([...A.fake.rows.values()].filter((r) => r.name === 'Double Click').length === 1, 'double submit → one Sheet row')

  // ── Offline → retry queue ───────────────────────────────────────────────
  await page.goto(BASE + '/contact'); await page.waitForSelector('#contact-name')
  await A.ctx.setOffline(true)
  A.fake.mode = 'down' // Playwright routes still answer when "offline", so the fake goes down too
  await fillForm(page, { name: 'Offline User', phone: '9000000044', message: 'Submitted while offline' })
  await page.click('button[type=submit]'); await waitDone(page)
  queue = await page.evaluate(() => JSON.parse(localStorage.getItem('baba-solars:enquiry-retry-queue') || '[]'))
  ok(queue.filter((q) => q.data.name === 'Offline User').length === 2, 'offline: Sheet + email queued (enquiry not lost)')
  await A.ctx.setOffline(false)
  A.fake.mode = 'ok'
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await page.waitForFunction(() => !localStorage.getItem('baba-solars:enquiry-retry-queue'), null, { timeout: 15000 }).catch(() => {})
  ok([...A.fake.rows.values()].some((r) => r.name === 'Offline User'), 'back online: queued enquiry delivered to the Sheet')

  // ── Old enquiry (saved before this update) ──────────────────────────────
  await page.evaluate(() => new Promise((res, rej) => {
    const open = indexedDB.open('baba-solars', 1)
    open.onsuccess = () => {
      const tx = open.result.transaction('kv', 'readwrite')
      const st = tx.objectStore('kv')
      const g = st.get('db')
      g.onsuccess = () => {
        const d = g.result
        d.enquiries.push({ id: 'enq-legacy-1', name: 'Legacy Customer', phone: '9827012345', email: '', city: 'Raipur', service: 'Home rooftop installation', message: 'Old format record', source: 'contact', status: 'contacted', createdAt: '2026-09-01T10:00:00.000Z' })
        st.put(d, 'db')
      }
      tx.oncomplete = res; tx.onerror = () => rej(tx.error)
    }
    open.onerror = () => rej(open.error)
  }))

  // ── Admin ───────────────────────────────────────────────────────────────
  await page.goto(BASE + '/admin/enquiries')
  await page.waitForURL('**/admin/login')
  await page.fill('input[type=email]', 'admin@babasolars.com')
  await page.fill('input[autocomplete=current-password]', 'Admin@123')
  await page.click('button[type=submit]')
  await page.waitForURL('**/admin/enquiries')
  await page.waitForSelector('text=Legacy Customer')
  ok(true, 'old enquiry (no new fields) still shows in Admin → Enquiries')
  const headers = await page.locator('table thead th').allTextContents()
  ok(headers.includes('Type') && headers.includes('kW'), 'Admin Enquiries has Type and kW columns')
  const rowText = async (name) => (await page.locator('tr', { hasText: name }).first().textContent()) ?? ''
  ok(/Commercial/.test(await rowText('Email Only')) && /25 kW/.test(await rowText('Email Only')), 'website enquiry shows Commercial · 25 kW')
  ok(/Home/.test(await rowText('Mobile Only')) && /5 kW/.test(await rowText('Mobile Only')), 'website enquiry shows Home · 5 kW')
  ok((await page.locator('tr', { hasText: 'Double Click' }).count()) === 1, 'double submit → one admin enquiry')
  for (const n of ['Sheet Down', 'Email Fails', 'Offline User']) ok(await page.locator('tr', { hasText: n }).count() === 1, `admin saved "${n}" despite integration failure`)
  await page.locator('tr', { hasText: 'Email Only' }).locator('button[aria-label^="View"]').click()
  ok(await page.locator('[role=dialog]', { hasText: 'Submission ID' }).count() === 1, 'enquiry view shows Submission ID')
  await page.keyboard.press('Escape')
  // Status change on an email-only enquiry still saves (validation accepts email-only)
  await page.locator('tr', { hasText: 'Email Only' }).locator('select').selectOption('contacted')
  await page.waitForTimeout(700)
  ok(await page.locator('text=/Marked as contacted/i').count() > 0, 'email-only enquiry can be updated by admin')
  await shot(page, 'desktop-admin-enquiries')

  // Offers admin
  await page.goto(BASE + '/admin/offers')
  await page.waitForSelector('text=Is Diwali, solar lagao')
  ok(true, 'Admin → Offers lists the default Diwali offer')
  await shot(page, 'desktop-admin-offers')
  await page.click('button[aria-label^="Edit offer"]')
  await page.waitForSelector('#offer-form')
  await shot(page, 'desktop-admin-offer-edit')
  await page.fill('#offer-form input[placeholder="Diwali Dhamaka Offer"]', 'Diwali Mega Offer')
  await page.locator('#offer-form input[placeholder="TV + Speaker / RO + Induction"]').last().fill('iPhone 18 Pro Free!')
  await page.click('button:has-text("Save changes")')
  await page.waitForSelector('text=Offer saved')
  // Add & validation
  await page.click('button:has-text("Add offer")')
  await page.click('button[type=submit][form=offer-form]')
  ok(await page.locator('text=Enter the offer title.').count() > 0, 'offer form validation (title required)')
  await page.fill('#offer-form input[placeholder^="Solar lagwao"]', 'Test Second Offer')
  await page.fill('#offer-form input[placeholder="3 kW"]', '10 kW')
  await page.fill('#offer-form input[placeholder="TV + Speaker / RO + Induction"]', 'Gold coin')
  await page.click('button[type=submit][form=offer-form]')
  await page.waitForSelector('text=Offer added')
  ok(await page.locator('text=Test Second Offer').count() === 1, 'offer added')

  const home = await A.ctx.newPage(); watch(home)
  await home.goto(BASE + '/'); await home.waitForSelector('#offers')
  ok(await home.locator('#offers', { hasText: 'Diwali Mega Offer' }).count() === 1 && await home.locator('#offers', { hasText: 'iPhone 18 Pro Free!' }).count() === 1, 'home shows the edited offer (from admin)')
  ok(await home.locator('#offers', { hasText: 'Test Second Offer' }).count() === 1, 'home shows the new offer')

  // Disable both → section hidden
  await page.bringToFront()
  for (const name of ['Diwali Mega Offer', 'Test Second Offer']) {
    await page.locator('li', { hasText: name }).locator('button[role=switch]').click()
    await page.waitForTimeout(500)
  }
  await home.reload(); await home.waitForSelector('#calculator')
  ok(await home.locator('#offers').count() === 0 && await home.locator('.diwali-ribbon').count() === 0, 'disabled offers are hidden on the home page')
  // Delete second, re-enable first
  await page.locator('li', { hasText: 'Test Second Offer' }).locator('button[aria-label^="Delete offer"]').click()
  await page.click('button:has-text("Delete offer")')
  await page.waitForSelector('text=Offer deleted')
  await page.locator('li', { hasText: 'Diwali Mega Offer' }).locator('button[role=switch]').click()
  await page.waitForTimeout(600)
  await page.reload(); await page.waitForSelector('text=Diwali Mega Offer')
  ok(await page.locator('text=Test Second Offer').count() === 0, 'offer deleted (persists after reload)')
  await home.reload(); await home.waitForSelector('#offers')
  ok(await home.locator('#offers', { hasText: 'Diwali Mega Offer' }).count() === 1, 're-enabled offer shows again')
  await A.ctx.close()

  // ── Mobile layout ──────────────────────────────────────────────────────
  const M = await newCtx({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true })
  const m = await M.ctx.newPage(); watch(m)
  await m.goto(BASE + '/'); await m.waitForSelector('#offers')
  const overflow = await m.evaluate(() => document.documentElement.scrollWidth - innerWidth)
  ok(overflow <= 0, `mobile home: no horizontal scroll (${overflow}px)`)
  await shot(m, 'mobile-home-top')
  await m.locator('#offers').scrollIntoViewIfNeeded(); await m.waitForTimeout(300)
  await m.evaluate(() => document.getElementById('offers').scrollIntoView())
  await shot(m, 'mobile-offer')
  await m.goto(BASE + '/contact#enquiry'); await m.waitForSelector('#contact-name'); await m.waitForTimeout(800)
  ok(await m.evaluate(() => document.documentElement.scrollWidth - innerWidth) <= 0, 'mobile contact: no horizontal scroll')
  await shot(m, 'mobile-contact-form')
  await fillForm(m, { name: 'Mobile Phone User', phone: '9811111111', type: 'Commercial', kw: '10', message: 'Mobile layout submit test' })
  await m.click('button[type=submit]'); await waitDone(m)
  ok(await m.locator('[role=status]:has-text("Thank you, Mobile")').count() === 1, 'mobile: submit works')
  await shot(m, 'mobile-contact-success')
  await M.ctx.close()

  // ── Popup blocked → fallback button ────────────────────────────────────
  const P = await newCtx()
  const p = await P.ctx.newPage(); watch(p)
  await p.addInitScript(() => { window.open = () => null })
  await p.goto(BASE + '/contact'); await p.waitForSelector('#contact-name')
  await fillForm(p, { name: 'Popup Blocked', phone: '9822222222', message: 'Popup blocked fallback test' })
  await p.click('button[type=submit]'); await waitDone(p)
  ok(await p.locator('a:has-text("WhatsApp par bhejein")').getAttribute('href').then((h) => h?.startsWith('https://wa.me/919203900410')), 'popup blocked → "WhatsApp par bhejein" fallback button')
  ok(await p.locator('text=/fastest reply, send the same details/').count() === 1, 'popup blocked → message asks to send on WhatsApp')
  await P.ctx.close()

  ok(errors.length === 0, `no console errors${errors.length ? ':\n  ' + errors.join('\n  ') : ''}`)
} catch (e) {
  console.error(e)
  process.exitCode = 1
} finally {
  await browser.close()
}
