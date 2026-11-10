/**
 * The handful of presentational pieces every page reuses.
 *
 * The panel owns its own material palette (see `styles.ts`), so these only
 * arrange content and name states; they never decide a colour.
 * @module dsh-autoloop/client/ui
 */

import { createElement, type ReactNode } from 'react'
import type { Run } from '../types.js'
import { runStateText } from './format.js'

/** One headline number with its explanation. */
export function Stat({ label, value, note }: { label: string; value: ReactNode; note?: ReactNode }): ReactNode {
  return createElement(
    'div',
    { className: 'alo-stat' },
    createElement('div', { className: 'alo-stat-label' }, label),
    createElement('div', { className: 'alo-stat-value' }, value),
    note !== undefined ? createElement('div', { className: 'alo-stat-note' }, note) : null,
  )
}

/** A titled section: the heading sits on the desk, its content on one sheet of paper. */
export function Section({
  title,
  meta,
  actions,
  children,
  bare,
}: {
  title: string
  meta?: ReactNode
  actions?: ReactNode
  children: ReactNode
  /** Render children directly on the desk instead of on a paper sheet. */
  bare?: boolean
}): ReactNode {
  return createElement(
    'section',
    { className: 'alo-section' },
    createElement(
      'div',
      { className: 'alo-section-head' },
      createElement(
        'h3',
        { className: 'alo-section-title' },
        title,
        meta !== undefined ? createElement('span', { className: 'alo-section-meta' }, meta) : null,
      ),
      actions ?? null,
    ),
    bare === true ? children : createElement('div', { className: 'alo-card' }, children),
  )
}

/** The text-colour tone of one run state, as a dot plus a word. */
export function runTone(run: Pick<Run, 'state' | 'attempts' | 'stopping'>): 'ok' | 'warn' | 'bad' | 'accent' | '' {
  if (run.stopping) return 'warn'
  if (run.state === 'claimed') return 'accent'
  if (run.state === 'queued') return 'warn'
  if (run.state === 'done') return 'ok'
  if (run.state === 'unknown') return 'bad'
  return ''
}

/** A run's state as a dot plus a word — never colour alone. */
export function RunBadge({ run }: { run: Pick<Run, 'state' | 'attempts' | 'stopping'> }): ReactNode {
  const tone = runTone(run)
  return createElement(
    'span',
    { className: `alo-small alo-nowrap alo-status${tone === '' ? ' alo-muted' : ` alo-check-${tone === 'accent' ? 'ok' : ''}`}`.trim() },
    createElement('span', { className: `alo-dot${tone === '' ? '' : ` alo-dot-${tone}`}`, 'aria-hidden': 'true' }),
    runStateText(run),
  )
}

/** Nothing to show, with a sentence saying why. */
export function Empty({ title, children }: { title?: string; children: ReactNode }): ReactNode {
  return createElement(
    'div',
    { className: 'alo-empty' },
    title !== undefined ? createElement('strong', {}, title) : null,
    children,
  )
}

/** A load failure that the user can retry. */
export function Failure({ message, retry }: { message: string; retry?: () => void }): ReactNode {
  return createElement(
    'div',
    { className: 'alo-card' },
    createElement('div', { className: 'alo-error' }, message),
    retry !== undefined
      ? createElement('button', { className: 'alo-btn', style: { marginTop: 10 }, onClick: retry }, '重试')
      : null,
  )
}

/** A labelled text field. */
export function Field({
  label,
  value,
  onChange,
  placeholder,
  disabled,
  id,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  id?: string
}): ReactNode {
  const fieldId = id ?? `alo-field-${label.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '-')}`
  return createElement(
    'div',
    { className: 'alo-field' },
    createElement('label', { htmlFor: fieldId }, label),
    createElement('input', {
      id: fieldId,
      className: 'alo-input',
      value,
      placeholder: placeholder ?? '',
      disabled: disabled === true,
      onChange: (event: { target: { value: string } }) => onChange(event.target.value),
    }),
  )
}

/** A labelled multi-line field. */
export function TextArea({
  label,
  value,
  onChange,
  rows,
  placeholder,
  id,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  rows?: number
  placeholder?: string
  id?: string
}): ReactNode {
  const fieldId = id ?? `alo-area-${label.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '-')}`
  return createElement(
    'div',
    { className: 'alo-field' },
    createElement('label', { htmlFor: fieldId }, label),
    createElement('textarea', {
      id: fieldId,
      className: 'alo-textarea',
      value,
      placeholder: placeholder ?? '',
      rows: rows ?? 4,
      onChange: (event: { target: { value: string } }) => onChange(event.target.value),
    }),
  )
}

/** A labelled select over string options. */
export function Select({
  label,
  value,
  options,
  onChange,
  id,
}: {
  label: string
  value: string
  options: { value: string; label: string }[]
  onChange: (value: string) => void
  id?: string
}): ReactNode {
  const fieldId = id ?? `alo-select-${label.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '-')}`
  return createElement(
    'div',
    { className: 'alo-field' },
    createElement('label', { htmlFor: fieldId }, label),
    createElement(
      'select',
      {
        id: fieldId,
        className: 'alo-select',
        value,
        onChange: (event: { target: { value: string } }) => onChange(event.target.value),
      },
      ...options.map((option) => createElement('option', { key: option.value, value: option.value }, option.label)),
    ),
  )
}
