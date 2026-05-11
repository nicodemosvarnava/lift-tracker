import { PROGRAMS } from '../programs.js';
import * as storage from '../storage.js';
import * as sync from '../sync.js';
import { showToast, refreshSyncIndicator } from '../app.js';

let currentDay = 'A';
let currentExIndex = 0;
let sessionStart = null;
let draftCache = {}; // { [exName]: { [setIdx]: { weight, reps, done } } }
let unitsLabel = 'kg';

function getSetClass(idx) {
  if (idx === 0) return 'warm-up';
  if (idx === 1) return 'working-1';
  return 'working-2';
}

function getExState(exName) {
  return draftCache[exName] || {};
}

function isExerciseDone(exIdx) {
  const program = PROGRAMS[currentDay];
  const ex = program.exercises[exIdx];
  const exState = getExState(ex.name);
  const hasWarmup = ex.sets[0] === 'Warm-up';
  const startIdx = hasWarmup ? 1 : 0;
  let total = 0;
  let done = 0;
  for (let si = startIdx; si < ex.sets.length; si++) {
    total++;
    if (exState[String(si)] && exState[String(si)].done) done++;
  }
  return total > 0 && done === total;
}

async function persistDraft() {
  await storage.setDraft(currentDay, draftCache);
}

async function setSet(exName, si, patch) {
  if (!draftCache[exName]) draftCache[exName] = {};
  if (!draftCache[exName][si]) draftCache[exName][si] = {};
  Object.assign(draftCache[exName][si], patch);
  await persistDraft();
}

async function renderExercise() {
  const program = PROGRAMS[currentDay];
  const ex = program.exercises[currentExIndex];
  const exState = getExState(ex.name);
  const lastSets = await storage.getLastSets(currentDay, ex.name);

  const total = program.exercises.length;
  const doneSoFar = program.exercises.filter((_, ei) => isExerciseDone(ei)).length;
  document.getElementById('progress-label-text').textContent = `${doneSoFar} of ${total} done`;
  document.getElementById('progress-pct').textContent = Math.round((doneSoFar / total) * 100) + '%';
  document.getElementById('progress-fill').style.width = Math.round((doneSoFar / total) * 100) + '%';

  const dropdown = document.getElementById('ex-dropdown');
  dropdown.innerHTML = program.exercises
    .map((e, i) => {
      const done = isExerciseDone(i);
      return `<option value="${i}" ${i === currentExIndex ? 'selected' : ''}>${done ? '✓' : '○'} ${i + 1}. ${e.name}</option>`;
    })
    .join('');

  const exDone = isExerciseDone(currentExIndex);
  let html = `
    <div class="ex-header">
      <div class="ex-number">${String(currentExIndex + 1).padStart(2, '0')}</div>
      <div class="ex-tag">${ex.muscle}${exDone ? ' &nbsp;<span style="color:var(--accent);font-size:11px;">✓ DONE</span>' : ''}</div>
      <div class="ex-name">${ex.name}</div>
      <div class="ex-rep-guide">Target: <span>${ex.reps} reps</span></div>
    </div>`;

  html += `<div class="last-session">
    <div class="last-session-label">Last Session</div>
    <div class="last-session-sets">`;
  if (lastSets && lastSets.length) {
    lastSets.forEach((s, i) => {
      const label = ex.sets[i] || `Set ${i + 1}`;
      html += `<div class="last-set-chip">
        <span class="chip-label">${label}</span>
        <span class="chip-val">${s.weight ? s.weight + unitsLabel : '—'} × ${s.reps || '—'}</span>
      </div>`;
    });
  } else {
    html += `<span class="no-history">No previous data</span>`;
  }
  html += `</div></div>`;

  html += `<div class="sets-container">`;
  ex.sets.forEach((setLabel, si) => {
    const saved = exState[si] || {};
    // Quick-fill: if no current draft value, prefill from last session.
    const lastSet = lastSets && lastSets[si] ? lastSets[si] : null;
    const weightVal = saved.weight != null && saved.weight !== ''
      ? saved.weight
      : (lastSet && lastSet.weight ? lastSet.weight : '');
    const repsVal = saved.reps != null && saved.reps !== ''
      ? saved.reps
      : (lastSet && lastSet.reps ? lastSet.reps : '');
    const isDraftFill = (saved.weight != null && saved.weight !== '') || (saved.reps != null && saved.reps !== '');
    const fillClass = !isDraftFill && (weightVal || repsVal) ? 'prefilled' : '';

    const isDone = saved.done || false;
    const setClass = getSetClass(si);
    html += `
      <div class="set-row ${setClass} ${isDone ? 'completed' : ''}" id="set-row-${si}">
        <div class="set-label">${setLabel}</div>
        <div class="input-group">
          ${ex.isTime ? `
            <input class="set-input ${fillClass}" type="number" inputmode="numeric" id="inp-reps-${si}"
              value="${repsVal}" placeholder="0" data-si="${si}" data-field="reps" style="width:72px">
            <span class="input-unit">sec</span>
          ` : ex.isBodyweight ? `
            <input class="set-input ${fillClass}" type="number" inputmode="numeric" id="inp-reps-${si}"
              value="${repsVal}" placeholder="0" data-si="${si}" data-field="reps" style="width:72px">
            <span class="input-unit">reps</span>
          ` : `
            <input class="set-input ${fillClass}" type="number" inputmode="decimal" id="inp-weight-${si}"
              value="${weightVal}" placeholder="${unitsLabel}" data-si="${si}" data-field="weight">
            <span class="input-sep">×</span>
            <input class="set-input ${fillClass}" type="number" inputmode="numeric" id="inp-reps-${si}"
              value="${repsVal}" placeholder="—" data-si="${si}" data-field="reps">
          `}
        </div>
        <button class="set-done-btn ${isDone ? 'done' : ''}" data-si="${si}" id="done-btn-${si}">
          ${isDone ? '✓' : '○'}
        </button>
      </div>`;
  });
  html += `</div>`;

  html += `<div class="nav-buttons">
    <button class="nav-btn prev ${currentExIndex === 0 ? 'disabled' : ''}" id="btn-prev">← Back</button>
    <button class="nav-btn next" id="btn-next">
      ${currentExIndex === total - 1 ? 'Finish →' : 'Next →'}
    </button>
  </div>`;

  const view = document.getElementById('exercise-view');
  view.innerHTML = html;

  // Wire up events (no inline handlers — clean event delegation)
  view.querySelectorAll('.set-input').forEach((el) => {
    el.addEventListener('input', onInputChange);
    el.addEventListener('focus', onInputFocus);
  });
  view.querySelectorAll('.set-done-btn').forEach((el) => {
    el.addEventListener('click', () => toggleDone(parseInt(el.dataset.si, 10)));
  });
  document.getElementById('btn-prev').addEventListener('click', prevEx);
  document.getElementById('btn-next').addEventListener('click', nextEx);
}

