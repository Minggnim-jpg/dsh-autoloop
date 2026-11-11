/**
 * 待我处理 — the page the hub exists for.
 *
 * A card is a question the agent could not settle alone. The panel shows the
 * evidence that came with it, lets the owner pick an option or write words, then
 * says plainly what happens next: answering wakes the agent, closing a card does
 * not. Those are two different acts and are never merged into one button.
 * @module dsh-autoloop/client/inbox
 */

import { createElement, useEffect, useState, type ReactNode } from 'react'
import type { Card } from '../types.js'
import { api, ApiError, answerOptions, isQuestion } from './api.js'
import { cardStateText, shortTime } from './format.js'
import { Empty, ExternalLink, RichText, Section } from './ui.js'

/** Props: the open and recent cards, plus a way to reload after an action. */
export interface InboxProps {
  cards: Card[]
  recent: Card[]
  selected: number | null
  onSelect: (id: number | null) => void
  onChanged: () => void
}

/** The inbox: a card list beside the detail and answer form of the selected card. */
export function Inbox({ cards, recent, selected, onSelect, onChanged }: InboxProps): ReactNode {
  const [tab, setTab] = useState<'open' | 'recent'>('open')
  const list = tab === 'open' ? cards : recent
  const current = list.find((card) => card.id === selected) ?? list[0] ?? null
  return createElement(
    'div',
    { style: { display: 'grid', gridTemplateColumns: 'minmax(220px, 300px) 1fr', gap: 12, alignItems: 'start' } },
    createElement(
      'div',
      { className: 'alo-card', style: { padding: 10 } },
      createElement(
        'div',
        { className: 'alo-row', style: { marginBottom: 8 } },
        createElement('button', { className: 'alo-chip', 'aria-pressed': tab === 'open', onClick: () => setTab('open') }, `等我的 ${cards.length}`),
        createElement('button', { className: 'alo-chip', 'aria-pressed': tab === 'recent', onClick: () => setTab('recent') }, `最近处理 ${recent.length}`),
      ),
      list.length === 0
        ? createElement(Empty, {}, tab === 'open' ? '没有等你处理的卡片。' : '还没有处理过的卡片。')
        : createElement(
            'ul',
            { className: 'alo-list' },
            ...list.map((card) =>
              createElement(
                'li',
                {
                  key: card.id,
                  style: { cursor: 'pointer', paddingLeft: 6, borderLeft: current?.id === card.id ? '2px solid var(--dsw-accent-primary)' : '2px solid transparent' },
                  onClick: () => onSelect(card.id),
                },
                createElement('div', { style: { fontWeight: current?.id === card.id ? 600 : 400 } }, `#${card.id} ${card.title}`),
                createElement(
                  'div',
                  { className: 'alo-muted alo-small' },
                  `${card.kind === 'ask' ? '等你决定' : '要你留意'} · ${cardStateText(card)} · ${shortTime(card.createdAt)}`,
                ),
              ),
            ),
          ),
    ),
    current === null
      ? createElement('div', { className: 'alo-card alo-empty' }, '选一张卡片看详情。')
      : createElement(CardDetail, { card: current, onChanged }),
  )
}

