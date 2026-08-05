// App orchestration: tabs, dashboard rendering, streaks, wiring.

import * as store from './store.js';
import * as sync from './sync.js';
import { loadStrava, earliestStravaDay } from './strava.js';
import { renderHeatmap } from './heatmap.js';
import { renderGnt } from './gnt.js';
import { renderSettings } from './settings.js';
import { openDayPanel, isHabitDone } from './daypanel.js';
import { esc, todayStr, addDays, fmtDateLong } from './util.js';
import { formatRange } from './bible.js';

const TABS = ['dashboard', 'gnt', 'settings'];
let currentTab = 'dashboard';
let viewYear = new Date().getFullYear();

// ---------- Habit day-completion helpers ----------

function effectiveDone(date, habit) {
  return isHabitDone(date, habit);
}

function dayFraction(date, habits) {
  if (!habits.length) return 0;
  let n = 0;
  for (const h of habits) if (effectiveDone(date, h)) n++;
  return n / habits.length;
}

function computeStreaks(habit) {
  const today = todayStr();
  let current = 0;
  // current streak: consecutive days ending today, or ending yesterday if
  // today isn't done yet (today still pending doesn't break the streak)
  let d = today;
  if (!effectiveDone(d, habit)) d = addDays(d, -1);
  while (effectiveDone(d, habit)) {
    current++;
    d = addDays(d, -1);
  }
  // longest + total: walk the calendar from the earliest record to the latest
  // (a synced day can sit ahead of this device's local date — count it too;
  // effectiveDone also covers strava-only days inside the window)
  const candidates = [store.earliestDate(), earliestStravaDay()].filter(Boolean).sort();
  const start = candidates[0] || today;
  let end = today;
  for (const k of Object.keys(store.getState().days)) if (k > end) end = k;
  let longest = 0;
  let total = 0;
  let run = 0;
  for (let cur = start; cur <= end; cur = addDays(cur, 1)) {
    if (effectiveDone(cur, habit)) {
      total++;
      run++;
      if (run > longest) longest = run;
    } else {
      run = 0;
    }
  }
  return { current, longest, total };
}

// ---------- Dashboard ----------

function renderDashboard(root) {
  const habits = store.activeHabits();
  const today = todayStr();

  const chips = habits.map((h) => {
    const done = effectiveDone(today, h);
    const via = h.auto === 'strava' && done && !store.getDay(today).done.includes(h.id) ? '<span class="via">via Strava</span>'
      : h.auto === 'readings' && done && !store.getDay(today).done.includes(h.id) ? '<span class="via">via log</span>' : '';
    return `<button class="chip ${done ? 'done' : ''}" data-habit="${h.id}" style="--hc: var(--slot${h.slot})" aria-pressed="${done}">
      <span class="dot"></span>${esc(h.icon)} ${esc(h.name)} ${via}<span class="check">✓</span>
    </button>`;
  }).join('');

  const habitSections = habits.map((h) => {
    const st = computeStreaks(h);
    return `
      <div class="card" data-habit-card="${h.id}">
        <div class="hm-head">
          <span class="hm-title" style="--hc: var(--slot${h.slot})"><span class="dot"></span>${esc(h.icon)} ${esc(h.name)}</span>
          <span class="hm-stats">
            <span>🔥 <b>${st.current}</b> current</span>
            <span>best <b>${st.longest}</b></span>
            <span>total <b>${st.total}</b></span>
          </span>
        </div>
        <div data-hm="${h.id}"></div>
      </div>`;
  }).join('');

  root.innerHTML = `
    <div class="card">
      <div class="today-date">${esc(fmtDateLong(today))}</div>
      <div class="habit-chips">${chips}</div>
      <div class="row" style="margin-top:12px">
        <button class="btn" id="log-reading">📖 Log a passage…</button>
        <button class="btn ghost" id="open-today">Day detail</button>
      </div>
    </div>

    <div class="card">
      <div class="hm-head">
        <span class="hm-title">All habits</span>
        <span class="year-nav">
          <button class="iconbtn" id="year-prev" aria-label="Previous year">‹</button>
          <span class="year">${viewYear}</span>
          <button class="iconbtn" id="year-next" aria-label="Next year">›</button>
        </span>
      </div>
      <div data-hm="__all__"></div>
      <div class="hm-legend">
        <span>0</span>
        <span class="sw" style="background:var(--cell0)"></span>
        <span class="sw" style="background:var(--q1)"></span>
        <span class="sw" style="background:var(--q2)"></span>
        <span class="sw" style="background:var(--q3)"></span>
        <span>all ${habits.length}</span>
      </div>
    </div>

    ${habitSections}`;

  // Today chips — compute the date at interaction time, not render time: a
  // dashboard rendered before midnight must not write to yesterday.
  for (const btn of root.querySelectorAll('.habit-chips [data-habit]')) {
    btn.addEventListener('click', () => {
      const t = todayStr();
      const id = btn.dataset.habit;
      store.setDone(t, id, !store.getDay(t).done.includes(id));
    });
  }
  root.querySelector('#log-reading').addEventListener('click', () => openDayPanel(todayStr(), { onClose: rerender }));
  root.querySelector('#open-today').addEventListener('click', () => openDayPanel(todayStr(), { onClose: rerender }));
  root.querySelector('#year-prev').addEventListener('click', () => { viewYear--; rerender(); });
  root.querySelector('#year-next').addEventListener('click', () => { viewYear++; rerender(); });

  const openDay = (date) => openDayPanel(date, { onClose: rerender });

  // Combined heatmap
  renderHeatmap(root.querySelector('[data-hm="__all__"]'), {
    year: viewYear,
    classFor: (ds) => {
      const f = dayFraction(ds, habits);
      if (f <= 0) return '';
      if (f >= 1) return 'q3';
      if (f >= 0.5) return 'q2';
      return 'q1';
    },
    tooltipFor: (ds) => {
      const doneList = habits.filter((h) => effectiveDone(ds, h)).map((h) => `${esc(h.icon)} ${esc(h.name)}`);
      const readings = store.getDay(ds).readings.map((r) => esc(formatRange(r)));
      return `<b>${esc(fmtDateLong(ds))}</b><br>${doneList.length ? doneList.join('<br>') : 'Nothing logged'}${readings.length ? `<br><span style="opacity:.8">${readings.join(' · ')}</span>` : ''}`;
    },
    onDayClick: openDay,
  });

  // Per-habit heatmaps
  for (const h of habits) {
    renderHeatmap(root.querySelector(`[data-hm="${h.id}"]`), {
      year: viewYear,
      classFor: (ds) => (effectiveDone(ds, h) ? `s${h.slot}` : ''),
      tooltipFor: (ds) => {
        const done = effectiveDone(ds, h);
        return `<b>${esc(fmtDateLong(ds))}</b><br>${esc(h.name)}: ${done ? 'done ✓' : 'not done'}`;
      },
      onDayClick: openDay,
    });
  }
}

