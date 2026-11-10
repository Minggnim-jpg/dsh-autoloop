/**
 * Browser half of dsh-autoloop.
 *
 * Targets the dsh 0.2.x sidebar contract: a global panel is a pair of
 * registrations sharing one id — an icon in the root-scoped `sidebar.panellist`
 * list, and the panel body in the root-scoped `main` keyed slot under the same
 * key. Selecting the icon (the sidebar wires it to `ctx.layout.selectPanel(id)`)
 * swaps the center column to the panel; no overlay or toggle is involved.
 * @module dsh-autoloop/client
 */

import { createElement } from 'react'
import { AutoloopIcon } from './icon.js'
import { AutoloopPanel } from './panel.js'
import { injectStyles } from './styles.js'

/** Stable Cordis plugin name. */
export const name = 'dsh-autoloop'

/** Client services this browser half cannot work without. */
export const inject = ['slots']

/** The panel id shared by the sidebar icon and the main panel key. */
export const PANEL_ID = 'dsh-autoloop'

/** The slice of the root slot service this plugin uses. */
interface SlotsService {
  register(options: Record<string, unknown>, component: unknown): () => void
  inject(seat: string, callback: () => unknown): unknown
}

/**
 * Register the sidebar icon and the main panel.
 *
 * There is no settings section: everything this plugin can configure is the
 * install itself, which lives on the panel's 系统管理 page rather than in dsh's
 * global settings.
 */
export function register(ctx: { slots?: SlotsService }): void {
  const slots = ctx.slots
  if (slots === undefined || typeof slots.register !== 'function') return

  injectStyles()

  // Sidebar nav row (icon only). The sidebar renders the icon with { size, active }.
  slots.inject('sidebar.panellist', () =>
    slots.register(
      { name: 'sidebar.panellist', id: PANEL_ID, order: 70, label: '自动循环' },
      () => createElement(AutoloopIcon, {}),
    ),
  )

  // Center-column panel body, dispatched when the icon's id is selected.
  slots.inject('main', () => slots.register({ name: 'main', key: PANEL_ID }, () => createElement(AutoloopPanel, {})))
}

const shared = module.exports as Record<string, unknown>
shared.name = name
shared.inject = inject
shared.apply = register
