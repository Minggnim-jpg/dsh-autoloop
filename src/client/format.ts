/**
 * Small formatting tools shared by every page.
 *
 * The hub speaks ISO times and counts; the owner reads durations, durations in
 * words and costs that say "未上报" instead of a fake zero.
 * @module dsh-autoloop/client/format
 */

import type { Card, Run, Usage } from '../types.js'

/** `2026-11-10T03:15:03.325Z` → `11-10 11:15` in the hub's own timezone. */
export function shortTime(iso: string | null): string {
  if (iso === null || iso === '') return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** A full timestamp with seconds, for details. */
export function fullTime(iso: string | null): string {
  if (iso === null || iso === '') return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

/** How long something took, in the coarsest useful unit. */
export function duration(run: Run): string {
  const start = run.claimedAt ?? run.createdAt
  if (start === null) return '—'
  const end = run.finishedAt ?? new Date().toISOString()
  const ms = Date.parse(end) - Date.parse(start)
  if (!Number.isFinite(ms) || ms < 0) return '—'
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds} 秒`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} 分钟`
  const hours = Math.floor(minutes / 60)
  return `${hours} 小时 ${minutes % 60} 分`
}

/** A run state in words, with the retry case folded in. */
export function runStateText(run: Pick<Run, 'state' | 'attempts' | 'stopping'>): string {
  if (run.stopping) return '正在停'
  if (run.state === 'queued' && run.attempts > 0) return '等重派'
  const words: Record<string, string> = {
    claimed: '在跑',
    queued: '排队',
    done: '完成',
    nothing: '没事可做',
    unknown: '不确定',
    cancelled: '已停',
  }
  return words[run.state] ?? run.state
}

/** A card's state in words. */
export function cardStateText(card: Pick<Card, 'state'>): string {
  const words: Record<string, string> = {
    open: '等你',
    decided: '已回答',
    closed: '已结案',
  }
  return words[card.state] ?? card.state
}

/** Token counts with thousands separators; `null` stays "未上报". */
export function tokens(value: number | undefined | null): string {
  if (value === undefined || value === null) return '未上报'
  return value.toLocaleString('zh-CN')
}

/** A cost in yuan; anything the worker did not report is not shown as 0. */
export function money(value: number | undefined, missing = 0): string {
  if (value === undefined && missing === 0) return '未上报'
  if (value === undefined) return '未上报'
  if (value === 0) return '¥0.00'
  return `¥${value.toFixed(value < 0.01 ? 4 : 2)}`
}

/**
 * A usage figure only counts when the source said it was complete.
 *
 * Workers differ: a Codex round can report cumulative session numbers, and an
 * old record may have no source marker at all. Showing those as a precise total
 * would overstate what was spent, so they are labelled instead.
 */
export function usageLine(usage: Usage | null): string {
  if (usage === null) return '用量未上报'
  const input = typeof usage.input === 'number' ? usage.input : undefined
  const output = typeof usage.output === 'number' ? usage.output : undefined
  if (input === undefined && output === undefined) return '用量未上报'
  const parts = [`输入 ${tokens(input)}`, `输出 ${tokens(output)}`]
  if (usage.complete === false) parts.push('（本轮未报全）')
  else if (usage.complete === undefined) parts.push('（来源未标明完整性）')
  return parts.join(' · ')
}

/** The first line of a long summary, for a table cell. */
export function firstLine(text: string, max = 120): string {
  const line = text.split('\n').find((part) => part.trim() !== '') ?? ''
  return line.length > max ? `${line.slice(0, max)}…` : line
}

/** A short id for a session or a commit. */
export function shortHash(value: string | null, length = 8): string {
  if (value === null || value === '') return '—'
  return value.length > length ? value.slice(0, length) : value
}

/** The weekday label the rules page shows beside a cron. */
export function weekday(date: Date): string {
  return ['日', '一', '二', '三', '四', '五', '六'][date.getDay()] ?? ''
}
