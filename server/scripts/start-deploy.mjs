import { execSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

/** QA Render/Neon must not run destructive prisma db push (e.g. main schema vs qa DB). */
function isQaStagingDeploy() {
  if (process.env.ATS_ENV === 'staging') return true
  const signals = [process.env.APP_URL ?? '', process.env.CLIENT_ORIGIN ?? '']
  return signals.some((value) => value.includes('qa.stitch-ats.in'))
}

function databaseUrlFromEnvFile(filename) {
  const filePath = path.join(root, 'server', filename)
  if (!existsSync(filePath)) return null
  const match = readFileSync(filePath, 'utf8').match(/^DATABASE_URL=(.+)$/m)
  if (!match) return null
  return match[1].replace(/^["']|["']$/g, '').trim()
}

function assertStagingDatabaseUrl() {
  const url = process.env.DATABASE_URL ?? ''
  if (!url.includes('weathered-math')) return
  const qaUrl = databaseUrlFromEnvFile('.env.staging')
  console.error(
    '[start:deploy] FATAL: QA staging DATABASE_URL points at production Neon (weathered-math).\n' +
      'Update Render stitch-ats-api-staging → Environment → DATABASE_URL to the Neon qa branch pooled URL.'
  )
  if (qaUrl && !qaUrl.includes('weathered-math')) {
    try {
      const host = new URL(qaUrl).hostname
      console.error(`Expected QA host similar to: ${host}`)
    } catch {
      /* ignore */
    }
  }
  process.exit(1)
}

function run(command) {
  execSync(command, { stdio: 'inherit', env: process.env })
}

if (isQaStagingDeploy()) {
  assertStagingDatabaseUrl()
  console.log(
    '[start:deploy] QA staging detected — skipping prisma db push (additive schema via runtime ensure* scripts)'
  )
} else {
  console.log('[start:deploy] Running prisma db push…')
  run('npx prisma db push')
  run('npx prisma generate')
}

run('node dist/index.js')
