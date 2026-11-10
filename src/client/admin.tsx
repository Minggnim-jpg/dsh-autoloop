/**
 * 系统管理 — the machine, behind a confirmation.
 *
 * Every action here changes this install: the hub process, the login item, the
 * CLI. The page therefore never runs anything on a bare click. It first asks the
 * host to describe exactly what would run, shows that description, and only the
 * confirmation that comes back — bound to those parameters and valid for ten
 * minutes — can start it. The page has no way to name a program or an argument.
 * @module dsh-autoloop/client/admin
 */

import { createElement, useEffect, useState, type ReactNode } from 'react'
import type { AdminJob, AdminOverview, ConfirmTicket } from '../types.js'
import { api, ApiError } from './api.js'
import { Empty, Failure, Section } from './ui.js'

/** The management page. */
export function Admin({ onChanged }: { onChanged: () => void }): ReactNode {
  const [view, setView] = useState<AdminOverview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<{ action: string; ticket: ConfirmTicket } | null>(null)
  const [jobs, setJobs] = useState<AdminJob[]>([])
  const [busy, setBusy] = useState<string | null>(null)

  const load = (): void => {
    api
      .admin()
      .then((value) => {
        setView(value)
        setError(null)
      })
      .catch((problem: unknown) => setError(problem instanceof ApiError ? problem.message : String(problem)))
  }
  useEffect(load, [])
  useEffect(() => {
    // A running job is polled until it finishes; nothing else polls.
    const running = jobs.filter((job) => job.state === 'running')
    if (running.length === 0) return
    const timer = setInterval(() => {
      for (const job of running) {
        void api
          .job(job.id)
          .then((fresh) => {
            setJobs((list) => list.map((item) => (item.id === fresh.id ? fresh : item)))
            if (fresh.state !== 'running') {
              load()
              onChanged()
            }
          })
          .catch(() => undefined)
      }
    }, 1500)
    return () => clearInterval(timer)
  }, [jobs, onChanged])

  if (error !== null) return createElement(Failure, { message: error, retry: load })
  if (view === null) return createElement('div', { className: 'alo-muted alo-small' }, '读取本机安装…')

  async function plan(action: string): Promise<void> {
    setBusy(action)
    try {
      const { ticket } = await api.plan(action, {})
      setPending({ action, ticket })
    } catch (problem) {
      setError(problem instanceof ApiError ? problem.message : String(problem))
    } finally {
      setBusy(null)
    }
  }

  async function confirm(): Promise<void> {
    if (pending === null) return
    setBusy(pending.action)
    try {
      const job = await api.start(pending.action, pending.ticket.token)
      setJobs((list) => [job, ...list])
      setPending(null)
    } catch (problem) {
      setError(problem instanceof ApiError ? problem.message : String(problem))
      setPending(null)
    } finally {
      setBusy(null)
    }
  }

  return createElement(
    'div',
    {},
    createElement(
      Section,
      { title: '这台电脑' },
      createElement(
        'div',
        { className: 'alo-small', style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 6 } },
        createElement('div', {}, `安装：${view.installed ? '已初始化' : '未初始化'}`),
        createElement('div', {}, `数据目录：${view.home}`),
        createElement('div', { className: 'alo-mono', style: { overflow: 'hidden', textOverflow: 'ellipsis' } }, `程序：${view.cli ?? '找不到'}`),
        createElement('div', {}, `版本：${view.version ?? '—'}`),
        createElement('div', {}, `中台：${view.hub.running ? `在跑（进程 ${view.hub.pid}）` : '没在跑'}`),
        createElement('div', {}, `系统服务：${view.service.detail}`),
        createElement('div', {}, `仓库：${view.git.head ?? '—'} ${view.git.remote ?? ''}`),
        createElement('div', {}, `登录自启（网页控制台）：${view.loginAgent.detail}`),
      ),
    ),
    createElement(
      Section,
      { title: '操作' },
      view.actions.length === 0
        ? createElement(Empty, {}, '没有可用操作。')
        : createElement(
            'div',
            { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10 } },
            ...view.actions.map((action) =>
              createElement(
                'div',
                { key: action.id, style: { border: '1px solid var(--dsw-border-subtle)', borderRadius: 8, padding: 10 } },
                createElement('div', { style: { fontWeight: 600, marginBottom: 4 } }, action.title),
                createElement('div', { className: 'alo-muted alo-small', style: { marginBottom: 8 } }, action.detail),
                createElement(
                  'button',
                  {
                    className: action.destructive ? 'alo-btn alo-btn-danger' : 'alo-btn',
                    disabled: busy !== null,
                    onClick: () => void plan(action.id),
                  },
                  busy === action.id ? '准备中…' : action.destructive ? '查看影响后确认' : '查看并执行',
                ),
              ),
            ),
          ),
      pending !== null
        ? createElement(
            'div',
            { className: 'alo-confirm' },
            createElement('div', { style: { fontWeight: 600, marginBottom: 6 } }, `确认执行：${pending.ticket.action}`),
            createElement('pre', {}, pending.ticket.summary),
            createElement('div', { className: 'alo-muted alo-small', style: { marginBottom: 8 } }, `确认有效到 ${new Date(pending.ticket.expiresAt).toLocaleTimeString('zh-CN')}，只能执行一次`),
            createElement(
              'div',
              { className: 'alo-row' },
              createElement('button', { className: 'alo-btn alo-btn-primary', disabled: busy !== null, onClick: () => void confirm() }, busy !== null ? '执行中…' : '确认执行'),
              createElement('button', { className: 'alo-btn', onClick: () => setPending(null) }, '取消'),
            ),
          )
        : null,
    ),
    createElement(
      Section,
      { title: '密钥' },
      view.keys.length === 0
        ? createElement(Empty, {}, '没有读到底层配置里的密钥名。')
        : createElement(
            'ul',
            { className: 'alo-list' },
            ...view.keys.map((key) => createElement('li', { key: `${key.kind}:${key.name}`, className: 'alo-row', style: { justifyContent: 'space-between' } }, createElement('span', {}, `${key.kind}`), createElement('span', { className: 'alo-mono' }, key.name))),
          ),
      createElement('div', { className: 'alo-muted alo-small', style: { marginTop: 8 } }, '只显示这台电脑 config.json 里的密钥名；中台不提供列密钥的接口，其它电脑上的密钥看不到。新建或收回密钥请用命令行 agent-autoloop key。'),
    ),
    createElement(
      Section,
      { title: 'MCP 接入' },
      createElement(
        'ul',
        { className: 'alo-list' },
        ...view.mcp.clients.map((client) =>
          createElement(
            'li',
            { key: client.id, className: 'alo-row', style: { justifyContent: 'space-between' } },
            createElement('span', {}, client.label),
            createElement(
              'span',
              { className: client.same ? 'alo-check-ok' : 'alo-muted alo-small' },
              `${client.installed ? '有配置文件' : '没有配置文件'} · ${client.same ? '已包含 agent-autoloop' : '未接入 agent-autoloop'} · ${client.file}`,
            ),
          ),
        ),
      ),
      createElement('div', { className: 'alo-muted alo-small', style: { marginTop: 8 } }, '这一步只做只读检查。要真正接入，请在网页控制台的“系统管理 → MCP 接入”里点，那里会写入并回读核对。'),
    ),
    jobs.length > 0
      ? createElement(
          Section,
          { title: `执行结果 ${jobs.length}` },
          ...jobs.map((job) =>
            createElement(
              'div',
              { key: job.id, style: { marginBottom: 10 } },
              createElement(
                'div',
                { className: 'alo-row', style: { justifyContent: 'space-between', marginBottom: 4 } },
                createElement('span', {}, `${job.action}`),
                createElement('span', { className: job.state === 'failed' ? 'alo-check-bad' : job.state === 'running' ? 'alo-muted' : 'alo-check-ok' }, `${job.state}${job.exit === null ? '' : ` · 退出码 ${job.exit}`}`),
              ),
              job.output !== '' ? createElement('pre', { className: 'alo-log' }, job.output) : null,
            ),
          ),
        )
      : null,
    createElement(
      Section,
      { title: '卸载时删什么、留什么' },
      createElement('ul', { className: 'alo-list' }, ...view.uninstall.files.map((file) => createElement('li', {}, `删除：${file}`))),
      createElement('ul', { className: 'alo-list' }, ...view.uninstall.keeps.map((file) => createElement('li', {}, `保留：${file}`))),
      createElement('div', { className: 'alo-muted alo-small', style: { marginTop: 8 } }, '卸载本身请在命令行运行 agent-autoloop uninstall，它会逐步确认。'),
    ),
  )
}
