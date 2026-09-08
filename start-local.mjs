import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(fileURLToPath(import.meta.url))
const frontendRoot = path.join(root, 'frontend')
const apiOrigin = 'http://127.0.0.1:4000'
const port = Number(process.env.FRONTEND_PORT || 3000)

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

async function proxyApi(req, res, requestUrl) {
  const target = `${apiOrigin}${requestUrl.pathname}${requestUrl.search}`
  const body = ['GET', 'HEAD'].includes(req.method || '') ? undefined : await new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })

  try {
    const upstream = await fetch(target, {
      method: req.method,
      headers: req.headers,
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

function serveFrontend(res, requestUrl) {
  const requested = decodeURIComponent(requestUrl.pathname === '/' ? '/index.html' : requestUrl.pathname)
  const candidate = path.resolve(frontendRoot, `.${requested}`)
  const safeRoot = `${path.resolve(frontendRoot)}${path.sep}`
  const filePath = candidate.startsWith(safeRoot) ? candidate : path.join(frontendRoot, 'index.html')
  const resolvedPath = fs.existsSync(filePath) && fs.statSync(filePath).isFile()
    ? filePath
    : path.join(frontendRoot, 'index.html')

  fs.readFile(resolvedPath, (error, data) => {
    if (error) return send(res, 404, 'Frontend build not found')
    const type = contentTypes[path.extname(resolvedPath).toLowerCase()] || 'application/octet-stream'
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' })
    res.end(data)
  })
}

const server = http.createServer((req, res) => {
  const requestUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
  if (requestUrl.pathname === '/api' || requestUrl.pathname.startsWith('/api/')) {
    proxyApi(req, res, requestUrl).catch((error) => send(res, 500, error.message))
    return
  }
  serveFrontend(res, requestUrl)
})

server.listen(port, '127.0.0.1', () => {
  console.log(`Frontend running at http://localhost:${port}`)
  console.log(`Proxying /api/* to ${apiOrigin}`)
})
