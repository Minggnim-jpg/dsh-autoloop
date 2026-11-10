/**
 * 总览 — the first thing the panel shows.
 *
 * Opens with one sentence instead of a row of stat cards: what is waiting, what
 * is running, and how today went. The detail lives in sections below, each of
 * which links to the page that can act on it.
 * @module dsh-autoloop/client/overview
 */

import { createElement, type ReactNode } from 'react'
import type { HubState } from '../types.js'
import { money, shortTime, tokens } from './format.js'
import { Empty, RunBadge, Section } from './ui.js'

/** Props: the loaded state plus navigation into the other pages. */
export interface OverviewProps {
  state: HubState
  onOpenCard: (id: number) => void
  onOpenRun: (id: number) => void
  onOpenTab: (tab: 'inbox' | 'runs' | 'automations') => void
}

/** A sentence, the cards waiting, the running rounds and today's numbers. */
export function Overview({ state, onOpenCard, onOpenRun, onOpenTab }: OverviewProps): ReactNode {
  const today = state.spending.today
  const active = state.runs.filter((run) => run.state === 'claimed' || run.state === 'queued')
  const recent = state.runs.filter((run) => !active.includes(run)).slice(0, 6)
  const attention = state.totals.attention
  const unknowns = today.missingTokens + today.incompleteTokens + today.unverifiedTokens
  return createElement(
    'div',
    {},

    createElement(
      'h1',
      { className: 'alo-hero', key: 'hero' },
      `今天完成 ${state.totals.doneToday} 轮，${state.totals.running} 轮正在运行，${attention} 张卡片等你处理。`,
    ),
    createElement(
      'p',
      { className: 'alo-hero-sub', key: 'sub' },
      [
        state.totals.retrying > 0 ? `另有 ${state.totals.retrying} 轮等待重试` : null,
        `今日用量 ${tokens(today.tokens)} tokens`,
        today.cost ? `金额 ¥${today.cost.toFixed(2)}` : '金额未上报',
        unknowns > 0 ? `其中 ${unknowns} 轮没报全` : null,
      ]
        .filter((part) => part !== null)
        .join(' · '),
    ),

    createElement(
      Section,
      {
        key: 'cards',
        title: '需要你处理',
        meta: String(attention),
        actions: attention > 0 ? createElement('button', { className: 'alo-btn alo-btn-quiet alo-btn-small', onClick: () => onOpenTab('inbox') }, '全部待办 →') : null,
      },
      state.cards.length === 0
        ? createElement(Empty, { title: '没有等你的卡片' }, 'Agent 拿不准的时候会在这里出现。')
        : createElement(
            'ul',
            { className: 'alo-list' },
            ...state.cards.slice(0, 5).map((card) =>
              createElement(
                'li',
                { key: card.id, className: 'alo-row alo-between', style: { gap: 12 } },
                createElement(
                  'div',
                  { style: { minWidth: 0 } },
                  createElement(
                    'div',
                    { className: 'alo-small alo-muted' },
                    createElement('span', { className: card.kind === 'ask' ? 'alo-badge alo-badge-open' : 'alo-badge' }, card.kind === 'ask' ? '需要决定' : '需要留意'),
                    ` ${card.rule ?? ''} · ${shortTime(card.createdAt)}`,
                  ),
                  createElement('div', { style: { fontWeight: 500, marginTop: 2 } }, `#${card.id} ${card.title}`),
                ),
                createElement('button', { className: 'alo-btn alo-btn-small', onClick: () => onOpenCard(card.id) }, card.kind === 'ask' ? '回答' : '确认'),
              ),
            ),
          ),
    ),

    createElement(
      Section,
      {
        key: 'active',
        title: '正在运行',
        meta: String(active.length),
        actions: createElement('button', { className: 'alo-btn alo-btn-quiet alo-btn-small', onClick: () => onOpenTab('runs') }, '执行记录 →'),
      },
      active.length === 0
        ? createElement(Empty, { title: '此刻没有运行中的轮次' }, '排队或新任务开始后会显示在这里。')
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
                createElement('th', { className: 'alo-num' }, '开始'),
              ),
            ),
            createElement(
              'tbody',
              {},
              ...active.map((run) =>
                createElement(
                  'tr',
                  { key: run.id, style: { cursor: 'pointer' }, onClick: () => onOpenRun(run.id) },
                  createElement('td', { className: 'alo-mono' }, `#${run.id}`),
                  createElement('td', { className: 'alo-cell-main' }, createElement('span', { className: 'alo-cell-title' }, run.rule)),
                  createElement('td', { className: 'alo-muted' }, run.agent),
                  createElement('td', {}, createElement(RunBadge, { run })),
                  createElement('td', { className: 'alo-num alo-mono alo-muted' }, shortTime(run.claimedAt ?? run.createdAt)),
                ),
              ),
            ),
          ),
    ),

    createElement(
      Section,
      {
        key: 'recent',
        title: '今天的执行',
        meta: `最近 ${recent.length} 条`,
        actions: createElement('button', { className: 'alo-btn alo-btn-quiet alo-btn-small', onClick: () => onOpenTab('runs') }, '全部执行记录 →'),
      },
      recent.length === 0
        ? createElement(Empty, { title: '还没有执行记录' }, '规则第一次被触发后，这里会列出每一轮。')
        : createElement(
            'table',
            { className: 'alo-table' },
            createElement(
              'thead',
              {},
              createElement(
                'tr',
                {},
                createElement('th', {}, '时间'),
                createElement('th', {}, '任务'),
                createElement('th', {}, '状态'),
                createElement('th', { className: 'alo-num' }, '用量'),
              ),
            ),
            createElement(
              'tbody',
              {},
              ...recent.map((run) =>
                createElement(
                  'tr',
                  { key: run.id, style: { cursor: 'pointer' }, onClick: () => onOpenRun(run.id) },
                  createElement('td', { className: 'alo-mono alo-muted' }, shortTime(run.finishedAt ?? run.createdAt)),
                  createElement(
                    'td',
                    { className: 'alo-cell-main' },
                    createElement('span', { className: 'alo-cell-title', title: run.summary || run.rule }, run.rule),
                    createElement('span', { className: 'alo-cell-sub' }, `#${run.id} · ${run.summary || '—'}`),
                  ),
                  createElement('td', {}, createElement(RunBadge, { run })),
                  createElement('td', { className: 'alo-num alo-mono alo-muted' }, run.usage ? tokens((run.usage.input ?? 0) + (run.usage.output ?? 0)) : '未上报'),
                ),
              ),
            ),
          ),
    ),

    createElement(
      Section,
      {
        key: 'rules',
        title: '自动任务',
        meta: `${state.lines.length} 条规则`,
        actions: createElement('button', { className: 'alo-btn alo-btn-quiet alo-btn-small', onClick: () => onOpenTab('automations') }, '管理规则 →'),
      },
      state.lines.length === 0
        ? createElement(Empty, { title: '还没有自动任务规则' }, '新建一条规则，让 Agent 按时或按事件接活。')
        : createElement(
            'table',
            { className: 'alo-table' },
            createElement(
              'thead',
              {},
              createElement(
                'tr',
                {},
                createElement('th', {}, '规则'),
                createElement('th', {}, 'Agent'),
                createElement('th', {}, '触发'),
                createElement('th', { className: 'alo-num' }, '下次'),
                createElement('th', { className: 'alo-num' }, '今天'),
              ),
            ),
            createElement(
              'tbody',
              {},
              ...state.lines.map((line) =>
                createElement(
                  'tr',
                  { key: line.name },
                  createElement('td', { className: 'alo-cell-main' }, createElement('span', { className: 'alo-cell-title', title: line.name }, line.name)),
                  createElement('td', { className: 'alo-muted' }, line.agent),
                  createElement('td', { className: 'alo-muted' }, line.source === 'schedule' ? (line.every ?? '定时') : `事件 · ${line.source}`),
                  createElement('td', { className: 'alo-num alo-mono alo-muted' }, line.next === null ? '—' : shortTime(line.next)),
                  createElement('td', { className: 'alo-num alo-mono' }, String(line.totals.doneToday)),
                ),
              ),
            ),
          ),
    ),

    createElement(
      Section,
      { key: 'week', title: '本周', bare: true },
      createElement(
        'div',
        { className: 'alo-row alo-wrap alo-small alo-muted', style: { gap: 18 } },
        createElement('span', {}, `轮次 ${state.spending.week.rounds}`),
        createElement('span', {}, `Token ${tokens(state.spending.week.tokens)}`),
        createElement('span', {}, `费用 ${money(state.spending.week.cost, state.spending.week.missingCost)}`),
        createElement('span', {}, `时区 ${state.timezone}`),
      ),
    ),
  )
}
