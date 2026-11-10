/**
 * Shared types between the host and browser halves of dsh-autoloop.
 *
 * Every route answers with an {@link Envelope}: the browser never has to guess
 * whether a failure was transport or business, and a host bug can never leak a
 * raw stack into the panel.
 * @module dsh-autoloop/types
 */

/** A failed call, as the panel renders it. */
export interface Failure {
  readonly ok: false
  readonly error: string
  readonly code?: string
}

/** A successful call. */
export interface Success<T> {
  readonly ok: true
  readonly value: T
}

export type Envelope<T> = Success<T> | Failure

/**
 * Where this machine stands with its Agent Autoloop install.
 *
 * Deliberately says *why* it is unavailable: "not installed" and "the hub is
 * down" need different fixes and must not collapse into one empty panel.
 */
export type LocalStatus =
  | { readonly state: 'ready'; readonly hub: string; readonly home: string; readonly rulesFile: string }
  | { readonly state: 'no-home'; readonly home: string }
  | { readonly state: 'bad-config'; readonly home: string; readonly error: string }
  | { readonly state: 'no-owner'; readonly hub: string; readonly home: string; readonly error: string }

/** One row of `GET /healthz` on the hub. */
export interface Health {
  readonly ok: boolean
  readonly commit: string
}

/** One card waiting on the owner, as `/v1/state` returns it. */
export interface Card {
  id: number
  version: number
  run: number | null
  ref: string | null
  kind: string
  state: string
  title: string
  text: string
  options: string[]
  recommend: number | null
  choice: number | null
  answer: string | null
  by: string | null
  result: string | null
  link: string | null
  rule: string | null
  createdAt: string
  decidedAt: string | null
  closedAt: string | null
}

/** Usage figures a worker reported for one round, or `null` when nothing was reported. */
export interface Usage {
  input?: number
  output?: number
  cost?: number
  complete?: boolean
  [key: string]: unknown
}

/** The event that woke one run. */
export interface RunEvent {
  source: string
  type: string
  subject: string
  summary: string
  link: string
}

/** One round of work. */
export interface Run {
  id: number
  rule: string
  agent: string
  state: string
  attempts: number
  createdAt: string | null
  claimedAt: string | null
  finishedAt: string | null
  notBefore: string | null
  summary: string
  error: string
  link: string
  session: string | null
  usage: Usage | null
  stopping: boolean
  events: RunEvent[]
}

/** Counters kept for one rule or agent. */
export interface Totals {
  running: number
  queued: number
  retrying: number
  unknown: number
  done: number
  doneToday: number
  nothing: number
  usage: { input: number; output: number; cost: number }
}

/** Token and cost figures for a window, with what could not be reported kept separate. */
export interface Spending {
  rounds: number
  tokens: number
  cost: number
  missingTokens: number
  incompleteTokens: number
  unverifiedTokens: number
  missingCost: number
}

export interface SourceRow {
  id: string
  name: string
  events: number
}

/** One rule as `/v1/state` summarises it. The full text lives in rules.json. */
export interface RuleLine {
  id: string
  name: string
  group: string
  agent: string
  source: string
  types: string[]
  every: string | null
  next: string | null
  totals: Totals
}

/** A task scheduled on another machine; shown, never driven from here. */
export interface Elsewhere {
  id: string
  name: string
  source: string
  agent: string
  cron: string
  every: string
  next: string
  where: string
}

export interface AgentRow {
  id: string
  name: string
  use: string
  worker: string
  seenAt: string | null
  online: boolean
  totals: Totals
}

export interface ChannelRow {
  id: string
  name: string
  seenAt: string | null
  online: boolean
}

/** The whole hub picture, exactly as `GET /v1/state` returns it. */
export interface HubState {
  now: string
  timezone: string
  spending: { today: Spending; week: Spending }
  totals: Totals & { attention: number }
  cards: Card[]
  recentCards: Card[]
  sources: SourceRow[]
  lines: RuleLine[]
  elsewhere: Elsewhere[]
  agents: AgentRow[]
  channels: ChannelRow[]
  runs: Run[]
  hasMore: boolean
  nextBefore: number | null
  unrouted: unknown[]
}

/** One archived rule: removed from the active file, kept in full so it can come back. */
export interface ArchivedRule {
  id: string
  rule: Record<string, unknown>
  archivedAt: string
}

/** `GET /api/autoloop/rules` — the rule file plus its revision hash. */
export interface RulesEnvelope {
  rules: Record<string, unknown> & { rules?: unknown[] }
  revision: string
  archived: { rules: ArchivedRule[] }
}

/** A rule as the panel's editor models it. */
export interface RuleDraft {
  name: string
  when: { cron: string } | { source: string; types: string[] }
  to: string
  cwd: string
  skill?: string
  prompt?: string
  group?: string
  tell?: string
  parallel?: number
}

/** Result of validating a whole rules document without saving it. */
export interface RuleCheck {
  issues: string[]
  ok: boolean
}

/** `GET /api/autoloop/runs/:id/detail` */
export interface RunDetail {
  run: Run
  timeline: string[]
}

/** `GET /api/autoloop/settings` — what the 系统设置 page shows. */
export interface Settings {
  health: { online: boolean; version: string | null }
  hub: { address: string | null; home: string; rulesPath: string }
  agents: AgentRow[]
  channels: ChannelRow[]
  checks: { id: string; label: string; ok: boolean; detail: string }[]
}

/** One key name the hub knows. The key itself never leaves the host. */
export interface KeyRow {
  kind: string
  name: string
  createdAt: string | null
}

/** `GET /api/autoloop/admin` — the system-management page's read side. */
export interface AdminOverview {
  installed: boolean
  home: string
  cli: string | null
  service: { supported: boolean; installed: boolean; detail: string }
  hub: { running: boolean; pid: number | null; detail: string }
  version: string | null
  git: { repo: string | null; head: string | null; remote: string | null }
  loginAgent: { supported: boolean; label: string; file: string; installed: boolean; detail: string }
  mcp: { clients: { id: string; label: string; file: string; installed: boolean; same: boolean }[] }
  keys: KeyRow[]
  uninstall: { files: string[]; keeps: string[] }
  local: LocalStatus
  actions: AdminAction[]
}

/** A confirmation the panel shows before a privileged action runs. */
export interface ConfirmTicket {
  token: string
  action: string
  summary: string
  expiresAt: string
}

/** One fixed, privileged action the 系统管理 page may run. */
export interface AdminAction {
  id: string
  title: string
  detail: string
  destructive: boolean
  needsArgs?: { name: string; label: string; placeholder?: string }[]
}

/** A background command's progress. */
export interface AdminJob {
  id: string
  action: string
  state: 'running' | 'done' | 'failed'
  startedAt: string
  finishedAt: string | null
  output: string
  exit: number | null
}
