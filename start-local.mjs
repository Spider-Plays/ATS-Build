import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(fileURLToPath(import.meta.url))
const frontendRoot = path.join(root, 'frontend')
const apiOrigin = process.env.API_ORIGIN || 'http://127.0.0.1:4000'
const host = process.env.HOST || '0.0.0.0'
const port = Number(process.env.FRONTEND_PORT || 3000)

function lanAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((iface) => iface && iface.family === 'IPv4' && !iface.internal)
    .map((iface) => iface.address)
}

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', ...headers })
  res.end(body)
}

/** Largest request body forwarded to the API (resume uploads are capped at 5 MB). */
const MAX_BODY_BYTES = 6 * 1024 * 1024

/**
 * Only set this when another trusted proxy or tunnel sits in front of this server and
 * sends the real visitor IP in a header it controls (for example `cf-connecting-ip`).
 */
const trustedClientIpHeader = (process.env.TRUSTED_CLIENT_IP_HEADER || '').trim().toLowerCase()

/** Visitor IP as this server sees it; never taken from headers the visitor can set. */
function clientIp(req) {
  if (trustedClientIpHeader) {
    const value = req.headers[trustedClientIpHeader]
    if (typeof value === 'string' && value.trim()) return value.split(',')[0].trim()
  }
  return (req.socket.remoteAddress || '').replace(/^::ffff:/, '')
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('Request body too large'), { status: 413 }))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

async function proxyApi(req, res, requestUrl) {
  const target = `${apiOrigin}${requestUrl.pathname}${requestUrl.search}`
  let body
  try {
    body = ['GET', 'HEAD'].includes(req.method || '') ? undefined : await readBody(req)
  } catch (error) {
    return send(res, error.status || 400, error.message)
  }

  // Drop hop-by-hop and client-supplied forwarding headers, then set our own.
  const forwardHeaders = { ...req.headers }
  for (const name of ['x-forwarded-for', 'x-real-ip', 'forwarded', 'x-forwarded-host', 'x-forwarded-proto', 'connection', 'content-length']) {
    delete forwardHeaders[name]
  }
  if (trustedClientIpHeader) delete forwardHeaders[trustedClientIpHeader]
  forwardHeaders['x-forwarded-for'] = clientIp(req)

  try {
    const upstream = await fetch(target, {
      method: req.method,
      headers: forwardHeaders,
      body,
    })
    const headers = {}
    upstream.headers.forEach((value, key) => {
      if (key !== 'transfer-encoding' && key !== 'connection') headers[key] = value
    })
    res.writeHead(upstream.status, headers)
    res.end(Buffer.from(await upstream.arrayBuffer()))
  } catch (error) {
    send(res, 502, `API is unavailable at ${apiOrigin}: ${error.message}`)
  }
}

/** Headers a meta-tag CSP cannot set (framing) plus standard hardening for the SPA. */
const FRONTEND_SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "frame-ancestors 'none'",
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
}

function serveFrontend(res, requestUrl) {
  let requested
  try {
    requested = decodeURIComponent(requestUrl.pathname === '/' ? '/index.html' : requestUrl.pathname)
  } catch {
    return send(res, 400, 'Bad request')
  }
  const candidate = path.resolve(frontendRoot, `.${requested}`)
  const safeRoot = `${path.resolve(frontendRoot)}${path.sep}`
  const filePath = candidate.startsWith(safeRoot) ? candidate : path.join(frontendRoot, 'index.html')
  const resolvedPath = fs.existsSync(filePath) && fs.statSync(filePath).isFile()
    ? filePath
    : path.join(frontendRoot, 'index.html')

  fs.readFile(resolvedPath, (error, data) => {
    if (error) return send(res, 404, 'Frontend build not found')
    const type = contentTypes[path.extname(resolvedPath).toLowerCase()] || 'application/octet-stream'
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache', ...FRONTEND_SECURITY_HEADERS })
    res.end(data)
  })
}

const server = http.createServer((req, res) => {
  let requestUrl
  try {
    // Fixed base: the Host header is visitor-controlled and only the path is needed here.
    requestUrl = new URL(req.url || '/', 'http://localhost')
  } catch {
    return send(res, 400, 'Bad request')
  }
  if (requestUrl.pathname === '/api' || requestUrl.pathname.startsWith('/api/')) {
    proxyApi(req, res, requestUrl).catch((error) => send(res, 500, error.message))
    return
  }
  serveFrontend(res, requestUrl)
})

server.listen(port, host, () => {
  console.log(`Frontend running at http://localhost:${port}`)
  for (const ip of lanAddresses()) {
    console.log(`Frontend also at http://${ip}:${port}`)
  }
  console.log(`Proxying /api/* to ${apiOrigin}`)
})
