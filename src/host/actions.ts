/**
 * The fixed, privileged actions the 系统管理 page may run.
 *
 * Nothing here takes a program or an argument list from the browser. Each action
 * has a fixed shape, validates the few parameters it accepts, and then runs the
 * one trusted CLI with an argument array. A confirmation token is minted for the
 * exact parameters that were shown and must come back with them, so a click on
 * the page can only ever run what that page displayed — never a value injected
 * from somewhere else.
 * @module dsh-autoloop/src/host/actions
 */

import { spawn } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AdminAction, AdminJob, ConfirmTicket } from '../types.js'
import type { CliLocation } from './system.js'
import { execQuiet, serviceFile, serviceLabel } from './system.js'

/** A refusal that carries the HTTP status the panel renders. */
export class ActionError extends Error {
  readonly status: number
  readonly code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'ActionError'
    this.status = status
    this.code = code
  }
}

/** What an action needs from the machine to run. */
export interface ActionContext {
  home: string
  cli: CliLocation | null
  rulesFile: string
}

/** The catalog the page renders, with no behaviour attached. */
export const CATALOG: AdminAction[] = [
  { id: 'status', title: '查看状态', detail: '运行 agent-autoloop status：谁在线、等你什么、在做什么、花了多少', destructive: false },
  { id: 'doctor', title: '检查配置', detail: '运行 agent-autoloop doctor：查哪里没配好', destructive: false },
  { id: 'check', title: '检查规则', detail: '运行 agent-autoloop check：读 rules.json 报告问题', destructive: false },
  { id: 'version', title: '查看版本', detail: '运行 agent-autoloop --version', destructive: false },
  { id: 'up-start', title: '启动中台', detail: '运行 agent-autoloop up，中台在后台监听本机地址', destructive: false },
  {
    id: 'up-stop',
    title: '停止中台',
    detail: '结束这台电脑上的中台进程；正在跑的轮次会被中断，已结束的结果不受影响',
    destructive: true,
  },
  {
    id: 'service-install',
    title: '安装并启动系统服务',
    detail: '安装登录后自动运行中台的服务（launchd / systemd），并立即启动',
    destructive: false,
  },
  {
    id: 'service-remove',
    title: '移除系统服务',
    detail: '停止并移除登录自启的系统服务；不会删除数据和中台',
    destructive: true,
  },
  { id: 'update', title: '更新程序', detail: '运行 agent-autoloop update（git pull --ff-only，会重启系统服务）', destructive: false },
  {
    id: 'try',
    title: '试跑一遍',
    detail: '运行 agent-autoloop try：会用真实模型跑一整轮并等你回答，耗时和费用按你的 Agent 计',
    destructive: false,
  },
]

/** Everything an action needs to know before it can be confirmed. */
export interface Plan {
  target: [string, string][]
  steps: string[]
  warnings: string[]
  /** What actually runs. `null` means the action is carried out in-process, not by the CLI. */
  argv: string[] | null
  timeoutMs: number
}

const bool = (value: unknown): boolean => (value === undefined ? true : typeof value === 'boolean' && value)
const only = (body: Record<string, unknown>, names: string[]): void => {
  for (const key of Object.keys(body)) if (!names.includes(key)) throw new ActionError(400, 'bad_params', `不认识的参数：${key}`)
}
const text = (value: unknown, label: string, max = 200): string => {
  if (typeof value !== 'string' || value.trim() === '') throw new ActionError(400, 'bad_params', `${label}不能为空`)
  if (value.length > max) throw new ActionError(400, 'bad_params', `${label}最多 ${max} 个字符`)
  // A value starting with "-" would be read as another option by the CLI.
  if (value.trimStart().startsWith('-')) throw new ActionError(400, 'bad_params', `${label}不能以 - 开头`)
  return value.trim()
}
const httpUrl = (value: unknown): string => {
  const raw = text(value, '中台地址', 500)
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new ActionError(400, 'bad_params', '中台地址要是一个 http(s) 地址')
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new ActionError(400, 'bad_params', '中台地址只支持 http 或 https')
  return url.toString()
}
const WORKER_ID = /^[a-z][a-z0-9-]*$/

/**
 * What the confirmation summary calls the machine.
 *
 * Deliberately not read from the environment: on many shells `HOSTNAME` holds
 * the machine's real name, which would put a person's device name into a
 * screenshot or a bug report. The summary only needs to say "this computer".
 */
const hostname = (): string => '这台电脑'

