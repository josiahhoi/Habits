// State management: localStorage-backed, with day-level last-write-wins
// merging so the same data file can be synced through a GitHub repo from
// several devices without a server.

const KEY = 'habits.state.v1';
const TOKEN_KEY = 'habits.ghToken';

const listeners = new Set();
let state = null;

export function defaultState() {
  return {
    version: 1,
    habits: [
      { id: 'reading', name: 'Greek/Hebrew Reading', icon: '📖', slot: 2, auto: 'readings', archived: false },
      { id: 'prayer', name: 'Prayer', icon: '🙏', slot: 3, auto: null, track: 'duration', archived: false },
    ],
    habitsUpdated: 0,
    // days["YYYY-MM-DD"] = { done: [habitId], readings: [{b,c1,v1,c2,v2}],
    //                        note: "", mins: {habitId: n}, weight: kg, m: epochMs }
    days: {},
    // Passages read before tracking started (not tied to a date)
    backfill: { ranges: [], m: 0 },
    // Synced user preferences (whole-block LWW, like backfill). The lb/kg
    // *display* unit is deliberately NOT here — it lives in local settings.
    prefs: { goalKg: null, m: 0 },
    settings: { gh: { owner: '', repo: '', branch: 'main', path: 'data/log.json' }, weightUnit: 'lb' },
  };
}

// Weight is stored canonically in kilograms so the lb/kg display toggle can
// stay device-local: settings never sync, so values stored "as typed" would be
// misread by a device set to the other unit. Anything outside human range is
// rejected — a typo or hostile JSON must not blow up the chart's axis scaling.
const MIN_KG = 20;
const MAX_KG = 500;
export function validWeightKg(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < MIN_KG || n > MAX_KG) return null;
  return Math.round(n * 1000) / 1000;
}

// Habit records arrive from synced/imported JSON, and their fields end up in
// HTML attributes and CSS vars — coerce every field to a safe shape on ingest
// (esc() at render sites is the second layer).
const AUTOS = new Set(['readings']);
let habitSeq = 0;

// The built-in Strava-backed Exercise habit was removed 2026-08 — drop it on
// every ingest path (load AND merge) so old synced/imported data can't
// reintroduce it. Any 'exercise' entries left in day.done arrays are inert.
const notRetired = (h) => h && h.auto !== 'strava' && h.id !== 'exercise';
function sanitizeHabit(h) {
  if (!h || typeof h !== 'object') return null;
  const id = String(h.id ?? '').replace(/[^A-Za-z0-9_-]/g, '');
  return {
    id: id || `h${Date.now().toString(36)}${(habitSeq++).toString(36)}`,
    name: String(h.name ?? 'Habit').slice(0, 60),
    icon: String(h.icon ?? '⭐').slice(0, 8),
    slot: Math.min(8, Math.max(1, h.slot | 0)),
    auto: AUTOS.has(h.auto) ? h.auto : null,
    // undefined (not null) means the record predates time tracking — migrate
    // the built-in prayer habit to duration tracking; an explicit null means
    // the user turned it off.
    track: h.track === 'duration' ? 'duration'
      : h.track === undefined && h.id === 'prayer' ? 'duration'
      : null,
    archived: Boolean(h.archived),
  };
}

function normalize(s) {
  const d = defaultState();
  if (!s || typeof s !== 'object') return d;
  s.version = 1;
  s.habits = Array.isArray(s.habits) ? s.habits.filter(notRetired).map(sanitizeHabit).filter(Boolean) : [];
  if (s.habits.length === 0) s.habits = d.habits;
  s.habitsUpdated = s.habitsUpdated || 0;
  s.days = s.days && typeof s.days === 'object' ? s.days : {};
  for (const day of Object.values(s.days)) {
    day.done = Array.isArray(day.done) ? day.done : [];
    day.readings = Array.isArray(day.readings) ? day.readings : [];
    day.note = typeof day.note === 'string' ? day.note : '';
    day.mins = day.mins && typeof day.mins === 'object' ? day.mins : {};
    const w = validWeightKg(day.weight);
    if (w == null) delete day.weight;
    else day.weight = w;
    day.m = day.m || 0;
  }
  if (!s.backfill || !Array.isArray(s.backfill.ranges)) s.backfill = d.backfill;
  s.prefs = s.prefs && typeof s.prefs === 'object'
    ? { goalKg: validWeightKg(s.prefs.goalKg), m: s.prefs.m || 0 }
    : d.prefs;
  s.settings = s.settings && typeof s.settings === 'object' ? s.settings : d.settings;
  s.settings.gh = { ...d.settings.gh, ...(s.settings.gh || {}) };
  s.settings.weightUnit = s.settings.weightUnit === 'kg' ? 'kg' : 'lb';
  return s;
}

