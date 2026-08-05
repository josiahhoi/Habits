// Day detail modal: toggle habits, log passages, see Strava activities, note.

import * as store from './store.js';
import { esc, el, fmtDateLong, fmtDuration, fmtKm, todayStr } from './util.js';
import { BOOKS } from './bible-data.js';
import { byAbbrev, formatRange, languageOf, maxVerse, normalizeRange } from './bible.js';
import { activitiesOn, hasActivity } from './strava.js';

let onCloseCb = null;
let openDate = null;
let offStore = null;

function onEscape(e) {
  if (e.key === 'Escape') close();
}

export function isHabitDone(date, habit, dayData) {
  const d = dayData || store.getDay(date);
  if (d.done.includes(habit.id)) return true;
  if (habit.auto === 'strava' && hasActivity(date)) return true;
  if (habit.auto === 'readings' && d.readings.length > 0) return true;
  if (habit.track === 'duration' && d.mins && Number(d.mins[habit.id]) > 0) return true;
  return false;
}

export function autoReason(date, habit, dayData) {
  const d = dayData || store.getDay(date);
  if (habit.auto === 'strava' && hasActivity(date)) return 'via Strava';
  if (habit.auto === 'readings' && d.readings.length > 0 && !d.done.includes(habit.id)) return 'via reading log';
  return '';
}

export function bookSelectHtml(id, selected = 'Matt') {
  const group = (books, label) =>
    `<optgroup label="${label}">` +
    books.map((b) => `<option value="${b.abbrev}" ${b.abbrev === selected ? 'selected' : ''}>${esc(b.name)}</option>`).join('') +
    '</optgroup>';
  const ot = BOOKS.filter((b) => b.testament === 'OT');
  const nt = BOOKS.filter((b) => b.testament === 'NT');
  return `<select id="${id}">${group(nt, 'New Testament (Greek)')}${group(ot, 'Old Testament (Hebrew)')}</select>`;
}

// Wire a passage form's auto-defaults. Elements: book select, c1, v1, c2, v2 inputs.
export function wirePassageForm(root, ids) {
  const $ = (id) => root.querySelector(`#${id}`);
  const book = $(ids.book);
  const c1 = $(ids.c1);
  const v1 = $(ids.v1);
  const c2 = $(ids.c2);
  const v2 = $(ids.v2);

  const resetForBook = () => {
    const b = byAbbrev[book.value];
    c1.max = c2.max = b.chapters.length;
    c1.value = 1;
    c2.value = 1;
    v1.value = 1;
    v2.value = maxVerse(book.value, 1);
  };
  book.addEventListener('change', resetForBook);
  c1.addEventListener('change', () => {
    if (Number(c2.value) < Number(c1.value)) c2.value = c1.value;
    v1.value = 1;
    v2.value = maxVerse(book.value, Number(c2.value));
  });
  c2.addEventListener('change', () => {
    if (Number(c2.value) < Number(c1.value)) c1.value = c2.value;
    v2.value = maxVerse(book.value, Number(c2.value));
  });
  return () => normalizeRange({
    b: book.value,
    c1: Number(c1.value), v1: Number(v1.value),
    c2: Number(c2.value), v2: Number(v2.value),
  });
}

export function passageFormHtml(prefix) {
  return `
    <div class="reading-form">
      <div class="field"><label for="${prefix}-book">Book</label>${bookSelectHtml(`${prefix}-book`)}</div>
      <div class="field"><label for="${prefix}-c1">Ch.</label><input id="${prefix}-c1" type="number" min="1" value="1" inputmode="numeric"></div>
      <div class="field"><label for="${prefix}-v1">v.</label><input id="${prefix}-v1" type="number" min="1" value="1" inputmode="numeric"></div>
      <span class="range-sep">–</span>
      <div class="field"><label for="${prefix}-c2">Ch.</label><input id="${prefix}-c2" type="number" min="1" value="1" inputmode="numeric"></div>
      <div class="field"><label for="${prefix}-v2">v.</label><input id="${prefix}-v2" type="number" min="1" value="1" inputmode="numeric"></div>
      <button class="btn primary" id="${prefix}-add">Add</button>
    </div>`;
}

export function openDayPanel(date, { onClose } = {}) {
  onCloseCb = onClose || null;
  openDate = date;
  // Re-render on every store change while open, so a background sync merge
  // can never leave the modal showing stale readings/chips (and stale
  // deletion indices).
  if (!offStore) offStore = store.on(() => { if (openDate) render(openDate); });
  document.addEventListener('keydown', onEscape);
  render(date);
  document.querySelector('#dp-backdrop .modal')?.focus();
}

function close() {
  if (offStore) {
    offStore();
    offStore = null;
  }
  document.removeEventListener('keydown', onEscape);
  // Commit an in-progress note before tearing down the DOM — closing via
  // Escape would otherwise discard text whose 'change' event never fired.
  const ta = document.getElementById('dp-note');
  if (ta && openDate && ta.value !== store.getDay(openDate).note) {
    store.setNote(openDate, ta.value);
  }
  openDate = null;
  const root = document.getElementById('modal-root');
  root.innerHTML = '';
  document.body.style.overflow = '';
  if (onCloseCb) onCloseCb();
  onCloseCb = null;
}

