import { PROGRAMS, suggestSets } from '../programs.js';
import * as storage from '../storage.js';
import * as sync from '../sync.js';
import { showToast, refreshSyncIndicator } from '../app.js';

let currentDay = 'A';
let currentExIndex = 0;
let sessionStart = null;
let draftCache = {}; // { [exName]: { [setIdx]: { weight, reps, done }, note: string } }
let unitsLabel = 'kg';

function getSetClass(sets, si) {
  if (sets[si] === 'Warm-up') return 'warm-up';
  const workingIdx = si - (sets[0] === 'Warm-up' ? 1 : 0);
  return workingIdx === 0 ? 'working-1' : 'working-2';
}

function stepper(field, si, val, fillClass, { placeholder = '—', inputmode = 'numeric', step = 1 } = {}) {
  return `<div class="stepper">
    <button class="step-btn" data-si="${si}" data-field="${field}" data-step="${-step}" aria-label="Decrease">−</button>
    <input class="set-input ${fillClass}" type="number" inputmode="${inputmode}" id="inp-${field}-${si}"
      value="${val}" placeholder="${placeholder}" data-si="${si}" data-field="${field}">
    <button class="step-btn" data-si="${si}" data-field="${field}" data-step="${step}" aria-label="Increase">+</button>
  </div>`;
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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

async function setNote(exName, note) {
  if (!draftCache[exName]) draftCache[exName] = {};
  draftCache[exName].note = note;
  await persistDraft();
}

async function renderExercise() {
  const program = PROGRAMS[currentDay];
  const ex = program.exercises[currentExIndex];
  const exState = getExState(ex.name);
  const lastSets = await storage.getLastSets(null, ex.name);
  const lastNote = await storage.getLastNote(null, ex.name);
  const targets = suggestSets(ex, lastSets, unitsLabel);

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
      const label = s.label || ex.sets[i] || `Set ${i + 1}`;
      html += `<div class="last-set-chip">
        <span class="chip-label">${label}</span>
        <span class="chip-val">${s.weight ? s.weight + unitsLabel : '—'} × ${s.reps || '—'}</span>
      </div>`;
    });
  } else {
    html += `<span class="no-history">No previous data</span>`;
  }
  html += `</div>`;
  if (lastNote) {
    html += `<div class="last-note">📝 ${escapeHtml(lastNote)}</div>`;
  }
  html += `</div>`;

  const allDone = ex.sets.every((_, si) => (exState[si] || {}).done);
  if (!allDone) {
    html += `<button class="log-all-btn" id="btn-log-all">✓ Log all as planned${currentExIndex === total - 1 ? '' : ' → next'}</button>`;
  }

  const weightStep = (ex.inc || 2.5) * (unitsLabel === 'lb' ? 2 : 1);
  html += `<div class="sets-container">`;
  ex.sets.forEach((setLabel, si) => {
    const saved = exState[si] || {};
    // Prefill from this session's draft, else the progression target.
    const target = targets ? targets[si] : null;
    const hasSaved = (k) => saved[k] != null && saved[k] !== '';
    const weightVal = hasSaved('weight') ? saved.weight : (target ? target.weight : '');
    const repsVal = hasSaved('reps') ? saved.reps : (target ? target.reps : '');
    const isDraftFill = hasSaved('weight') || hasSaved('reps');
    const fillClass = !isDraftFill && (weightVal || repsVal) ? 'prefilled' : '';
    const bump = target && target.bump && !isDraftFill
      ? `<span class="set-target">↑ +${weightStep}${unitsLabel}</span>`
      : '';

    const isDone = saved.done || false;
    const setClass = getSetClass(ex.sets, si);
    html += `
      <div class="set-row ${setClass} ${isDone ? 'completed' : ''}" id="set-row-${si}">
        <div class="set-head">
          <div class="set-label">${setLabel}</div>
          ${bump}
          <button class="set-done-btn ${isDone ? 'done' : ''}" data-si="${si}" id="done-btn-${si}" aria-label="Mark set done">
            ${isDone ? '✓' : '○'}
          </button>
        </div>
        <div class="input-group">
          ${ex.isTime ? `
            ${stepper('reps', si, repsVal, fillClass, { placeholder: '0', step: 5 })}
            <span class="input-unit">sec</span>
          ` : ex.isBodyweight ? `
            ${stepper('reps', si, repsVal, fillClass, { placeholder: '0' })}
            <span class="input-unit">reps</span>
          ` : `
            ${stepper('weight', si, weightVal, fillClass, { placeholder: unitsLabel, inputmode: 'decimal', step: weightStep })}
            <span class="input-sep">×</span>
            ${stepper('reps', si, repsVal, fillClass)}
          `}
        </div>
      </div>`;
  });
  html += `</div>`;

  const noteVal = exState.note || '';
  html += `<div class="ex-note-wrap">
    <label class="ex-note-label" for="inp-note">Note for next session</label>
    <textarea class="ex-note" id="inp-note" rows="2"
      placeholder="e.g. go up 2.5kg next time, felt easy">${escapeHtml(noteVal)}</textarea>
  </div>`;

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
  view.querySelectorAll('.step-btn').forEach((el) => {
    el.addEventListener('click', () => onStep(el));
  });
  const logAllBtn = document.getElementById('btn-log-all');
  if (logAllBtn) logAllBtn.addEventListener('click', logAllAsPlanned);
  view.querySelectorAll('.set-done-btn').forEach((el) => {
    el.addEventListener('click', () => toggleDone(parseInt(el.dataset.si, 10)));
  });
  const noteEl = document.getElementById('inp-note');
  if (noteEl) noteEl.addEventListener('input', onNoteChange);
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

