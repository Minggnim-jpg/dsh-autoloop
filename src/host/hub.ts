/**
 * The hub, from inside dsh.
 *
 * The same HTTP + JSON surface every other client uses (`protocol/client.ts` in
 * the kernel repository): one fetch per call, a Bearer owner key, and the hub's
 * own error message forwarded as-is so the panel can say what the CLI would say.
 * Nothing here writes to the hub's database or to any file.
 * @module dsh-autoloop/src/host/hub
 */

import type { Card, Health, HubState, KeyRow, RunDetail, Run, Usage } from '../types.js'

/** A hub call that did not succeed. `status` is the hub's HTTP status. */
export class HubError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'HubError'
    this.status = status
  }
}

/** One hub reachable with one key. */
export interface Hub {
  readonly url: string
  call<T = unknown>(method: string, path: string, body?: unknown, timeoutSeconds?: number): Promise<T>
}

/**
 * A client for one hub address and key.
 * @param url - base address, no trailing slash.
 * @param key - the owner key; empty means every owner call fails with the hub's own 401.
 */
export function hubClient(url: string, key: string): Hub {
  const base = url.replace(/\/$/, '')
  async function call<T>(method: string, path: string, body?: unknown, timeoutSeconds = 30): Promise<T> {
    const response = await fetch(base + path, {
      method,
      headers: {
        authorization: `Bearer ${key}`,
        ...(body !== undefined && { 'content-type': 'application/json' }),
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(timeoutSeconds * 1000),
    })
    const text = await response.text()
    let data: unknown = null
    try {
      data = text === '' ? null : JSON.parse(text)
    } catch {
      data = null
    }
    if (!response.ok) {
      const message =
        typeof data === 'object' && data !== null && typeof (data as { error?: unknown }).error === 'string'
          ? ((data as { error: string }).error)
          : `中台返回 ${response.status}`
      throw new HubError(response.status, message)
    }
    return data as T
  }
  return { url: base, call }
}

/** `GET /healthz` — reachable even when no key is configured. */
export async function health(hub: Hub): Promise<Health> {
  return hub.call<Health>('GET', '/healthz', undefined, 5)
}

/** `GET /v1/state` — the whole picture, or one page of older runs. */
export async function state(hub: Hub, before?: number): Promise<HubState> {
  return hub.call<HubState>('GET', before === undefined ? '/v1/state' : `/v1/state?before=${before}`, undefined, 20)
}

/** `GET /v1/runs/:id/why` — the raw facts of one round. */
export async function why(hub: Hub, id: number): Promise<unknown[]> {
  return hub.call<unknown[]>('GET', `/v1/runs/${id}/why`, undefined, 20)
}

/** Answer an open card: a 0-based option or free text. */
export async function answer(hub: Hub, id: number, input: { choice?: number; text?: string }): Promise<unknown> {
  return hub.call('POST', `/v1/cards/${id}/answer`, input, 20)
}

/** Close a card with the result that was actually verified. */
export async function resolve(hub: Hub, id: number, reason: string): Promise<unknown> {
  return hub.call('POST', `/v1/cards/${id}/resolve`, { reason }, 20)
}

/** Ask a run to stop. Accepted is not stopped: the panel keeps watching `stopping`. */
export async function cancel(hub: Hub, id: number): Promise<unknown> {
  return hub.call('POST', `/v1/runs/${id}/cancel`, {}, 20)
}

/** Send an event through this machine's source key; the same id is recorded once. */
export async function emit(hub: Hub, body: Record<string, unknown>): Promise<unknown> {
  return hub.call('POST', '/v1/events', body, 20)
}

/** Send a notice through this machine's source key. */
export async function tell(hub: Hub, key: string, text: string): Promise<unknown> {
  return hub.call('POST', '/v1/tell', { key, text }, 20)
}

/** `DELETE /v1/keys/:kind/:name` — revoke one key immediately. */
export async function removeKey(hub: Hub, kind: string, name: string): Promise<unknown> {
  return hub.call('DELETE', `/v1/keys/${encodeURIComponent(kind)}/${encodeURIComponent(name)}`, undefined, 20)
}

type Change = { table: string; key: string; row: Record<string, unknown> | null }
type Fact = { changes?: Change[] }

/**
 * Rebuild one round's detail the way the local console does.
 *
 * `why` returns the fact log, not a projection of it: the last write to the run
 * row is the round's final state, and the `run_events`/`events` changes replay
 * which events woke it. Deriving it here rather than repeating the hub's SQL
 * keeps the plugin a pure client — if the fact format moves, only this function
 * has to move with it.
 * @returns the round and the events that woke it, in event order.
 * @throws HubError 404 when the facts carry no run row.
 */
export async function runDetail(hub: Hub, id: number): Promise<RunDetail> {
  const facts = (await why(hub, id)) as Fact[]
  const changes = facts.flatMap((fact) => fact.changes ?? [])
  const runChanges = changes.filter((change) => change.table === 'runs' && change.key === String(id) && change.row)
  const found = runChanges.at(-1)?.row
  if (found === undefined || found === null) throw new HubError(404, '找不到这轮执行的历史记录')
  const last = found
  const relation = new Map<string, Record<string, unknown>>()
  const events = new Map<number, Record<string, unknown>>()
  for (const change of changes) {
    if (change.table === 'run_events') {
      if (change.row) relation.set(change.key, change.row)
      else relation.delete(change.key)
    } else if (change.table === 'events') {
      const eventId = Number(change.key)
      if (change.row) events.set(eventId, change.row)
      else events.delete(eventId)
    }
  }
  const runEvents = [...relation.values()]
    .filter((row) => row.run_id === id)
    .map((row) => events.get(Number(row.event_id)))
    .filter((row): row is Record<string, unknown> => row !== undefined)
    .sort((a, b) => Number(a.id) - Number(b.id))
    .map((row) => ({
      source: String(row.source ?? ''),
      type: String(row.type ?? ''),
      subject: String(row.subject ?? ''),
      summary: String(row.summary ?? ''),
      link: String(row.link ?? ''),
    }))
  const run: Run = {
    id: Number(last.id),
    rule: String(last.rule ?? ''),
    agent: String(last.agent ?? ''),
    state: String(last.state ?? 'unknown'),
    attempts: Number(last.attempts ?? 0),
    createdAt: (last.created_at as string | null) ?? null,
    claimedAt: (last.claimed_at as string | null) ?? null,
    finishedAt: (last.finished_at as string | null) ?? null,
    notBefore: (last.not_before as string | null) ?? null,
    summary: String(last.summary ?? ''),
    error: String(last.error ?? ''),
    link: String(last.link ?? ''),
    session: (last.session as string | null) ?? null,
    usage: parseUsage(last.usage),
    stopping: last.cancel_at !== null && last.cancel_at !== undefined,
    events: runEvents,
  }
  return { run, timeline: timelineOf(facts) }
}

/** `usage` is stored as a JSON string by the worker's receipt; older rows hold an object. */
function parseUsage(value: unknown): Usage | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as Usage
    } catch {
      return null
    }
  }
  return typeof value === 'object' ? (value as Usage) : null
}