export function load() {
  if (state) return state;
  try {
    state = normalize(JSON.parse(localStorage.getItem(KEY)));
  } catch {
    state = defaultState();
  }
  return state;
}

export function getState() {
  return load();
}

export function on(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(kind) {
  for (const fn of listeners) fn(kind);
}

let persistFailed = false;
function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    persistFailed = false;
  } catch (e) {
    console.error('Failed to persist state', e);
    if (!persistFailed) {
      persistFailed = true;
      emit('persist-error');
    }
  }
}

// `silent` skips notifying sync (used when applying a merge that came FROM sync)
export function save(kind = 'change', { silent = false } = {}) {
  persist();
  emit(silent ? `${kind}:silent` : kind);
}

function day(date) {
  const s = load();
  if (!s.days[date]) s.days[date] = { done: [], readings: [], note: '', mins: {}, m: 0 };
  return s.days[date];
}

function touch(date) {
  day(date).m = Date.now();
}

// ---------- Mutators ----------
// Note: emptied days are kept on purpose — an emptied day with a fresh
// timestamp must win over a remote copy that still has old contents.

export function setDone(date, habitId, on) {
  const d = day(date);
  const has = d.done.includes(habitId);
  if (on && !has) d.done.push(habitId);
  if (!on && has) d.done = d.done.filter((h) => h !== habitId);
  touch(date);
  save();
}

export function addReading(date, range) {
  day(date).readings.push(range);
  touch(date);
  save();
}

// `expected` guards against a background sync merge replacing the readings
// array between render and click: only splice when the entry still matches.
export function removeReading(date, idx, expected) {
  const d = day(date);
  const same = (a, b) => a && b && a.b === b.b && a.c1 === b.c1 && a.v1 === b.v1 && a.c2 === b.c2 && a.v2 === b.v2;
  let i = idx;
  if (expected && !same(d.readings[i], expected)) {
    i = d.readings.findIndex((r) => same(r, expected));
    if (i === -1) return;
  }
  d.readings.splice(i, 1);
  touch(date);
  save();
}

export function setNote(date, text) {
  day(date).note = text;
  touch(date);
  save();
}

// Minutes spent on a duration-tracked habit (e.g. prayer). 0 clears the entry.
export function setMinutes(date, habitId, mins) {
  const d = day(date);
  if (!d.mins || typeof d.mins !== 'object') d.mins = {};
  const m = Math.max(0, Math.min(1440, Math.round(Number(mins) || 0)));
  if (m > 0) d.mins[habitId] = m;
  else delete d.mins[habitId];
  touch(date);
  save();
}

export function minutesFor(date, habitId) {
  const d = load().days[date];
  return d && d.mins ? Number(d.mins[habitId]) || 0 : 0;
}

// ---------- Weight (always kilograms; convert at the display edge) ----------

// An out-of-range or empty value clears the day's entry. The day record itself
// is kept with a fresh timestamp so the deletion wins the last-write-wins merge.
export function setWeight(date, kg) {
  const d = day(date);
  const v = validWeightKg(kg);
  if (v == null) delete d.weight;
  else d.weight = v;
  touch(date);
  save();
}

export function weightFor(date) {
  const d = load().days[date];
  return d && d.weight != null ? d.weight : null;
}

// Chronological [{ date, kg }] — the input every weight view works from.
export function weightSeries() {
  const out = [];
  for (const [date, d] of Object.entries(load().days)) {
    if (d.weight != null) out.push({ date, kg: d.weight });
  }
  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return out;
}

export function goalWeight() {
  return load().prefs.goalKg;
}

export function setGoalWeight(kg) {
  const s = load();
  s.prefs = { goalKg: validWeightKg(kg), m: Date.now() };
  save();
}

export function getWeightUnit() {
  return load().settings.weightUnit === 'kg' ? 'kg' : 'lb';
}

export function setWeightUnit(unit) {
  const s = load();
  s.settings.weightUnit = unit === 'kg' ? 'kg' : 'lb';
  save('settings');
}

export function totalMinutes(habitId) {
  let total = 0;
  for (const d of Object.values(load().days)) {
    if (d.mins) total += Number(d.mins[habitId]) || 0;
  }
  return total;
}

export function addBackfill(range) {
  const s = load();
  s.backfill.ranges.push(range);
  s.backfill.m = Date.now();
  save();
}

export function removeBackfill(idx) {
  const s = load();
  s.backfill.ranges.splice(idx, 1);
  s.backfill.m = Date.now();
  save();
}

export function addHabit({ name, icon, slot, track }) {
  const s = load();
  const id = `h${Date.now().toString(36)}`;
  s.habits.push({ id, name, icon: icon || '⭐', slot: slot || 4, auto: null, track: track === 'duration' ? 'duration' : null, archived: false });
  s.habitsUpdated = Date.now();
  save();
}

