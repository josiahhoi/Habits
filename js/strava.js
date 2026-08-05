// Reads data/strava.json (written by the GitHub Action) and answers
// "was there exercise on this day?".

let data = { generatedAt: null, days: {} };
let loaded = false;

export async function loadStrava() {
  try {
    const r = await fetch('./data/strava.json', { cache: 'no-store' });
    if (r.ok) {
      const j = await r.json();
      if (j && typeof j === 'object') {
        data = { generatedAt: j.generatedAt || null, days: j.days && typeof j.days === 'object' ? j.days : {} };
      }
    }
  } catch {
    // offline or file:// — the tracker still works, exercise is just manual
  }
  loaded = true;
  return data;
}

export const stravaLoaded = () => loaded;
export const activitiesOn = (date) => data.days[date] || [];
export const hasActivity = (date) => (data.days[date] || []).length > 0;
export const stravaGeneratedAt = () => data.generatedAt;
export const stravaDayCount = () => Object.keys(data.days).length;

export function earliestStravaDay() {
  const keys = Object.keys(data.days).sort();
  return keys[0] || null;
}