function onInputFocus(e) {
  // Once user focuses, the prefilled hint visual goes away on input.
  e.target.classList.remove('prefilled');
}

async function onInputChange(e) {
  const si = parseInt(e.target.dataset.si, 10);
  const field = e.target.dataset.field;
  const ex = PROGRAMS[currentDay].exercises[currentExIndex];
  const v = e.target.value;
  await setSet(ex.name, si, { [field]: v });
  e.target.classList.remove('prefilled');
}

async function toggleDone(si) {
  const ex = PROGRAMS[currentDay].exercises[currentExIndex];
  // Capture current input values into draft (for prefilled values that were never edited)
  const wEl = document.getElementById(`inp-weight-${si}`);
  const rEl = document.getElementById(`inp-reps-${si}`);
  const patch = {};
  if (wEl) patch.weight = wEl.value;
  if (rEl) patch.reps = rEl.value;
  patch.done = !((draftCache[ex.name] || {})[si] || {}).done;
  await setSet(ex.name, si, patch);
  await renderExercise();
}

function jumpToExercise(idx) {
  currentExIndex = parseInt(idx, 10);
  renderExercise();
}

function prevEx() {
  if (currentExIndex > 0) {
    currentExIndex--;
    renderExercise();
  }
}

function nextEx() {
  const total = PROGRAMS[currentDay].exercises.length;
  if (currentExIndex < total - 1) {
    currentExIndex++;
    renderExercise();
  } else {
    showDoneScreen();
  }
}