export function updateHabit(id, patch) {
  const s = load();
  const h = s.habits.find((x) => x.id === id);
  if (!h) return;
  Object.assign(h, patch);
  s.habitsUpdated = Date.now();
  save();
}

export function deleteHabit(id) {
  const s = load();
  s.habits = s.habits.filter((x) => x.id !== id);
  for (const d of Object.values(s.days)) {
    if (d.done.includes(id)) {
      d.done = d.done.filter((h) => h !== id);
      d.m = Date.now();
    }
  }
  s.habitsUpdated = Date.now();
  save();
}

export function setGhConfig(gh) {
  const s = load();
  s.settings.gh = { ...s.settings.gh, ...gh };
  save('settings');
}

// ---------- Token (kept out of the synced payload) ----------

export function getToken() {
  try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; }
}

export function setToken(t) {
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  } catch { /* private mode */ }
}

// ---------- Sync payload + merging ----------

// Only user data is synced; device settings and the token stay local.
// Day keys are sorted so the serialization is canonical: two devices with the
// same logical data produce byte-identical files (otherwise every sync cycle
// would see a "difference" and devices would ping-pong commits forever).
export function syncPayload(s = load()) {
  const days = {};
  for (const k of Object.keys(s.days).sort()) days[k] = s.days[k];
  return {
    version: 1,
    habits: s.habits,
    habitsUpdated: s.habitsUpdated,
    days,
    backfill: s.backfill,
    prefs: s.prefs,
  };
}

export function serializeSync(s = load()) {
  return JSON.stringify(syncPayload(s), null, 1);
}

// Merge remote payload into local state. Day-level last-write-wins;
// habits, backfill, and prefs as whole blocks by their own timestamps.
// NOTE: each day is rebuilt from an explicit field list below — any new
// per-day field MUST be added there too, or it is silently dropped on merge.
export function mergeRemote(remote) {
  if (!remote || typeof remote !== 'object') return false;
  const s = load();
  let changed = false;
  if ((remote.habitsUpdated || 0) > (s.habitsUpdated || 0) && Array.isArray(remote.habits)) {
    const sanitized = remote.habits.filter(notRetired).map(sanitizeHabit).filter(Boolean);
    if (sanitized.length) {
      s.habits = sanitized;
      s.habitsUpdated = remote.habitsUpdated;
      changed = true;
    }
  }
  const rdays = remote.days && typeof remote.days === 'object' ? remote.days : {};
  for (const [k, rd] of Object.entries(rdays)) {
    if (!rd || typeof rd !== 'object') continue;
    const ld = s.days[k];
    if (!ld || (rd.m || 0) > (ld.m || 0)) {
      const merged = {
        done: Array.isArray(rd.done) ? rd.done : [],
        readings: Array.isArray(rd.readings) ? rd.readings : [],
        note: typeof rd.note === 'string' ? rd.note : '',
        mins: rd.mins && typeof rd.mins === 'object' ? rd.mins : {},
        m: rd.m || 0,
      };
      const w = validWeightKg(rd.weight);
      if (w != null) merged.weight = w;
      s.days[k] = merged;
      changed = true;
    }
  }
  if (remote.backfill && (remote.backfill.m || 0) > (s.backfill.m || 0) && Array.isArray(remote.backfill.ranges)) {
    s.backfill = { ranges: remote.backfill.ranges, m: remote.backfill.m };
    changed = true;
  }
  if (remote.prefs && (remote.prefs.m || 0) > (s.prefs.m || 0)) {
    s.prefs = { goalKg: validWeightKg(remote.prefs.goalKg), m: remote.prefs.m || 0 };
    changed = true;
  }
  if (changed) save('change', { silent: true });
  return changed;
}

// ---------- Export / import ----------

export function exportJson() {
  return JSON.stringify({ exportedAt: new Date().toISOString(), ...syncPayload() }, null, 2);
}

export function importJson(text) {
  const data = JSON.parse(text);
  mergeRemote(data);
  // A user-initiated import is a local mutation, not a sync echo: emit
  // non-silently so the imported data gets pushed to GitHub when sync is on.
  save();
  return true;
}

export function clearAll() {
  state = defaultState();
  save();
}

// ---------- Queries ----------

export function activeHabits() {
  return load().habits.filter((h) => !h.archived);
}

export function getDay(date) {
  return load().days[date] || { done: [], readings: [], note: '', mins: {}, m: 0 };
}

export function earliestDate() {
  const keys = Object.keys(load().days).filter((k) => {
    const d = load().days[k];
    return d.done.length || d.readings.length || d.note;
  });
  keys.sort();
  return keys[0] || null;
}
