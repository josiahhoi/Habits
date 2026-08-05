#!/usr/bin/env node
// .github/scripts/strava-sync.mjs
//
// Syncs Strava activities into data/strava.json for the static habit tracker.
// Plain Node (>= 20), no npm dependencies — uses the global fetch.
//
// Env (required): STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET, STRAVA_REFRESH_TOKEN
//
// Output shape:
// {
//   "generatedAt": "2026-08-05T12:34:56.789Z",
//   "days": {
//     "2026-08-05": [
//       { "id": 123, "type": "Run", "name": "Morning Run",
//         "distance": 5012.3, "movingTime": 1802 }
//     ]
//   }
// }

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const TOKEN_URL = "https://www.strava.com/oauth/token";
const ACTIVITIES_URL = "https://www.strava.com/api/v3/athlete/activities";
const DATA_FILE = path.join(process.cwd(), "data", "strava.json");

const WINDOW_DAYS = 400;   // how far back we re-fetch on every run
const PER_PAGE = 200;      // Strava's maximum page size
const MAX_PAGES = 25;      // hard safety cap (25 * 200 = 5000 activities)

function requireEnv(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(
      `Missing required environment variable ${name}. ` +
        `Set it as a GitHub Actions repository secret (see README).`
    );
  }
  return value.trim();
}

async function getAccessToken(clientId, clientSecret, refreshToken) {
  let res;
  try {
    res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    });
  } catch (err) {
    throw new Error(`Network error calling Strava token endpoint: ${err.message}`);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "<unreadable body>");
    throw new Error(
      `Strava auth failed: token endpoint returned HTTP ${res.status}. ` +
        `Check the STRAVA_CLIENT_ID / STRAVA_CLIENT_SECRET / STRAVA_REFRESH_TOKEN secrets ` +
        `(a 400/401 here usually means the refresh token or client secret is wrong or revoked). ` +
        `Response: ${body}`
    );
  }

  const json = await res.json();
  if (!json.access_token) {
    throw new Error("Strava token response contained no access_token.");
  }

  // Strava's docs say to treat the refresh token as mutable: always store the
  // refresh_token that comes back, and once a newer one has been issued the
  // old one stops working. In practice the refresh_token grant returns the
  // same token back, but if it ever differs, the stored secret is stale.
  // Warn WITHOUT printing the new token — it would not be masked in public
  // Actions logs.
  if (json.refresh_token && json.refresh_token !== refreshToken) {
    console.log(
      "::warning::Strava returned a NEW refresh token; the STRAVA_REFRESH_TOKEN " +
        "secret is now stale and future runs may fail. Redo the one-time OAuth " +
        "authorization (see README) and update the secret."
    );
  }

  return json.access_token;
}

async function fetchAllActivities(accessToken, afterEpochSeconds) {
  const all = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = new URL(ACTIVITIES_URL);
    url.searchParams.set("after", String(afterEpochSeconds));
    url.searchParams.set("per_page", String(PER_PAGE));
    url.searchParams.set("page", String(page));

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (res.status === 401 || res.status === 403) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `Strava auth failed fetching activities (HTTP ${res.status}). ` +
          `The token likely lacks the activity:read_all scope — redo the ` +
          `one-time OAuth authorization with scope=activity:read_all. ${body}`
      );
    }
    if (res.status === 429) {
      throw new Error("Strava rate limit exceeded (HTTP 429). Try again later.");
    }
    if (!res.ok) {
      throw new Error(`Strava activities request failed: HTTP ${res.status}.`);
    }

    const batch = await res.json();
    if (!Array.isArray(batch)) {
      throw new Error(`Unexpected activities response: ${JSON.stringify(batch).slice(0, 200)}`);
    }

    all.push(...batch);
    if (batch.length < PER_PAGE) return all; // last page
  }
  console.log(
    `::warning::Stopped after ${MAX_PAGES} pages (${all.length} activities); ` +
      `older activities inside the window may be missing. Raise MAX_PAGES if this persists.`
  );
  return all;
}

