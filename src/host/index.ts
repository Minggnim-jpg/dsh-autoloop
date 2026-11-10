/**
 * Host half of dsh-autoloop.
 *
 * Registers `/api/autoloop/*` on the dsh connection service so the browser half
 * can read the local Agent Autoloop hub and drive it. Everything privileged —
 * the owner key in `~/.agent-autoloop/config.json`, the rule file, the CLI —
 * stays on this side of the route table.
 *
 * The plugin is a pure client: it talks to the hub over HTTP and to the CLI as a
 * separate process. It never writes the hub database and never removes the local
 * web console's own service, so opening the panel does not disturb a browser tab
 * that is already using `127.0.0.1:3351`.
 * @module dsh-autoloop
 */

import type { Disposer, Logger, PluginContext } from '../cordis.js'
import { createRouter, type RouteDeps } from './routes.js'

/** Stable Cordis plugin name, matching the package and the client half. */
export const name = 'dsh-autoloop'

/** The Host services this plugin cannot work without. */
export const inject = ['connection'] as const

/** The slice of `ctx.connection` this plugin relies on. */
export interface HostConnection {
  readonly fetch?: {
    readonly register?: (route: RouteDef) => Disposer | Promise<Disposer>
  }
}

/** One exact Fetch route as the connection service registers it. */
export interface RouteDef {
  readonly path: string
  readonly methods: readonly string[]
  readonly requestBody: 'buffered' | 'streaming'
  readonly fetch: (request: Request) => Promise<Response>
}

/**
 * Register every dsh-autoloop route for the browser half.
 * @param ctx - the host plugin context.
 */
export function apply(ctx: PluginContext): void {
  const logger = ctx.logger('dsh-autoloop')
  ctx.inject(['connection'], (scope) => {
    const connection = scope.get<HostConnection>('connection')
    const registry = connection?.fetch
    const register = registry?.register
    if (registry === undefined || typeof register !== 'function') {
      logger.warn('dsh-autoloop: host connection exposes no fetch registry; the panel will render without data')
      return
    }
    const deps: RouteDeps = { logger: logger as unknown as RouteDeps['logger'] }
    const { routes } = createRouter(deps)
    // Exact-route rows are keyed by path, so one row per path carries its methods.
    const byPath = new Map<string, { methods: Set<string>; handlers: Map<string, (request: Request) => Promise<Response>> }>()
    for (const route of routes) {
      const row = byPath.get(route.path) ?? { methods: new Set<string>(), handlers: new Map<string, (request: Request) => Promise<Response>>() }
      for (const method of route.methods) {
        row.methods.add(method)
        row.handlers.set(method, route.handle)
      }
      byPath.set(route.path, row)
    }
    for (const [path, row] of byPath) {
      const handlers = row.handlers
      const def: RouteDef = {
        path,
        methods: [...row.methods],
        requestBody: 'buffered',
        async fetch(request: Request): Promise<Response> {
          // One path can carry several methods with different handlers (GET and PUT
          // on /rules); anything else is a 405 rather than a surprise side effect.
          const handler = handlers.get(request.method.toUpperCase())
          if (handler === undefined) {
            return Response.json({ ok: false, error: `${request.method} 不支持`, code: 'method_not_allowed' }, { status: 405 })
          }
          return handler(request)
        },
      }
      ctx.effect(() => register.call(registry, def), `dsh-autoloop: ${path}`)
    }
  })
}

export type { Logger }