function requireCli(ctx: ActionContext): CliLocation {
  if (ctx.cli === null) {
    throw new ActionError(409, 'cli_missing', '找不到 agent-autoloop 程序（应在 <数据目录>/app/bin/agent-autoloop.ts），请先用命令行安装')
  }
  return ctx.cli
}

/** Validate parameters and describe exactly what would run. Pure: nothing is executed. */
export function planAction(id: string, body: unknown, ctx: ActionContext): Plan {
  const params = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>
  const cli = requireCli(ctx)
  const run = (args: string[], timeoutMs = 120_000, extra: Partial<Plan> = {}): Plan => ({
    target: [
      ['目标', hostname()],
      ['数据目录', ctx.home],
      ['程序', cli.program],
    ],
    steps: [`运行 ${['agent-autoloop', ...args].join(' ')}`],
    warnings: [],
    argv: args,
    timeoutMs,
    ...extra,
  })
  switch (id) {
    case 'status':
      return run(['status'])
    case 'doctor':
      return run(['doctor'])
    case 'check':
      return run(['check'])
    case 'version':
      return run(['--version'], 30_000)
    case 'up-start':
      only(params, [])
      return {
        ...run(['up'], 180_000, {
          steps: ['把中台放进独立进程组启动，输出写进 <数据目录>/logs/up.log', '中台在后台监听本机地址，关掉这个页面不会停'],
          warnings: ['如果中台已在运行，新进程会因 up.pid 冲突直接退出'],
        }),
        argv: null,
      }
    case 'up-stop':
      only(params, [])
      return {
        ...run([], 30_000, {
          steps: [`给中台进程（up.pid）发 SIGTERM，等它结束当前事务再退出`],
          warnings: ['正在执行的轮次会被中断；排队的任务留到中台下次启动'],
        }),
        argv: null,
      }
    case 'service-install':
      only(params, [])
      return {
        ...run(['service', 'install'], 120_000, {
          steps: [`写入登录自启项（${serviceFile(ctx.home)}）`, '启动服务并立即拉起中台'],
        }),
      }
    case 'service-remove':
      only(params, [])
      return {
        ...run(['service', 'remove'], 120_000, {
          warnings: ['移除后中台不会随登录自动启动，需要手动 agent-autoloop up'],
        }),
      }
    case 'update':
      only(params, [])
      return {
        ...run(['update'], 300_000, {
          warnings: ['更新会 git pull --ff-only，本地改动可能导致失败；成功后重启系统服务'],
        }),
      }
    case 'try':
      only(params, [])
      return {
        ...run(['try'], 300_000, {
          warnings: ['会调用你配置的真实模型，产生 Token 和费用，并等你回答一张卡片'],
        }),
      }
    case 'init': {
      only(params, ['agent', 'command', 'port', 'service'])
      const agent = typeof params.agent === 'string' ? params.agent : 'auto'
      if (!['auto', 'claude', 'codex', 'command'].includes(agent)) {
        throw new ActionError(400, 'bad_params', 'Agent 只能是自动检测、claude、codex 或自定义命令')
      }
      const command = agent === 'command' ? text(params.command, '命令', 500) : undefined
      if (agent !== 'command' && params.command) throw new ActionError(400, 'bad_params', '只有选择自定义命令时才填写命令')
      const port = params.port === undefined ? 3350 : params.port
      if (!Number.isSafeInteger(port) || (port as number) < 1 || (port as number) > 65535) {
        throw new ActionError(400, 'bad_params', '端口要在 1 到 65535 之间')
      }
      const service = bool(params.service)
      const args = [
        'init',
        ...(agent === 'claude' || agent === 'codex' ? ['--agent', agent] : []),
        ...(command ? ['--command', command] : []),
        '--port',
        String(port),
        ...(service ? [] : ['--no-service']),
      ]
      return {
        target: [
          ['目标', hostname()],
          ['数据目录', ctx.home],
          ['中台地址', `http://127.0.0.1:${port}`],
          ['Agent', agent === 'auto' ? '自动检测 Claude Code / Codex' : agent === 'command' ? (command ?? '') : agent],
          ['程序', cli.program],
        ],
        steps: [
          '写入配置：本机接单程序、来源 local、本人身份三把密钥（只写进文件，不在网页显示）',
          `写入入门规则 ${ctx.rulesFile}`,
          service ? '安装并启动系统服务' : '不安装系统服务',
          '运行 agent-autoloop init 并显示输出',
        ],
        warnings: [],
        argv: args,
        timeoutMs: 180_000,
      }
    }
    case 'join': {
      only(params, ['url', 'worker', 'key', 'service'])
      const url = httpUrl(params.url)
      const worker = text(params.worker, '接单程序名字', 200)
      if (!WORKER_ID.test(worker)) throw new ActionError(400, 'bad_params', '接单程序名字只能用小写字母、数字和 -')
      const key = text(params.key, '接单密钥', 500)
      const service = bool(params.service)
      return {
        target: [
          ['中台地址', url],
          ['接单程序', worker],
          ['数据目录', ctx.home],
        ],
        steps: ['写入接单密钥（只写进文件，不在网页显示）', service ? '安装并启动系统服务' : '不安装系统服务', '运行 agent-autoloop join'],
        warnings: [],
        argv: ['join', url, '--worker', worker, '--key', key, ...(service ? [] : ['--no-service'])],
        timeoutMs: 180_000,
      }
    }
    default:
      throw new ActionError(404, 'unknown_action', '没有这个操作')
  }
}

