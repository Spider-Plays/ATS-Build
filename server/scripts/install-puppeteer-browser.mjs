import { existsSync } from 'node:fs'
import { execSync } from 'node:child_process'

// Production on Render/Linux uses @sparticuz/chromium; local dev on Windows/macOS uses puppeteer.
if (!existsSync('node_modules/puppeteer') || process.platform === 'linux') {
  process.exit(0)
}

execSync('node ./node_modules/puppeteer/install.mjs', { stdio: 'inherit' })
