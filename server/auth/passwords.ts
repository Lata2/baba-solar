import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto'

const scrypt = (pw: string, salt: Buffer, len: number, opts: ScryptOptions) =>
  new Promise<Buffer>((resolve, reject) => scryptCb(pw, salt, len, opts, (err, key) => (err ? reject(err) : resolve(key))))

const N = 2 ** 15
const R = 8
const P = 1
const LEN = 64
const MAXMEM = 128 * N * R * 2

/** scrypt$N$r$p$salt$hash (base64url) */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const key = await scrypt(password.normalize('NFKC'), salt, LEN, { N, r: R, p: P, maxmem: MAXMEM })
  return ['scrypt', N, R, P, salt.toString('base64url'), key.toString('base64url')].join('$')
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, salt, hash] = stored.split('$')
  if (alg !== 'scrypt' || !salt || !hash) return false
  const expected = Buffer.from(hash, 'base64url')
  const key = await scrypt(password.normalize('NFKC'), Buffer.from(salt, 'base64url'), expected.length, { N: Number(n), r: Number(r), p: Number(p), maxmem: MAXMEM })
  return key.length === expected.length && timingSafeEqual(key, expected)
}

/** Used when the email does not exist, so a wrong email takes as long as a wrong password. */
let dummy: string | null = null
export async function burnPasswordCheck(password: string) {
  dummy ??= await hashPassword('dummy-password-for-timing')
  await verifyPassword(password, dummy)
}

/** Returns an error message, or null when the password is acceptable. */
export function passwordProblem(pw: string, email = ''): string | null {
  if (typeof pw !== 'string' || pw.length < 10) return 'Use at least 10 characters.'
  if (pw.length > 128) return 'Use at most 128 characters.'
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(pw)).length
  if (classes < 3) return 'Mix at least three of: lowercase, uppercase, numbers, symbols.'
  const local = email.split('@')[0]?.toLowerCase()
  if (local && local.length >= 4 && pw.toLowerCase().includes(local)) return 'Do not use your email name in the password.'
  if (/^(password|admin|babasolar)/i.test(pw)) return 'This password is too easy to guess.'
  return null
}
