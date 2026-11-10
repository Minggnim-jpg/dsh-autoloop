/**
 * 自动任务 — the rules file, edited from the panel.
 *
 * Saves carry the revision the page loaded, so a change made in the local web
 * console meanwhile becomes a visible conflict instead of a silent overwrite.
 * Disabling a rule moves it whole into the archive (`rules.archive.json`), which
 * the web console reads too; nothing is ever deleted, and a claimed round keeps
 * running under the rules it was claimed with.
 * @module dsh-autoloop/client/automations
 */

import { createElement, useEffect, useState, type ReactNode } from 'react'
import type { HubState, RuleCheck, RulesEnvelope } from '../types.js'
import { api, ApiError } from './api.js'
import { shortTime } from './format.js'
import { Empty, Failure, Field, Select, TextArea } from './ui.js'

/** The document and its revision, as the page holds it. */
interface Doc {
  rules: Record<string, unknown>
  revision: string
  archived: { id: string; rule: Record<string, unknown>; archivedAt: string }[]
}

const TEXTS = { tell: ['needed', 'always', 'never'], access: ['edit', 'read', 'full'] }

/** The rules page: the list, the selected rule's editor, the archive and templates. */
export function Automations({ state, onChanged }: { state: HubState; onChanged: () => void }): ReactNode {
  const [doc, setDoc] = useState<Doc | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const load = (): void => {
    api
      .rules()
      .then((value: RulesEnvelope) => {
        setDoc({ rules: value.rules, revision: value.revision, archived: value.archived.rules })
        setError(null)
      })
      .catch((problem: unknown) => setError(problem instanceof ApiError ? problem.message : String(problem)))
  }
  useEffect(load, [])

  if (error !== null) return createElement(Failure, { message: error, retry: load })
  if (doc === null) return createElement('div', { className: 'alo-muted alo-small' }, '读取规则…')

  const list = (Array.isArray(doc.rules.rules) ? doc.rules.rules : []) as Record<string, unknown>[]
  const agents = Object.entries((doc.rules.agents ?? {}) as Record<string, { name?: string }>).map(([id, agent]) => ({
    value: id,
    label: agent.name ?? id,
  }))
  const sources = Object.keys((doc.rules.sources ?? {}) as Record<string, unknown>).map((id) => ({ value: id, label: id }))

  async function run(action: () => Promise<unknown>, done: string): Promise<void> {
    setBusy(true)
    setNotice(null)
    try {
      await action()
      setNotice(done)
      load()
      onChanged()
    } catch (problem) {
      setNotice(problem instanceof ApiError ? problem.message : String(problem))
    } finally {
      setBusy(false)
    }
  }

  return createElement(
    'div',
    { style: { display: 'grid', gridTemplateColumns: 'minmax(240px, 340px) 1fr', gap: 12, alignItems: 'start' } },
    createElement(
      'div',
      { className: 'alo-card' },
      createElement(
        'div',
        { className: 'alo-row', style: { justifyContent: 'space-between', marginBottom: 8 } },
        createElement('h3', { style: { margin: 0 } }, `规则 ${list.length}`),
        createElement(
          'button',
          { className: 'alo-btn', onClick: () => setSelected(-1) },
          '新建',
        ),
      ),
      list.length === 0
        ? createElement(Empty, {}, '还没有规则。')
        : createElement(
            'ul',
            { className: 'alo-list' },
            ...list.map((rule, index) => {
              const name = String(rule.name ?? '')
              const line = state.lines.find((item) => item.name === name)
              return createElement(
                'li',
                {
                  key: name,
                  style: { cursor: 'pointer', borderLeft: selected === index ? '2px solid var(--dsw-accent-primary)' : '2px solid transparent', paddingLeft: 6 },
                  onClick: () => setSelected(index),
                },
                createElement('div', { style: { fontWeight: selected === index ? 600 : 400 } }, name),
                createElement(
                  'div',
                  { className: 'alo-muted alo-small' },
                  line === undefined
                    ? '中台还没有加载到这条规则'
                    : line.source === 'schedule'
                      ? `${line.every ?? '定时'} · 下次 ${shortTime(line.next)}`
                      : `事件 ${line.source} · ${line.types.join(', ')}`,
                ),
                createElement(
                  'div',
                  { className: 'alo-row', style: { marginTop: 4, gap: 6 } },
                  createElement(
                    'button',
                    {
                      className: 'alo-btn',
                      disabled: busy,
                      onClick: (event: { stopPropagation: () => void }) => {
                        event.stopPropagation()
                        void run(() => api.disableRule(index, doc.revision), `已停用并存入存档：${name}`)
                      },
                    },
                    '停用',
                  ),
                ),
              )
            }),
          ),
    ),

    createElement(
      'div',
      {},
      notice !== null ? createElement('div', { className: 'alo-card alo-small' }, notice) : null,
      selected === null
        ? createElement('div', { className: 'alo-card alo-empty' }, '选一条规则看详情，或点“新建”。')
        : createElement(RuleEditor, {
            doc,
            index: selected === -1 ? null : selected,
            agents,
            sources,
            busy,
            onSave: (next) =>
              run(async () => {
                const copy = structuredClone(doc.rules) as Record<string, unknown>
                const rules = Array.isArray(copy.rules) ? [...(copy.rules as unknown[])] : []
                if (selected === -1) rules.push(next)
                else rules[selected] = next
                copy.rules = rules
                await api.saveRules(copy, doc.revision)
                setSelected(null)
              }, '规则已保存。中台会在下次读取时加载它。'),
          }),
      createElement(Archive, { doc, busy, onRestore: (id, name) => run(() => api.restoreRule(id, doc.revision), `已恢复：${name}`) }),
      createElement(Elsewhere, { state }),
    ),
  )
}

