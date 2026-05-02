# Lift Tracker

A personal mobile-first PWA for logging gym sessions, with workout history stored as JSON in this repo.

## Architecture

- **Phone** runs the installable PWA, logs sessions, pushes each save to `data/sessions.json` via the GitHub Contents API using a personal access token.
- **Computer** opens the same deployed URL — read-only by default, pulling `data/sessions.json` from `raw.githubusercontent.com` for analytics.
- **Programs** (`js/programs.js`) are edited locally and pushed via git. Phone PWA picks them up after the service worker cache busts.

## Setup

1. Deploy via GitHub Pages: Settings → Pages → branch `main`, folder `/`.
2. Generate a fine-grained PAT scoped to this repo with `Contents: Read and write`.
3. On phone: visit the deployed URL → Add to Home Screen → open from icon → Settings → GitHub Sync → enter owner / repo / branch / PAT → Test → Save.
4. On computer: visit the same URL → Settings → enter owner / repo / branch (no PAT) → Save. Read-only.

## Layout

```
index.html, manifest.webmanifest, service-worker.js
data/sessions.json            ← workout history (created on first phone push)
js/
  app.js                      ← entry, tab router, sync indicator
  programs.js                 ← workout day templates
  storage.js                  ← IndexedDB + export/import + LS migration
  sync.js                     ← GitHub Contents API client
  chart.js                    ← inline SVG line chart + heatmap
  views/{workout,history,progress,settings}.js
css/app.css
icons/
```
