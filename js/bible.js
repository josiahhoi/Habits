// Logic over the versification dataset: range normalization, formatting,
// and Greek NT coverage/progress computation.

import { BOOKS, NA_OMISSIONS } from './bible-data.js';

export const byAbbrev = Object.fromEntries(BOOKS.map((b) => [b.abbrev, b]));
export const NT_BOOKS = BOOKS.filter((b) => b.testament === 'NT');
export const OT_BOOKS = BOOKS.filter((b) => b.testament === 'OT');

// "Matt:17" -> Set of omitted verse numbers (absent from NA28)
const omitted = {};
for (const o of NA_OMISSIONS) {
  const k = `${o.abbrev}:${o.chapter}`;
  (omitted[k] ||= new Set()).add(o.verse);
}

export function omittedIn(abbrev, chapter) {
  return omitted[`${abbrev}:${chapter}`] || null;
}

export function isOmitted(abbrev, chapter, verse) {
  const s = omitted[`${abbrev}:${chapter}`];
  return s ? s.has(verse) : false;
}

export function maxVerse(abbrev, chapter) {
  const b = byAbbrev[abbrev];
  return b ? (b.chapters[chapter - 1] || 0) : 0;
}

export function languageOf(abbrev) {
  const b = byAbbrev[abbrev];
  return b ? (b.testament === 'NT' ? 'Greek' : 'Hebrew') : '';
}

// Countable verses in a chapter (denominator for GNT progress):
// max verse number minus verses absent from NA28.
export function countableVerses(abbrev, chapter) {
  const m = maxVerse(abbrev, chapter);
  const om = omittedIn(abbrev, chapter);
  return m - (om ? om.size : 0);
}

// Clamp and order a raw range so it is always valid against the dataset.
export function normalizeRange(r) {
  const b = byAbbrev[r.b];
  if (!b) return null;
  const nch = b.chapters.length;
  let c1 = Math.min(Math.max(1, r.c1 | 0), nch);
  let c2 = Math.min(Math.max(1, r.c2 | 0), nch);
  let rv1 = r.v1 | 0;
  let rv2 = r.v2 | 0;
  // Swap the verses together with their chapters, or each verse gets clamped
  // against the wrong chapter's maximum.
  if (c2 < c1) {
    [c1, c2] = [c2, c1];
    [rv1, rv2] = [rv2, rv1];
  }
  let v1 = Math.min(Math.max(1, rv1), maxVerse(r.b, c1));
  let v2 = Math.min(Math.max(1, rv2), maxVerse(r.b, c2));
  if (c1 === c2 && v2 < v1) [v1, v2] = [v2, v1];
  return { b: r.b, c1, v1, c2, v2 };
}

// Expand a (possibly multi-chapter) range into per-chapter {ch, from, to} pieces.
export function chapterPieces(range) {
  const r = normalizeRange(range);
  if (!r) return [];
  const out = [];
  for (let ch = r.c1; ch <= r.c2; ch++) {
    const from = ch === r.c1 ? r.v1 : 1;
    const to = ch === r.c2 ? r.v2 : maxVerse(r.b, ch);
    if (from <= to) out.push({ ch, from, to });
  }
  return out;
}

export function formatRange(r) {
  const b = byAbbrev[r.b];
  if (!b) return '?';
  const name = b.name;
  const wholeFrom = r.v1 === 1;
  const wholeTo = r.v2 === maxVerse(r.b, r.c2);
  if (r.c1 === r.c2) {
    if (wholeFrom && wholeTo) return `${name} ${r.c1}`;
    if (r.v1 === r.v2) return `${name} ${r.c1}:${r.v1}`;
    return `${name} ${r.c1}:${r.v1}–${r.v2}`;
  }
  if (wholeFrom && wholeTo) return `${name} ${r.c1}–${r.c2}`;
  return `${name} ${r.c1}:${r.v1}–${r.c2}:${r.v2}`;
}

// ---------- Greek NT coverage ----------

// Build per-book, per-chapter boolean coverage from all dated readings + backfill.
// Returns { [abbrev]: Uint8Array[] } where cov[abbrev][chIdx][verseIdx-?]... we use
// cov[abbrev][chIdx] as a Uint8Array of length maxVerse(ch), 1 = read.
export function buildCoverage(stateDays, backfillRanges) {
  const cov = {};
  const mark = (range) => {
    const book = byAbbrev[range.b];
    if (!book || book.testament !== 'NT') return;
    if (!cov[range.b]) cov[range.b] = book.chapters.map((m) => new Uint8Array(m));
    for (const p of chapterPieces(range)) {
      const arr = cov[range.b][p.ch - 1];
      for (let v = p.from; v <= p.to; v++) arr[v - 1] = 1;
    }
  };
  for (const d of Object.values(stateDays)) {
    for (const r of d.readings || []) mark(r);
  }
  for (const r of backfillRanges || []) mark(r);
  return cov;
}

export function chapterStats(cov, abbrev, chapter) {
  const total = countableVerses(abbrev, chapter);
  const arr = cov[abbrev] && cov[abbrev][chapter - 1];
  let read = 0;
  if (arr) {
    const om = omittedIn(abbrev, chapter);
    for (let v = 1; v <= arr.length; v++) {
      if (arr[v - 1] && !(om && om.has(v))) read++;
    }
  }
  return { read, total };
}

export function gntStats(cov) {
  let total = 0;
  let read = 0;
  const perBook = [];
  for (const book of NT_BOOKS) {
    let bTotal = 0;
    let bRead = 0;
    const perChapter = [];
    for (let ch = 1; ch <= book.chapters.length; ch++) {
      const st = chapterStats(cov, book.abbrev, ch);
      perChapter.push(st);
      bTotal += st.total;
      bRead += st.read;
    }
    perBook.push({ abbrev: book.abbrev, name: book.name, read: bRead, total: bTotal, perChapter });
    total += bTotal;
    read += bRead;
  }
  return { read, total, perBook };
}
