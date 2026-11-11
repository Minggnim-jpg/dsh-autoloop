/**
 * 执行记录 — every round the hub has run, and the detail of one.
 *
 * Filtering happens over what is loaded, and the page says so: a search that
 * silently covered only the first page would let someone conclude a round never
 * ran. "加载更早" pulls the next page from the hub's own cursor.
 * @module dsh-autoloop/client/runs
 */

import { createElement, useEffect, useState, type ReactNode } from 'react'
import type { AgentRow, HubState, Run, RunDetail } from '../types.js'
import { api, ApiError } from './api.js'
import { duration, firstLine, fullTime, shortTime, usageLine } from './format.js'
import { Empty, ExternalLink, Failure, RunBadge } from './ui.js'

/** Props: the loaded runs and who they belong to. */
export interface RunsProps {
  state: HubState
  selected: number | null
  onSelect: (id: number | null) => void
  onLoadOlder: () => void
  onChanged: () => void
}

const STATES = [
  { value: 'all', label: '全部状态' },
  { value: 'claimed', label: '在跑' },
  { value: 'queued', label: '排队 / 等重派' },
  { value: 'done', label: '完成' },
  { value: 'unknown', label: '不确定' },
  { value: 'cancelled', label: '已停' },
]

/** The run list, with its filters, and the detail of the selected round. */
export function Runs({ state, selected, onSelect, onLoadOlder, onChanged }: RunsProps): ReactNode {
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('all')
  const [agent, setAgent] = useState('all')
  const [within, setWithin] = useState('all')
  const run = state.runs.find((item) => item.id === selected) ?? null

  const now = Date.now()
  const filtered = state.runs.filter((item) => {
    if (status !== 'all' && item.state !== status) return false
    if (agent !== 'all' && item.agent !== agent) return false
    if (within !== 'all') {
      const since = now - Number(within) * 3_600_000
      const at = Date.parse(item.finishedAt ?? item.createdAt ?? '')
      if (!Number.isFinite(at) || at < since) return false
    }
    if (query.trim() !== '') {
      const needle = query.trim().toLowerCase()
      const hay = `${item.rule} ${item.agent} ${item.summary} ${item.error} ${item.id}`.toLowerCase()
      if (!hay.includes(needle)) return false
    }
    return true
  })

  return createElement(
    'div',
    {},
    createElement(
      'div',
      { className: 'alo-card' },
      createElement(
        'div',
        { className: 'alo-row', style: { flexWrap: 'wrap' } },
        createElement('input', {
          className: 'alo-input',
          style: { maxWidth: 240 },
          placeholder: '搜规则、Agent、结果或轮次号',
          value: query,
          onChange: (event: { target: { value: string } }) => setQuery(event.target.value),
        }),
        createElement(
          'select',
          { className: 'alo-select', style: { maxWidth: 140 }, value: status, onChange: (event: { target: { value: string } }) => setStatus(event.target.value) },
          ...STATES.map((option) => createElement('option', { key: option.value, value: option.value }, option.label)),
        ),
        createElement(
          'select',
          { className: 'alo-select', style: { maxWidth: 180 }, value: agent, onChange: (event: { target: { value: string } }) => setAgent(event.target.value) },
          createElement('option', { value: 'all' }, '全部 Agent'),
          ...state.agents.map((row: AgentRow) => createElement('option', { key: row.id, value: String(row.id) }, row.name)),
        ),
        createElement(
          'select',
          { className: 'alo-select', style: { maxWidth: 130 }, value: within, onChange: (event: { target: { value: string } }) => setWithin(event.target.value) },
          createElement('option', { value: 'all' }, '不限时间'),
          createElement('option', { value: '1' }, '最近 1 小时'),
          createElement('option', { value: '24' }, '最近 24 小时'),
          createElement('option', { value: '168' }, '最近 7 天'),
        ),
      ),
      createElement(
        'div',
        { className: 'alo-muted alo-small', style: { marginTop: 8 } },
        `已加载 ${state.runs.length} 条，筛选后 ${filtered.length} 条${state.hasMore ? '；筛选只覆盖已加载的记录，更早的去点下方加载' : '（已到最早的记录）'}`,
      ),
    ),

    run !== null ? createElement(RunDetailView, { id: run.id, onBack: () => onSelect(null), onChanged }) : null,

    filtered.length === 0
      ? createElement(Empty, {}, '没有符合条件的执行记录。')
      : createElement(
          'table',
          { className: 'alo-table' },
          createElement(
            'thead',
            {},
            createElement(
              'tr',
              {},
              createElement('th', {}, '轮次'),
              createElement('th', {}, '规则'),
              createElement('th', {}, 'Agent'),
              createElement('th', {}, '状态'),
              createElement('th', {}, '结果'),
              createElement('th', {}, '用时'),
              createElement('th', {}, '结束于'),
            ),
          ),
          createElement(
            'tbody',
            {},
            ...filtered.map((item) =>
              createElement(
                'tr',
                { key: item.id, style: { cursor: 'pointer' }, onClick: () => onSelect(item.id) },
                createElement('td', { className: 'alo-mono' }, `#${item.id}`),
                createElement('td', {}, item.rule),
                createElement('td', { className: 'alo-muted' }, item.agent),
                createElement('td', {}, createElement(RunBadge, { run: item })),
                createElement(
                  'td',
                  { className: item.error ? 'alo-error' : 'alo-muted', style: { maxWidth: 360 } },
                  firstLine(item.error || item.summary) || '—',
                ),
                createElement('td', { className: 'alo-muted' }, duration(item)),
                createElement('td', { className: 'alo-muted' }, shortTime(item.finishedAt)),
              ),
            ),
          ),
        ),
    state.hasMore ? createElement('div', { className: 'alo-pager' }, createElement('button', { className: 'alo-btn', onClick: onLoadOlder }, '加载更早的记录')) : null,
  )
}