const CONFIRM_TTL = 10 * 60_000
const MAX_JOBS = 20
const OUTPUT_CAP = 200 * 1024

/** A pending confirmation, bound to the exact action it authorises. */
interface Pending {
  id: string
  params: string
  expiresAt: number
}

/** The admin page's state machine: pending confirmations and the jobs they started. */
export interface AdminEngine {
  confirm(id: string, params: string, plan: Plan): ConfirmTicket
  start(id: string, token: string, ctx: ActionContext): AdminJob
  job(jobId: string): AdminJob
  jobs(): AdminJob[]
}

/** Keep the tail of a growing command output, so one noisy job cannot exhaust memory. */
function capped(text: string): string {
  return text.length <= OUTPUT_CAP ? text : `…（前 ${text.length - OUTPUT_CAP} 字符省略）\n${text.slice(-OUTPUT_CAP)}`
}

/** Run the trusted CLI under this Node, with a fixed argv and no shell. */
function runProgram(program: string, argv: string[], { cwd, timeoutMs }: { cwd: string; timeoutMs: number }) {
  return new Promise<{ output: string; exit: number | null }>((done) => {
    // The CLI is a TypeScript entry run by Node itself; the flag only silences the strip-types notice.
    const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', program, ...argv], {
      cwd,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    })
    let output = ''
    const collect = (chunk: Buffer) => {
      output = capped(output + chunk.toString('utf8'))
    }
    child.stdout?.on('data', collect)
    child.stderr?.on('data', collect)
    const timer = setTimeout(() => {
      output = capped(`${output}\n（超过 ${Math.round(timeoutMs / 1000)} 秒，已停止）`)
      killGroup(child.pid, 'SIGTERM')
      setTimeout(() => killGroup(child.pid, 'SIGKILL'), 5_000).unref()
    }, timeoutMs)
    timer.unref()
    child.on('close', (code) => {
      clearTimeout(timer)
      done({ output, exit: code })
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      done({ output: `${output}\n${error.message}`, exit: -1 })
    })
  })
}

/** The CLI may start its own children; stopping the group stops them too. */
function killGroup(pid: number | undefined, signal: NodeJS.Signals): void {
  if (pid === undefined) return
  try {
    process.kill(-pid, signal)
  } catch {
    try {
      process.kill(pid, signal)
    } catch {
      // Already gone.
    }
  }
}

/**
 * Start the hub the way the system service would: detached, logging to a file,
 * so closing dsh does not take the hub with it.
 * @returns what the page reports: the pid and the log to follow.
 */
function startHub(home: string, program: string): { pid: number | null; log: string; detail: string } {
  const dir = join(home, 'logs')
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const log = join(dir, 'up.log')
  const fd = openSync(log, 'a', 0o600)
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', program, 'up'], {
    cwd: home,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    detached: true,
    shell: false,
    stdio: ['ignore', fd, fd],
  })
  closeSync(fd)
  child.unref()
  return { pid: child.pid ?? null, log, detail: '中台在后台启动，输出写进日志；几秒后刷新本页看连接状态' }
}

/**
 * Stop the hub by the pid it wrote itself.
 *
 * The pid file alone proves nothing — pids get reused — so the command line has
 * to still be an `agent-autoloop up` before a signal is sent. The hub traps
 * SIGTERM, finishes its transaction and exits; a claimed round is interrupted.
 */