/** One rule's form, validating through the host before saving. */
function RuleEditor({
  doc,
  index,
  agents,
  sources,
  busy,
  onSave,
}: {
  doc: Doc
  index: number | null
  agents: { value: string; label: string }[]
  sources: { value: string; label: string }[]
  busy: boolean
  onSave: (rule: Record<string, unknown>) => Promise<void>
}): ReactNode {
  const existing = index === null ? {} : ((doc.rules.rules as Record<string, unknown>[])[index] ?? {})
  const when = (existing.when ?? { cron: '0 9 * * *' }) as Record<string, unknown>
  const [name, setName] = useState(String(existing.name ?? ''))
  const [trigger, setTrigger] = useState<'cron' | 'event'>(when.source === undefined ? 'cron' : 'event')
  const [cron, setCron] = useState(String(when.cron ?? '0 9 * * *'))
  const [source, setSource] = useState(String(when.source ?? sources[0]?.value ?? ''))
  const [types, setTypes] = useState<string[]>(Array.isArray(when.types) ? (when.types as string[]) : [])
  const [to, setTo] = useState(String(existing.to ?? agents[0]?.value ?? ''))
  const [cwd, setCwd] = useState(String(existing.cwd ?? '~/'))
  const [prompt, setPrompt] = useState(String(existing.prompt ?? ''))
  const [skill, setSkill] = useState(String(existing.skill ?? ''))
  const [tell, setTell] = useState(String(existing.tell ?? 'needed'))
  const [check, setCheck] = useState<RuleCheck | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  const draft: Record<string, unknown> = {
    ...existing,
    name,
    when: trigger === 'cron' ? { cron } : { source, types },
    to,
    cwd,
    ...(prompt !== '' && { prompt }),
    ...(skill !== '' && { skill }),
    ...(tell !== 'needed' && { tell }),
  }

  async function save(): Promise<void> {
    setProblem(null)
    try {
      const result = await api.validateRule(draft, index)
      setCheck(result)
      if (!result.ok) return
      await onSave(draft)
    } catch (error) {
      setProblem(error instanceof ApiError ? error.message : String(error))
    }
  }

  return createElement(
    'div',
    { className: 'alo-card' },
    createElement('h3', {}, index === null ? '新建规则' : `编辑：${name || '未命名'}`),
    createElement(Field, { label: '名称', value: name, onChange: setName, placeholder: '例如：早报' }),
    createElement(
      'div',
      { className: 'alo-row', style: { marginBottom: 10 } },
      createElement('button', { className: 'alo-chip', 'aria-pressed': trigger === 'cron', onClick: () => setTrigger('cron') }, '定时'),
      createElement('button', { className: 'alo-chip', 'aria-pressed': trigger === 'event', onClick: () => setTrigger('event') }, '事件'),
    ),
    trigger === 'cron'
      ? createElement(Field, { label: 'cron（分 时 日 月 周）', value: cron, onChange: setCron, placeholder: '0 9 * * *' })
      : createElement(
          'div',
          {},
          createElement(Select, { label: '来源', value: source, options: sources, onChange: setSource }),
          createElement(Field, {
            label: '事件类型（逗号分隔，可用 x.* 或 *）',
            value: types.join(', '),
            onChange: (value) => setTypes(value.split(',').map((part) => part.trim()).filter((part) => part !== '')),
            placeholder: 'issue.opened, pull_request.*',
          }),
        ),
    createElement(Select, { label: '交给哪个 Agent', value: to, options: agents, onChange: setTo }),
    createElement(Field, { label: '在哪个目录干', value: cwd, onChange: setCwd, placeholder: '~/notes' }),
    createElement(TextArea, { label: '任务说明（prompt）', value: prompt, onChange: setPrompt }),
    createElement(Field, { label: 'Skill（可选）', value: skill, onChange: setSkill }),
    createElement(Select, {
      label: '什么时候告诉你',
      value: tell,
      options: [
        { value: 'needed', label: '拿不准才问' },
        { value: 'always', label: '每轮都说' },
        { value: 'never', label: '不打扰' },
      ],
      onChange: setTell,
    }),
    check !== null && !check.ok
      ? createElement('ul', { className: 'alo-error' }, ...check.issues.map((issue, i) => createElement('li', { key: i }, issue)))
      : null,
    problem !== null ? createElement('div', { className: 'alo-error' }, problem) : null,
    createElement(
      'div',
      { className: 'alo-row', style: { marginTop: 8 } },
      createElement('button', { className: 'alo-btn alo-btn-primary', disabled: busy, onClick: () => void save() }, busy ? '保存中…' : '校验并保存'),
      createElement('span', { className: 'alo-muted alo-small' }, `当前版本 ${doc.revision.slice(0, 8)}`),
    ),
  )
}

