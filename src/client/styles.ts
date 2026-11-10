/**
 * The panel's styles.
 *
 * The panel carries its own material palette instead of borrowing the shell's
 * `--dsw-*` colour tokens. That is deliberate: a generic token surface cannot
 * express the surfaces this panel needs — a linen canvas, a paper page, a
 * stitched leather tag, a Bakelite button — and every token the shell renames
 * would otherwise silently repaint the panel.
 *
 * What the palette still does is follow the shell's light/dark mode. dsh marks
 * dark mode with `body[data-ds-dark-theme]`; the same rule is mirrored here so
 * the panel switches exactly when the rest of the app does, with no timer and no
 * separate preference to keep in sync.
 *
 * Every colour is declared on `.alo-root` as a custom property, so nothing leaks
 * into the shell and a nested panel would still scope correctly.
 * @module dsh-autoloop/client/styles
 */

const TAG_ID = 'dsh-autoloop/styles.css?v=3'

/** Paper fibre: one 160px SVG turbulence tile, inlined so the bundle needs no assets. */
export const PAPER_NOISE =
  'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'160\' height=\'160\'%3E%3Cfilter id=\'n\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'.78\' numOctaves=\'3\' stitchTiles=\'stitch\'/%3E%3CfeColorMatrix type=\'saturate\' values=\'0\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23n)\' opacity=\'.09\'/%3E%3C/svg%3E")'

