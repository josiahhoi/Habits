// Settings tab: GitHub sync, Strava status, habit management, data tools.

import * as store from './store.js';
import * as sync from './sync.js';
import { esc, download, todayStr } from './util.js';

const SLOT_NAMES = ['blue', 'orange', 'aqua', 'yellow', 'magenta', 'green', 'violet', 'red'];

export function renderSettings(root) {
  const s = store.getState();
  const gh = s.settings.gh;
  const token = store.getToken();

  const habitRows = s.habits.map((h) => `
    <div class="habit-manage-row ${h.archived ? 'archived' : ''}">
      <span class="hicon">${esc(h.icon)}</span>
      <span class="slot-dot" style="background: var(--slot${h.slot})"></span>
      <span class="hname">${esc(h.name)}${h.auto === 'readings' ? ' <span class="small muted">(auto: reading log)</span>' : ''}${h.track === 'duration' ? ' <span class="small muted">(tracks time)</span>' : ''}</span>
      <button class="btn tiny" data-tracktime="${h.id}" title="Track minutes for this habit">⏱ ${h.track === 'duration' ? 'On' : 'Off'}</button>
      <button class="btn tiny" data-rename="${h.id}">Rename</button>
      <button class="btn tiny" data-archive="${h.id}">${h.archived ? 'Unarchive' : 'Archive'}</button>
      <button class="btn tiny danger" data-delete="${h.id}">Delete</button>
    </div>`).join('');

  const slotPicks = SLOT_NAMES.map((n, i) =>
    `<button class="slot-pick ${i === 3 ? 'sel' : ''}" data-slot="${i + 1}" style="background: var(--slot${i + 1})" title="${n}" aria-label="${n}"></button>`).join('');

  root.innerHTML = `
    <div class="card">
      <h2>Sync across devices (GitHub)</h2>
      <p class="sub">This site can store your log in the same GitHub repo it is served from, so your phone and laptop stay in sync — no server needed. Create a <b>fine-grained personal access token</b> at GitHub → Settings → Developer settings → Fine-grained tokens, scoped to <b>only this repo</b> with <b>Contents: Read and write</b> permission, and paste it here. The token stays in this browser only.</p>
      <div class="row">
        <div class="field"><label for="gh-owner">Owner</label><input id="gh-owner" value="${esc(gh.owner)}" placeholder="your-username" autocapitalize="off" autocorrect="off"></div>
        <div class="field"><label for="gh-repo">Repo</label><input id="gh-repo" value="${esc(gh.repo)}" placeholder="habits" autocapitalize="off" autocorrect="off"></div>
        <div class="field"><label for="gh-branch">Branch</label><input id="gh-branch" value="${esc(gh.branch || 'main')}"></div>
      </div>
      <div class="field"><label for="gh-token">Fine-grained token ${token ? '(saved)' : ''}</label><input id="gh-token" type="password" placeholder="${token ? '••••••••••••' : 'github_pat_…'}" autocomplete="off"></div>
      <div class="row">
        <button class="btn primary" id="gh-save">Save &amp; test</button>
        <button class="btn" id="gh-sync">Sync now</button>
        <button class="btn danger" id="gh-disconnect">Disconnect</button>
      </div>
      <div class="status-line" id="gh-status"></div>
    </div>

    <div class="card">
      <h2>Habits</h2>
      <div class="settings-grid">${habitRows}</div>
      <h3 class="small" style="margin-top:14px">Add a habit</h3>
      <div class="row" style="margin-top:6px">
        <div class="field"><label for="nh-name">Name</label><input id="nh-name" placeholder="e.g. Scripture memory"></div>
        <div class="field"><label for="nh-icon">Emoji</label><input id="nh-icon" placeholder="⭐" style="width:64px"></div>
        <div class="field"><label>Color</label><div class="slot-picker" id="nh-slots">${slotPicks}</div></div>
        <label class="small" style="display:flex;align-items:center;gap:6px;margin-bottom:8px"><input type="checkbox" id="nh-track"> Track time</label>
        <button class="btn primary" id="nh-add" style="margin-bottom:2px">Add</button>
      </div>
    </div>

    <div class="card">
      <h2>Data</h2>
      <div class="row">
        <button class="btn" id="data-export">Export JSON</button>
        <label class="btn" style="display:inline-flex;align-items:center;gap:6px;cursor:pointer">Import JSON<input id="data-import" type="file" accept="application/json,.json" hidden></label>
        <button class="btn danger" id="data-clear">Clear all data</button>
      </div>
      <p class="sub" style="margin-top:8px">Everything is stored in this browser (and, if sync is on, in <code>${esc(gh.path || 'data/log.json')}</code> in your repo). Export regularly if you are not using sync.</p>
    </div>`;

  // --- GitHub sync ---
  // Look the status node up on every call: saving the config re-renders this
  // panel mid-handler, so a captured reference would point at detached DOM
  // and every message (including errors) would silently vanish.
  const setStatus = (msg, cls = '') => {
    const el = root.querySelector('#gh-status');
    if (el) {
      el.textContent = msg;
      el.className = `status-line ${cls}`;
    }
  };
  const syncStatus = sync.getStatus();
  if (syncStatus.state === 'ok') setStatus(syncStatus.detail, 'ok');
  if (syncStatus.state === 'error') setStatus(syncStatus.detail, 'err');

  root.querySelector('#gh-save').addEventListener('click', async () => {
    const owner = root.querySelector('#gh-owner').value.trim();
    const repo = root.querySelector('#gh-repo').value.trim();
    const branch = root.querySelector('#gh-branch').value.trim() || 'main';
    const tokenInput = root.querySelector('#gh-token').value.trim();
    // Token first: setGhConfig triggers a re-render, and the rebuilt panel
    // should already show the token as saved.
    if (tokenInput) store.setToken(tokenInput);
    store.setGhConfig({ owner, repo, branch });
    if (!sync.configured()) {
      setStatus('Fill in owner, repo, and token first.', 'err');
      return;
    }
    setStatus('Testing…');
    try {
      await sync.testConnection();
      setStatus('Connected ✓ — syncing…', 'ok');
      await sync.syncNow();
      setStatus(sync.getStatus().state === 'error' ? sync.getStatus().detail : 'Connected & synced ✓', sync.getStatus().state === 'error' ? 'err' : 'ok');
    } catch (e) {
      setStatus(e.message, 'err');
    }
  });
  root.querySelector('#gh-sync').addEventListener('click', async () => {
    setStatus('Syncing…');
    await sync.syncNow();
    const st = sync.getStatus();
    setStatus(st.detail || 'Done', st.state === 'error' ? 'err' : 'ok');
  });
  root.querySelector('#gh-disconnect').addEventListener('click', () => {
    sync.disconnect();
    setStatus('Token removed from this browser.');
  });

  // --- Habit management ---
  for (const btn of root.querySelectorAll('[data-rename]')) {
    btn.addEventListener('click', () => {
      const h = s.habits.find((x) => x.id === btn.dataset.rename);
      const name = prompt('Habit name:', h.name);
      if (name && name.trim()) store.updateHabit(h.id, { name: name.trim() });
    });
  }
  for (const btn of root.querySelectorAll('[data-tracktime]')) {
    btn.addEventListener('click', () => {
      const h = s.habits.find((x) => x.id === btn.dataset.tracktime);
      store.updateHabit(h.id, { track: h.track === 'duration' ? null : 'duration' });
    });
  }
  for (const btn of root.querySelectorAll('[data-archive]')) {
    btn.addEventListener('click', () => {
      const h = s.habits.find((x) => x.id === btn.dataset.archive);
      store.updateHabit(h.id, { archived: !h.archived });
    });
  }
  for (const btn of root.querySelectorAll('[data-delete]')) {
    btn.addEventListener('click', () => {
      const h = s.habits.find((x) => x.id === btn.dataset.delete);
      if (confirm(`Delete “${h.name}” and remove it from every day's record? History of other habits is kept. This cannot be undone.`)) {
        store.deleteHabit(h.id);
      }
    });
  }

  let pickedSlot = 4;
  for (const p of root.querySelectorAll('#nh-slots .slot-pick')) {
    p.addEventListener('click', () => {
      pickedSlot = Number(p.dataset.slot);
      root.querySelectorAll('#nh-slots .slot-pick').forEach((x) => x.classList.remove('sel'));
      p.classList.add('sel');
    });
  }
  root.querySelector('#nh-add').addEventListener('click', () => {
    const name = root.querySelector('#nh-name').value.trim();
    if (!name) return;
    store.addHabit({
      name,
      icon: root.querySelector('#nh-icon').value.trim() || '⭐',
      slot: pickedSlot,
      track: root.querySelector('#nh-track').checked ? 'duration' : null,
    });
  });

  // --- Data tools ---
  root.querySelector('#data-export').addEventListener('click', () => {
    download(`habits-export-${todayStr()}.json`, store.exportJson());
  });
  root.querySelector('#data-import').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      if (confirm('Merge this file into your existing data? (To fully replace instead, clear data first, then import.)')) {
        store.importJson(text);
      }
    } catch (err) {
      alert(`Import failed: ${err.message}`);
    }
    e.target.value = '';
  });
  root.querySelector('#data-clear').addEventListener('click', () => {
    if (confirm('Delete ALL local habit data? If GitHub sync is on, the repo copy may restore it on next sync.') && confirm('Really sure? This clears every day and reading.')) {
      store.clearAll();
    }
  });
}
