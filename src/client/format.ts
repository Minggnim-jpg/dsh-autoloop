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

/** One piece of a card's text: either prose, or a link that can be opened. */
export interface TextPiece {
  kind: 'text' | 'link'
  value: string
  /** The absolute URL to open; only set for `link` pieces. */
  href?: string
}

/**
 * Matches an absolute URL in running text.
 *
 * Cards routinely carry a bare URL straight from an agent ("选品台：http://…"),
 * and that URL ends at whitespace, at a CJK character, or at a piece of
 * punctuation a writer puts *around* a link. Latin punctuation that can legally
 * appear in a URL is kept here and judged by {@link trimUrl} afterwards, because
 * only the tail tells a URL's own punctuation from the sentence's.
 */
const URL_PATTERN = /(?:https?:\/\/|www\.)[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]+/gi

/**
 * Punctuation that ends a sentence rather than a URL.
 *
 * Brackets are deliberately absent: they may legitimately sit inside a URL, so
 * {@link trimUrl} decides them against the URL's own bracket balance instead.
 */
const TRAILING = /[.,;:!?、，。；：！？"'’”]+$/

/**
 * Trim the characters of a match that belong to the sentence, not the URL.
 *
 * Two rules, applied until neither fires: trailing sentence punctuation is
 * always dropped, and a trailing closing bracket is dropped when it closes more
 * brackets than the URL opened — so `(见 http://a/b)` yields `http://a/b`, while
 * `http://a/b_(c)` keeps its final `)`. Chinese brackets are never part of a
 * URL, so they are dropped outright.
 */
function trimUrl(raw: string): string {
  let url = raw.replace(/[》」』】]+$/, '').replace(TRAILING, '')
  const pairs: [string, string][] = [
    ['(', ')'],
    ['[', ']'],
  ]
  for (let changed = true; changed; ) {
    changed = false
    const before = url
    url = url.replace(TRAILING, '')
    for (const [open, close] of pairs) {
      while (url.endsWith(close) && (url.match(new RegExp(`\\${open}`, 'g'))?.length ?? 0) < (url.match(new RegExp(`\\${close}`, 'g'))?.length ?? 0)) {
        url = url.slice(0, -1)
      }
    }
    changed = url !== before
  }
  return url
}

/**
 * Split text into prose and links without losing a character.
 *
 * Rejoining `pieces.map(piece => piece.value)` always yields the input exactly,
 * so the panel can show the same words the agent wrote — only some of them now
 * open a browser.
 */
export function splitLinks(text: string): TextPiece[] {
  const pieces: TextPiece[] = []
  if (text === '') return pieces
  let last = 0
  URL_PATTERN.lastIndex = 0
  for (let match = URL_PATTERN.exec(text); match !== null; match = URL_PATTERN.exec(text)) {
    const url = trimUrl(match[0])
    if (url === '' || /^https?:\/\/$/i.test(url) || /^www\.$/i.test(url)) continue
    if (match.index > last) pieces.push({ kind: 'text', value: text.slice(last, match.index) })
    const href = /^https?:\/\//i.test(url) ? url : `https://${url}`
    pieces.push({ kind: 'link', value: url, href })
    last = match.index + url.length
  }
  if (last < text.length) pieces.push({ kind: 'text', value: text.slice(last) })
  return pieces
}
