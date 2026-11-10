/**
 * Every route the browser half talks to.
 *
 * The host half is the security boundary: it owns the owner key, the rule file
 * and the CLI, and the browser half only ever sees what a route decides to send
 * back. Each route answers an {@link Envelope} so a failure is data, not a stack.
 *
 * Paths are registered one per method because the dsh connection service keys
 * routes by exact path: `/api/autoloop/x` may be GET here and POST there, but
 * the same method twice on one path is a registration error.
 * @module dsh-autoloop/src/host/routes
 */

import { existsSync, readFileSync } from 'node:fs'
import type { Envelope, Settings } from '../types.js'
import { ActionError, createAdmin, planAction, CATALOG, type AdminEngine } from './actions.js'
import { readInstall, safeHubAddress } from './config.js'
import {
  answer,
  cancel,
  health,
  hubClient,
  HubError,
  localKeyRows,
  resolve,
  runDetail,
  state,
  tell,
} from './hub.js'
import { disableRule, readRules, restoreRule, RulesError, saveRules, validateRule, validateRules } from './rules.js'
import { execQuiet, gitInfo, locateCli, mcpClientFiles, runningUp, serviceStatus } from './system.js'

/** What one route needs: the host logger, for anything that is not the user's fault. */
export interface RouteDeps {
  logger: { warn(message: string, ...rest: unknown[]): void; error(message: string, ...rest: unknown[]): void }
}

/** One registered route: its exact path, the methods it serves, and its handler. */
export interface Route {
  path: string
  methods: string[]
  handle: (request: Request) => Promise<Response>
}

function json<T>(value: T, status = 200): Response {
  return Response.json(value, { status, headers: { 'cache-control': 'no-store' } })
}

const ok = <T>(value: T): Response => json<Envelope<T>>({ ok: true, value })
const fail = (error: string, status = 500, code?: string): Response =>
  json<Envelope<never>>({ ok: false, error, ...(code !== undefined && { code }) }, status)

/**
 * Any route body that throws becomes an envelope with the hub's or the rule
 * file's own message, because those are the messages the owner already knows
 * from the CLI. Anything else is logged once and answered generically.
 */
async function guard<T>(deps: RouteDeps, run: () => Promise<T>): Promise<Response> {
  try {
    return ok(await run())
  } catch (error) {
    if (error instanceof HubError) return fail(error.message, error.status, 'hub_error')
    if (error instanceof RulesError) return fail(error.message, error.status, error.code)
    if (error instanceof ActionError) return fail(error.message, error.status, error.code)
    if (error instanceof Error && error.name === 'TimeoutError') {
      return fail('中台没有响应（超时）', 504, 'hub_timeout')
    }
    deps.logger.error('dsh-autoloop route failed', error)
    return fail(error instanceof Error ? error.message : String(error), 500, 'internal')
  }
}

/** A positive integer from a path segment, or a 400. */
function idOf(raw: string | undefined, label: string): number {
  const id = Number(raw)
  if (!Number.isSafeInteger(id) || id < 1) throw new ActionError(400, 'invalid_id', `${label}必须是正整数`)
  return id
}

async function bodyOf<T>(request: Request): Promise<T> {
  const text = await request.text()
  if (text === '') return {} as T
  try {
    return JSON.parse(text) as T
  } catch {
    throw new ActionError(400, 'bad_json', '请求体不是 JSON')
  }
}

/** Read config.json for this request; a missing install is a normal, explained answer. */
function install() {
  return readInstall()
}

