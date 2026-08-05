# Habits

A personal habit tracker that runs entirely on GitHub Pages — no server, no accounts.

- **GitHub-style heatmaps** for each habit (Greek/Hebrew Reading, Prayer — add your own), plus a combined view, streaks, and totals.
- **Amount shading** — the Reading heatmap shades by verses read that day (under 10 / under 30 / 30+, roughly a chapter), and the Prayer heatmap by minutes (under 15m / under 30m / 30m+), with per-habit totals.
- **Prayer time tracking** — log minutes per day (quick +5/+15/+30 buttons in the day panel). Any habit can track time via Settings → ⏱.
- **Verse-level reading log** — record exactly which passages you read each day.
- **Greek NT tab** — verse-accurate progress through the Greek New Testament (counted against NA28; the 16 verses absent from NA28 are excluded). Includes per-book meters, per-chapter shading, and a way to mark passages you read before you started tracking.
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

## Data & privacy

- Your log is one JSON file: habits, one entry per day (habit completions, passages read, optional note), plus "previously read" passages. Export/import from Settings.
- If the repo is public, `data/log.json` is public. It contains habit completions, Bible references, minutes, and any notes you write — keep notes non-sensitive, or make the repo private (Pages on private repos needs GitHub Pro).
- Verse numbering follows standard English (KJV) versification; Greek NT progress excludes the 16 verses absent from NA28.
