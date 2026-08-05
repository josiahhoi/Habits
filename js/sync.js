// Cross-device sync through the GitHub Contents API: the site itself lives
// in a repo, so the repo doubles as the database. The user supplies a
// fine-grained personal access token (Contents: read/write on this one repo);
// it stays in localStorage on the device and is never part of the synced file.

import * as store from './store.js';

const API = 'https://api.github.com';

let sha = null;            // sha of data/log.json at last pull, for conflict-safe PUTs
let pushTimer = null;
let inflight = false;
let pendingPush = false;

const statusListeners = new Set();
let status = { state: 'off', detail: '' }; // off | idle | busy | ok | error

export function onStatus(fn) {
  statusListeners.add(fn);
  fn(status);
  return () => statusListeners.delete(fn);
}

function setStatus(state, detail = '') {
  status = { state, detail };
  for (const fn of statusListeners) fn(status);
}

export function getStatus() {
  return status;
}

export function configured() {
  const { owner, repo } = store.getState().settings.gh;
  return Boolean(owner && repo && store.getToken());
}

function cfg() {
  const gh = store.getState().settings.gh;
  return { ...gh, branch: gh.branch || 'main', path: gh.path || 'data/log.json' };
}

function headers() {
  return {
    Authorization: `Bearer ${store.getToken()}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

function b64encodeUtf8(s) {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function b64decodeUtf8(s) {
  const bin = atob(s.replace(/\s/g, ''));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function fetchRemote() {
  const { owner, repo, branch, path } = cfg();
  const url = `${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path}?ref=${encodeURIComponent(branch)}`;
  const r = await fetch(url, { headers: headers() });
  if (r.status === 404) {
    sha = null;
    return { exists: false, text: null };
  }
  if (!r.ok) throw new Error(`GitHub ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  sha = j.sha;
  return { exists: true, text: b64decodeUtf8(j.content || '') };
}

async function putRemote(text) {
  const { owner, repo, branch, path } = cfg();
  const url = `${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path}`;
  const body = {
    message: 'habits: update log',
    content: b64encodeUtf8(text),
    branch,
  };
  if (sha) body.sha = sha;
  const r = await fetch(url, { method: 'PUT', headers: { ...headers(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) {
    const err = new Error(`GitHub ${r.status}: ${(await r.text()).slice(0, 200)}`);
    err.status = r.status;
    throw err;
  }
  const j = await r.json();
  sha = j.content && j.content.sha;
}

// Pull remote, merge into local. Returns true if local changed.
export async function pull() {
  const { exists, text } = await fetchRemote();
  if (!exists || !text) return false;
  let remote;
  try {
    remote = JSON.parse(text);
  } catch {
    throw new Error('Remote log file is not valid JSON — not merging.');
  }
  return store.mergeRemote(remote);
}

// Full cycle: pull+merge, then push if our merged state differs from remote.
export async function syncNow() {
  if (!configured()) return;
  if (inflight) { pendingPush = true; return; }
  inflight = true;
  setStatus('busy', 'Syncing…');
  try {
    const { exists, text } = await fetchRemote();
    if (exists && text) {
      try {
        store.mergeRemote(JSON.parse(text));
      } catch {
        throw new Error('Remote log file is not valid JSON — not overwriting it. Fix or delete it in the repo.');
      }
    }
    const local = store.serializeSync();
    if (!exists || text !== local) {
      try {
        await putRemote(local);
      } catch (e) {
        if (e.status === 409 || e.status === 422) {
          // Someone else pushed between our GET and PUT — re-pull, re-merge, retry once.
          const again = await fetchRemote();
          if (again.exists && again.text) store.mergeRemote(JSON.parse(again.text));
          await putRemote(store.serializeSync());
        } else {
          throw e;
        }
      }
    }
    setStatus('ok', `Synced ${new Date().toLocaleTimeString()}`);
  } catch (e) {
    console.error('Sync failed', e);
    setStatus('error', e.message || 'Sync failed');
  } finally {
    inflight = false;
    if (pendingPush) {
      pendingPush = false;
      schedulePush();
    }
  }
}

export function schedulePush() {
  if (!configured()) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    syncNow();
  }, 4000);
}

// Turn sync off on this device: forget the token, cancel pending pushes,
// and broadcast the off state so the header dot clears immediately.
export function disconnect() {
  store.setToken('');
  clearTimeout(pushTimer);
  pushTimer = null;
  pendingPush = false;
  setStatus('off');
}

export async function testConnection() {
  const { owner, repo } = cfg();
  const r = await fetch(`${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, { headers: headers() });
  if (!r.ok) throw new Error(r.status === 404 ? 'Repo not found (check owner/repo and token access).' : `GitHub ${r.status}`);
  const j = await r.json();
  if (!j.permissions || !(j.permissions.push || j.permissions.admin)) {
    throw new Error('Token cannot write to this repo — it needs Contents: Read and write.');
  }
  return true;
}

export function init() {
  if (configured()) {
    setStatus('idle');
    syncNow();
  } else {
    setStatus('off');
  }
  // Push pending changes when the tab is being hidden/closed
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && pushTimer) {
      clearTimeout(pushTimer);
      pushTimer = null;
      syncNow();
    }
  });
}
