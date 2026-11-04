import { beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

/**
 * Runs apps-script/Code.js in a sandbox with small fakes of SpreadsheetApp, MailApp, etc.
 * Checks: header row, token, duplicate protection, email template, email failure isolation.
 */
const code = readFileSync(fileURLToPath(new URL('../../apps-script/Code.js', import.meta.url)), 'utf8')

class FakeRange {
  constructor(private sheet: FakeSheet, private r: number, private c: number, private nr: number, private nc: number) {}
  getValues() {
    return Array.from({ length: this.nr }, (_, i) => Array.from({ length: this.nc }, (_, j) => this.sheet.cells[this.r - 1 + i]?.[this.c - 1 + j] ?? ''))
  }
  setValues(v: unknown[][]) {
    v.forEach((row, i) => row.forEach((x, j) => {
      const ri = this.r - 1 + i
      this.sheet.cells[ri] ??= []
      this.sheet.cells[ri][this.c - 1 + j] = x
    }))
    return this
  }
  setNumberFormat() { return this }
  setFontWeight() { return this }
  setBackground() { return this }
  setFontColor() { return this }
  createTextFinder(text: string) {
    let whole = false
    const finder = {
      matchEntireCell: (b: boolean) => { whole = b; return finder },
      findNext: () => this.getValues().flat().some((v) => (whole ? String(v) === text : String(v).includes(text))) || null,
    }
    return finder
  }
}
class FakeSheet {
  cells: unknown[][] = []
  hidden = false
  constructor(public name: string) {}
  getName() { return this.name }
  getRange(r: number, c: number, nr = 1, nc = 1) { return new FakeRange(this, r, c, nr, nc) }
  getLastRow() { return this.cells.filter((row) => row && row.some((v) => v !== '' && v != null)).length }
  setFrozenRows() {}
  setColumnWidth() {}
  hideSheet() { this.hidden = true }
  getParent() { return { getUrl: () => 'https://docs.google.com/fake' } }
}

let sheets: Map<string, FakeSheet>
let mails: Array<Record<string, string>>
let props: Record<string, string>
let mailFails = false
let ctx: vm.Context

function load() {
  const spreadsheet = {
    getSheetByName: (n: string) => sheets.get(n) ?? null,
    insertSheet: (n: string) => { const s = new FakeSheet(n); sheets.set(n, s); return s },
    getUrl: () => 'https://docs.google.com/fake',
  }
  ctx = vm.createContext({
    console: { log: () => {}, error: () => {} },
    SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet, openById: () => spreadsheet },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k: string) => props[k] ?? null }) },
    LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
    MailApp: { sendEmail: (o: Record<string, string>) => { if (mailFails) throw new Error('Service invoked too many times for one day: email.'); mails.push(o) } },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (t: string) => ({ text: t, setMimeType() { return this } }) },
    Utilities: { formatDate: () => '04 Nov 2026, 12:00 AM', getUuid: () => '00000000-0000-4000-8000-000000000000' },
  })
  vm.runInContext(code, ctx)
}

const post = (body: unknown) => {
  const out = (ctx.doPost as (e: unknown) => { text: string })({ postData: { contents: JSON.stringify(body) } })
  return JSON.parse(out.text) as { ok: boolean; result?: string; error?: string }
}
const data = (over: Record<string, string> = {}) => ({
  submissionId: '11111111-2222-4333-8444-555555555555', dateTime: '04 Nov 2026, 12:00 am', name: 'Ravi Verma', mobile: '9876543210',
  email: '', enquiryType: 'Home', requiredKw: '5', message: 'Need solar', ...over,
})

beforeEach(() => {
  sheets = new Map()
  mails = []
  mailFails = false
  props = { API_TOKEN: 'tok', ADMIN_EMAIL: 'owner@babasolars.example' }
  load()
})

