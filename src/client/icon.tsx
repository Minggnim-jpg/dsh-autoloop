/**
 * The sidebar glyph.
 *
 * The sidebar renders each `sidebar.panellist` occupant with `{ size, active }`
 * and paints its own button, so this is only the glyph — a loop arrow, which is
 * what the hub is: work that comes back to you only when it needs a decision.
 * @module dsh-autoloop/client/icon
 */

import { createElement, type ReactNode } from 'react'

/** Props supplied by the sidebar panel row. */
export interface AutoloopIconProps {
  /** Requested square edge in pixels (16 when wide, 18 when collapsed). */
  readonly size?: number
  /** Whether this panel is the current selection. */
  readonly active?: boolean
}

/** The loop glyph used as the sidebar panel icon. */
export function AutoloopIcon({ size = 18 }: AutoloopIconProps): ReactNode {
  return createElement(
    'svg',
    { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': 'true', focusable: 'false' },
    createElement('path', {
      d: 'M20.5 12a8.5 8.5 0 1 1-2.7-6.2M20.5 4.5v4.2h-4.2',
      stroke: 'currentColor',
      strokeWidth: '1.6',
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
    }),
    createElement('circle', { cx: 12, cy: 12, r: 2.1, stroke: 'currentColor', strokeWidth: '1.6' }),
  )
}
