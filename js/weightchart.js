// Weight trend chart: dependency-free inline SVG, same hand-rolled approach as
// the calendar heatmap. Daily weight is noisy, so the 7-day rolling average is
// the primary mark and the raw daily series is secondary — same hue, lighter
// step, because they are the same measurement rather than two categories.

import { parseDate, dateStr, fmtWeight, toDisplayWeight, debounce } from './util.js';
import { showTooltip, hideTooltip } from './heatmap.js';

const DAY_MS = 86400000;

// Consecutive entries further apart than this leave a gap in the raw line
// rather than drawing a straight segment through days you never weighed in.
// Skipping a day or two still connects, so ordinary use doesn't fragment.
const GAP_DAYS = 4;

/**
 * Rolling mean over a trailing calendar window (not "previous N entries"), so
 * gaps in logging don't distort the average.
 * points: [{ t, v }] sorted by t. Returns the same length, each with .avg.
 */
export function rollingAverage(points, windowDays = 7) {
  const span = windowDays * DAY_MS;
  return points.map((p) => {
    let sum = 0;
    let n = 0;
    for (const q of points) {
      if (q.t > p.t) break;
      if (q.t > p.t - span) {
        sum += q.v;
        n++;
      }
    }
    return { ...p, avg: n ? sum / n : p.v };
  });
}

// Clean axis steps: 1/2/2.5/5 x powers of ten, whichever yields ~4-5 ticks.
function niceTicks(min, max, target = 5) {
  const span = Math.max(max - min, 1e-6);
  const raw = span / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || 10 * mag;
  const first = Math.ceil(min / step) * step;
  const ticks = [];
  for (let v = first; v <= max + step * 0.001; v += step) ticks.push(Math.round(v * 1000) / 1000);
  return ticks;
}

function xTickFormat(spanMs) {
  if (spanMs <= 100 * DAY_MS) return (d) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  if (spanMs <= 800 * DAY_MS) return (d) => d.toLocaleDateString(undefined, { month: 'short' });
  return (d) => String(d.getFullYear());
}