// start_date_local looks like "2026-08-05T06:12:34Z". The trailing "Z" is a
// lie: the value is local wall-clock time. Take the date portion of the
// string directly — passing it through new Date()/toISOString() would
// reinterpret it as UTC and shift activities across midnight.
function localCalendarDate(activity) {
  const m = /^(\d{4}-\d{2}-\d{2})T/.exec(activity.start_date_local ?? "");
  return m ? m[1] : null;
}

function buildDays(activities) {
  const days = {};
  const sorted = [...activities].sort((a, b) =>
    String(a.start_date_local).localeCompare(String(b.start_date_local))
  );
  for (const a of sorted) {
    const date = localCalendarDate(a);
    if (!date) {
      console.log(`::warning::Skipping activity ${a.id}: unparseable start_date_local.`);
      continue;
    }
    (days[date] ??= []).push({
      id: a.id,
      // sport_type is the current field ("TrailRun", "MountainBikeRide", ...);
      // legacy `type` is deprecated but kept as a fallback.
      type: a.sport_type || a.type || "Workout",
      name: a.name ?? "",
      distance: Math.round((a.distance ?? 0) * 10) / 10, // meters
      movingTime: a.moving_time ?? 0, // seconds
    });
  }
  return days;
}

function sortKeys(daysObject) {
  const out = {};
  for (const key of Object.keys(daysObject).sort()) out[key] = daysObject[key];
  return out;
}

async function readExisting() {
  try {
    const raw = await readFile(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.days === "object" && parsed.days !== null) return parsed;
  } catch {
    // Missing or corrupt file — start fresh.
  }
  return { generatedAt: null, days: {} };
}

async function main() {
  const clientId = requireEnv("STRAVA_CLIENT_ID");
  const clientSecret = requireEnv("STRAVA_CLIENT_SECRET");
  const refreshToken = requireEnv("STRAVA_REFRESH_TOKEN");

  const nowEpoch = Math.floor(Date.now() / 1000);
  const afterEpoch = nowEpoch - WINDOW_DAYS * 24 * 60 * 60;

  const accessToken = await getAccessToken(clientId, clientSecret, refreshToken);
  const activities = await fetchAllActivities(accessToken, afterEpoch);
  console.log(`Fetched ${activities.length} activities from the last ~${WINDOW_DAYS} days.`);

  const fetchedDays = buildDays(activities);

  // Merge. Days on/after the prune boundary are authoritative from this fetch
  // (so activities deleted on Strava disappear). Days before the boundary
  // keep their existing (complete) data: the boundary sits 2 days after
  // `after` because `after` filters on UTC start time while our keys are
  // local dates, so the fetch may return only PART of a boundary day — the
  // existing entry must win there or activities would be silently lost.
  // Existing days the fetch knows nothing about are preserved as-is.
  const existing = await readExisting();
  const pruneFrom = new Date((afterEpoch + 2 * 24 * 60 * 60) * 1000)
    .toISOString()
    .slice(0, 10);

  const merged = { ...fetchedDays };
  for (const [date, list] of Object.entries(existing.days)) {
    if (date < pruneFrom) merged[date] = list;
  }

  const days = sortKeys(merged);

  // Only rewrite the file when the day data actually changed; otherwise
  // generatedAt alone would change every run and defeat the workflow's
  // "commit only if changed" guard.
  const newDaysJson = JSON.stringify(days);
  const oldDaysJson = JSON.stringify(sortKeys(existing.days));
  if (newDaysJson === oldDaysJson && existing.generatedAt) {
    console.log("No changes in activity data; leaving data/strava.json untouched.");
    return;
  }

  await mkdir(path.dirname(DATA_FILE), { recursive: true });
  await writeFile(
    DATA_FILE,
    JSON.stringify({ generatedAt: new Date().toISOString(), days }, null, 2) + "\n",
    "utf8"
  );
  console.log(`Wrote ${Object.keys(days).length} days to ${DATA_FILE}.`);
}

main().catch((err) => {
  console.error(`strava-sync failed: ${err.message}`);
  process.exit(1);
});