/** The rules taken off the list, kept whole so they can come back. */
function Archive({ doc, busy, onRestore }: { doc: Doc; busy: boolean; onRestore: (id: string, name: string) => void }): ReactNode {
  if (doc.archived.length === 0) return null
  return createElement(
    'div',
    { className: 'alo-card' },
    createElement('h3', {}, `存档 ${doc.archived.length}`),
    createElement(
      'ul',
      { className: 'alo-list' },
      ...doc.archived.map((entry) =>
        createElement(
          'li',
          { key: entry.id, className: 'alo-row', style: { justifyContent: 'space-between' } },
          createElement(
            'span',
            {},
            String(entry.rule.name ?? entry.id),
            createElement('span', { className: 'alo-muted alo-small' }, ` · 停用于 ${shortTime(entry.archivedAt)}`),
          ),
          createElement('button', { className: 'alo-btn', disabled: busy, onClick: () => onRestore(entry.id, String(entry.rule.name ?? entry.id)) }, '恢复'),
        ),
      ),
    ),
  )
}

/** Tasks scheduled on other machines: shown, never driven from here. */
function Elsewhere({ state }: { state: HubState }): ReactNode {
  if (state.elsewhere.length === 0) return null
  return createElement(
    'div',
    { className: 'alo-card' },
    createElement('h3', {}, '在别的电脑上跑'),
    createElement(
      'ul',
      { className: 'alo-list' },
      ...state.elsewhere.map((task) =>
        createElement(
          'li',
          { key: task.id },
          createElement('div', {}, task.name),
          createElement('div', { className: 'alo-muted alo-small' }, `${task.where} · ${task.every} · 下次 ${shortTime(task.next)}`),
        ),
      ),
    ),
    createElement('div', { className: 'alo-muted alo-small', style: { marginTop: 6 } }, '这些任务不在这台电脑上运行，这里只能看，不能启停。'),
  )
}

export { TEXTS }