async function stopHub(home: string): Promise<{ stopped: boolean; pid: number | null; detail: string }> {
  const file = join(home, 'up.pid')
  if (!existsSync(file)) return { stopped: false, pid: null, detail: '没有找到 up.pid：中台本来就没在这台电脑上运行' }
  const pid = Number(readFileSync(file, 'utf8').trim())
  if (!Number.isSafeInteger(pid) || pid < 2) return { stopped: false, pid: null, detail: 'up.pid 内容不是有效的进程号' }
  const ps = await execQuiet('ps', ['-p', String(pid), '-o', 'command='])
  if (!ps.ok || !/agent-autoloop(\.ts)\s+up\b/.test(ps.stdout)) {
    return { stopped: false, pid, detail: '这个进程号已经不是中台（多半已退出），没有发送信号' }
  }
  try {
    process.kill(pid, 'SIGTERM')
  } catch (error) {
    return { stopped: false, pid, detail: `无法结束进程：${(error as Error).message}` }
  }
  return { stopped: true, pid, detail: '已发送退出信号，中台会先结束当前事务再退出' }
}

/**
 * Create the confirmation and job registry for one plugin instance.
 * @param resolveContext - read fresh on every call, so config changes land without a restart.
 */
export function createAdmin(resolveContext: () => ActionContext): AdminEngine {
  const pending = new Map<string, Pending>()
  const jobs = new Map<string, AdminJob>()

  function finish(job: AdminJob, output: string, exit: number | null): void {
    job.output = capped(output)
    job.exit = exit
    job.state = exit === 0 ? 'done' : 'failed'
    job.finishedAt = new Date().toISOString()
  }

  return {
    confirm(id, params, plan) {
      for (const [key, value] of pending) if (value.expiresAt < Date.now()) pending.delete(key)
      const token = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
      const expiresAt = Date.now() + CONFIRM_TTL
      pending.set(token, { id, params, expiresAt })
      const lines = [
        `操作：${id}`,
        ...plan.target.map(([label, value]) => `${label}：${value}`),
        plan.steps.length > 0 ? `步骤：\n${plan.steps.join('\n')}` : '',
        plan.warnings.length > 0 ? `注意：\n${plan.warnings.join('\n')}` : '',
      ].filter((line) => line !== '')
      return { token, action: id, summary: lines.join('\n'), expiresAt: new Date(expiresAt).toISOString() }
    },

    start(id, token, ctx) {
      const entry = pending.get(token)
      if (entry === undefined) throw new ActionError(409, 'confirm_expired', '这次确认已过期或被用过，请重新点一次')
      if (entry.id !== id) throw new ActionError(400, 'confirm_mismatch', '确认信息与要执行的操作不一致')
      if (entry.expiresAt < Date.now()) {
        pending.delete(token)
        throw new ActionError(409, 'confirm_expired', '这次确认已过期，请重新点一次')
      }
      // One confirmation, one run: the token must never authorise a second execution.
      pending.delete(token)
      if (jobs.size >= MAX_JOBS) {
        const finished = [...jobs.values()]
          .filter((job) => job.state !== 'running')
          .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
        for (const old of finished.slice(0, jobs.size - MAX_JOBS + 1)) jobs.delete(old.id)
      }
      const job: AdminJob = {
        id: `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        action: id,
        state: 'running',
        startedAt: new Date().toISOString(),
        finishedAt: null,
        output: '',
        exit: null,
      }
      jobs.set(job.id, job)
      const cli = requireCli(ctx)
      if (id === 'up-start') {
        try {
          const started = startHub(ctx.home, cli.program)
          finish(job, `中台进程 ${started.pid ?? '（未知）'} 已启动\n日志：${started.log}`, 0)
        } catch (error) {
          finish(job, `启动失败：${(error as Error).message}`, -1)
        }
        return job
      }
      if (id === 'up-stop') {
        void stopHub(ctx.home).then((result) => finish(job, result.detail, result.stopped ? 0 : 1))
        return job
      }
      const plan = planAction(id, {}, ctx)
      if (plan.argv === null) throw new ActionError(409, 'no_program', '这个操作没有对应的命令')
      void runProgram(cli.program, plan.argv, { cwd: ctx.home, timeoutMs: plan.timeoutMs }).then((result) =>
        finish(job, result.output, result.exit),
      )
      return job
    },

    job(jobId) {
      const job = jobs.get(jobId)
      if (job === undefined) throw new ActionError(404, 'job_missing', '找不到这个任务')
      return job
    },

    jobs() {
      return [...jobs.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    },
  }
}

/** Where the login item's unit file is, for the page's target list. */
export function serviceTarget(home: string): string {
  return `${serviceLabel(home)} → ${serviceFile(home)}`
}
