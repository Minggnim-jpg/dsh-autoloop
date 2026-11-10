/**
 * The panel's data layer.
 *
 * Every call goes to the host half (`/api/autoloop/*`), which owns the hub key.
 * Failures arrive as an {@link Envelope} with `ok: false`, and this module turns
 * them into a thrown {@link ApiError} so a component can render one message
 * instead of checking two kinds of result.
 * @module dsh-autoloop/client/api
 */

import type {
  AdminJob,
  AdminOverview,
  Card,
  ConfirmTicket,
  Envelope,
  Health,
  HubState,
  LocalStatus,
  RuleCheck,
  RulesEnvelope,
  RunDetail,
  Settings,
} from '../types.js'

/** A failed call, with the host's own message. */
export class ApiError extends Error {
  readonly status: number
  readonly code?: string
  constructor(message: string, status: number, code?: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

const BASE = '/api/autoloop'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(BASE + path, {
    ...init,
    headers: {
      ...(init?.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...init?.headers,
    },
    cache: 'no-store',
    credentials: 'same-origin',
  })
  const raw = await response.text()
  let body: Envelope<T> | null = null
  try {
    body = raw === '' ? null : (JSON.parse(raw) as Envelope<T>)
  } catch {
    body = null
  }
  if (body === null) throw new ApiError(`插件服务没有返回可用的结果（${response.status}）`, response.status)
  if (body.ok === false) throw new ApiError(body.error, response.status, body.code)
  return body.value
}

const post = (path: string, body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) })

/** Everything the panel calls. */
export const api = {
  health: () => request<{ local: LocalStatus; health: Health | null }>('/health'),
  state: (before?: number) => request<{ state: HubState; local: LocalStatus }>(`/state${before === undefined ? '' : `?before=${before}`}`),
  runDetail: (id: number) => request<RunDetail>(`/runs/detail?id=${id}`),
  answer: (id: number, input: { choice?: number; text?: string }) =>
    request<unknown>('/card/answer', post('', { id, ...input })),
  resolve: (id: number, reason: string) => request<unknown>('/card/resolve', post('', { id, reason })),
  cancel: (id: number) => request<unknown>('/run/cancel', post('', { id })),
  rules: () => request<RulesEnvelope>('/rules'),
  validateRules: (rules: unknown) => request<RuleCheck>('/rules/validate', post('', { rules })),
  validateRule: (rule: unknown, index: number | null) => request<RuleCheck>('/rules/validate', post('', { rule, index })),
  saveRules: (rules: unknown, expectedRevision: string) =>
    request<{ revision: string }>('/rules', { method: 'PUT', body: JSON.stringify({ rules, expectedRevision }) }),
  disableRule: (index: number, expectedRevision: string) =>
    request<{ revision: string; archived: { id: string } }>('/rules/disable', post('', { index, expectedRevision })),
  restoreRule: (id: string, expectedRevision: string) =>
    request<{ revision: string }>('/rules/restore', post('', { id, expectedRevision })),
  settings: () => request<Settings>('/settings'),
  notice: (key: string, text: string) => request<unknown>('/notice', post('', { key, text })),
  admin: () => request<AdminOverview>('/admin'),
  plan: (action: string, params: Record<string, unknown>) =>
    request<{ ticket: ConfirmTicket }>('/admin/plan', post('', { action, params })),
  start: (action: string, token: string) => request<AdminJob>('/admin/start', post('', { action, token })),
  job: (id: string) => request<AdminJob>(`/admin/job?id=${encodeURIComponent(id)}`),
  jobs: () => request<{ jobs: AdminJob[] }>('/admin/jobs'),
}

/** One card's answer shape, 1-based as the owner reads it on the page. */
export function answerOptions(card: Card): { index: number; text: string }[] {
  return card.options.map((text, index) => ({ index, text }))
}

/** Is this card a question (needs an option or words) or a notice (just acknowledge)? */
export function isQuestion(card: Pick<Card, 'kind'>): boolean {
  return card.kind === 'ask'
}