async function onStep(btn) {
  const si = parseInt(btn.dataset.si, 10);
  const field = btn.dataset.field;
  const input = document.getElementById(`inp-${field}-${si}`);
  const cur = parseFloat(input.value) || 0;
  const next = Math.max(0, Math.round((cur + parseFloat(btn.dataset.step)) * 100) / 100);
  input.value = String(next);
  input.classList.remove('prefilled');
  const ex = PROGRAMS[currentDay].exercises[currentExIndex];
  await setSet(ex.name, si, { [field]: input.value });
}

function readSetInputs(si) {
  const wEl = document.getElementById(`inp-weight-${si}`);
  const rEl = document.getElementById(`inp-reps-${si}`);
  const patch = {};
  if (wEl) patch.weight = wEl.value;
  if (rEl) patch.reps = rEl.value;
  return patch;
}

// One tap: every unfinished set is logged with what's on screen, then move on.
async function logAllAsPlanned() {
  const ex = PROGRAMS[currentDay].exercises[currentExIndex];
  for (let si = 0; si < ex.sets.length; si++) {
    if (((draftCache[ex.name] || {})[si] || {}).done) continue;
    await setSet(ex.name, si, { ...readSetInputs(si), done: true });
  }
  nextEx();
}

async function onNoteChange(e) {
  const ex = PROGRAMS[currentDay].exercises[currentExIndex];
  await setNote(ex.name, e.target.value);
}

async function toggleDone(si) {
  const ex = PROGRAMS[currentDay].exercises[currentExIndex];
  // Capture current input values into draft (for prefilled values that were never edited)
  const done = !((draftCache[ex.name] || {})[si] || {}).done;
  await setSet(ex.name, si, { ...readSetInputs(si), done });
  await renderExercise();
  // Last set ticked off → move to the next exercise automatically.
  const exIdx = currentExIndex;
  if (done && ex.sets.every((_, i) => (draftCache[ex.name][i] || {}).done)) {
    setTimeout(() => {
      if (currentExIndex === exIdx) nextEx();
    }, 700);
  }
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
  const exercises = program.exercises
    .map((ex) => {
      const exState = getExState(ex.name);
      // Only keep sets that were actually logged (have a value or were marked
      // done). Skipped exercises shouldn't pollute history / shadow last week.
      const sets = ex.sets
        .map((label, si) => {
          const v = exState[si] || {};
          return {
            label,
            weight: v.weight ?? null,
            reps: v.reps ?? null,
            isTime: !!ex.isTime,
            isBodyweight: !!ex.isBodyweight,
            done: !!v.done,
          };
        })
        .filter(
          (s) =>
            (s.weight != null && s.weight !== '') ||
            (s.reps != null && s.reps !== '') ||
            s.done,
        );
      const note = (exState.note || '').trim();
      return { name: ex.name, muscle: ex.muscle, sets, note: note || null };
    })
    .filter((ex) => ex.sets.length > 0 || ex.note);

  const duration = sessionStart ? Math.round((Date.now() - sessionStart) / 60000) : null;
  const saved = await storage.saveSession({
    day: currentDay,
    program: program.name,
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