// ---------- Tabs & rendering ----------

function panel(tab) {
  return document.getElementById(`tab-${tab}`);
}

function rerender() {
  if (currentTab === 'dashboard') renderDashboard(panel('dashboard'));
  if (currentTab === 'gnt') renderGnt(panel('gnt'));
  if (currentTab === 'settings') renderSettings(panel('settings'));
}

function switchTab(tab) {
  if (!TABS.includes(tab)) tab = 'dashboard';
  currentTab = tab;
  for (const t of TABS) {
    panel(t).hidden = t !== tab;
  }
  for (const btn of document.querySelectorAll('.tabs .tab')) {
    const active = btn.dataset.tab === tab;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-selected', String(active));
  }
  if (location.hash !== `#${tab}`) history.replaceState(null, '', `#${tab}`);
  rerender();
}

// ---------- Boot ----------

async function main() {
  store.load();

  for (const btn of document.querySelectorAll('.tabs .tab')) {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  }
  window.addEventListener('hashchange', () => switchTab(location.hash.slice(1)));

  // Re-render on any state change; push to GitHub unless the change came from sync itself.
  store.on((kind) => {
    if (kind === 'persist-error') {
      document.getElementById('footer-note').textContent =
        '⚠️ Could not save to this browser (storage full or private mode) — export your data or enable GitHub sync.';
      return;
    }
    const silent = kind.endsWith(':silent');
    // A background sync merge must not redraw the Settings tab under the
    // user's feet — it would wipe a half-typed token field.
    if (!(silent && currentTab === 'settings')) rerender();
    if (!silent) sync.schedulePush();
  });

  // Day rollover: a tab left open (or a PWA resumed) across midnight must not
  // keep rendering — or writing to — yesterday. Also covers New Year.
  let renderedDay = todayStr();
  const refreshDay = () => {
    const t = todayStr();
    if (t !== renderedDay) {
      renderedDay = t;
      viewYear = new Date().getFullYear();
      rerender();
    }
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshDay();
  });
  setInterval(refreshDay, 60000);

  const dot = document.getElementById('sync-dot');
  sync.onStatus((st) => {
    dot.hidden = st.state === 'off';
    dot.className = `sync-dot ${st.state === 'ok' ? 'ok' : st.state === 'error' ? 'err' : st.state === 'busy' ? 'busy' : ''}`;
    dot.title = st.detail || `Sync: ${st.state}`;
  });

  document.getElementById('footer-note').textContent =
    'Your data lives in this browser (and your GitHub repo when sync is on).';

  switchTab(location.hash.slice(1) || 'dashboard');

  await loadStrava();   // non-blocking for first paint; rerender when it arrives
  rerender();
  sync.init();
}

main();
