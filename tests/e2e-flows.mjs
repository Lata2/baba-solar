/**
 * End-to-end check of the new website & admin workflows (Playwright, Chromium).
 *   npm run build && npm run preview          # http://localhost:4173
 *   npm run test:e2e:flows                    # (BASE_URL=… to point elsewhere; SHOTS=dir to save screenshots)
 * Covers: mobile menu, calculator (categories, location, verified vs indicative tariff, no tariff
 * input), Normal vs Premium (drone cleaning), quote request → enquiry, login errors, manual enquiry →
 * proposal, Excel/CSV import with validation & duplicates, export, proposal edit/PDF/duplicate/convert,
 * quotation from enquiry, billing quick-add charges, products & rates, persistence, console errors.
 */
import { chromium } from 'playwright'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const BASE = process.env.BASE_URL || 'http://localhost:4173'
const SHOTS = process.env.SHOTS || ''
let failed = 0
const ok = (c, m) => { console.log((c ? '✓ ' : '✗ ') + m); if (!c) { failed++; process.exitCode = 1 } }
const shot = async (page, name, full = false) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: full }) }

const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {})
const errors = []
const watch = (page) => {
  page.on('console', (m) => { if (m.type() === 'error' && !/ERR_TUNNEL|ERR_NAME|Failed to load resource/.test(m.text())) errors.push(`${page.url()} ${m.text().slice(0, 300)}`) })
  page.on('pageerror', (e) => errors.push(`[pageerror] ${page.url()} ${e.message}`))
}

