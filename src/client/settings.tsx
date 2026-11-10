/**
 * 系统设置 — is everything wired up, and who is connected.
 *
 * Read-only by design: it answers "why is nothing happening" (hub unreachable,
 * no owner key, broken rule file, worker offline) and nothing here changes the
 * machine. Anything that does lives on 系统管理, behind a confirmation.
 * @module dsh-autoloop/client/settings
 */

import { createElement, useEffect, useState, type ReactNode } from 'react'
import type { Settings as SettingsView } from '../types.js'
import { api, ApiError } from './api.js'
import { shortTime } from './format.js'
import { Empty, Failure, Section, Select, TextArea } from './ui.js'

/** The settings page. */
export function Settings({ onRanCommand }: { onRanCommand: () => void }): ReactNode {
  const [view, setView] = useState<SettingsView | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    api
      .settings()
      .then(setView)
      .catch((problem: unknown) => setError(problem instanceof ApiError ? problem.message : String(problem)))
  }, [])

  if (error !== null) return createElement(Failure, { message: error })
  if (view === null) return createElement('div', { className: 'alo-muted alo-small' }, '读取设置…')

  return createElement(
    'div',
    {},
    createElement(
      Section,
      { title: '连接检查' },
      createElement(
        'ul',
        { className: 'alo-list' },
        ...view.checks.map((check) =>
          createElement(
            'li',
            { key: check.id, className: 'alo-row', style: { justifyContent: 'space-between', gap: 12 } },
            createElement('span', {}, check.label),
            createElement('span', { className: check.ok ? 'alo-check-ok' : 'alo-check-bad' }, `${check.ok ? '✓' : '✕'} ${check.detail}`),
          ),
        ),
      ),
      createElement(
        'div',
        { className: 'alo-muted alo-small', style: { marginTop: 8 } },
        `中台地址 ${view.hub.address ?? '—'} · 数据目录 ${view.hub.home} · 规则 ${view.hub.rulesPath}`,
      ),
    ),
    createElement(
      Section,
      { title: `Agent ${view.agents.length}` },
      view.agents.length === 0
        ? createElement(Empty, {}, '还没有登记 Agent。')
        : createElement(
            'table',
            { className: 'alo-table' },
            createElement('thead', {}, createElement('tr', {}, createElement('th', {}, '名称'), createElement('th', {}, '类型'), createElement('th', {}, '接单程序'), createElement('th', {}, '在线'), createElement('th', {}, '最近看到'))),
            createElement(
              'tbody',
              {},
              ...view.agents.map((agent) =>
                createElement(
                  'tr',
                  { key: agent.id },
                  createElement('td', {}, agent.name),
                  createElement('td', { className: 'alo-muted' }, agent.use),
                  createElement('td', { className: 'alo-mono' }, agent.worker),
                  createElement('td', { className: agent.online ? 'alo-check-ok' : 'alo-muted' }, agent.online ? '在线' : '离线'),
                  createElement('td', { className: 'alo-muted' }, shortTime(agent.seenAt)),
                ),
              ),
            ),
          ),
    ),
    createElement(
      Section,
      { title: `通知通道 ${view.channels.length}` },
      view.channels.length === 0
        ? createElement(Empty, {}, '还没有配置通道。')
        : createElement(
            'ul',
            { className: 'alo-list' },
            ...view.channels.map((channel) =>
              createElement(
                'li',
                { key: channel.id, className: 'alo-row', style: { justifyContent: 'space-between' } },
                createElement('span', {}, channel.name),
                createElement('span', { className: channel.online ? 'alo-check-ok' : 'alo-muted' }, `${channel.online ? '在线' : '离线'} · ${shortTime(channel.seenAt)}`),
              ),
            ),
          ),
    ),
    createElement(NoticeForm, { onRanCommand }),
  )
}

/** Send yourself a notice through the local source key — the CLI's `tell` from the page. */
function NoticeForm({ onRanCommand }: { onRanCommand: () => void }): ReactNode {
  const [key, setKey] = useState('dsh-test')
  const [text, setText] = useState('')
  const [state, setState] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  return createElement(
    Section,
    { title: '发一条通知' },
    createElement(
      'div',
      { className: 'alo-muted alo-small', style: { marginBottom: 8 } },
      '和命令行 agent-autoloop tell 一样：用这台电脑的来源密钥发一条通知卡片，发到你把“与 Agent Autoloop 的对话”挪回聊天时才看得到效果。相同编号只会发一次。',
    ),
    createElement(Select, {
      label: '编号',
      value: key,
      options: [
        { value: 'dsh-test', label: 'dsh-test（测试）' },
        { value: 'dsh-note', label: 'dsh-note（备注）' },
      ],
      onChange: setKey,
    }),
    createElement(TextArea, { label: '内容', value: text, onChange: setText, rows: 3 }),
    state !== null ? createElement('div', { className: 'alo-small', style: { marginBottom: 8 } }, state) : null,
    createElement(
      'button',
      {
        className: 'alo-btn',
        disabled: busy || text.trim() === '',
        onClick: () => {
          setBusy(true)
          api
            .notice(key, text.trim())
            .then(() => {
              setState('已发出。')
              setText('')
              onRanCommand()
            })
            .catch((problem: unknown) => setState(problem instanceof ApiError ? problem.message : String(problem)))
            .finally(() => setBusy(false))
        },
      },
      busy ? '发送中…' : '发送通知',
    ),
  )
}
