import { describe, expect, it } from 'vitest'
import { findDuplicates, normalizeEnquiry, normalizeMobile, validateEnquiry } from '@/lib/enquiries'
import { autoMap, convertRow, missingRequired, toIsoDate } from '@/lib/enquiryImport'
import { parseCsv } from '@/excel/table'
import { blankProposal, deriveProposal, isExpired, proposalFromEnquiry, validateProposal } from '@/lib/proposals'
import { DEFAULT_CALCULATOR } from '@/data/settings-defaults'
import type { Enquiry } from '@/types'

describe('enquiries', () => {
  it('normalises Indian mobile formats', () => {
    expect(normalizeMobile('+91 98765 43210')).toBe('9876543210')
    expect(normalizeMobile('09876543210')).toBe('9876543210')
    expect(normalizeMobile('12345')).toBe('')
  })
  it('validates required fields', () => {
    const e = validateEnquiry({ name: 'A', phone: '1', service: '' })
    expect(Object.keys(e).sort()).toEqual(['name', 'phone', 'service'])
    expect(validateEnquiry({ name: 'Ravi', phone: '9876543210', service: 'Solar' })).toEqual({})
  })
  it('migrates old (schema 5) records safely', () => {
    const old = { id: 'e1', name: 'Old', phone: '9876543210', email: '', city: '', service: 'x', message: '', source: 'contact', status: 'contacted', createdAt: '2026-01-01T00:00:00Z' } as Enquiry
    const n = normalizeEnquiry(old)
    expect(n.origin).toBe('website')
    expect(n.status).toBe('contacted')
    expect(normalizeEnquiry({ ...old, status: 'weird' as never }).status).toBe('new')
  })
  it('finds duplicates against existing data and inside the file', () => {
    const d = findDuplicates(
      [{ name: 'A', phone: '9876543210', email: '' }, { name: 'B', phone: '9000000001', email: 'b@x.in' }, { name: 'C', phone: '+91 9000000001', email: '' }],
      [{ id: 'x', name: 'Existing', phone: '9876543210', email: '' }],
    )
    expect(d.map((x) => x.index)).toEqual([0, 2])
    expect(d[0].existingId).toBe('x')
  })
})

describe('Excel / CSV import', () => {
  it('parses CSV with quotes, BOM and semicolons', () => {
    expect(parseCsv('﻿a,b\n"x, y","say ""hi"""\n')).toEqual([['a', 'b'], ['x, y', 'say "hi"']])
    expect(parseCsv('a;b\n1;2')).toEqual([['a', 'b'], ['1', '2']])
  })
  it('maps differently named columns', () => {
    const m = autoMap(['Customer', 'Contact Number', 'Location', 'Need', 'KW', 'Lead Source'])
    expect(m.name).toBe(0); expect(m.phone).toBe(1); expect(m.city).toBe(2); expect(m.service).toBe(3); expect(m.capacityKw).toBe(4); expect(m.source).toBe(5)
    expect(missingRequired(m)).toEqual([])
    expect(missingRequired(autoMap(['Foo']))).toContain('Mobile')
    const m2 = autoMap(['Customer Name', 'Mobile No', 'City', 'System Capacity (kW)'])
    expect(m2.city).toBe(2)
    expect(m2.capacityKw).toBe(3)
  })
  it('converts values and reports invalid ones', () => {
    const m = autoMap(['Name', 'Mobile', 'Requirement', 'Capacity', 'Status', 'Source', 'Date'])
    const ok = convertRow(['Ravi', '+91 98765 43210', '3 kW', '3 kW', 'site visit', 'Facebook', '28/10/2026'], m, 1)
    expect(ok.errors).toEqual({})
    expect(ok.values).toMatchObject({ phone: '9876543210', capacityKw: 3, status: 'site-visit', source: 'social' })
    expect(ok.values.createdAt?.startsWith('2026-10-28')).toBe(true)
    const bad = convertRow(['R', '123', '', 'abc', 'zzz', '', 'notadate'], m, 2)
    expect(Object.keys(bad.errors)).toEqual(expect.arrayContaining(['name', 'phone', 'service', 'capacityKw', 'status', 'createdAt']))
  })
  it('reads Excel serial dates', () => {
    expect(toIsoDate('46326')).toBe('2026-10-31')
    expect(toIsoDate('2026-10-31T10:00:00Z')).toBe('2026-10-31')
  })
})

describe('proposals', () => {
  const enquiry = normalizeEnquiry({ id: 'e1', name: 'Asha', phone: '9876543210', email: '', city: 'Bhilai', service: '3 kW', message: '', source: 'manual', status: 'new', createdAt: '', capacityKw: 3 })
  it('copies customer details from the enquiry', () => {
    const p = proposalFromEnquiry(enquiry)
    expect(p).toMatchObject({ enquiryId: 'e1', customerName: 'Asha', city: 'Bhilai', capacityKw: 3 })
    expect(validateProposal(p)).toEqual({})
  })
  it('totals: items with GST, discount, subsidy', () => {
    const p = { ...blankProposal(), customerName: 'A B', phone: '9876543210', capacityKw: 3, discount: 1000,
      items: [{ id: 'l1', name: 'Kit', description: '', hsn: '', unit: 'SET', quantity: 1, rate: 200000, discountPct: 0, gstRate: 5 },
        { id: 'l2', name: 'Transport', description: '', hsn: '', unit: 'LOT', quantity: 1, rate: 2000, discountPct: 0, gstRate: 18 }] }
    const d = deriveProposal(p, { calc: DEFAULT_CALCULATOR, businessStateCode: '22' })
    expect(d.taxableAmount).toBeCloseTo(201000, 0)
    expect(d.grandTotal).toBeGreaterThan(201000)
    expect(d.subsidy).toBe(78000)
    expect(d.stateSubsidy).toBe(30000)
    expect(d.netCost).toBeCloseTo(d.grandTotal - 108000, 0)
  })
  it('rejects bad items and validity before the date', () => {
    const p = { ...blankProposal(), customerName: 'A B', phone: '9876543210', validUntil: '2000-01-01', items: [{ id: 'x', name: '', description: '', hsn: '', unit: '', quantity: 0, rate: -1, discountPct: 0, gstRate: 18 }] }
    const e = validateProposal(p)
    expect(Object.keys(e)).toEqual(expect.arrayContaining(['validUntil', 'items.0.name', 'items.0.quantity', 'items.0.rate']))
  })
  it('flags expired open proposals only', () => {
    expect(isExpired({ status: 'sent', validUntil: '2026-01-01' }, '2026-02-01')).toBe(true)
    expect(isExpired({ status: 'accepted', validUntil: '2026-01-01' }, '2026-02-01')).toBe(false)
  })
})
