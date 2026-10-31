import { randomBytes } from 'node:crypto'
import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { loadConfig } from './config'
import { loadEnvFile } from './envFile'
import { jsonUserRepository, ROLES } from './auth/users'
import { passwordProblem } from './auth/passwords'
import type { Role } from '../src/types'

/**
 *   npm run server:keygen        → random TOKEN_ENCRYPTION_KEY and an agent token
 *   npm run server:create-user   → add a user (admin / editor / sales) or reset a password
 */
async function main() {
  const cmd = process.argv[2]
  if (cmd === 'keygen') {
    console.log(`TOKEN_ENCRYPTION_KEY=${randomBytes(32).toString('base64')}`)
    console.log(`AGENT_TOKENS=${randomBytes(32).toString('base64url')}`)
    return
  }
  if (cmd === 'create-user') {
    loadEnvFile()
    const cfg = loadConfig()
    const users = jsonUserRepository(cfg.dataDir)
    const rl = createInterface({ input: stdin, output: stdout })
    const email = (await rl.question('Email: ')).trim().toLowerCase()
    const name = (await rl.question('Name: ')).trim() || email
    const role = ((await rl.question('Role (admin/editor/sales) [admin]: ')).trim() || 'admin') as Role
    const password = await rl.question('Password (min 10 chars, mixed): ')
    rl.close()
    if (!ROLES.includes(role)) throw new Error('Unknown role.')
    const problem = passwordProblem(password, email)
    if (problem) throw new Error(problem)
    const existing = await users.byEmail(email)
    if (existing) { await users.update(existing.id, { password, role, isActive: true }); console.log(`Updated ${email} (${role}).`) }
    else { await users.create({ email, name, role, password }); console.log(`Created ${email} (${role}).`) }
    return
  }
  console.log('Usage: tsx server/cli.ts keygen | create-user')
}

main().catch((e) => { console.error((e as Error).message); process.exit(1) })
