// GitHub-style calendar heatmap, rendered as inline SVG.
// One delegated listener set per heatmap; a single shared tooltip div.

import { dateStr, parseDate, todayStr } from './util.js';

const CELL = 12;
const GAP = 3;
const STEP = CELL + GAP;
const LEFT = 30;   // weekday label gutter
const TOP = 16;    // month label row

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = [{ i: 1, t: 'Mon' }, { i: 3, t: 'Wed' }, { i: 5, t: 'Fri' }];

const tooltip = () => document.getElementById('tooltip');

// Any tap/click outside a heatmap cell dismisses a lingering tooltip.
document.addEventListener('pointerdown', (e) => {
  if (!e.target.closest?.('.hm-cell')) hideTooltip();
}, true);

export function showTooltip(html, x, y) {
  const t = tooltip();
  if (!t) return;
  t.innerHTML = html;
  t.hidden = false;
  const r = t.getBoundingClientRect();
  let left = x + 12;
  let top = y - r.height - 10;
  if (left + r.width > window.innerWidth - 8) left = x - r.width - 12;
  if (left < 8) left = 8;
  if (top < 8) top = y + 16;
  t.style.left = `${left}px`;
  t.style.top = `${top}px`;
}

export function hideTooltip() {
  const t = tooltip();
  if (t) t.hidden = true;
}

/**
 * Render a year heatmap into `container`.
 * opts:
 *   year        — calendar year to draw
 *   classFor    — (dateStr) => extra class string for the cell ('', 'q1'..'q3', 's1'..'s8')
 *   tooltipFor  — (dateStr) => html string for the tooltip
 *   onDayClick  — (dateStr) => void
 */
export function renderHeatmap(container, { year, classFor, tooltipFor, onDayClick }) {
  const today = todayStr();
  const jan1 = new Date(year, 0, 1);
  const dec31 = new Date(year, 11, 31);
  const startDow = jan1.getDay(); // 0 = Sunday
  const totalDays = Math.round((dec31 - jan1) / 86400000) + 1;
  const weeks = Math.ceil((startDow + totalDays) / 7);
  const width = LEFT + weeks * STEP;
  const height = TOP + 7 * STEP;

  const parts = [];
  parts.push(`<svg class="hm-svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Activity heatmap for ${year}">`);

  // month labels: at the first week that contains the 1st of the month
  let lastLabelX = -100;
  for (let m = 0; m < 12; m++) {
    const first = new Date(year, m, 1);
    const idx = startDow + Math.round((first - jan1) / 86400000);
    const x = LEFT + Math.floor(idx / 7) * STEP;
    if (x - lastLabelX >= 28) {
      parts.push(`<text x="${x}" y="10">${MONTHS[m]}</text>`);
      lastLabelX = x;
    }
  }
  for (const d of DOW) {
    parts.push(`<text x="0" y="${TOP + d.i * STEP + CELL - 2.5}">${d.t}</text>`);
  }

  const cur = new Date(year, 0, 1);
  for (let i = 0; i < totalDays; i++) {
    const ds = dateStr(cur);
    const idx = startDow + i;
    const x = LEFT + Math.floor(idx / 7) * STEP;
    const y = TOP + (idx % 7) * STEP;
    let cls = 'hm-cell';
    const extra = classFor(ds);
    if (extra) cls += ` ${extra}`;
    // A synced day can legitimately sit ahead of this device's local date
    // (other timezone); keep it clickable — only empty future cells are inert.
    if (ds > today && !extra) cls += ' future';
    if (ds === today) cls += ' today-ring';
    parts.push(`<rect class="${cls}" data-date="${ds}" x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="3"></rect>`);
    cur.setDate(cur.getDate() + 1);
  }
  parts.push('</svg>');

  container.innerHTML = `<div class="hm-scroll">${parts.join('')}</div>`;
  const scroller = container.firstElementChild;
  const svg = scroller.firstElementChild;

  // Hover tooltips are mouse/pen only — a touch tap has no "leave" event, so
  // the tooltip would stick; on touch, the tap opens the day panel instead.
  svg.addEventListener('pointerover', (e) => {
    if (e.pointerType === 'touch') return;
    const cell = e.target.closest('.hm-cell');
    if (!cell || cell.classList.contains('future')) return;
    showTooltip(tooltipFor(cell.dataset.date), e.clientX, e.clientY);
  });
  svg.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return;
    const cell = e.target.closest('.hm-cell');
    if (cell && !cell.classList.contains('future')) showTooltip(tooltipFor(cell.dataset.date), e.clientX, e.clientY);
  });
  svg.addEventListener('pointerleave', hideTooltip);
  svg.addEventListener('click', (e) => {
    const cell = e.target.closest('.hm-cell');
    if (!cell || cell.classList.contains('future')) return;
    hideTooltip();
    onDayClick?.(cell.dataset.date);
  });

  // Scroll current year to "now", others to the start
  if (year === parseDate(today).getFullYear()) {
    const idx = startDow + Math.round((parseDate(today) - jan1) / 86400000);
    const x = LEFT + Math.floor(idx / 7) * STEP;
    scroller.scrollLeft = Math.max(0, x - scroller.clientWidth + 80);
  }
}
