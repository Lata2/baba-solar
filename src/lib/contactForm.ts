import type { EnquiryType } from '@/types'
import { indianPhone, minLength, optionalEmail, required, validate } from './validation'

/** Website contact form values (all strings, as typed). */
export interface ContactValues {
  name: string
  phone: string
  email: string
  city: string
  enquiryType: EnquiryType
  /** '' = not sure / not given */
  kw: string
  service: string
  message: string
}

/** Required kW choices (optional field). */
export const KW_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: 'Not sure yet' },
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 20, 25, 30, 40, 50, 75, 100, 150, 200, 300, 500].map((n) => ({ value: String(n), label: `${n} kW` })),
]

/**
 * Rules: name and message required; mobile OR email required (both fine); a mobile that is filled in
 * must be a 10-digit Indian number and an email must look valid; kW optional.
 */
export function validateContact(v: ContactValues): Partial<Record<keyof ContactValues, string>> {
  const errs = validate(v as unknown as Record<string, string>, {
    name: [required('your name'), minLength(2, 'Name')],
    email: [optionalEmail],
    message: [required('a short message'), minLength(10, 'Message')],
  }) as Partial<Record<keyof ContactValues, string>>
  const phone = v.phone.trim()
  if (phone) {
    const msg = indianPhone(phone)
    if (msg) errs.phone = msg
  } else if (!v.email.trim()) {
    errs.phone = 'Enter your mobile number or email — at least one is needed.'
  }
  if (v.enquiryType !== 'home' && v.enquiryType !== 'commercial') errs.enquiryType = 'Choose Home or Commercial.'
  if (v.kw && !(Number(v.kw) > 0)) errs.kw = 'Choose a valid capacity.'
  return errs
}

/** Order used to focus the first invalid field. */
export const CONTACT_FIELD_ORDER: Array<keyof ContactValues> = ['name', 'phone', 'email', 'city', 'enquiryType', 'service', 'kw', 'message']