function path(points, key) {
  return points.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p[key].toFixed(1)}`).join(' ');
}

/**
 * Render into `container`.
 * opts:
 *   series   — [{ date, kg }] chronological (already range-filtered)
 *   unit     — 'lb' | 'kg'
 *   goalKg   — number | null
 *   compact  — sparkline mode: no axes/legend/hover, just the trend
 *   height   — px (defaults 260 full / 52 compact)
 */
export function renderWeightChart(container, opts) {
  const draw = () => drawChart(container, opts);
  draw();

  // Re-render on width changes only; height changes are our own output and
  // would otherwise feed back into the observer.
  if (container._weightObserver) container._weightObserver.disconnect();
  let lastWidth = container.clientWidth;

  // First paint can measure before layout settles (e.g. loading straight into
  // #weight), which would leave the chart drawn at the wrong width until
  // something else resizes it. Re-check on the next frame.
  requestAnimationFrame(() => {
    if (container.isConnected && container.clientWidth !== lastWidth) {
      lastWidth = container.clientWidth;
      draw();
    }
  });
  const onResize = debounce(() => {
    if (Math.abs(container.clientWidth - lastWidth) < 4) return;
    lastWidth = container.clientWidth;
    draw();
  }, 150);
  const ro = new ResizeObserver(onResize);
  ro.observe(container);
  container._weightObserver = ro;
}

function drawChart(container, { series, unit, goalKg = null, compact = false, height }) {
  const H = height || (compact ? 52 : 260);
  const W = Math.max(container.clientWidth || 320, 240);

  if (!series || series.length === 0) {
    container.innerHTML = compact
      ? '<div class="small muted">No weight logged yet.</div>'
      : '<div class="chart-empty">No weight logged yet — add today\'s weight above and the trend appears here.</div>';
    return;
  }

  // Work entirely in display units from here: axis ticks must be clean numbers
  // in the unit actually shown, not in canonical kilograms.
  const pts = rollingAverage(
    series.map((p) => ({ t: parseDate(p.date).getTime(), v: toDisplayWeight(p.kg, unit), date: p.date })),
  );
  const goal = goalKg == null ? null : toDisplayWeight(goalKg, unit);

  const M = compact
    ? { top: 4, right: 4, bottom: 4, left: 4 }
    : { top: 12, right: 52, bottom: 26, left: 46 };
  const plotW = Math.max(W - M.left - M.right, 10);
  const plotH = Math.max(H - M.top - M.bottom, 10);

  const tMin = pts[0].t;
  const tMax = pts[pts.length - 1].t;
  const tSpan = Math.max(tMax - tMin, DAY_MS);
  const xOf = (t) => M.left + ((t - tMin) / tSpan) * plotW;

  // Weight sits in a narrow band, so the y domain is data-driven, not
  // zero-based — a zero baseline would flatten the trend into a flat line.
  // (Bars would still require zero; this is a line chart.)
  const values = pts.flatMap((p) => [p.v, p.avg]);
  if (goal != null) values.push(goal);
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  const pad = Math.max((hi - lo) * 0.12, unit === 'kg' ? 0.5 : 1);
  lo -= pad;
  hi += pad;
  const yOf = (v) => M.top + plotH - ((v - lo) / (hi - lo)) * plotH;

  const parts = [];
  const latest = pts[pts.length - 1];
  const label = `Weight trend: ${pts.length} entries, latest ${latest.v.toFixed(1)} ${unit}`;
  parts.push(`<svg class="wc-svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${label}">`);

  if (!compact) {
    const yTicks = niceTicks(lo, hi);
    for (const v of yTicks) {
      const y = yOf(v);
      parts.push(`<line class="wc-grid" x1="${M.left}" y1="${y.toFixed(1)}" x2="${M.left + plotW}" y2="${y.toFixed(1)}"></line>`);
      parts.push(`<text class="wc-axis" x="${M.left - 7}" y="${(y + 3.5).toFixed(1)}" text-anchor="end">${v}</text>`);
    }
    const fmtX = xTickFormat(tSpan);
    const xTickCount = Math.max(2, Math.min(5, Math.floor(plotW / 80)));
    const seen = new Set();
    for (let i = 0; i < xTickCount; i++) {
      const t = tMin + (tSpan * i) / (xTickCount - 1 || 1);
      const text = fmtX(new Date(t));
      if (seen.has(text)) continue;
      seen.add(text);
      const anchor = i === 0 ? 'start' : i === xTickCount - 1 ? 'end' : 'middle';
      parts.push(`<text class="wc-axis" x="${xOf(t).toFixed(1)}" y="${H - 8}" text-anchor="${anchor}">${text}</text>`);
    }
  }

  // Goal: an annotation, not a series — muted ink, so color stays reserved
  // for data.
  if (goal != null && !compact) {
    const gy = yOf(goal);
    parts.push(`<line class="wc-goal" x1="${M.left}" y1="${gy.toFixed(1)}" x2="${M.left + plotW}" y2="${gy.toFixed(1)}"></line>`);
    parts.push(`<text class="wc-goal-label" x="${M.left + plotW + 4}" y="${(gy + 3.5).toFixed(1)}">Goal</text>`);
  }

  const xy = pts.map((p) => ({ ...p, x: xOf(p.t), yv: yOf(p.v), ya: yOf(p.avg) }));

  if (!compact) {
    // Raw daily series, split at real gaps.
    let seg = [xy[0]];
    const segs = [];
    for (let i = 1; i < xy.length; i++) {
      if (xy[i].t - xy[i - 1].t > GAP_DAYS * DAY_MS) {
        segs.push(seg);
        seg = [];
      }
      seg.push(xy[i]);
    }
    segs.push(seg);
    for (const s of segs) {
      if (s.length > 1) parts.push(`<path class="wc-raw" d="${path(s, 'yv')}" fill="none"></path>`);
    }
    // Dots only when they can breathe; otherwise the line carries it.
    if (xy.length <= 70) {
      for (const p of xy) parts.push(`<circle class="wc-raw-dot" cx="${p.x.toFixed(1)}" cy="${p.yv.toFixed(1)}" r="2.5"></circle>`);
    }
  }

  parts.push(`<path class="wc-avg" d="${path(xy, 'ya')}" fill="none"></path>`);

  const end = xy[xy.length - 1];
  parts.push(`<circle class="wc-end" cx="${end.x.toFixed(1)}" cy="${end.ya.toFixed(1)}" r="4"></circle>`);
  if (!compact) {
    parts.push(`<text class="wc-endlabel" x="${Math.min(end.x + 9, W - 2)}" y="${(end.ya + 3.5).toFixed(1)}">${end.avg.toFixed(1)}</text>`);
    parts.push('<g class="wc-hover" hidden><line class="wc-crosshair" y1="0" y2="0"></line><circle class="wc-focus" r="4.5"></circle></g>');
    parts.push(`<rect class="wc-capture" x="${M.left}" y="${M.top}" width="${plotW}" height="${plotH}" fill="transparent"></rect>`);
  }
  parts.push('</svg>');
  container.innerHTML = parts.join('');

  if (compact) return;

  // Hover: snap to the nearest entry. Mouse/pen only — a touch tap fires no
  // leave event, so the crosshair would stick (same guard as the heatmap).
  const svg = container.querySelector('svg');
  const hover = svg.querySelector('.wc-hover');
  const crosshair = svg.querySelector('.wc-crosshair');
  const focus = svg.querySelector('.wc-focus');
  const capture = svg.querySelector('.wc-capture');

  const move = (e) => {
    if (e.pointerType === 'touch') return;
    const rect = svg.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    let best = xy[0];
    for (const p of xy) {
      if (Math.abs(p.x - px) < Math.abs(best.x - px)) best = p;
    }
    // `hidden` is an HTMLElement property — assigning it on an SVG element sets
    // a useless expando, so toggle the attribute directly.
    hover.removeAttribute('hidden');
    crosshair.setAttribute('x1', best.x.toFixed(1));
    crosshair.setAttribute('x2', best.x.toFixed(1));
    crosshair.setAttribute('y1', M.top);
    crosshair.setAttribute('y2', M.top + plotH);
    focus.setAttribute('cx', best.x.toFixed(1));
    focus.setAttribute('cy', best.yv.toFixed(1));
    const d = parseDate(best.date);
    showTooltip(
      `<b>${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</b><br>` +
        `${best.v.toFixed(1)} ${unit}<br><span style="opacity:.8">7-day avg ${best.avg.toFixed(1)} ${unit}</span>`,
      e.clientX,
      e.clientY,
    );
  };
  capture.addEventListener('pointermove', move);
  capture.addEventListener('pointerdown', move);
  capture.addEventListener('pointerleave', () => {
    hover.setAttribute('hidden', '');
    hideTooltip();
  });
}

// Filter a series to a trailing window; `days` of null means everything.
export function withinRange(series, days) {
  if (!days) return series;
  const cutoff = dateStr(new Date(Date.now() - days * DAY_MS));
  return series.filter((p) => p.date >= cutoff);
}

// Latest entry, plus the change since the entry closest to `daysAgo` back.
export function changeOver(series, daysAgo) {
  if (series.length < 2) return null;
  const latest = series[series.length - 1];
  const target = parseDate(latest.date).getTime() - daysAgo * DAY_MS;
  let ref = null;
  for (const p of series) {
    const t = parseDate(p.date).getTime();
    if (t <= target) ref = p;
    else break;
  }
  if (!ref) return null;
  return latest.kg - ref.kg;
}

export { fmtWeight };
