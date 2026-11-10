/**
 * The main panel: one header, six pages, and the state they share.
 *
 * The panel owns the whole picture (`/api/autoloop/state`) and hands each page
 * the slice it needs, so switching pages does not refetch and a card answered on
 * one page updates the count on every other. Only the run detail and the rule
 * file are fetched per page, because they are large and only one page wants them.
 * @module dsh-autoloop/client/panel
 */

import { createElement, useCallback, useEffect, useState, type ReactNode } from 'react'
import type { HubState, LocalStatus } from '../types.js'
import { Admin } from './admin.js'
import { api, ApiError } from './api.js'
import { Automations } from './automations.js'
import { Inbox } from './inbox.js'
import { Overview } from './overview.js'
import { Runs } from './runs.js'
import { Settings } from './settings.js'
import { injectStyles } from './styles.js'
import { Failure } from './ui.js'

/** The panel's pages, in the order the local console lists them. */
type Page = 'overview' | 'inbox' | 'runs' | 'automations' | 'settings' | 'admin'

const PAGES: { id: Page; label: string }[] = [
  { id: 'overview', label: '总览' },
  { id: 'inbox', label: '待我处理' },
  { id: 'runs', label: '执行记录' },
  { id: 'automations', label: '自动任务' },
  { id: 'settings', label: '系统设置' },
  { id: 'admin', label: '系统管理' },
]

/** How often the panel re-reads the hub while it is open. */
const REFRESH_MS = 30_000

/** The panel body. */
export function AutoloopPanel(): ReactNode {
  // The panel owns its stylesheet rather than trusting the sidebar entry to have
  // injected it: the body renders through a separate slot and may mount first.
  injectStyles()
  const [page, setPage] = useState<Page>('overview')
  const [state, setState] = useState<HubState | null>(null)
  const [local, setLocal] = useState<LocalStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cardId, setCardId] = useState<number | null>(null)
  const [runId, setRunId] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(
    (before?: number) => {
      setLoading(true)
      api
        .state(before)
        .then(({ state: next, local: where }) => {
          setLocal(where)
          setState((current) => {
            if (before === undefined || current === null) return next
            // "加载更早" appends; every other refresh replaces.
            return { ...next, runs: [...current.runs, ...next.runs.filter((run) => !current.runs.some((old) => old.id === run.id))] }
          })
          setError(null)
        })
        .catch((problem: unknown) => setError(problem instanceof ApiError ? problem.message : String(problem)))
        .finally(() => setLoading(false))
    },
    [],
  )

  useEffect(() => {
    load()
    const timer = setInterval(() => load(), REFRESH_MS)
    return () => clearInterval(timer)
  }, [load])

  if (error !== null && state === null) {
    return createElement('div', { className: 'alo-root' }, createElement('div', { className: 'alo-body' }, createElement(Failure, { message: error, retry: () => load() })))
  }
  if (state === null) {
    return createElement(
      'div',
      { className: 'alo-root' },
      createElement('div', { className: 'alo-body', style: { paddingTop: 24 } }, createElement('div', { className: 'alo-muted' }, '读取中台状态…')),
    )
  }

  const changed = () => load()
  return createElement(
    'div',
    { className: 'alo-root' },
    createElement(
      'div',
      { className: 'alo-head' },
      createElement('h2', {}, 'Autoloop'),
      createElement(
        'div',
        { className: 'alo-tabs', role: 'tablist' },
        ...PAGES.map((item) =>
          createElement(
            'button',
            {
              key: item.id,
              className: 'alo-tab',
              role: 'tab',
              'aria-selected': page === item.id,
              onClick: () => setPage(item.id),
            },
            item.label,
            item.id === 'inbox' && state.totals.attention > 0 ? createElement('span', { className: 'alo-count' }, String(state.totals.attention)) : null,
          ),
        ),
      ),
      createElement('span', { className: 'alo-spacer' }),
      createElement(
        'div',
        { className: 'alo-actions' },
        createElement(
          'button',
          { className: 'alo-btn alo-btn-small', disabled: loading, onClick: () => load() },
          loading ? '刷新中…' : '刷新',
        ),
      ),
    ),
    createElement(
      'div',
      { className: 'alo-body' },
      createElement('div', { className: 'alo-view' },
      error !== null ? createElement('div', { className: 'alo-error', style: { marginBottom: 8 } }, `刷新失败：${error}`) : null,
      page === 'overview'
        ? createElement(Overview, {
            state,
            onOpenCard: (id) => {
              setCardId(id)
              setPage('inbox')
            },
            onOpenRun: (id) => {
              setRunId(id)
              setPage('runs')
            },
            onOpenTab: (tab) => setPage(tab),
          })
        : null,
      page === 'inbox'
        ? createElement(Inbox, {
            cards: state.cards,
            recent: state.recentCards,
            selected: cardId,
            onSelect: setCardId,
            onChanged: changed,
          })
        : null,
      page === 'runs'
        ? createElement(Runs, {
            state,
            selected: runId,
            onSelect: setRunId,
            onLoadOlder: () => {
              if (state.nextBefore !== null) load(state.nextBefore)
            },
            onChanged: changed,
          })
        : null,
      page === 'automations' ? createElement(Automations, { state, onChanged: changed }) : null,
      page === 'settings' ? createElement(Settings, { onRanCommand: changed }) : null,
      page === 'admin' ? createElement(Admin, { onChanged: changed }) : null,
      local !== null && local.state !== 'ready' ? createElement('div', { className: 'alo-muted alo-small', style: { marginTop: 12 } }, `本机状态：${local.state}`) : null,
      ),
    ),
  )
}
