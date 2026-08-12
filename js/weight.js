// Weight tab: current weight, trend chart, goal, and an editable history list
// (which doubles as the table view, so no value is chart-only).

import * as store from './store.js';
import { esc, todayStr, fmtDateLong, fmtDateShort, fmtWeight, fmtWeightDelta, toDisplayWeight, fromDisplayWeight } from './util.js';
import { renderWeightChart, withinRange, changeOver } from './weightchart.js';

const RANGES = [
  { key: '30', label: '30d', days: 30 },
  { key: '90', label: '90d', days: 90 },
  { key: '365', label: '1y', days: 365 },
  { key: 'all', label: 'All', days: null },
];
let rangeKey = '90';

const HISTORY_LIMIT = 60;

export function renderWeight(root) {
  const unit = store.getWeightUnit();
  const series = store.weightSeries();
  const goalKg = store.goalWeight();
  const range = RANGES.find((r) => r.key === rangeKey) || RANGES[1];
  const shown = withinRange(series, range.days);
  const latest = series[series.length - 1] || null;

  const d7 = changeOver(series, 7);
  const d30 = changeOver(series, 30);
  const toGoal = latest && goalKg != null ? latest.kg - goalKg : null;

  const stat = (label, kg) =>
    kg == null ? '' : `<span class="wstat"><span class="muted">${label}</span> <b class="${kg < 0 ? 'down' : kg > 0 ? 'up' : ''}">${esc(fmtWeightDelta(kg, unit))}</b></span>`;

  const rangeBtns = RANGES.map((r) =>
    `<button class="btn tiny ${r.key === rangeKey ? 'sel' : ''}" data-range="${r.key}">${r.label}</button>`).join('');

  const goalDisplay = goalKg == null ? '' : toDisplayWeight(goalKg, unit).toFixed(1);
  const todayVal = store.weightFor(todayStr());

  const historyRows = series.slice().reverse().slice(0, HISTORY_LIMIT).map((p, i, arr) => {
    const prev = arr[i + 1];
    const delta = prev ? p.kg - prev.kg : null;
    return `
      <div class="w-row">
        <span class="w-date">${esc(fmtDateShort(p.date))}</span>
        <span class="w-val">${esc(fmtWeight(p.kg, unit))}</span>
        <span class="w-delta ${delta == null ? '' : delta < 0 ? 'down' : delta > 0 ? 'up' : ''}">${delta == null ? '' : esc(fmtWeightDelta(delta, unit))}</span>
        <button class="iconbtn" data-del-weight="${p.date}" aria-label="Remove weight for ${esc(fmtDateLong(p.date))}">✕</button>
      </div>`;
  }).join('');

  root.innerHTML = `
    <div class="card">
      <div class="spread">
        <h2>Weight</h2>
        <span class="year-nav">${rangeBtns}</span>
      </div>
      <div class="hero" style="margin-top:6px">
        <div class="hero-number">${latest ? esc(fmtWeight(latest.kg, unit)) : '—'}${latest ? `<small> · ${esc(fmtDateShort(latest.date))}</small>` : ''}</div>
        <div class="wstats">
          ${stat('7d', d7)}
          ${stat('30d', d30)}
          ${toGoal == null ? '' : `<span class="wstat"><span class="muted">to goal</span> <b>${esc(fmtWeightDelta(toGoal, unit))}</b></span>`}
        </div>
      </div>
      <div id="w-chart" class="wc-wrap"></div>
      ${shown.length ? `<div class="hm-legend">
        <span class="sw wc-key-raw"></span><span>Daily</span>
        <span class="sw wc-key-avg"></span><span>7-day average</span>
        ${goalKg == null ? '' : '<span class="sw wc-key-goal"></span><span>Goal</span>'}
      </div>` : ''}
    </div>

    <div class="card">
      <h2>Log a weight</h2>
      <div class="reading-form">
        <div class="field"><label for="w-date">Date</label><input id="w-date" type="date" value="${todayStr()}" max="${todayStr()}"></div>
        <div class="field"><label for="w-value">Weight (${unit})</label><input id="w-value" type="number" inputmode="decimal" step="0.1" min="0" placeholder="${todayVal ? toDisplayWeight(todayVal, unit).toFixed(1) : '0.0'}"></div>
        <button class="btn primary" id="w-add">Save</button>
      </div>
      <div class="row" style="margin-top:12px">
        <div class="field" style="margin-bottom:0"><label for="w-goal">Goal weight (${unit})</label><input id="w-goal" type="number" inputmode="decimal" step="0.1" min="0" value="${goalDisplay}" placeholder="none"></div>
        <button class="btn" id="w-goal-save" style="margin-bottom:2px">Set goal</button>
        ${goalKg == null ? '' : '<button class="btn ghost" id="w-goal-clear" style="margin-bottom:2px">Clear</button>'}
      </div>
      <p class="sub" style="margin-top:8px">Units can be switched between lb and kg in Settings; entries are stored in a single canonical unit, so switching never changes what you recorded.</p>
    </div>

    <div class="card">
      <h2>History</h2>
      <div class="w-list">${historyRows || '<div class="small muted">Nothing logged yet.</div>'}</div>
      ${series.length > HISTORY_LIMIT ? `<div class="small muted" style="margin-top:8px">Showing the most recent ${HISTORY_LIMIT} of ${series.length} entries.</div>` : ''}
    </div>`;

  renderWeightChart(root.querySelector('#w-chart'), { series: shown, unit, goalKg });

  for (const btn of root.querySelectorAll('[data-range]')) {
    btn.addEventListener('click', () => {
      rangeKey = btn.dataset.range;
      renderWeight(root);
    });
  }

  const dateInput = root.querySelector('#w-date');
  const valueInput = root.querySelector('#w-value');
  const save = () => {
    const kg = fromDisplayWeight(valueInput.value, unit);
    if (kg == null || !dateInput.value) return;
    store.setWeight(dateInput.value, kg);
    valueInput.value = '';
  };
  root.querySelector('#w-add').addEventListener('click', save);
  valueInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
  // Show the existing entry for whichever date is picked.
  dateInput.addEventListener('change', () => {
    const existing = store.weightFor(dateInput.value);
    valueInput.placeholder = existing ? toDisplayWeight(existing, unit).toFixed(1) : '0.0';
  });

  root.querySelector('#w-goal-save').addEventListener('click', () => {
    store.setGoalWeight(fromDisplayWeight(root.querySelector('#w-goal').value, unit));
  });
  root.querySelector('#w-goal-clear')?.addEventListener('click', () => store.setGoalWeight(null));

  for (const btn of root.querySelectorAll('[data-del-weight]')) {
    btn.addEventListener('click', () => store.setWeight(btn.dataset.delWeight, null));
  }
}