function showDoneScreen() {
  const duration = sessionStart ? Math.round((Date.now() - sessionStart) / 60000) : 0;
  document.getElementById('done-duration').textContent = duration > 0 ? `${duration} min` : 'Session complete';

  const program = PROGRAMS[currentDay];
  let summaryHtml = `<div class="summary-title">${currentDay} — ${program.name}</div>`;
  program.exercises.forEach((ex) => {
    const exState = getExState(ex.name);
    const doneSets = Object.values(exState).filter((s) => s && s.done).length;
    const totalSets = ex.sets.length;
    summaryHtml += `
      <div class="summary-ex">
        <span class="summary-ex-name">${ex.name}</span>
        <span class="summary-ex-sets">${doneSets}/${totalSets} sets</span>
      </div>`;
  });
  document.getElementById('session-summary').innerHTML = summaryHtml;
  document.getElementById('done-screen').classList.add('visible');
  document.getElementById('workout-view').style.display = 'none';
  document.getElementById('progress-wrap').style.display = 'none';
  document.getElementById('dropdown-wrap').style.display = 'none';
}

async function saveSession() {
  const program = PROGRAMS[currentDay];
  const exercises = program.exercises.map((ex) => {
    const exState = getExState(ex.name);
    const sets = ex.sets.map((label, si) => {
      const v = exState[si] || {};
      return {
        label,
        weight: v.weight ?? null,
        reps: v.reps ?? null,
        isTime: !!ex.isTime,
        isBodyweight: !!ex.isBodyweight,
        done: !!v.done,
      };
    });
    return { name: ex.name, muscle: ex.muscle, sets };
  });

  const duration = sessionStart ? Math.round((Date.now() - sessionStart) / 60000) : null;
  const saved = await storage.saveSession({
    day: currentDay,
    date: new Date().toISOString(),
    durationMin: duration,
    exercises,
  });
  await storage.clearDraft(currentDay);
  draftCache = {};
  showToast('Session saved!');

  // Try to push to GitHub. If offline / unauthorized, queue for retry.
  if (await sync.isWriter()) {
    try {
      await sync.pushSession(saved);
      showToast('Synced to GitHub');
    } catch (err) {
      console.warn('Sync failed, queuing:', err);
      await sync.enqueue(saved);
      showToast('Saved locally — will sync when online');
    }
    refreshSyncIndicator();
  }

  setTimeout(() => {
    resetWorkout();
    document.dispatchEvent(new CustomEvent('navigate', { detail: 'history' }));
  }, 1000);
}

async function resetWorkout() {
  currentExIndex = 0;
  sessionStart = Date.now();
  draftCache = await storage.getDraft(currentDay);
  document.getElementById('done-screen').classList.remove('visible');
  document.getElementById('workout-view').style.display = '';
  document.getElementById('progress-wrap').style.display = '';
  document.getElementById('dropdown-wrap').style.display = '';
  await renderExercise();
}

async function switchDay(day) {
  currentDay = day;
  currentExIndex = 0;
  document.querySelectorAll('.day-tab').forEach((t, i) => {
    t.classList.toggle('active', (i === 0 && day === 'A') || (i === 1 && day === 'B'));
  });
  document.getElementById('done-screen').classList.remove('visible');
  document.getElementById('workout-view').style.display = '';
  document.getElementById('progress-wrap').style.display = '';
  document.getElementById('dropdown-wrap').style.display = '';
  draftCache = await storage.getDraft(currentDay);
  await renderExercise();
}

export async function mount(container, { units = 'kg' } = {}) {
  unitsLabel = units;

  // Wire static controls (these elements live in index.html)
  document.querySelectorAll('.day-tab').forEach((btn, i) => {
    btn.addEventListener('click', () => switchDay(i === 0 ? 'A' : 'B'));
  });
  document.getElementById('ex-dropdown').addEventListener('change', (e) => jumpToExercise(e.target.value));
  document.getElementById('btn-save').addEventListener('click', saveSession);
  document.getElementById('btn-reset').addEventListener('click', resetWorkout);

  draftCache = await storage.getDraft(currentDay);
  sessionStart = Date.now();
  await renderExercise();
}

export function show() {
  document.getElementById('workout-shell').style.display = '';
}

export function hide() {
  document.getElementById('workout-shell').style.display = 'none';
}

export async function refresh() {
  draftCache = await storage.getDraft(currentDay);
  if (document.getElementById('exercise-view')) await renderExercise();
}

export function setUnits(u) {
  unitsLabel = u;
  if (document.getElementById('exercise-view')) renderExercise();
}
