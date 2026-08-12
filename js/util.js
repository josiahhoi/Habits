// Small shared helpers. All date handling is in LOCAL time on purpose —
// a habit day is the user's calendar day, never UTC.

export const pad2 = (n) => String(n).padStart(2, '0');

export function dateStr(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function todayStr() {
  return dateStr(new Date());
}

export function parseDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(s, n) {
  const d = parseDate(s);
  d.setDate(d.getDate() + n);
  return dateStr(d);
}

export function fmtDateLong(s) {
  return parseDate(s).toLocaleDateString(undefined, {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
}

export function fmtDateShort(s) {
  return parseDate(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function esc(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export function debounce(fn, ms) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

export function download(filename, text) {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------- Weight: canonical kilograms in, display units out ----------

export const KG_PER_LB = 0.45359237;

export function toDisplayWeight(kg, unit) {
  if (kg == null) return null;
  return unit === 'kg' ? kg : kg / KG_PER_LB;
}

export function fromDisplayWeight(value, unit) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return unit === 'kg' ? n : n * KG_PER_LB;
}

// One decimal everywhere, so an lb -> kg -> lb round-trip never surfaces
// float noise like 182.40000000000003.
export function fmtWeight(kg, unit, { withUnit = true } = {}) {
  const v = toDisplayWeight(kg, unit);
  if (v == null) return '—';
  return `${v.toFixed(1)}${withUnit ? ` ${unit}` : ''}`;
}

export function fmtWeightDelta(kg, unit) {
  const v = toDisplayWeight(kg, unit);
  if (v == null) return '';
  const sign = v > 0 ? '+' : v < 0 ? '−' : '';
  return `${sign}${Math.abs(v).toFixed(1)} ${unit}`;
}

export function fmtMins(mins) {
  const m = Math.round(Number(mins) || 0);
  const h = Math.floor(m / 60);
  return h > 0 ? `${h}h ${m % 60}m` : `${m}m`;
}