function render(date) {
  const root = document.getElementById('modal-root');
  const day = store.getDay(date);
  const habits = store.activeHabits();
  const acts = activitiesOn(date);
  const isToday = date === todayStr();

  const habitRows = habits.map((h) => {
    const done = isHabitDone(date, h, day);
    const reason = autoReason(date, h, day);
    const mins = h.track === 'duration' ? (day.mins && Number(day.mins[h.id])) || 0 : 0;
    const timeRow = h.track === 'duration' ? `
        <div class="time-row">
          <label for="mins-${h.id}" title="Minutes">⏱</label>
          <input id="mins-${h.id}" data-mins="${h.id}" type="number" inputmode="numeric" min="0" max="1440" step="5" value="${mins || ''}" placeholder="0" aria-label="Minutes of ${esc(h.name)}">
          <span class="small muted">min</span>
          <button class="btn tiny" data-addmin="${h.id}:5">+5</button>
          <button class="btn tiny" data-addmin="${h.id}:15">+15</button>
          <button class="btn tiny" data-addmin="${h.id}:30">+30</button>
        </div>` : '';
    return `
      <div class="day-habit-row">
        <button class="chip ${done ? 'done' : ''}" data-habit="${h.id}" style="--hc: var(--slot${h.slot})" aria-pressed="${done}">
          <span class="dot"></span>${esc(h.icon)} ${esc(h.name)}
          ${reason ? `<span class="via">${esc(reason)}</span>` : ''}
          <span class="check">✓</span>
        </button>
        ${timeRow}
      </div>`;
  }).join('');

  const actHtml = acts.length
    ? `<div class="small muted" style="margin-top:2px">Strava:</div>` + acts.map((a) => `
        <div class="activity-item">🏅 ${esc(a.type || 'Activity')} · ${esc(a.name || '')} ${a.movingTime ? `· ${fmtDuration(a.movingTime)}` : ''} ${a.distance ? `· ${fmtKm(a.distance)}` : ''}</div>`).join('')
    : '';

  const readingsHtml = day.readings.map((r, i) => `
    <div class="reading-item">
      <span>${esc(formatRange(r))} <span class="lang">${esc(languageOf(r.b))}</span></span>
      <button class="iconbtn" data-del-reading="${i}" aria-label="Remove ${esc(formatRange(r))}">✕</button>
    </div>`).join('');

  root.innerHTML = `
    <div class="modal-backdrop" id="dp-backdrop">
      <div class="modal" role="dialog" aria-modal="true" aria-label="Day detail" tabindex="-1">
        <div class="spread">
          <h2>${isToday ? 'Today — ' : ''}${esc(fmtDateLong(date))}</h2>
          <button class="iconbtn" id="dp-close" aria-label="Close">✕</button>
        </div>
        <div class="day-habits">${habitRows}</div>
        ${actHtml}
        <h3 class="small" style="margin-top:14px">Reading log</h3>
        <div class="reading-list">${readingsHtml || '<div class="small muted">No passages logged.</div>'}</div>
        ${passageFormHtml('dp')}
        <div class="field" style="margin-top:12px">
          <label for="dp-note">Note</label>
          <textarea id="dp-note" rows="2" placeholder="Optional">${esc(day.note)}</textarea>
        </div>
      </div>
    </div>`;

  document.body.style.overflow = 'hidden';

  const backdrop = document.getElementById('dp-backdrop');
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  document.getElementById('dp-close').addEventListener('click', close);

  // Mutations re-render via the store subscription in openDayPanel.
  for (const btn of backdrop.querySelectorAll('[data-habit]')) {
    btn.addEventListener('click', () => {
      const id = btn.dataset.habit;
      const d = store.getDay(date);
      store.setDone(date, id, !d.done.includes(id));
    });
  }
  for (const btn of backdrop.querySelectorAll('[data-del-reading]')) {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.delReading);
      store.removeReading(date, idx, day.readings[idx]);
    });
  }
  for (const input of backdrop.querySelectorAll('[data-mins]')) {
    input.addEventListener('change', () => {
      store.setMinutes(date, input.dataset.mins, input.value);
    });
  }
  for (const btn of backdrop.querySelectorAll('[data-addmin]')) {
    btn.addEventListener('click', () => {
      const [id, n] = btn.dataset.addmin.split(':');
      store.setMinutes(date, id, store.minutesFor(date, id) + Number(n));
    });
  }

  const getRange = wirePassageForm(backdrop, { book: 'dp-book', c1: 'dp-c1', v1: 'dp-v1', c2: 'dp-c2', v2: 'dp-v2' });
  // initialize defaults for the first selected book
  backdrop.querySelector('#dp-book').dispatchEvent(new Event('change'));
  backdrop.querySelector('#dp-add').addEventListener('click', () => {
    const r = getRange();
    if (r) store.addReading(date, r);
  });

  const note = backdrop.querySelector('#dp-note');
  note.addEventListener('change', () => {
    if (note.value !== store.getDay(date).note) store.setNote(date, note.value);
  });
}