describe('Apps Script: Google Sheet', () => {
  it('creates the header row automatically and appends the 8 columns', () => {
    expect(post({ action: 'sheet', token: 'tok', data: data() })).toMatchObject({ ok: true, result: 'added' })
    const s = sheets.get('Enquiries')!
    expect(s.cells[0]).toEqual(['Submission ID', 'Date & Time', 'Name', 'Mobile', 'Email', 'Enquiry Type', 'Required kW', 'Message'])
    expect(s.cells[1]).toEqual(['11111111-2222-4333-8444-555555555555', '04 Nov 2026, 12:00 am', 'Ravi Verma', '9876543210', '', 'Home', '5', 'Need solar'])
  })

  it('same submissionId twice → only one row', () => {
    post({ action: 'sheet', token: 'tok', data: data() })
    expect(post({ action: 'sheet', token: 'tok', data: data() })).toMatchObject({ ok: true, result: 'duplicate' })
    post({ action: 'sheet', token: 'tok', data: data({ submissionId: 'aaaaaaaa-2222-4333-8444-555555555555' }) })
    expect(sheets.get('Enquiries')!.getLastRow()).toBe(3) // header + 2 different enquiries
  })

  it('rejects a wrong or missing token, and an unset server token', () => {
    expect(post({ action: 'sheet', token: 'nope', data: data() })).toEqual({ ok: false, error: 'Unauthorized' })
    expect(post({ action: 'sheet', data: data() })).toEqual({ ok: false, error: 'Unauthorized' })
    props = {}
    expect(post({ action: 'sheet', token: 'tok', data: data() }).error).toMatch(/API_TOKEN/)
    expect(sheets.size).toBe(0)
  })

  it('validates data and neutralises spreadsheet formulas', () => {
    expect(post({ action: 'sheet', token: 'tok', data: data({ mobile: '', email: '' }) }).error).toMatch(/Mobile or email/)
    expect(post({ action: 'sheet', token: 'tok', data: data({ mobile: '12345' }) }).error).toMatch(/mobile/i)
    post({ action: 'sheet', token: 'tok', data: data({ message: '=HYPERLINK("http://x")' }) })
    expect(sheets.get('Enquiries')!.cells[1][7]).toBe('\'=HYPERLINK("http://x")')
  })
})

describe('Apps Script: email', () => {
  it('sends one branded email; empty fields are not shown', () => {
    expect(post({ action: 'email', token: 'tok', data: data() })).toMatchObject({ ok: true, result: 'sent' })
    expect(mails).toHaveLength(1)
    const m = mails[0]
    expect(m.to).toBe('owner@babasolars.example')
    expect(m.subject).toBe('New enquiry · Ravi Verma · Home · 5 kW')
    expect(m.htmlBody).toContain('Baba Solars')
    expect(m.htmlBody).toContain('>Home</span>') // type badge
    expect(m.htmlBody).toContain('5 <span') // kW block
    expect(m.htmlBody).toContain('04 Nov 2026, 12:00 am')
    expect(m.htmlBody).not.toContain('>Email</td>') // email empty → no row
    expect(m.htmlBody).not.toContain('City / area')
    expect(m.replyTo).toBeUndefined()
  })

  it('emails each submission only once', () => {
    post({ action: 'email', token: 'tok', data: data() })
    expect(post({ action: 'email', token: 'tok', data: data() })).toMatchObject({ ok: true, result: 'already-sent' })
    expect(mails).toHaveLength(1)
  })

  it('escapes HTML from customer input', () => {
    post({ action: 'email', token: 'tok', data: data({ name: 'Ravi <script>x</script>', email: 'r@x.in' }) })
    expect(mails[0].htmlBody).not.toContain('<script>')
    expect(mails[0].htmlBody).toContain('&lt;script&gt;')
    expect(mails[0].replyTo).toBe('r@x.in')
  })

  it('email failure returns ok:false (website retries) and does not touch the sheet', () => {
    post({ action: 'sheet', token: 'tok', data: data() })
    mailFails = true
    const r = post({ action: 'email', token: 'tok', data: data() })
    expect(r.ok).toBe(false)
    expect(sheets.get('Enquiries')!.getLastRow()).toBe(2)
    mailFails = false
    expect(post({ action: 'email', token: 'tok', data: data() })).toMatchObject({ ok: true, result: 'sent' }) // retry works
  })

  it('missing ADMIN_EMAIL → ok:false (kept in the retry queue)', () => {
    delete props.ADMIN_EMAIL
    expect(post({ action: 'email', token: 'tok', data: data() }).error).toMatch(/ADMIN_EMAIL/)
  })
})