/** One card: its text, options, answer and close forms. */
function CardDetail({ card, onChanged }: { card: Card; onChanged: () => void }): ReactNode {
  const options = answerOptions(card)
  const [choice, setChoice] = useState<number | null>(card.recommend ?? null)
  const [text, setText] = useState('')
  const [reason, setReason] = useState('')
  const [mode, setMode] = useState<'answer' | 'close'>('answer')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  useEffect(() => {
    setChoice(card.recommend ?? null)
    setText('')
    setReason('')
    setMode('answer')
    setError(null)
    setDone(null)
  }, [card.id, card.version])

  const isOpen = card.state === 'open'
  async function submit(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      if (mode === 'close') {
        if (reason.trim() === '') {
          setError('结案要写一句结果，写清楚这件事最终怎么样了')
          return
        }
        await api.resolve(card.id, reason.trim())
        setDone('已结案。这张卡片不会唤醒 Agent；如果它还在等你决定，请改用“回答”。')
      } else if (isQuestion(card)) {
        const hasChoice = choice !== null
        const hasText = text.trim() !== ''
        if (!hasChoice && !hasText) {
          setError('选一个选项，或者写下你的想法')
          return
        }
        await api.answer(card.id, { ...(hasChoice && { choice: choice as number }), ...(hasText && { text: text.trim() }) })
        setDone('回答已送出。Agent 会接上原来的会话继续把活干完，去“执行记录”能看到下一轮。')
      } else {
        await api.answer(card.id, {})
        setDone('已确认收到。')
      }
      onChanged()
    } catch (error) {
      setError(error instanceof ApiError ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  return createElement(
    'div',
    { className: 'alo-card' },
    createElement(
      'div',
      { className: 'alo-row', style: { justifyContent: 'space-between', marginBottom: 8 } },
      createElement('h3', { style: { margin: 0 } }, `#${card.id} ${card.title}`),
      createElement('span', { className: 'alo-badge' }, cardStateText(card)),
    ),
    createElement(
      'div',
      { className: 'alo-small alo-muted', style: { marginBottom: 10 } },
      `${card.kind === 'ask' ? '等你决定' : '要你留意'}${card.run ? ` · 第 ${card.run} 轮` : ''}${card.rule ? ` · ${card.rule}` : ''} · ${shortTime(card.createdAt)}`,
    ),
    // The body is prose, but consoles and drafts arrive as bare URLs: keep the
    // words as written and make the URLs open the owner's browser in one click.
    createElement(RichText, { text: card.text, style: { marginBottom: 12 } }),
    card.link !== null && card.link !== ''
      ? createElement(
          'div',
          { style: { marginBottom: 12 } },
          createElement(ExternalLink, { href: card.link, className: 'alo-small' }, '打开关联链接'),
        )
      : null,

    isOpen
      ? createElement(
          'div',
          {},
          createElement(
            'div',
            { className: 'alo-row', style: { marginBottom: 10 } },
            createElement('button', { className: 'alo-chip', 'aria-pressed': mode === 'answer', onClick: () => setMode('answer') }, isQuestion(card) ? '回答' : '确认收到'),
            createElement('button', { className: 'alo-chip', 'aria-pressed': mode === 'close', onClick: () => setMode('close') }, '结案'),
          ),
          mode === 'answer' && options.length > 0
            ? createElement(
                'div',
                { style: { marginBottom: 10 } },
                ...options.map((option) =>
                  createElement(
                    'label',
                    { key: option.index, className: 'alo-row', style: { padding: '6px 0', cursor: 'pointer' } },
                    createElement('input', {
                      type: 'radio',
                      name: `card-${card.id}`,
                      checked: choice === option.index,
                      onChange: () => setChoice(option.index),
                    }),
                    createElement('span', {}, `${option.text}`),
                    card.recommend === option.index ? createElement('span', { className: 'alo-small alo-muted' }, '（推荐）') : null,
                  ),
                ),
              )
            : null,
          mode === 'answer' && isQuestion(card)
            ? createElement(
                'div',
                { className: 'alo-field' },
                createElement('label', {}, '或者写下你的想法'),
                createElement('textarea', {
                  className: 'alo-textarea',
                  rows: 3,
                  value: text,
                  placeholder: '可以只选选项，也可以补充说明',
                  onChange: (event: { target: { value: string } }) => setText(event.target.value),
                }),
              )
            : null,
          mode === 'close'
            ? createElement(
                'div',
                { className: 'alo-field' },
                createElement('label', {}, '结果（已核实的事实）'),
                createElement('textarea', {
                  className: 'alo-textarea',
                  rows: 3,
                  value: reason,
                  placeholder: '例如：已经在网页里手动处理完了',
                  onChange: (event: { target: { value: string } }) => setReason(event.target.value),
                }),
              )
            : null,
          error !== null ? createElement('div', { className: 'alo-error', style: { marginBottom: 8 } }, error) : null,
          createElement(
            'button',
            { className: 'alo-btn alo-btn-primary', disabled: busy, onClick: () => void submit() },
            busy ? '提交中…' : mode === 'close' ? '确认结案' : isQuestion(card) ? '提交回答' : '确认收到',
          ),
        )
      : createElement(
          'div',
          { className: 'alo-small' },
          createElement('div', {}, `回答：${card.answer ?? card.result ?? '—'}`),
          createElement('div', { className: 'alo-muted' }, `${card.by ? `由 ${card.by} ` : ''}${shortTime(card.decidedAt ?? card.closedAt)}`),
        ),
    done !== null ? createElement(Section, { title: '已完成' }, createElement('div', { className: 'alo-small' }, done)) : null,
  )
}