try {
  // ── Mobile website ──────────────────────────────────────────────────────
  const mctx = await browser.newContext({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true })
  const m = await mctx.newPage(); watch(m)
  await m.goto(BASE + '/')
  await m.waitForSelector('#calc-bill')
  const order = await m.evaluate(() => {
    const calc = document.querySelector('#calculator')?.getBoundingClientRect().top ?? 1e9
    const plans = document.querySelector('#home-plans')?.getBoundingClientRect().top ?? 1e9
    const six = [...document.querySelectorAll('h2')].find((h) => /6 months|free cleaning/i.test(h.textContent ?? ''))?.getBoundingClientRect().top ?? 1e9
    return { calc, plans, six }
  })
  ok(order.calc < order.six && order.calc < order.plans, 'home: calculator is placed above the 6-month section and plan comparison')
  ok(await m.locator('text=/Tariff \\(₹ per unit/').count() === 0, 'home calculator: no visible tariff input')
  ok(await m.locator('#calculator label:has-text("Commercial")').count() > 0 && await m.locator('#calculator label:has-text("Business")').count() === 0, 'home calculator: "Commercial" label (no "Business")')
  await shot(m, 'm-home')

  await m.click('button[aria-label="Open menu"]')
  await m.waitForSelector('#mobile-menu')
  await m.waitForTimeout(350)
  await shot(m, 'm-menu')
  ok(await m.evaluate(() => document.activeElement?.closest('#mobile-menu') != null), 'menu: focus moves into the menu')
  await m.keyboard.press('Escape'); await m.waitForTimeout(450)
  ok(await m.locator('#mobile-menu').count() === 0, 'menu: Escape closes')
  await m.click('button[aria-label="Open menu"]'); await m.waitForSelector('#mobile-menu')
  await m.locator('#mobile-menu a', { hasText: /^Home$/ }).click(); await m.waitForTimeout(450)
  ok(await m.locator('#mobile-menu').count() === 0, 'menu: tapping the current page closes it')
  await m.click('button[aria-label="Open menu"]'); await m.waitForSelector('#mobile-menu'); await m.waitForTimeout(350)
  await m.mouse.click(20, 400); await m.waitForTimeout(450)
  ok(await m.locator('#mobile-menu').count() === 0, 'menu: tapping the overlay closes it')
  await m.click('button[aria-label="Open menu"]'); await m.waitForSelector('#mobile-menu')
  await m.locator('#mobile-menu a', { hasText: 'Pricing' }).click(); await m.waitForURL('**/pricing'); await m.waitForTimeout(450)
  ok(await m.locator('#mobile-menu').count() === 0 && m.url().endsWith('/pricing'), 'menu: navigates and closes')
  ok(await m.evaluate(() => document.body.style.overflow === ''), 'menu: page scroll restored after closing')

  // Pricing: Normal vs Premium
  await m.waitForSelector('#plans-compare')
  const droneRow = await m.locator('#plans-compare tbody tr', { hasText: 'Drone cleaning' }).first().innerText()
  ok(/Not included[\s\S]*Included/i.test(droneRow) && !/^\s*Included[\s\S]*Not included/i.test(droneRow), 'pricing: drone cleaning — Normal not included, Premium included')
  ok((await m.locator('#plans-compare thead th').allInnerTexts()).join(' ').match(/Normal[\s\S]*Premium/) !== null, 'pricing: compact comparison shows Normal and Premium side by side')
  await shot(m, 'm-pricing', true)
  for (const path of ['/', '/offers', '/pricing', '/calculator', '/services', '/contact', '/drone-cleaning', '/pm-surya-ghar', '/gallery', '/projects', '/about', '/faqs']) {
    await m.goto(BASE + path); await m.waitForLoadState('networkidle')
    const over = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    ok(over <= 0, `375px ${path}: no horizontal scroll (${over}px)`)
  }
  await mctx.close()

  // ── Calculator (desktop) ────────────────────────────────────────────────
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, acceptDownloads: true })
  const page = await ctx.newPage(); watch(page)
  await page.goto(BASE + '/calculator')
  await page.waitForSelector('text=Consumer type')
  ok(await page.locator('text=/Tariff \\(₹ per unit/').count() === 0, 'calculator page: no tariff input')
  ok(await page.locator('text=Bill worked out with the official').count() > 0, 'calculator: Chhattisgarh uses the verified CSPDCL tariff')
  await page.locator('fieldset:has(legend:text("Consumer type")) label:has-text("Industrial")').click()
  await page.waitForTimeout(150)
  ok(await page.locator('text=/LV-5\\.2\\.[12] Industry/').count() > 0, 'calculator: industrial uses the LV-5 industry tariff')
  ok(await page.locator('text=/not eligible/i').count() > 0, 'calculator: industrial shows no PM Surya Ghar subsidy')
  await page.selectOption('select:near(:text("State"))', { label: 'Maharashtra' })
  await page.waitForTimeout(150)
  ok(await page.locator('text=Estimate needs confirmation').count() > 0, 'calculator: unverified state shows "needs confirmation"')
  await page.selectOption('select:near(:text("Country"))', 'OTHER')
  await page.waitForTimeout(150)
  ok(await page.locator('text=/outside India/').count() > 0, 'calculator: other country flagged as not configured')
  await page.selectOption('select:near(:text("Country"))', 'IN')
  await page.selectOption('select:near(:text("State"))', { label: 'Chhattisgarh' })
  await page.locator('fieldset:has(legend:text("Consumer type")) label:has-text("Residential")').click()
  const sizeSouth = await page.locator('text=Recommended system').locator('xpath=following-sibling::p[1]').innerText()
  await page.selectOption('select:near(:text("Roof faces"))', 'east')
  await page.selectOption('select:near(:text("Shading on the roof"))', 'heavy')
  await page.waitForTimeout(150)
  const sizeEast = await page.locator('text=Recommended system').locator('xpath=following-sibling::p[1]').innerText()
  ok(parseFloat(sizeEast) > parseFloat(sizeSouth), `calculator: east + heavy shade needs a bigger system (${sizeSouth} → ${sizeEast})`)
  await shot(page, 'calculator', true)

  // Quote request from the home calculator → enquiry
  await page.goto(BASE + '/')
  await page.waitForSelector('#calc-bill')
  await page.click('#calculator button:has-text("Request this quote")')
  await page.fill('[role=dialog] input[autocomplete=name]', 'Meera Calc')
  await page.fill('[role=dialog] input[type=tel]', '9811122233')
  await page.click('[role=dialog] button[type=submit]')
  await page.waitForSelector('text=Request noted')
  ok(true, 'calculator quote request sent')

  // ── Admin login ─────────────────────────────────────────────────────────
  await page.goto(BASE + '/admin/enquiries')
  await page.waitForURL('**/admin/login')
  await page.click('button[type=submit]')
  ok(await page.locator('text=/Enter your email/i').count() > 0, 'login: empty form shows validation')
  await page.fill('input[type=email]', 'admin@babasolars.com')
  await page.fill('input[autocomplete=current-password]', 'wrong-pass')
  await page.click('button[type=submit]')
  await page.waitForSelector('[role=alert]')
  ok(await page.url().includes('/admin/login'), 'login: wrong password shows an error and stays on login')
  ok(await page.locator('text=/demo|admin@babasolars\\.com \\/ Admin@123/i').count() === 0, 'login: no demo credentials shown')
  await page.fill('input[type=email]', '  Admin@BabaSolars.com ')
  await page.fill('input[autocomplete=current-password]', 'Admin@123')
  await page.click('button[type=submit]')
  await page.waitForURL('**/admin/enquiries')
  ok(true, 'login: correct credentials (case/space-insensitive email) open the requested page')

  // ── Enquiries ───────────────────────────────────────────────────────────
  await page.waitForSelector('text=Meera Calc')
  await page.click('button[aria-label="View enquiry from Meera Calc"]')
  ok(await page.locator('[role=dialog] >> text=Website calculator estimate').count() === 1, 'enquiries: calculator request shows the estimate')
  await page.keyboard.press('Escape')

  await page.click('button:has-text("New enquiry")')
  await page.click('[role=dialog] footer button[type=submit]')
  ok(await page.locator('[role=dialog] [role=alert], [role=dialog] [id$="-error"]').count() >= 2, 'enquiry form: required-field validation')
  await page.locator('[role=dialog]').getByLabel('Customer name').fill('Sunil Manual')
  await page.locator('[role=dialog]').getByLabel('Mobile').fill('+91 98765 11111')
  await page.locator('[role=dialog]').getByLabel('Requirement').fill('5 kW rooftop for house')
  await page.locator('[role=dialog]').getByLabel('System capacity (kW)').fill('5')
  await page.locator('[role=dialog]').getByLabel('Address').fill('Telibandha, Raipur')
  await page.click('[role=dialog] footer button[type=submit]')
  await page.waitForSelector('text=/Draft proposal .* created/')
  ok(await page.locator('text=Sunil Manual').count() > 0, 'manual enquiry added')

  await page.click('button:has-text("New enquiry")')
  await page.locator('[role=dialog]').getByLabel('Customer name').fill('Wa Lead')
  await page.locator('[role=dialog]').getByLabel('Mobile').fill('9876522222')
  await page.locator('[role=dialog]').getByLabel('Requirement').fill('Society rooftop')
  await page.selectOption('[role=dialog] select:near(:text("Source"))', 'whatsapp')
  await page.click('[role=dialog] footer button[type=submit]')
  await page.waitForTimeout(800)
  ok(await page.locator('text=Wa Lead').count() > 0, 'WhatsApp enquiry added (no proposal by default)')

  // edit
  await page.click('button[aria-label="Edit enquiry from Wa Lead"]')
  await page.locator('[role=dialog]').getByLabel('Internal notes').fill('Call back after 6 pm')
  await page.click('[role=dialog] footer button[type=submit]')
  await page.waitForTimeout(700)
  await page.click('button[aria-label="View enquiry from Wa Lead"]')
  ok(await page.locator('[role=dialog] >> text=Call back after 6 pm').count() === 1, 'enquiry edit saved')
  await page.keyboard.press('Escape')

  // search + filter
  await page.fill('input[placeholder^="Search name, mobile"]', 'telibandha')
  await page.waitForTimeout(200)
  ok(await page.locator('tbody tr').count() === 1, 'enquiries: search matches address')
  await page.fill('input[placeholder^="Search name, mobile"]', '')
  await page.selectOption('label:has(> span:text-is("Source")) select', 'website')
  await page.waitForTimeout(200)
  ok(await page.locator('tbody tr').count() === 1 && await page.locator('tbody >> text=Meera Calc').count() === 1, 'enquiries: filter by website source')
  await page.selectOption('label:has(> span:text-is("Source")) select', 'all')

  // Excel/CSV import with mapping, invalid row and duplicate
  const dir = mkdtempSync(join(tmpdir(), 'bs-'))
  const csv = join(dir, 'leads.csv')
  writeFileSync(csv, '﻿Customer,Contact Number,City,Need,KW,Lead Source\nAsha Import,9876533333,Bhilai,3 kW home,3,WhatsApp\nBad Phone,12345,Durg,Shop solar,,Phone call\nSunil Again,9876511111,Raipur,Repeat,5,Referral\n')
  await page.click('button:has-text("Import Excel")')
  await page.setInputFiles('[role=dialog] input[type=file]', csv)
  await page.waitForSelector('text=Match columns')
  ok(await page.locator('[role=dialog] select').first().inputValue() === '0', 'import: columns auto-mapped')
  await page.click('[role=dialog] button:has-text("Preview")')
  await page.waitForSelector('text=Review rows')
  ok(await page.locator('[role=dialog] >> text=/With errors 1/').count() === 1, 'import: invalid row detected')
  ok(await page.locator('[role=dialog] >> text=/Possible duplicates 1/').count() === 1, 'import: duplicate detected')
  await page.click('[role=dialog] button:has-text("Import 1 enquiry")')
  await page.waitForSelector('[role=dialog] >> text=Imported')
  const resultText = await page.locator('[role=dialog]').innerText()
  ok(/Imported\s*1/.test(resultText) && /Failed \/ not imported\s*1/.test(resultText) && /Skipped duplicates\s*1/.test(resultText), 'import: result shows imported / failed / skipped counts')
  await page.click('[role=dialog] button:has-text("Done")')
  await page.waitForSelector('text=Asha Import')
  ok(true, 'imported enquiry listed')

  // export
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('button:has-text("Export Excel")')])
  ok(dl.suggestedFilename().endsWith('.xlsx'), `enquiries exported (${dl.suggestedFilename()})`)

  // delete with confirmation
  await page.click('button[aria-label="Delete enquiry from Wa Lead"]')
  await page.waitForSelector('text=Delete this enquiry?')
  await page.click('[role=dialog] button:has-text("Delete enquiry")')
  await page.waitForTimeout(700)
  ok(await page.locator('tbody >> text=Wa Lead').count() === 0, 'enquiry deleted after confirmation')
  await shot(page, 'admin-enquiries', true)

  // ── Proposals ───────────────────────────────────────────────────────────
  await page.goto(BASE + '/admin/proposals')
  await page.waitForSelector('text=Sunil Manual')
  ok(true, 'manual enquiry appears in Proposals as a draft')
  await page.click('button[aria-label^="Edit proposal"]')
  await page.waitForSelector('text=Products, materials & charges')
  await page.click('[role=dialog] button:has-text("+ Transportation")')
  await page.click('[role=dialog] button:has-text("Add custom item")')
  const names = page.locator('[role=dialog] input[placeholder="e.g. Solar PV modules"]')
  await names.nth(1).fill('Extra GI nuts & bolts')
  const rates = page.locator('[role=dialog] label:has-text("Rate") input')
  await rates.nth(0).fill('2500')
  await rates.nth(1).fill('850')
  await page.click('[role=dialog] footer button[type=submit]')
  await page.waitForSelector('text=Proposal saved')
  ok(true, 'proposal edited with transport + custom material')
  await page.click('button[aria-label^="PDF of proposal"]')
  await page.waitForSelector('[role=dialog] iframe, [role=dialog] object, [role=dialog] embed', { timeout: 20000 })
  ok(true, 'proposal PDF generated')
  await page.keyboard.press('Escape'); await page.waitForTimeout(300)
  await page.click('button[aria-label^="Duplicate proposal"]')
  await page.waitForSelector('text=/Duplicated as/')
  ok(await page.locator('tbody tr').count() === 2, 'proposal duplicated')
  await page.locator('button[aria-label^="Convert"]').first().click()
  await page.waitForURL('**/admin/quotations**')
  await page.waitForSelector('[role=dialog] >> text=From proposal')
  ok(await page.locator('[role=dialog] >> text=/BS\\/PRP\\//').count() > 0, 'proposal converted → quotation keeps proposal link')
  await page.keyboard.press('Escape')

  // ── Quotation from enquiry ──────────────────────────────────────────────
  await page.goto(BASE + '/admin/enquiries')
  await page.click('button[aria-label="Create quotation for Asha Import"]')
  await page.waitForSelector('text=New quotation')
  ok(await page.locator('[role=dialog]').getByLabel('Customer name').inputValue() === 'Asha Import', 'quotation from enquiry: customer details pre-filled')
  await page.click('[role=dialog] footer button[type=submit]')
  await page.waitForSelector('text=/Quotation .* created/')
  await page.goto(BASE + '/admin/enquiries')
  await page.waitForSelector('text=Asha Import')
  ok(await page.locator('tr:has-text("Asha Import") select').inputValue() === 'quoted', 'enquiry status moves to Quoted')

  // ── Products & billing ──────────────────────────────────────────────────
  await page.goto(BASE + '/admin/products')
  await page.click('button:has-text("Add item")')
  await page.locator('[role=dialog]').getByLabel('Name').fill('SS nut M10')
  await page.locator('[role=dialog]').getByLabel('Rate (₹, excl. GST)').fill('4.5')
  await page.click('[role=dialog] footer button[type=submit]')
  await page.waitForTimeout(600)
  await page.fill('input[placeholder="Search name, SKU or HSN"]', 'SS nut')
  ok(await page.locator('tbody >> text=SS nut M10').count() === 1, 'products: material added and searchable')

  await page.goto(BASE + '/admin/billing')
  await page.click('button:has-text("New invoice")')
  await page.waitForSelector('text=Products & services')
  ok(await page.locator('[role=dialog] button:has-text("+ Labour charges")').count() === 1, 'billing: labour / transport quick-add available')

  // ── Persistence ─────────────────────────────────────────────────────────
  await page.goto(BASE + '/admin/proposals')
  await page.reload()
  await page.waitForSelector('text=Sunil Manual')
  ok(await page.locator('tbody tr').count() === 2, 'proposals persist after reload')
  await page.goto(BASE + '/admin')
  await page.waitForSelector('text=Open proposals')
  ok(true, 'dashboard shows proposal stats')
  await shot(page, 'admin-dashboard', true)

  // Admin on a phone: tables become cards
  await page.setViewportSize({ width: 375, height: 800 })
  await page.goto(BASE + '/admin/enquiries')
  await page.waitForSelector('ul[aria-label="Enquiries"] li')
  ok(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth) <= 0, 'admin enquiries at 375px: card layout, no horizontal scroll')
  await shot(page, 'admin-enquiries-mobile', true)

  ok(errors.length === 0, `no console errors${errors.length ? ':\n  ' + errors.join('\n  ') : ''}`)
} catch (e) {
  failed++
  process.exitCode = 1
  console.log('✗ stopped: ' + (e instanceof Error ? e.message.split('\n')[0] : e))
} finally {
  await browser.close()
  console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed')
}
