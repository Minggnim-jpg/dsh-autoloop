/**
 * Read-only views of this machine's install.
 *
 * Everything here answers "what is on this machine right now" without changing
 * it: the launchd/systemd label, whether the hub process is up, where the CLI
 * lives, what git says and where the login item is. The write side lives in
 * `actions.ts` and only ever calls fixed programs with fixed argument arrays.
 * @module dsh-autoloop/src/host/system
 */

import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'

/** One finished external command. */
export interface ExecResult {
  ok: boolean
  code: number | null
  stdout: string
  stderr: string
}

/**
 * Run a program with an argument array and a timeout.
 *
 * `shell: false` everywhere: nothing a browser sent may reach a shell, and every
 * caller passes a fixed program name from its own source.
 */
export function execQuiet(file: string, args: readonly string[], { timeout = 5_000 }: { timeout?: number } = {}): Promise<ExecResult> {
  return new Promise((done) => {
    execFile(
      file,
      [...args],
      { timeout, env: process.env, shell: false, encoding: 'utf8', maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        const code = error === null ? 0 : typeof (error as { code?: unknown }).code === 'number' ? ((error as { code: number }).code) : null
        done({ ok: error === null, code, stdout: stdout ?? '', stderr: stderr ?? '' })
      },
    )
  })
}

/** Same naming as the hub's `host/service.ts`: the default home owns the plain label. */
export function serviceLabel(home: string, userHome = homedir()): string {
  return resolve(home) === join(userHome, '.agent-autoloop')
    ? 'agent-autoloop'
    : `agent-autoloop-${createHash('sha256').update(resolve(home)).digest('hex').slice(0, 8)}`
}

/** The unit file launchd (or systemd) reads for this install. */
export function serviceFile(home: string, platform: string = process.platform, userHome = homedir()): string {
  const label = serviceLabel(home, userHome)
  return platform === 'darwin'
    ? join(userHome, 'Library/LaunchAgents', `${label}.plist`)
    : join(userHome, '.config/systemd/user', `${label}.service`)
}

/** Whether the login item is installed and whether the manager thinks it runs. */
export async function serviceStatus({
  home,
  program,
  platform = process.platform,
  userHome = homedir(),
}: {
  home: string
  program: string | null
  platform?: string
  userHome?: string
}): Promise<{ label: string; file: string; installed: boolean; owned: boolean | null; running: boolean; manager: string; detail: string }> {
  const label = serviceLabel(home, userHome)
  const file = serviceFile(home, platform, userHome)
  const installed = existsSync(file)
  let owned: boolean | null = null
  if (installed) {
    try {
      const text = readFileSync(file, 'utf8')
      owned = program === null ? false : text.includes(program)
    } catch {
      owned = false
    }
  }
  let running = false
  if (platform === 'darwin') {
    if (installed && typeof process.getuid === 'function') {
      running = (await execQuiet('launchctl', ['print', `gui/${process.getuid()}/${label}`])).ok
    }
  } else {
    running = (await execQuiet('systemctl', ['--user', 'is-active', '--quiet', label])).ok
  }
  const manager = platform === 'darwin' ? 'launchd' : 'systemd'
  const detail = !installed
    ? '没有安装登录自启'
    : owned === false
      ? `同名但不是这套程序写的，不会覆盖（${file}）`
      : running
        ? '已安装并正在运行'
        : '已安装，当前没有运行'
  return { label, file, installed, owned, running, manager, detail }
}

/**
 * The hub process, recognised by its `up.pid` and its command line.
 *
 * A pid file on its own proves nothing: pids are reused. The command line has to
 * still be an `agent-autoloop up` for the process to count as the hub.
 */
export async function runningUp(home: string): Promise<{ pid: number; command: string } | null> {
  const file = join(home, 'up.pid')
  if (!existsSync(file)) return null
  let pid: number
  try {
    pid = Number(readFileSync(file, 'utf8').trim())
  } catch {
    return null
  }
  if (!Number.isSafeInteger(pid) || pid < 2) return null
  const ps = await execQuiet('ps', ['-p', String(pid), '-o', 'command='])
  return ps.ok && /agent-autoloop(\.ts)? up\b/.test(ps.stdout) ? { pid, command: ps.stdout.trim() } : null
}

/** The CLI this install runs, and whether it is the installed copy or a development checkout. */
export interface CliLocation {
  program: string
  root: string
  version: string | null
  kind: 'installed' | 'development'
}

/**
 * Locate the one trusted `agent-autoloop` program.
 *
 * The same rule the local console uses: `<home>/app/bin/agent-autoloop.ts`, and
 * only if the package beside it really is `agent-autoloop`. A relative or made-up
 * path can never become the program, because nothing from the browser is read here.
 */
export function locateCli(home: string): CliLocation | null {
  const program = join(home, 'app', 'bin', 'agent-autoloop.ts')
  if (!existsSync(program)) return null
  try {
    const real = realpathSync(program)
    if (basename(real) !== 'agent-autoloop.ts' || basename(dirname(real)) !== 'bin') return null
    const root = dirname(dirname(real))
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { name?: string; version?: string }
    if (pkg.name !== 'agent-autoloop') return null
    const appRoot = realpathSync(join(home, 'app'))
    return {
      program: real,
      root,
      version: typeof pkg.version === 'string' ? pkg.version : null,
      kind: root === appRoot ? 'installed' : 'development',
    }
  } catch {
    return null
  }
}

/** Git facts about the install directory, when it is a checkout. */
export async function gitInfo(root: string): Promise<{ repo: string | null; head: string | null; remote: string | null }> {
  if (!existsSync(join(root, '.git'))) return { repo: null, head: null, remote: null }
  const git = (args: string[]) => execQuiet('git', ['-C', root, ...args])
  const [top, head, remote] = await Promise.all([git(['rev-parse', '--show-toplevel']), git(['rev-parse', '--short', 'HEAD']), git(['remote', 'get-url', 'origin'])])
  return {
    repo: top.ok ? top.stdout.trim() : null,
    head: head.ok ? head.stdout.trim() : null,
    remote: remote.ok ? remote.stdout.trim() : null,
  }
}

/** Where this machine's MCP client configs keep their `agent-autoloop` entry. */
export function mcpClientFiles(userHome = homedir()): { id: string; label: string; file: string }[] {
  return [
    { id: 'claude', label: 'Claude Code', file: join(userHome, '.claude.json') },
    { id: 'codex', label: 'Codex', file: join(userHome, '.codex', 'config.toml') },
  ]
}

/** The login item launchd or systemd reads, for this install. */
export function loginItemFile(userHome = homedir(), platform = process.platform): { file: string; label: string } {
  return {
    file: join(userHome, 'Library/LaunchAgents', 'agent-autoloop-ui.plist'),
    label: platform === 'darwin' ? 'launchd' : 'systemd',
  }
}
