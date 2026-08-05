# Habits

A personal habit tracker that runs entirely on GitHub Pages — no server, no accounts.

- **GitHub-style heatmaps** for each habit (Exercise, Greek/Hebrew Reading, Prayer — add your own), plus a combined view, streaks, and totals.
- **Verse-level reading log** — record exactly which passages you read each day.
- **Greek NT tab** — verse-accurate progress through the Greek New Testament (counted against NA28; the 16 verses absent from NA28 are excluded). Includes per-book meters, per-chapter shading, and a way to mark passages you read before you started tracking.
- **Exercise auto-sync from Strava** via a GitHub Action (Garmin watches: enable Garmin Connect → Strava auto-sync and activities flow through — Garmin's own API isn't open to individuals).
- **Cross-device sync with no backend**: the app can commit your log to this repo through the GitHub API using a fine-grained token you keep in your browser.

## Run it locally

```bash
python3 -m http.server 4173
```

Then open <http://localhost:4173>. (Any static file server works; opening `index.html` directly as a `file://` URL will not, because the app uses ES modules.)

## Publish to GitHub Pages

1. Push this folder to the GitHub repository:

   ```bash
   git init && git add -A && git commit -m "Habit tracker"
   git branch -M main
   git remote add origin https://github.com/josiahhoi/Habits.git
   git push -u origin main
   ```

2. In the repo: **Settings → Pages → Build and deployment → Source: Deploy from a branch**, branch `main`, folder `/ (root)`.
3. Your tracker is live at <https://josiahhoi.github.io/Habits/> a minute later. Add it to your phone's home screen for an app-like feel.

A **private repo** works too (Pages on private repos needs GitHub Pro; the free alternative is a public repo — your log file is then public, so keep notes non-sensitive, or upgrade).

## Cross-device sync (optional, recommended)

Without sync, data lives in each browser's localStorage (use Settings → Export for backups). With sync, every device reads and writes `data/log.json` in this repo:

1. GitHub → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
2. Repository access: **Only select repositories** → this repo. Permissions: **Contents → Read and write**. Nothing else.
3. In the app: **Settings → Sync across devices**, fill in owner/repo, paste the token, **Save & test**.
4. Repeat step 3 on each device (same token or a fresh one).

Merges are per-day, last-write-wins, so logging on your phone and laptop the same afternoon is fine. The token never leaves the browser you pasted it into.

## Exercise sync from Strava

The site shows exercise data from `data/strava.json`, which a GitHub Action refreshes every ~6 hours. Days with an activity automatically count as Exercise. One-time setup:

### 1. Create a Strava API application

1. Go to <https://www.strava.com/settings/api> (log in to Strava first).
2. Fill in the form. Any name/website is fine for personal use. Set **Authorization Callback Domain** to exactly:
   ```
   localhost
   ```
3. After saving, note your **Client ID** and **Client Secret** on that page.

### 2. One-time OAuth authorization (gets your refresh token)

The default tokens shown on the settings page only have `read` scope — you must do a real OAuth authorization to get `activity:read_all` (needed so private activities are counted).

1. Open this URL in your browser, replacing `YOUR_CLIENT_ID`:

   ```
   https://www.strava.com/oauth/authorize?client_id=YOUR_CLIENT_ID&redirect_uri=http://localhost&response_type=code&approval_prompt=force&scope=activity:read_all
   ```

2. Click **Authorize** (leave "View data about your private activities" checked).
3. Your browser will try to load `http://localhost/...` and fail — that's expected. Copy the `code` value out of the address bar. It looks like:

   ```
   http://localhost/?state=&code=1a2b3c4d5e6f...&scope=read,activity:read_all
   ```

   Confirm the `scope` in that URL includes `activity:read_all`.
4. Exchange the code for tokens (codes are single-use and expire quickly — if this fails, redo step 1):

   ```bash
   curl -X POST https://www.strava.com/oauth/token -d client_id=YOUR_CLIENT_ID -d client_secret=YOUR_CLIENT_SECRET -d code=CODE_FROM_URL -d grant_type=authorization_code
   ```

5. From the JSON response, save the **`refresh_token`** value. (The `access_token` only lives 6 hours; the workflow mints fresh ones itself, so you can ignore it.)

### 3. Add the repository secrets

In the repo: **Settings → Secrets and variables → Actions → New repository secret**, create all three:

| Secret name | Value |
|---|---|
| `STRAVA_CLIENT_ID` | Client ID from step 1 |
| `STRAVA_CLIENT_SECRET` | Client Secret from step 1 |
| `STRAVA_REFRESH_TOKEN` | `refresh_token` from step 2 |

Or with the GitHub CLI: `gh secret set STRAVA_CLIENT_ID` (and likewise for the other two).

### 4. First run

Go to **Actions → Strava sync → Run workflow**. The job fetches the last ~400 days of activities and commits `data/strava.json`. After that it runs automatically every ~6 hours (roughly 8–16 API requests/day — far under Strava's rate limits).

**Note on Pages deployment:** the sync commit is made with the built-in `GITHUB_TOKEN`, and commits pushed with that token do not trigger other Actions workflows. If your Pages site uses **Deploy from a branch** (what this README recommends), you're fine — GitHub's built-in Pages build still picks the commit up. If you instead deploy Pages via your own Actions workflow triggered on `push`, that workflow will NOT fire for sync commits.

**Garmin (and other watch) users:** you don't need Garmin's API — it's business-partners-only. Link the accounts once — in the Strava app under **Settings → Connect an App or Device → Garmin**, or from Garmin Connect's Connected Apps settings — and every activity recorded on the watch auto-uploads to Garmin Connect and forwards to Strava within minutes, where this sync picks it up. Linking covers activities going forward; for older Garmin history the documented route is manually exporting activities from Garmin Connect and bulk-uploading them to Strava (up to 25 files at a time).

**If a run warns that Strava returned a new refresh token:** redo step 2 and update the `STRAVA_REFRESH_TOKEN` secret.

## Data & privacy

- Your log is one JSON file: habits, one entry per day (habit completions, passages read, optional note), plus "previously read" passages. Export/import from Settings.
- If the repo is public, `data/log.json` and `data/strava.json` are public. They contain habit completions, Bible references, and activity names/dates — no location data (the sync script stores only type, name, distance, and duration).
- Verse numbering follows standard English (KJV) versification; Greek NT progress excludes the 16 verses absent from NA28.