/**
 * A readable timeline, one line per fact, using `why`'s own shape.
 * The CLI's `formatWhy` lives in the kernel package; this is the same idea
 * narrowed to what the detail page shows.
 */
function timelineOf(facts: Fact[]): string[] {
  const lines: string[] = []
  facts.forEach((fact, index) => {
    const changed = (fact.changes ?? []).map((change) => {
      const verb = change.row === null ? '清除' : '写入'
      return `${change.table}#${change.key} ${verb}`
    })
    if (changed.length > 0) lines.push(`${index + 1}. ${changed.join('，')}`)
  })
  return lines
}

/** Present one card the way the answer form needs it: options are 1-based in the UI. */
export function answerShape(card: Card): { options: { index: number; text: string }[]; canText: boolean } {
  return {
    options: card.options.map((text, index) => ({ index, text })),
    canText: card.kind === 'ask',
  }
}

/** Name the kind of a card as the owner sees it. */
export function cardKindLabel(card: Pick<Card, 'kind'>): string {
  return card.kind === 'ask' ? '等你决定' : '要你留意'
}

/**
 * Who holds a key, as the panel labels each kind.
 *
 * The hub has no list endpoint (`agent-autoloop key list` reads its own SQLite),
 * so the plugin shows only the key names this machine's config.json carries and
 * says so, rather than pretending it sees every key on the hub.
 */
export function localKeyRows(config: {
  owner?: string
  source?: { name?: string; key?: string }
  worker?: { name?: string; key?: string }
  channels?: Record<string, { key?: string }>
}): KeyRow[] {
  const rows: KeyRow[] = []
  if (typeof config.owner === 'string' && config.owner !== '') rows.push({ kind: 'owner', name: '本人', createdAt: null })
  if (config.source?.key) rows.push({ kind: 'source', name: config.source.name ?? '来源', createdAt: null })
  if (config.worker?.key) rows.push({ kind: 'worker', name: config.worker.name ?? '接单程序', createdAt: null })
  for (const [name, channel] of Object.entries(config.channels ?? {})) {
    if (channel.key) rows.push({ kind: 'channel', name, createdAt: null })
  }
  return rows
}