async function settingsOf(): Promise<Settings> {
  const local = install()
  const hub = hubClient(local.hubUrl, local.owner ?? '')
  const online = await health(hub)
    .then(() => true)
    .catch(() => false)
  const current = await state(hub).catch(() => null)
  const cli = locateCli(local.home)
  const service = await serviceStatus({ home: local.home, program: cli?.program ?? null })
  let rulesCheck = { ok: false, detail: '规则文件还没有读过' }
  try {
    const snapshot = readRules(local.rulesFile)
    const check = validateRules(snapshot.rules)
    rulesCheck = check.ok ? { ok: true, detail: '规则格式有效' } : { ok: false, detail: check.issues.join('\n') }
  } catch (error) {
    rulesCheck = { ok: false, detail: (error as Error).message }
  }
  return {
    health: { online, version: online ? '中台可达' : null },
    hub: { address: safeHubAddress(local.hubUrl), home: local.home, rulesPath: local.rulesFile },
    agents: current?.agents ?? [],
    channels: current?.channels ?? [],
    checks: [
      { id: 'hub', label: '中台', ok: online, detail: online ? '已连接' : '当前无法连接' },
      { id: 'owner', label: '本人身份', ok: local.owner !== null, detail: local.owner ? '密钥已配置（内容不会显示）' : '缺少本人密钥' },
      { id: 'rules', label: '规则文件', ...rulesCheck },
      {
        id: 'config',
        label: '本机配置',
        ok: local.status.state === 'ready' || local.status.state === 'no-owner',
        detail: local.status.state === 'ready' ? '已读取本机配置' : local.status.state === 'no-owner' ? local.status.error : '找不到 config.json',
      },
      { id: 'service', label: '登录自启', ok: service.installed, detail: service.detail },
      { id: 'loopback', label: '本地访问', ok: true, detail: '插件只在这台电脑上访问中台，不经过网页端口' },
    ],
  }
}

/**
 * Every route, in registration order. `admin` is one engine per plugin instance
 * so confirmation tokens do not outlive the plugin.
 */
