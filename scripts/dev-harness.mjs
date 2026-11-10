#!/usr/bin/env node
/**
 * A harness that mounts the host routes on a throwaway localhost server.
 *
 * It exists so the routes can be exercised against the real ~/.agent-autoloop
 * config without installing dsh and without touching the hub database: every
 * call goes through the same code dsh runs, over real HTTP. The sources are
 * bundled first (esbuild, same as the build) so `.js` specifiers resolve.
 *
 * Usage: node scripts/dev-harness.mjs [port]
 */
import { createServer } from 'node:http'
import { Readable } from 'node:stream'
import { build } from 'esbuild'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const OUT = '.tmp-harness'
await mkdir(OUT, { recursive: true })
await build({
  entryPoints: ['src/host/routes.ts'],
  outfile: join(OUT, 'routes.mjs'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  logLevel: 'warning',
})

const { createRouter } = await import(`../${OUT}/routes.mjs?t=${Date.now()}`)
const { routes } = createRouter({ logger: console })

const byPath = new Map()
for (const route of routes) {
  const row = byPath.get(route.path) ?? []
  row.push(route)
  byPath.set(route.path, row)
}

const port = Number(process.argv[2] ?? 3999)
const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`)
  const rows = byPath.get(url.pathname) ?? []
  const route = rows.find((row) => row.methods.includes(req.method))
  if (route === undefined) {
    res.writeHead(404, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: '没有这个接口', code: 'no_route' }))
    return
  }
  try {
    const body = ['GET', 'HEAD'].includes(req.method) ? undefined : Readable.toWeb(req)
    const request = new Request(url, { method: req.method, headers: req.headers, body, duplex: 'half' })
    const response = await route.handle(request)
    res.writeHead(response.status, Object.fromEntries(response.headers))
    if (response.body === null) return void res.end()
    Readable.fromWeb(response.body).pipe(res)
  } catch (error) {
    res.writeHead(500, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: String(error), code: 'harness' }))
  }
})
server.listen(port, '127.0.0.1', () => process.stdout.write(`harness on http://127.0.0.1:${port}\n`))
