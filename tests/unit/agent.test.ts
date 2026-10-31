import { describe, expect, it } from 'vitest'
import path from 'node:path'
// @ts-expect-error plain ESM script without types
import { localPathFor } from '../../agent/sync-agent.mjs'

describe('desktop sync agent path safety', () => {
  const root = path.resolve('/tmp/QB')
  it('maps server paths into the local Quotation and Billing folder', () => {
    expect(localPathFor(root, 'Quotations/Ramesh Sharma/BS-QT-2026-27-0001 - Ramesh Sharma.pdf')).toBe(path.join(root, 'Quotations', 'Ramesh Sharma', 'BS-QT-2026-27-0001 - Ramesh Sharma.pdf'))
  })
  it.each(['../Windows/x.pdf', 'Quotations/../../x', 'Quotations/a\\..\\b.pdf', 'Other/x.pdf', 'Billing//x.pdf', 'Billing/C:x.pdf'])('refuses %s', (p) => {
    expect(() => localPathFor(root, p)).toThrow()
  })
})