/** One round: what woke it, how it went, and the stop button while it can still stop. */
function RunDetailView({ id, onBack, onChanged }: { id: number; onBack: () => void; onChanged: () => void }): ReactNode {
  const [detail, setDetail] = useState<RunDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let live = true
    setDetail(null)
    setError(null)
    api
      .runDetail(id)
      .then((value) => {
        if (live) setDetail(value)
      })
      .catch((problem: unknown) => {
        if (live) setError(problem instanceof ApiError ? problem.message : String(problem))
      })
    return () => {
      live = false
    }
  }, [id])

  async function stop(): Promise<void> {
    setBusy(true)
    try {
      await api.cancel(id)
      onChanged()
      onBack()
    } catch (problem) {
      setError(problem instanceof ApiError ? problem.message : String(problem))
    } finally {
      setBusy(false)
    }
  }

  const run: Run | null = detail?.run ?? null
  const canStop = run !== null && (run.state === 'claimed' || run.state === 'queued') && !run.stopping
  return createElement(
    'div',
    { className: 'alo-card' },
    createElement(
      'div',
      { className: 'alo-row', style: { justifyContent: 'space-between', marginBottom: 8 } },
      createElement('h3', { style: { margin: 0 } }, `第 ${id} 轮${run === null ? '' : ` · ${run.rule}`}`),
      createElement(
        'div',
        { className: 'alo-row' },
        canStop ? createElement('button', { className: 'alo-btn alo-btn-danger', disabled: busy, onClick: () => void stop() }, busy ? '提交中…' : '停止这一轮') : null,
        createElement('button', { className: 'alo-btn', onClick: onBack }, '收起'),
      ),
    ),
    error !== null ? createElement(Failure, { message: error }) : null,
    detail === null && error === null
      ? createElement('div', { className: 'alo-muted alo-small' }, '读取中…')
      : run === null
        ? null
        : createElement(
            'div',
            {},
            createElement(
              'div',
              { className: 'alo-small', style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 6, marginBottom: 10 } },
              createElement('div', {}, `状态：`, createElement(RunBadge, { run })),
              createElement('div', {}, `Agent：${run.agent}`),
              createElement('div', {}, `尝试次数：${run.attempts}`),
              createElement('div', {}, `开始：${fullTime(run.claimedAt ?? run.createdAt)}`),
              createElement('div', {}, `结束：${fullTime(run.finishedAt)}`),
              createElement('div', {}, `用时：${duration(run)}`),
              createElement('div', {}, `用量：${usageLine(run.usage)}`),
              createElement('div', { className: 'alo-mono', style: { overflow: 'hidden', textOverflow: 'ellipsis' } }, `会话：${run.session ?? '—'}`),
            ),
            run.summary !== '' ? createElement('div', { style: { marginBottom: 10 } }, createElement('div', { className: 'alo-small alo-muted' }, '结果'), createElement('pre', { style: { whiteSpace: 'pre-wrap', fontFamily: 'inherit', margin: 0 } }, run.summary)) : null,
            run.error !== '' ? createElement('div', { className: 'alo-error', style: { marginBottom: 10 } }, run.error) : null,
            run.events.length > 0
              ? createElement(
                  'div',
                  { style: { marginBottom: 10 } },
                  createElement('div', { className: 'alo-small alo-muted' }, '唤醒它的事件'),
                  createElement(
                    'ul',
                    { className: 'alo-timeline' },
                    ...run.events.map((event, index) => createElement('li', { key: index }, `${event.source} · ${event.type}${event.summary ? ` · ${event.summary}` : ''}`)),
                  ),
                )
              : null,
            run.link !== '' ? createElement(ExternalLink, { href: run.link, className: 'alo-small' }, '打开关联链接') : null,
            createElement(
              'details',
              { style: { marginTop: 10 } },
              createElement('summary', { className: 'alo-small alo-muted' }, `时间线（${detail.timeline.length} 条）`),
              createElement('ul', { className: 'alo-timeline' }, ...detail.timeline.slice(0, 200).map((line, index) => createElement('li', { key: index }, line))),
            ),
          ),
  )
}