const CSS = `
.alo-root {
  /* Cloud oak: a barely-there desk under paper that is only a shade brighter. */
  --alo-desk: #efe8dc;
  --alo-paper: #fffdf8;
  --alo-ink: #302a23;
  --alo-muted: #5c554a;
  --alo-faint: #6a6156;
  --alo-line: #e6ddd0;
  --alo-line-strong: #c2b6a3;
  --alo-hover: #f6f0e6;
  --alo-accent: #44526a;
  --alo-accent-soft: #eef1f5;
  --alo-warn: #87492a;
  --alo-warn-soft: #f7e7d2;
  --alo-ok: #3d624b;
  --alo-ok-soft: #edf2ea;
  --alo-bad: #8f4a40;
  --alo-bad-soft: #f7e5de;
  --alo-button: #3d352c;
  --alo-button-text: #fffaf1;
  --alo-desk-ink: #302a23;
  --alo-desk-muted: #514a3f;
  --alo-desk-link: #33476a;
  --alo-metal-hi: #f8f6f1;
  --alo-metal-lo: #cbc2b4;
  --alo-noise: ${PAPER_NOISE};
  --alo-ease: cubic-bezier(.23, 1, .32, 1);
  --alo-mono: var(--dsw-font-mono, ui-monospace, SFMono-Regular, Consolas, monospace);

  display: flex; flex-direction: column; height: 100%; min-height: 0;
  color: var(--alo-ink);
  font-size: 14px; line-height: 1.65;
  background-color: var(--alo-desk);
  background-image: var(--alo-noise), radial-gradient(ellipse at 16% 0%, rgba(255,255,255,.5), transparent 62%);
}

/* Same switch as the rest of dsh: no second theme state to keep in sync. */
body[data-ds-dark-theme] .alo-root {
  --alo-desk: #6f6558;
  --alo-paper: #f5efe4;
  --alo-ink: #302a23;
  --alo-muted: #595245;
  --alo-faint: #696154;
  --alo-line: #cdbfaa;
  --alo-line-strong: #a69880;
  --alo-hover: #e6ded0;
  --alo-accent: #44526a;
  --alo-accent-soft: #d6dce3;
  --alo-warn: #7a4423;
  --alo-warn-soft: #e8d4b6;
  --alo-ok: #325843;
  --alo-ok-soft: #d2dcca;
  --alo-bad: #81423a;
  --alo-bad-soft: #e9cfc2;
  --alo-desk-ink: #fff9ef;
  --alo-desk-muted: #f2ebe0;
  --alo-desk-link: #e8eeff;
  --alo-metal-hi: #a09484;
  --alo-metal-lo: #60564a;
}

/* Reset only what each control needs. A blanket color: inherit on buttons has a
   higher specificity than a single class and would repaint the ink chip's label. */
.alo-root button, .alo-root input, .alo-root select, .alo-root textarea { font: inherit; }
.alo-root input, .alo-root select, .alo-root textarea { color: inherit; }
.alo-root button { cursor: pointer; touch-action: manipulation; }
.alo-root a { color: var(--alo-accent); text-decoration: none; }
.alo-root a:hover { text-decoration: underline; }
.alo-root button:focus-visible, .alo-root a:focus-visible, .alo-root input:focus-visible,
.alo-root select:focus-visible, .alo-root textarea:focus-visible {
  outline: 2px solid var(--alo-accent); outline-offset: 3px; box-shadow: 0 0 0 2px var(--alo-paper);
}
.alo-root * { box-sizing: border-box; }

/* Header: the desk's own colour, type only, so the paper below reads as content. */
.alo-head { display: flex; align-items: center; gap: 12px; padding: 14px 24px 10px; flex-wrap: wrap; color: var(--alo-desk-ink); }
.alo-head h2 { margin: 0; font-size: 15px; font-weight: 600; letter-spacing: .02em; }
.alo-head .alo-spacer { flex: 1; }
.alo-head .alo-actions { display: flex; align-items: center; gap: 8px; }
.alo-tabs { display: flex; gap: 4px; overflow-x: auto; padding: 0 0 2px; scrollbar-width: thin; }
.alo-tab {
  border: 0; background: transparent; color: var(--alo-desk-muted);
  padding: 6px 10px; border-radius: 6px; font-size: 13px; white-space: nowrap;
}
/* Tabs read as flat chips drawn on the desk: a hover tint, and ink plus weight
   when selected, so nothing has to be painted on top of the paper. */
.alo-tab:hover { background: rgba(127, 110, 82, .16); color: var(--alo-desk-ink); }
.alo-tab[aria-selected="true"] { background: rgba(127, 110, 82, .22); color: var(--alo-desk-ink); font-weight: 500; }
body[data-ds-dark-theme] .alo-root .alo-tab:hover,
body[data-ds-dark-theme] .alo-root .alo-tab[aria-selected="true"] { background: rgba(255, 249, 239, .18); color: var(--alo-desk-ink); }
.alo-tab .alo-count { margin-left: 4px; font-size: 11px; color: var(--alo-warn); font-variant-numeric: tabular-nums; }

.alo-body { flex: 1; min-height: 0; overflow: auto; padding: 0 24px 24px; overscroll-behavior: contain; }
.alo-view { max-width: 1180px; margin: 0 auto; }

/* Paper: one ruled page per block, no card-in-card. */
.alo-card {
  position: relative; margin-bottom: 14px; padding: 16px 18px;
  border: 1px solid var(--alo-line); border-radius: 5px;
  background-color: var(--alo-paper);
  background-image: var(--alo-noise), repeating-linear-gradient(0deg, transparent 0 27px, rgba(91,113,116,.055) 27px 28px);
  box-shadow: inset 0 1px rgba(255,255,255,.7), 0 1px 0 rgba(60,48,30,.10), 0 10px 22px rgba(43,39,28,.13);
}
.alo-card > h3, .alo-section-title { margin: 0 0 8px; font-size: 14px; font-weight: 600; letter-spacing: .02em; }
.alo-section { margin-bottom: 20px; }
.alo-section-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: 0 0 8px; color: var(--alo-desk-ink); }
.alo-section-meta { margin-left: 8px; color: var(--alo-desk-muted); font-size: 12px; font-weight: 400; }

.alo-hero { margin: 4px 0 6px; color: var(--alo-desk-ink); font-size: 23px; font-weight: 600; line-height: 1.42; letter-spacing: .01em; text-wrap: balance; text-shadow: 0 1px rgba(255,255,255,.28); }
body[data-ds-dark-theme] .alo-root .alo-hero { text-shadow: 0 1px rgba(0,0,0,.35); }
.alo-root .alo-head h2, body[data-ds-dark-theme] .alo-root .alo-head h2 { color: var(--alo-desk-ink); }
body[data-ds-dark-theme] .alo-root .alo-section-title { color: var(--alo-desk-ink); }
.alo-hero-sub { margin: 0 0 22px; color: var(--alo-desk-muted); font-size: 13px; }
.alo-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 10px; }
.alo-stat { padding: 10px 12px; border: 1px solid var(--alo-line); border-radius: 4px; background: rgba(255,255,255,.35); }
.alo-stat-label { font-size: 12px; color: var(--alo-muted); margin-bottom: 2px; }
.alo-stat-value { font-size: 22px; font-weight: 600; font-variant-numeric: tabular-nums; }
.alo-stat-note { font-size: 11px; color: var(--alo-muted); margin-top: 2px; }

.alo-row { display: flex; align-items: center; gap: 8px; min-width: 0; }
.alo-wrap { flex-wrap: wrap; }
.alo-between { justify-content: space-between; }
.alo-muted { color: var(--alo-muted); }
.alo-faint { color: var(--alo-faint); }
.alo-small { font-size: 12px; }
.alo-mono { font-family: var(--alo-mono); font-size: 12px; font-variant-numeric: tabular-nums; }
.alo-sr { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }

.alo-table { width: 100%; border-collapse: collapse; }
.alo-table th, .alo-table td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--alo-line); vertical-align: middle; }
.alo-table th { color: var(--alo-muted); font-weight: 500; font-size: 12px; white-space: nowrap; }
.alo-table td.alo-num, .alo-table th.alo-num { text-align: right; font-variant-numeric: tabular-nums; }
.alo-table tbody tr:last-child td { border-bottom: 0; }
.alo-table tbody tr:hover td { background: var(--alo-hover); }
.alo-cell-main { max-width: 340px; }
.alo-cell-title { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.alo-cell-sub { display: block; margin-top: 2px; color: var(--alo-muted); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.alo-badge { display: inline-block; padding: 0 7px; border: 1px solid var(--alo-line-strong); border-radius: 3px; font-size: 11px; white-space: nowrap; }
.alo-badge-open { border-color: var(--alo-warn); color: var(--alo-warn); background: var(--alo-warn-soft); }
.alo-badge-running { border-color: var(--alo-accent); color: var(--alo-accent); background: var(--alo-accent-soft); }
.alo-badge-done { color: var(--alo-muted); }
.alo-badge-bad { border-color: var(--alo-bad); color: var(--alo-bad); background: var(--alo-bad-soft); }
.alo-dot { display: inline-block; width: 7px; height: 7px; margin-right: 5px; border-radius: 50%; vertical-align: 1px;
  background: radial-gradient(circle at 30% 24%, #fff 0 10%, #a2a79b 30%, #5c6458 74%); box-shadow: 0 1px 1px rgba(0,0,0,.18); }
.alo-dot-ok { background: radial-gradient(circle at 30% 24%, #eaffd9 0 9%, #6fa876 30%, #2c5139 78%); }
.alo-dot-warn { background: radial-gradient(circle at 30% 24%, #fff1c8 0 9%, #d58a42 32%, #87492a 80%); }
.alo-dot-bad { background: radial-gradient(circle at 30% 24%, #ffe2d5 0 9%, #c7725f 32%, #8f4a40 80%); }

/* Buttons: the preview's flat pair — a paper chip and an inked chip. No gradient,
   no inner highlight; the material lives on the desk and the paper, not on every
   control. Sizes, radii and hover all come from the same preview stylesheet. */
.alo-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 7px;
  min-height: 34px; padding: 6px 12px; border: 1px solid var(--alo-line-strong); border-radius: 7px;
  background: var(--alo-paper); color: var(--alo-ink);
  font-size: 13px; line-height: 1.4;
  transition: background-color 110ms ease, opacity 110ms ease, transform 110ms var(--alo-ease);
}
.alo-btn:hover:not(:disabled) { background: var(--alo-hover); }
.alo-btn:active:not(:disabled) { transform: translateY(1px); }
.alo-btn:disabled { opacity: .5; cursor: not-allowed; }
/* The ink chip keeps its light label through every state: the plain hover above
   must not repaint it with the paper's ink colour. */
.alo-btn-primary,
.alo-btn-primary:hover:not(:disabled),
.alo-btn-primary:active:not(:disabled),
.alo-btn-primary:focus-visible { background: var(--alo-button); border-color: var(--alo-button); color: var(--alo-button-text); }
.alo-btn-primary:hover:not(:disabled) { opacity: .88; }
.alo-btn-danger, .alo-btn-danger:hover:not(:disabled) { color: var(--alo-bad); }
.alo-btn-danger { color: var(--alo-bad); border-color: color-mix(in srgb, var(--alo-bad) 38%, var(--alo-line)); background: var(--alo-paper); }
.alo-btn-danger:hover:not(:disabled) { background: var(--alo-bad-soft); }
/* A quiet button is a text link that sits in a row of buttons. */
.alo-btn-quiet, .alo-btn-quiet:hover:not(:disabled) {
  border-color: transparent; background: none; color: var(--alo-accent); padding: 0; min-height: 0;
}
body[data-ds-dark-theme] .alo-root .alo-section-head .alo-btn-quiet,
body[data-ds-dark-theme] .alo-root .alo-section-head .alo-btn-quiet:hover:not(:disabled) { color: var(--alo-desk-link); }
.alo-btn-quiet:hover:not(:disabled) { text-decoration: underline; }
.alo-btn-small { min-height: 30px; padding: 4px 10px; font-size: 12px; }
.alo-btn-icon { width: 34px; padding: 0; }

.alo-input, .alo-textarea, .alo-select {
  width: 100%; min-height: 34px; padding: 6px 9px;
  border: 1px solid var(--alo-line-strong); border-radius: 4px;
  background-color: #faf6ee; color: var(--alo-ink); font-size: 13px;
  box-shadow: inset 0 2px 4px rgba(66,51,28,.16), inset 0 1px rgba(66,51,28,.12);
}
body[data-ds-dark-theme] .alo-root .alo-input,
body[data-ds-dark-theme] .alo-root .alo-textarea,
body[data-ds-dark-theme] .alo-root .alo-select { background-color: #f1ead9; }
.alo-textarea { min-height: 84px; resize: vertical; line-height: 1.7; }
.alo-input::placeholder, .alo-textarea::placeholder { color: var(--alo-faint); }
.alo-field { margin-bottom: 10px; }
.alo-field > label, .alo-field-label { display: block; margin-bottom: 4px; color: var(--alo-muted); font-size: 12px; }
.alo-chip {
  border: 1px solid var(--alo-line-strong); border-radius: 999px; padding: 2px 10px;
  background: transparent; color: var(--alo-muted); font-size: 12px;
}
.alo-chip[aria-pressed="true"] { border-color: var(--alo-accent); color: var(--alo-accent); background: var(--alo-accent-soft); }

.alo-error { color: var(--alo-bad); font-size: 12px; white-space: pre-wrap; }
.alo-nowrap { white-space: nowrap; }
.alo-status { display: inline-flex; align-items: center; gap: 5px; }
.alo-empty { padding: 26px 12px; text-align: center; color: var(--alo-muted); font-size: 13px; }
.alo-empty strong { display: block; margin-bottom: 2px; color: var(--alo-ink); font-weight: 500; }
.alo-list { list-style: none; margin: 0; padding: 0; }
.alo-list li { padding: 8px 0; border-bottom: 1px solid var(--alo-line); }
.alo-list li:last-child { border-bottom: 0; }
.alo-pager { display: flex; justify-content: center; padding: 8px 0; }
.alo-timeline { margin: 0; padding-left: 18px; color: var(--alo-muted); font-size: 12px; }
.alo-check-ok { color: var(--alo-ok); }
.alo-check-bad { color: var(--alo-bad); }
.alo-log {
  max-height: 240px; overflow: auto; margin: 0; padding: 8px;
  border: 1px solid var(--alo-line); border-radius: 4px; background: #f3ecdd;
  font-family: var(--alo-mono); font-size: 11px; white-space: pre-wrap;
  box-shadow: inset 0 2px 4px rgba(66,51,28,.12);
}
.alo-confirm {
  margin-top: 8px; padding: 14px 16px; border: 1px dashed var(--alo-warn); border-left: 3px solid var(--alo-warn);
  border-radius: 4px; background: var(--alo-warn-soft);
}
.alo-confirm pre { margin: 0 0 8px; white-space: pre-wrap; font-family: inherit; font-size: 12px; }
.alo-icon-wrap { position: relative; display: inline-flex; }
.alo-icon { display: inline-flex; align-items: center; justify-content: center; }
.alo-icon svg { display: block; }
.alo-nav-badge {
  position: absolute; top: -3px; right: -5px; min-width: 15px; height: 15px; padding: 0 3px;
  border: 1px solid #673818; border-radius: 8px; background: #a05a2c; color: #fff1d5;
  font-size: 9px; line-height: 13px; text-align: center; font-variant-numeric: tabular-nums;
}
.alo-search { position: relative; flex: 1; min-width: 200px; max-width: 340px; }
.alo-search .alo-input { padding-left: 32px; }
.alo-search > svg { position: absolute; left: 9px; top: 9px; color: var(--alo-faint); }
.alo-filters { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-bottom: 10px; }
.alo-filters .alo-select { width: auto; min-width: 120px; }
.alo-meta { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 8px 16px; }
.alo-meta-label { display: block; color: var(--alo-muted); font-size: 11px; }
.alo-meta-value { display: block; margin-top: 1px; overflow-wrap: anywhere; }
.alo-split { display: grid; grid-template-columns: minmax(220px, 300px) minmax(0, 1fr); gap: 14px; align-items: start; }
.alo-split > * { min-width: 0; }

@media (max-width: 900px) {
  .alo-split { grid-template-columns: 1fr; }
}
@media (max-width: 640px) {
  .alo-head { padding: 12px 14px 8px; }
  .alo-body { padding: 0 14px 16px; }
  .alo-card { padding: 14px; }
  .alo-table { min-width: 560px; }
  .alo-card .alo-scroll { overflow-x: auto; }
  .alo-search { max-width: none; flex-basis: 100%; }
}
@media (prefers-reduced-motion: reduce) {
  .alo-root *, .alo-root *::before, .alo-root *::after { animation: none !important; transition: none !important; scroll-behavior: auto !important; }
  .alo-btn:active:not(:disabled) { transform: none; }
}
`

/** Put the stylesheet in the document once; a second call is a no-op after HMR. */
export function injectStyles(): void {
  if (typeof document === 'undefined') return
  const previous = document.getElementById(TAG_ID)
  if (previous !== null) previous.remove()
  const tag = document.createElement('style')
  tag.id = TAG_ID
  tag.textContent = CSS
  document.head.appendChild(tag)
}

export { TAG_ID }
