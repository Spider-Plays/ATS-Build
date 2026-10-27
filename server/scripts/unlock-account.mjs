/**
 * Clears the sign-in lockout (wrong password and wrong MFA code counters) for one account or all.
 * Uses DATABASE_URL from the environment, else from the repo-root .env.
 * Run: node server/scripts/unlock-account.mjs <email>
 *      node server/scripts/unlock-account.mjs --all
 */
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PrismaClient } from '@prisma/client'

const __dirname = dirname(fileURLToPath(import.meta.url))
const envPath = resolve(__dirname, '../../.env')
if (!process.env.DATABASE_URL && existsSync(envPath)) process.loadEnvFile(envPath)

const arg = process.argv[2]?.trim()
if (!arg) {
  console.error('Usage: node server/scripts/unlock-account.mjs <email> | --all')
  process.exit(1)
}

const dbUrl = process.env.DATABASE_URL ?? ''
console.log(`Database: ${dbUrl.replace(/\/\/[^@]*@/, '//****@').split('?')[0]}`)

const prisma = new PrismaClient()
const cleared = { lockedAt: null, failedLoginAttempts: 0, mfaFailedAttempts: 0 }

try {
  if (arg === '--all') {
    const where = { OR: [{ lockedAt: { not: null } }, { failedLoginAttempts: { gt: 0 } }, { mfaFailedAttempts: { gt: 0 } }] }
    const users = await prisma.user.findMany({ where, select: { email: true, lockedAt: true } })
    await prisma.user.updateMany({ where, data: cleared })
    for (const u of users) console.log(`  ${u.lockedAt ? 'unlocked' : 'reset counters'}: ${u.email}`)
    console.log(`Done: ${users.length} account(s) cleared.`)
  } else {
    const email = arg.toLowerCase()
    const user = await prisma.user.findUnique({ where: { email }, select: { lockedAt: true, failedLoginAttempts: true } })
    if (!user) {
      console.error(`No account found for ${email}`)
      process.exitCode = 1
    } else {
      await prisma.user.update({ where: { email }, data: cleared })
      console.log(`${user.lockedAt ? 'Unlocked' : 'Was not locked; reset counters for'} ${email} (had ${user.failedLoginAttempts} failed attempts).`)
    }
  }
} finally {
  await prisma.$disconnect()
}
