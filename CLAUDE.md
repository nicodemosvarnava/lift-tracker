# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project shape

Vanilla-JS, zero-dependency PWA. There is no build step, no bundler, no package.json, no test runner, no linter. Source files are served as-is.

**Run locally:** any static HTTP server from the repo root, e.g. `python3 -m http.server 8000` then open `http://localhost:8000/`. Service worker only registers over `http(s)`, not `file://` (see `js/app.js`).

**Deploy:** GitHub Pages from `main` / root. There is no CI.

**"Tests":** none. Verify changes by loading the page in a browser and exercising the UI; the four tabs (workout/history/progress/settings) cover the surface area.

## Architecture — what you must understand before editing

### Data flows in two directions through GitHub itself

The repo *is* the database. Workout history lives at `data/sessions.json` in this same GitHub repo (created lazily on the first phone push — not committed in the initial template).

- **Phone** = writer. Has a fine-grained PAT stored in IndexedDB, uses the GitHub Contents API to PUT `data/sessions.json`.
- **Computer** = reader. No PAT; pulls `raw.githubusercontent.com/.../data/sessions.json` for analytics, read-only.
- The split is enforced by `sync.isWriter()` (requires `gh_pat`) vs `sync.isConfigured()` (just owner+repo). Any new write path must gate on `isWriter()`.

`sync.pushSession` is atomic-with-retry: GET sha+content → merge by session id → PUT with sha → retry once on 409. If you change the push path, preserve the sha round-trip — the merge is what keeps phone and any future writer from clobbering each other.

Failed pushes go into a queue (`gh_queue` setting). `flushQueue` drains on app load and on the `online` event, stopping at the first failure to avoid hammering the API.

### Local storage is IndexedDB, not localStorage

`js/storage.js` owns the `liftDB` IndexedDB with three stores: `sessions`, `draft` (in-progress workout per day), `settings` (k/v, including GitHub config and the migration flag).

A one-time migration on first init copies the legacy `liftHistory` / `liftState` keys out of localStorage. Don't reintroduce localStorage — go through `storage.getSetting` / `setSetting`.

`SCHEMA_VERSION` in `storage.js` and `DB_VERSION` are separate; if you change the IndexedDB shape, bump `DB_VERSION` and add an `onupgradeneeded` branch.

### Service worker has two invariants you can break silently

`service-worker.js`:

1. **Bump `CACHE` on every shipped change** (currently `'lift-v2'`). Old caches are evicted only on activate when the cache name changes; otherwise installed phones keep serving stale JS forever.
2. **Add new top-level modules to `APP_SHELL`**. The service worker precaches that exact list — a new file under `js/views/` or `js/` won't be reachable offline if it's missing.
3. **Never cache `api.github.com` or `raw.githubusercontent.com`.** The fetch handler explicitly skips them so sync always sees fresh remote state. If you add another data origin, exempt it the same way.

### Module layout

`js/app.js` is the entry: boots storage, mounts all four view modules at startup, then toggles their visibility on tab change (views aren't re-mounted, they `show()`/`hide()`). Tabs can also be switched programmatically via `document.dispatchEvent(new CustomEvent('navigate', { detail: 'history' }))`.

Views (`js/views/{workout,history,progress,settings}.js`) each export `mount`, `show`, `hide`, and `setUnits`. Workout view is the only one with a draft persisted to IndexedDB between sessions.

`js/programs.js` is the workout-template source of truth (Day A push+core, Day B pull+legs). Programs are code, not data — edit and commit, then the phone picks them up after the service worker cache busts (so bump `CACHE` when changing programs).

`js/chart.js` renders inline SVG (line chart + heatmap) and computes Brzycki e1RM. No charting library.

### Legacy file

`gym-tracker.html` at the repo root is the pre-refactor single-file prototype. It's not referenced by `index.html` or the service worker and is not part of the running app. Leave it alone unless explicitly asked.

## Conventions worth following

- ES modules with relative `./` / `../` paths. No bundler will rewrite them.
- All async DB access goes through `storage.js` helpers; don't open IndexedDB directly from views.
- Settings keys are flat strings (`gh_owner`, `gh_pat`, `units`, `migratedFromLS`, …). Grep `getSetting`/`setSetting` before introducing a new one.
- UI is mobile-first and dark-themed; colors live in `css/app.css` and are duplicated as constants in `chart.js` for SVG output — keep them in sync if you reskin.
