import * as storage from '../storage.js';

let unitsLabel = 'kg';

export function mount(_container, { units = 'kg' } = {}) {
  unitsLabel = units;
}

export function show() {
  document.getElementById('history-view').classList.add('visible');
  render();
}

export function hide() {
  document.getElementById('history-view').classList.remove('visible');
}

export function setUnits(u) {
  unitsLabel = u;
  if (document.getElementById('history-view').classList.contains('visible')) render();
}

async function render() {
  const sessions = await storage.getSessions();
  const container = document.getElementById('history-content');

  if (!sessions.length) {
    container.innerHTML = `<div class="empty-history">No sessions yet.<br>Complete a workout to see history.</div>`;
    return;
  }

  let html = '';
  [...sessions].reverse().forEach((session) => {
    const d = new Date(session.date);
    const dateStr = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
    html += `<div class="history-session">
      <div class="history-date">Day ${session.day} · ${dateStr}</div>`;

    (session.exercises || []).forEach((ex) => {
      const hasAny = (ex.sets || []).some((s) => s && (s.weight || s.reps));
      if (!hasAny) return;
      html += `<div class="history-ex">
        <div class="history-ex-name">${ex.name}</div>
        <div class="history-sets-row">`;
      ex.sets.forEach((s, si) => {
        if (s && (s.weight || s.reps)) {
          const label = s.label ? abbrev(s.label) : (si === 0 ? 'W' : `S${si}`);
          const weightStr = s.weight ? `${s.weight}${unitsLabel} × ` : '';
          html += `<span class="history-set-chip">${label}: ${weightStr}${s.reps || '—'}</span>`;
        }
      });
      html += `</div></div>`;
    });
    html += `</div>`;
  });

  container.innerHTML = html;
}

function abbrev(label) {
  if (label === 'Warm-up') return 'W';
  const m = label.match(/^Set (\d+)$/);
  if (m) return `S${m[1]}`;
  const r = label.match(/^Round (\d+)$/);
  if (r) return `R${r[1]}`;
  return label.slice(0, 4);
}
