// Greek New Testament progress tab: hero %, per-book meters, chapter grid,
// verse-level detail, and "previously read" backfill management.

import * as store from './store.js';
import { esc } from './util.js';
import {
  NT_BOOKS, byAbbrev, buildCoverage, gntStats, chapterStats,
  maxVerse, omittedIn, formatRange,
} from './bible.js';
import { passageFormHtml, wirePassageForm } from './daypanel.js';

let expandedBook = null;    // abbrev
let expandedChapter = null; // number

function pct(read, total) {
  if (!total) return '0%';
  const p = (read / total) * 100;
  if (p > 0 && p < 1) return '<1%';
  if (p > 99 && p < 100) return '>99%';
  return `${Math.round(p)}%`;
}

function fracClass(read, total) {
  if (!total || read === 0) return '';
  const f = read / total;
  if (f >= 1) return 'q3';
  if (f >= 0.5) return 'q2';
  return 'q1';
}

export function renderGnt(root) {
  const s = store.getState();
  const cov = buildCoverage(s.days, s.backfill.ranges);
  const stats = gntStats(cov);
  const overall = stats.total ? (stats.read / stats.total) * 100 : 0;
  // Never round a not-quite-finished GNT up to "100.0%" — 7,938/7,941 is not done.
  let heroPct = overall.toFixed(1);
  if (heroPct === '100.0' && stats.read < stats.total) heroPct = '99.9';

  const bookRows = stats.perBook.map((b) => {
    const open = expandedBook === b.abbrev;
    const row = `
      <button class="book-row" data-book="${b.abbrev}" aria-expanded="${open}">
        <span class="bname">${esc(b.name)}</span>
        <span class="meter"><i style="width:${b.total ? (b.read / b.total) * 100 : 0}%"></i></span>
        <span class="bpct"><b>${pct(b.read, b.total)}</b> · ${b.read}/${b.total}</span>
      </button>`;
    return row + (open ? bookDetailHtml(b, cov) : '');
  }).join('');

  const backfillHtml = s.backfill.ranges.length
    ? s.backfill.ranges.map((r, i) => `
        <div class="backfill-item">
          <span>${esc(formatRange(r))}</span>
          <button class="iconbtn" data-del-backfill="${i}" aria-label="Remove ${esc(formatRange(r))}">✕</button>
        </div>`).join('')
    : '<div class="small muted">Nothing marked yet. Use “Mark as previously read” below, or the chapter grids above.</div>';

  root.innerHTML = `
    <div class="card">
      <h2>Greek New Testament</h2>
      <div class="hero">
        <div class="hero-number">${heroPct}%<small> · ${stats.read.toLocaleString()} of ${stats.total.toLocaleString()} verses</small></div>
        <div class="meter thick" role="progressbar" aria-valuenow="${heroPct}" aria-valuemin="0" aria-valuemax="100" aria-label="Greek NT progress"><i style="width:${overall}%"></i></div>
        <div class="sub">Counted against the NA28 text (verses absent from NA28 are excluded). Progress combines your dated reading log with passages marked as previously read.</div>
      </div>
    </div>

    <div class="card">
      <h2>Books</h2>
      <div>${bookRows}</div>
    </div>

    <div class="card">
      <h2>Previously read (no date)</h2>
      <p class="sub">Already read parts of the GNT before you started tracking? Add them here — they count toward progress but not toward the habit heatmap.</p>
      ${passageFormHtml('bf')}
      <div class="backfill-list" style="margin-top:12px">${backfillHtml}</div>
    </div>`;

  for (const btn of root.querySelectorAll('.book-row')) {
    btn.addEventListener('click', () => {
      const b = btn.dataset.book;
      expandedBook = expandedBook === b ? null : b;
      expandedChapter = null;
      renderGnt(root);
    });
  }
  for (const btn of root.querySelectorAll('.ch-cell')) {
    btn.addEventListener('click', () => {
      const ch = Number(btn.dataset.ch);
      expandedChapter = expandedChapter === ch ? null : ch;
      renderGnt(root);
    });
  }
  root.querySelector('[data-mark-chapter]')?.addEventListener('click', (e) => {
    const [b, ch] = e.currentTarget.dataset.markChapter.split(':');
    store.addBackfill({ b, c1: Number(ch), v1: 1, c2: Number(ch), v2: maxVerse(b, Number(ch)) });
    renderGnt(root);
  });
  root.querySelector('[data-mark-book]')?.addEventListener('click', (e) => {
    const b = e.currentTarget.dataset.markBook;
    const book = byAbbrev[b];
    store.addBackfill({ b, c1: 1, v1: 1, c2: book.chapters.length, v2: maxVerse(b, book.chapters.length) });
    renderGnt(root);
  });
  for (const btn of root.querySelectorAll('[data-del-backfill]')) {
    btn.addEventListener('click', () => {
      store.removeBackfill(Number(btn.dataset.delBackfill));
      renderGnt(root);
    });
  }

  const bfForm = root.querySelector('#bf-book');
  if (bfForm) {
    const getRange = wirePassageForm(root, { book: 'bf-book', c1: 'bf-c1', v1: 'bf-v1', c2: 'bf-c2', v2: 'bf-v2' });
    bfForm.dispatchEvent(new Event('change'));
    root.querySelector('#bf-add').textContent = 'Mark as previously read';
    root.querySelector('#bf-add').addEventListener('click', () => {
      const r = getRange();
      if (r) {
        if (byAbbrev[r.b].testament !== 'NT') {
          alert('Backfill currently tracks the Greek New Testament — pick a NT book.');
          return;
        }
        store.addBackfill(r);
        renderGnt(root);
      }
    });
  }
}

