/**
 * This machine's Agent Autoloop install, as the plugin sees it.
 *
 * The owner key in `~/.agent-autoloop/config.json` can send events, change rules
 * and stop runs. It stays on the host: the browser only ever learns whether the
 * file parsed and which hub it points at. The plugin never writes to this file,
 * never copies it, and never hands any part of it to the client half.
 * @module dsh-autoloop/src/host/config
 */

import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import type { LocalStatus } from '../types.js'

/** The fields of config.json this plugin reads. Everything else is ignored. */
export interface AutoloopConfig {
  /** Base address of the hub, e.g. `http://127.0.0.1:3350`. */
  url?: string
  /** The owner's own key. Its value never leaves this module. */
  owner?: string
  hub?: { listen?: string; publicUrl?: string }
  source?: { name?: string; key?: string }
  worker?: { name?: string; key?: string }
  channels?: Record<string, { key?: string }>
}

/** Resolved locations plus the parsed config, or why there is none. */
export interface LocalInstall {
  /** `~/.agent-autoloop`, or `$AGENT_AUTOLOOP_HOME` when set. */
  home: string
  /** `rules.json` beside the config file. */
  rulesFile: string
  /** Parsed config, or `null` when it is missing or unusable. */
  config: AutoloopConfig | null
  /** Present only when the owner key is usable. */
  owner: string | null
  /** `/healthz` address, without a trailing slash. */
  hubUrl: string
  /** Why there is no usable install, as the panel renders it. */
  status: LocalStatus
}

/** The data directory, matching the CLI's own resolution. */
export function autoloopHome(): string {
  const raw = process.env.AGENT_AUTOLOOP_HOME?.trim()
  if (raw !== undefined && raw !== '') return resolve(raw)
  return join(homedir(), '.agent-autoloop')
}

/** Absolute path of the rule file, honouring the CLI's `AGENT_AUTOLOOP_RULES` override. */
export function autoloopRulesFile(home = autoloopHome()): string {
  const raw = process.env.AGENT_AUTOLOOP_RULES?.trim()
  if (raw !== undefined && raw !== '') return resolve(raw)
  return join(home, 'rules.json')
}

const DEFAULT_HUB = 'http://127.0.0.1:3350'

/** Strip a trailing slash so route joins stay predictable. */
function cleanUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol)) return null
    return `${url.origin}${url.pathname === '/' ? '' : url.pathname.replace(/\/$/, '')}`
  } catch {
    return null
  }
}

/**
 * Read the install fresh on every call.
 *
 * `agent-autoloop init`, `join` and `key new` rewrite config.json while dsh runs,
 * so a cached copy would show a stale hub address or claim the owner key is gone
 * after the user added one. The file is small and read at most once per request.
 * @returns the resolved install; `status.state === 'ready'` means the panel can load.
 */
export function readInstall(): LocalInstall {
  const home = autoloopHome()
  const rulesFile = autoloopRulesFile(home)
  const configFile = join(home, 'config.json')
  const noHome: LocalInstall = {
    home,
    rulesFile,
    config: null,
    owner: null,
    hubUrl: DEFAULT_HUB,
    status: { state: 'no-home', home },
  }
  if (!existsSync(configFile)) return noHome

  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(configFile, 'utf8'))
  } catch (error) {
    return {
      ...noHome,
      status: { state: 'bad-config', home, error: `config.json 无法解析：${(error as Error).message}` },
    }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ...noHome, status: { state: 'bad-config', home, error: 'config.json 不是一个对象' } }
  }
  const config = parsed as AutoloopConfig
  const hubUrl = cleanUrl(config.url) ?? DEFAULT_HUB
  const owner = typeof config.owner === 'string' && config.owner.trim() !== '' ? config.owner : null
  if (owner === null) {
    return {
      home,
      rulesFile,
      config,
      owner: null,
      hubUrl,
      status: {
        state: 'no-owner',
        hub: hubUrl,
        home,
        error: '这台电脑没有本人密钥（config.json 的 owner）。运行 agent-autoloop status 确认安装。',
      },
    }
  }
  return {
    home,
    rulesFile,
    config,
    owner,
    hubUrl,
    status: { state: 'ready', hub: hubUrl, home, rulesFile },
  }
}

/** The hub address, never echoed back with credentials. */
export function safeHubAddress(hubUrl: string): string {
  try {
    const url = new URL(hubUrl)
    return `${url.origin}${url.pathname === '/' ? '' : url.pathname}`
  } catch {
    return DEFAULT_HUB
  }
}