export function createRouter(deps: RouteDeps): { routes: Route[]; admin: AdminEngine } {
  const context = () => {
    const local = install()
    return { home: local.home, cli: locateCli(local.home), rulesFile: local.rulesFile }
  }
  const admin = createAdmin(context)

  const routes: Route[] = [
    {
      path: '/api/autoloop/health',
      methods: ['GET'],
      handle: async () =>
        guard(deps, async () => {
          const local = install()
          if (local.status.state !== 'ready') return { local: local.status, health: null }
          const hub = hubClient(local.hubUrl, local.owner ?? '')
          const up = await health(hub)
          return { local: local.status, health: up }
        }),
    },
    {
      path: '/api/autoloop/state',
      methods: ['GET'],
      handle: async (request) =>
        guard(deps, async () => {
          const local = install()
          if (local.status.state !== 'ready') throw new ActionError(409, 'not_ready', local.status.state === 'no-home' ? `这台电脑还没有安装 Agent Autoloop（${local.home}）` : local.status.state === 'bad-config' ? local.status.error : local.status.error)
          const before = new URL(request.url).searchParams.get('before')
          const cursor = before === null ? undefined : idOf(before, '分页游标')
          const hub = hubClient(local.hubUrl, local.owner ?? '')
          return { state: await state(hub, cursor), local: local.status }
        }),
    },
    {
      path: '/api/autoloop/runs/detail',
      methods: ['GET'],
      handle: async (request) =>
        guard(deps, async () => {
          const local = install()
          const id = idOf(new URL(request.url).searchParams.get('id') ?? undefined, '执行编号')
          const hub = hubClient(local.hubUrl, local.owner ?? '')
          return runDetail(hub, id)
        }),
    },
    {
      path: '/api/autoloop/card/answer',
      methods: ['POST'],
      handle: async (request) =>
        guard(deps, async () => {
          const local = install()
          const body = await bodyOf<{ id?: unknown; choice?: unknown; text?: unknown }>(request)
          const id = idOf(String(body.id ?? ''), '卡片编号')
          const extra = Object.keys(body).filter((key) => !['id', 'choice', 'text'].includes(key))
          if (extra.length > 0) throw new ActionError(400, 'bad_params', '回答只能包含 choice 和 text')
          const hasChoice = body.choice !== undefined
          const hasText = body.text !== undefined
          if (hasChoice && (!Number.isSafeInteger(body.choice) || (body.choice as number) < 0)) {
            throw new ActionError(400, 'bad_params', '选项编号无效')
          }
          if (hasText && (typeof body.text !== 'string' || body.text.trim() === '' || body.text.length > 8_000)) {
            throw new ActionError(400, 'bad_params', '文字回答需在 1 到 8000 字符之间')
          }
          const hub = hubClient(local.hubUrl, local.owner ?? '')
          return answer(hub, id, {
            ...(hasChoice && { choice: body.choice as number }),
            ...(hasText && { text: (body.text as string).trim() }),
          })
        }),
    },
    {
      path: '/api/autoloop/card/resolve',
      methods: ['POST'],
      handle: async (request) =>
        guard(deps, async () => {
          const local = install()
          const body = await bodyOf<{ id?: unknown; reason?: unknown }>(request)
          const id = idOf(String(body.id ?? ''), '卡片编号')
          if (typeof body.reason !== 'string' || body.reason.trim() === '' || body.reason.length > 2_000) {
            throw new ActionError(400, 'bad_params', '结案原因需在 1 到 2000 字符之间')
          }
          const hub = hubClient(local.hubUrl, local.owner ?? '')
          return resolve(hub, id, body.reason.trim())
        }),
    },
    {
      path: '/api/autoloop/run/cancel',
      methods: ['POST'],
      handle: async (request) =>
        guard(deps, async () => {
          const local = install()
          const body = await bodyOf<{ id?: unknown }>(request)
          const id = idOf(String(body.id ?? ''), '执行编号')
          const hub = hubClient(local.hubUrl, local.owner ?? '')
          return cancel(hub, id)
        }),
    },
    {
      path: '/api/autoloop/rules',
      methods: ['GET'],
      handle: async () =>
        guard(deps, async () => {
          const local = install()
          return readRules(local.rulesFile)
        }),
    },
    {
      path: '/api/autoloop/rules',
      methods: ['PUT'],
      handle: async (request) =>
        guard(deps, async () => {
          const local = install()
          const body = await bodyOf<{ rules?: unknown; expectedRevision?: unknown }>(request)
          if (typeof body.rules !== 'object' || body.rules === null) {
            throw new ActionError(400, 'bad_params', '需要完整规则对象')
          }
          return saveRules(local.rulesFile, body.rules, body.expectedRevision)
        }),
    },
    {
      path: '/api/autoloop/rules/validate',
      methods: ['POST'],
      handle: async (request) =>
        guard(deps, async () => {
          const local = install()
          const body = await bodyOf<{ rules?: unknown; rule?: unknown; index?: unknown }>(request)
          if (body.rule !== undefined) {
            const snapshot = readRules(local.rulesFile)
            const index = body.index === undefined || body.index === null ? null : Number(body.index)
            return validateRule(snapshot.rules as Record<string, unknown>, body.rule, index)
          }
          return validateRules(body.rules)
        }),
    },
    {
      path: '/api/autoloop/rules/disable',
      methods: ['POST'],
      handle: async (request) =>
        guard(deps, async () => {
          const local = install()
          const body = await bodyOf<{ index?: unknown; expectedRevision?: unknown }>(request)
          if (!Number.isInteger(body.index) || (body.index as number) < 0) {
            throw new ActionError(400, 'bad_params', '规则编号无效')
          }
          return disableRule(local.rulesFile, body.index as number, body.expectedRevision)
        }),
    },
    {
      path: '/api/autoloop/rules/restore',
      methods: ['POST'],
      handle: async (request) =>
        guard(deps, async () => {
          const local = install()
          const body = await bodyOf<{ id?: unknown; expectedRevision?: unknown }>(request)
          if (typeof body.id !== 'string' || body.id === '') throw new ActionError(400, 'bad_params', '需要存档编号')
          return restoreRule(local.rulesFile, body.id, body.expectedRevision)
        }),
    },
    {
      path: '/api/autoloop/settings',
      methods: ['GET'],
      handle: async () => guard(deps, settingsOf),
    },
    {
      path: '/api/autoloop/notice',
      methods: ['POST'],
      handle: async (request) =>
        guard(deps, async () => {
          const local = install()
          if (!local.config?.source?.key) throw new ActionError(409, 'no_source', '这台电脑没有来源密钥，不能直接告诉你')
          const body = await bodyOf<{ key?: unknown; text?: unknown }>(request)
          if (typeof body.key !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(body.key)) {
            throw new ActionError(400, 'bad_params', '编号只能用小写字母、数字和 . _ -')
          }
          if (typeof body.text !== 'string' || body.text.trim() === '' || body.text.length > 20_000) {
            throw new ActionError(400, 'bad_params', '内容需在 1 到 20000 字符之间')
          }
          const hub = hubClient(local.hubUrl, local.config.source.key)
          return tell(hub, body.key, body.text.trim())
        }),
    },
    {
      path: '/api/autoloop/admin',
      methods: ['GET'],
      handle: async () =>
        guard(deps, async () => {
          const local = install()
          const cli = locateCli(local.home)
          const [service, up, git] = await Promise.all([
            serviceStatus({ home: local.home, program: cli?.program ?? null }),
            runningUp(local.home),
            cli === null ? Promise.resolve({ repo: null, head: null, remote: null }) : gitInfo(cli.root),
          ])
          const version = cli === null ? null : await execQuiet(process.execPath, ['--disable-warning=ExperimentalWarning', cli.program, '--version'], { timeout: 20_000 }).then((result) => (result.ok ? result.stdout.trim().split('\n')[0] ?? null : null))
          const mcp = mcpClientFiles().map((client) => {
            let installed = false
            let same = false
            try {
              installed = existsSync(client.file)
              const text = installed ? readFileSync(client.file, 'utf8') : ''
              same = /agent-autoloop/.test(text)
            } catch {
              installed = false
            }
            return { id: client.id, label: client.label, file: client.file, installed, same }
          })
          return {
            installed: local.status.state === 'ready' || local.status.state === 'no-owner',
            home: local.home,
            cli: cli?.program ?? null,
            service: {
              supported: process.platform === 'darwin' || process.platform === 'linux',
              installed: service.installed,
              detail: service.detail,
            },
            hub: { running: up !== null, pid: up?.pid ?? null, detail: up === null ? '这台电脑上没有正在运行的中台' : `进程 ${up.pid}` },
            version,
            git,
            loginAgent: {
              supported: false,
              label: process.platform === 'darwin' ? 'launchd' : 'systemd',
              file: '',
              installed: false,
              detail: '网页控制台的登录自启由 agent-autoloop-ui 自己管理，这里不接管',
            },
            mcp: { clients: mcp },
            keys: local.config === null ? [] : localKeyRows(local.config),
            uninstall: {
              files: [`${local.home}/app（程序）`, `${local.home}/logs`],
              keeps: [`${local.home}/config.json`, `${local.home}/rules.json`, `${local.home}/hub.db`, `${local.home}/master.key`],
            },
            local: local.status,
            actions: CATALOG,
          }
        }),
    },
    {
      path: '/api/autoloop/admin/plan',
      methods: ['POST'],
      handle: async (request) =>
        guard(deps, async () => {
          const body = await bodyOf<{ action?: unknown; params?: unknown }>(request)
          if (typeof body.action !== 'string') throw new ActionError(400, 'bad_params', '需要操作编号')
          const plan = planAction(body.action, body.params ?? {}, context())
          return { plan, ticket: admin.confirm(body.action, JSON.stringify(body.params ?? {}), plan) }
        }),
    },
    {
      path: '/api/autoloop/admin/start',
      methods: ['POST'],
      handle: async (request) =>
        guard(deps, async () => {
          const body = await bodyOf<{ action?: unknown; token?: unknown }>(request)
          if (typeof body.action !== 'string' || typeof body.token !== 'string') {
            throw new ActionError(400, 'bad_params', '需要操作编号和确认编号')
          }
          // The confirmation must describe the same parameters that are about to run.
          const params = await paramsOfTicket(admin, body.token)
          planAction(body.action, params, context())
          return admin.start(body.action, body.token, context())
        }),
    },
    {
      path: '/api/autoloop/admin/job',
      methods: ['GET'],
      handle: async (request) =>
        guard(deps, async () => admin.job(new URL(request.url).searchParams.get('id') ?? '')),
    },
    {
      path: '/api/autoloop/admin/jobs',
      methods: ['GET'],
      handle: async () => guard(deps, async () => ({ jobs: admin.jobs() })),
    },
  ]
  return { routes, admin }
}

/** The parameters a confirmation was minted for, re-parsed so `start` cannot run anything else. */
async function paramsOfTicket(admin: AdminEngine, token: string): Promise<unknown> {
  const raw = adminParams.get(token)
  if (raw === undefined) return {}
  return JSON.parse(raw) as unknown
}

/** Tokens are minted by the engine; this map mirrors just their parameters for the re-check above. */
const adminParams = new Map<string, string>()