function bookDetailHtml(bookStats, cov) {
  const b = bookStats.abbrev;
  const book = byAbbrev[b];
  const cells = book.chapters.map((_, i) => {
    const ch = i + 1;
    const st = bookStats.perChapter[i];
    const cls = fracClass(st.read, st.total);
    const open = expandedChapter === ch ? ' is-open' : '';
    return `<button class="ch-cell ${cls}${open}" data-ch="${ch}" aria-label="${esc(book.name)} ${ch}: ${st.read} of ${st.total} verses read">${ch}</button>`;
  }).join('');

  let versePanel = '';
  if (expandedChapter && expandedChapter <= book.chapters.length) {
    versePanel = versePanelHtml(b, expandedChapter, cov);
  }

  const complete = bookStats.read >= bookStats.total;
  return `
    <div class="book-detail">
      <div class="spread">
        <span class="small muted">Chapters — shading shows how much of each is read</span>
        ${complete ? '<span class="small" style="color:var(--good)">✓ Complete</span>' : `<button class="btn tiny" data-mark-book="${b}">Mark whole book read</button>`}
      </div>
      <div class="ch-grid">${cells}</div>
      ${versePanel}
    </div>`;
}

function versePanelHtml(b, ch, cov) {
  const book = byAbbrev[b];
  const max = maxVerse(b, ch);
  const om = omittedIn(b, ch);
  const arr = cov[b] && cov[b][ch - 1];
  const st = chapterStats(cov, b, ch);
  const chips = [];
  for (let v = 1; v <= max; v++) {
    if (om && om.has(v)) {
      chips.push(`<span class="v-chip omitted" title="Not in NA28">${v}</span>`);
    } else {
      const read = arr && arr[v - 1];
      chips.push(`<span class="v-chip ${read ? 'read' : ''}">${v}</span>`);
    }
  }
  const omNote = om && om.size
    ? `<div class="small muted">Struck-through verses are absent from NA28 and not counted.</div>`
    : '';
  return `
    <div class="verse-panel">
      <div class="spread">
        <b>${esc(book.name)} ${ch}</b>
        <span class="small muted">${st.read}/${st.total} verses</span>
      </div>
      <div class="verse-grid">${chips.join('')}</div>
      ${omNote}
      ${st.read < st.total ? `<button class="btn tiny" data-mark-chapter="${b}:${ch}">Mark chapter as read</button>` : ''}
    </div>`;
}
