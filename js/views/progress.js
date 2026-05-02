import * as storage from '../storage.js';
import { allExercises } from '../programs.js';
import { lineChart, heatmap, isoDate, estimated1RM, bestE1RM } from '../chart.js';

let unitsLabel = 'kg';
let selectedExercise = null;

export function mount(_container, { units = 'kg' } = {}) {
  unitsLabel = units;
}

export function show() {
  document.getElementById('progress-view').classList.add('visible');
  render();
}

export function hide() {
  document.getElementById('progress-view').classList.remove('visible');
}

export function setUnits(u) {
  unitsLabel = u;
  if (document.getElementById('progress-view').classList.contains('visible')) render();
}

async function render() {
  const sessions = await storage.getSessions();
  const container = document.getElementById('progress-content');

  // Default selection: most-recently-logged exercise.
  if (!selectedExercise) {
    for (let i = sessions.length - 1; i >= 0 && !selectedExercise; i--) {
      const exs = sessions[i].exercises || [];
      const ex = exs.find((e) => (e.sets || []).some((s) => s && s.weight && s.reps));
      if (ex) selectedExercise = ex.name;
    }
    if (!selectedExercise) {
      const all = allExercises();
      if (all.length) selectedExercise = all[0].name;
    }
  }

  // Calendar data
  const cells = new Map();
  for (const s of sessions) {
    const key = isoDate(new Date(s.date));
    const cur = cells.get(key) || { A: 0, B: 0 };
    cur[s.day] = (cur[s.day] || 0) + 1;
    cells.set(key, cur);
  }

  // Streak / counts
  const stats = computeStreaks(sessions);

  // Per-exercise progression points
  const points = [];
  let mostRecent = null;
  let allTimeBest = null;
  for (const s of sessions) {
    const ex = (s.exercises || []).find((e) => e.name === selectedExercise);
    if (!ex) continue;
    const best = bestE1RM(ex);
    if (best) {
      points.push({ date: new Date(s.date), value: best.value, label: `${best.set.weight}${unitsLabel} × ${best.set.reps}` });
      mostRecent = best.set;
      if (!allTimeBest || best.value > estimated1RM(allTimeBest.weight, allTimeBest.reps)) {
        allTimeBest = best.set;
      }
    }
  }

  const exerciseOptions = allExercises()
    .map((e) => `<option value="${escapeAttr(e.name)}" ${e.name === selectedExercise ? 'selected' : ''}>${e.name} <em>(${e.day})</em></option>`)
    .join('');

  container.innerHTML = `
    <section class="progress-section">
      <div class="section-title">Consistency</div>
      <div class="heatmap-wrap">${heatmap(cells, { weeks: 12 })}</div>
      <div class="legend">
        <span><span class="dot dot-a"></span> Day A</span>
        <span><span class="dot dot-b"></span> Day B</span>
      </div>
      <div class="stat-grid">
        <div class="stat-card"><div class="stat-label">Current streak</div><div class="stat-val">${stats.currentStreak}<span class="stat-unit">wk</span></div></div>
        <div class="stat-card"><div class="stat-label">Longest streak</div><div class="stat-val">${stats.longestStreak}<span class="stat-unit">wk</span></div></div>
        <div class="stat-card"><div class="stat-label">Last 7 days</div><div class="stat-val">${stats.last7}<span class="stat-unit">sessions</span></div></div>
        <div class="stat-card"><div class="stat-label">Last 30 days</div><div class="stat-val">${stats.last30}<span class="stat-unit">sessions</span></div></div>
      </div>
    </section>

    <section class="progress-section">
      <div class="section-title">Per-exercise progression</div>
      <select class="ex-dropdown" id="prog-ex-dropdown">${exerciseOptions}</select>
      <div class="chart-wrap">${lineChart(points, { width: 320, height: 180 })}</div>
      <div class="set-summary-row">
        <div class="set-summary-card">
          <div class="set-summary-label">Most recent</div>
          <div class="set-summary-val">${mostRecent ? `${mostRecent.weight}${unitsLabel} × ${mostRecent.reps}` : '—'}</div>
        </div>
        <div class="set-summary-card">
          <div class="set-summary-label">All-time best</div>
          <div class="set-summary-val">${allTimeBest ? `${allTimeBest.weight}${unitsLabel} × ${allTimeBest.reps}` : '—'}</div>
        </div>
      </div>
      <div class="chart-hint">Shows estimated 1RM (Brzycki) per session</div>
    </section>
  `;

  document.getElementById('prog-ex-dropdown').addEventListener('change', (e) => {
    selectedExercise = e.target.value;
    render();
  });
}

function computeStreaks(sessions) {
  if (!sessions.length) return { currentStreak: 0, longestStreak: 0, last7: 0, last30: 0 };
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const ms7 = today.getTime() - 7 * 24 * 3600 * 1000;
  const ms30 = today.getTime() - 30 * 24 * 3600 * 1000;
  let last7 = 0;
  let last30 = 0;
  const weeksWithSession = new Set();
  for (const s of sessions) {
    const d = new Date(s.date);
    const t = d.getTime();
    if (t >= ms7) last7++;
    if (t >= ms30) last30++;
    weeksWithSession.add(weekKey(d));
  }

  // Current streak: count back from this week (or last week if this week empty)
  let cur = 0;
  let cursor = new Date(today);
  if (!weeksWithSession.has(weekKey(cursor))) {
    cursor.setDate(cursor.getDate() - 7);
  }
  while (weeksWithSession.has(weekKey(cursor))) {
    cur++;
    cursor.setDate(cursor.getDate() - 7);
  }

  // Longest streak: scan all weeks present, find longest run of consecutive ISO weeks.
  const weekSet = weeksWithSession;
  let longest = 0;
  for (const wk of weekSet) {
    let run = 1;
    let next = nextWeekKey(wk);
    while (weekSet.has(next)) {
      run++;
      next = nextWeekKey(next);
    }
    if (run > longest) longest = run;
  }

  return { currentStreak: cur, longestStreak: longest, last7, last30 };
}

function weekKey(d) {
  // ISO week-year + week (rough — sufficient for streak grouping)
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = (date.getUTCDay() + 6) % 7; // Mon=0
  date.setUTCDate(date.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((date - firstThursday) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function nextWeekKey(wk) {
  const m = wk.match(/^(\d+)-W(\d+)$/);
  const y = parseInt(m[1], 10);
  const w = parseInt(m[2], 10);
  // crude: bump week by 1, roll over after week 52 (week 53 still gets evaluated correctly via membership check)
  const probe = new Date(Date.UTC(y, 0, 1 + (w) * 7));
  return weekKey(new Date(probe.getUTCFullYear(), probe.getUTCMonth(), probe.getUTCDate()));
}

function escapeAttr(s) {
  return String(s).replace(/"/g, '&quot;');
}
