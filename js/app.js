import * as storage from './storage.js';
import * as sync from './sync.js';
import * as workoutView from './views/workout.js';
import * as historyView from './views/history.js';
import * as progressView from './views/progress.js';
import * as settingsView from './views/settings.js';

const VIEWS = {
  workout: workoutView,
  history: historyView,
  progress: progressView,
  settings: settingsView,
};

let currentView = 'workout';

export function showToast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => t.classList.remove('show'), 2000);
}

export async function refreshSyncIndicator() {
  const dot = document.getElementById('sync-dot');
  if (!dot) return;
  const configured = await sync.isConfigured();
  if (!configured) {
    dot.className = 'sync-dot off';
    dot.title = 'Sync not configured';
    return;
  }
  const queue = await sync.getQueue();
  if (queue.length > 0) {
    dot.className = 'sync-dot pending';
    dot.title = `${queue.length} session${queue.length === 1 ? '' : 's'} waiting to sync`;
  } else {
    dot.className = 'sync-dot ok';
    dot.title = 'Synced';
  }
}

function switchTo(name) {
  if (!VIEWS[name]) return;
  if (currentView !== name) {
    VIEWS[currentView].hide();
    currentView = name;
    VIEWS[name].show();
  } else {
    VIEWS[name].show();
  }
  document.querySelectorAll('.bottom-nav-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.view === name);
  });
}

async function init() {
  await storage.init();
  const units = (await storage.getSetting('units')) || 'kg';

  document.getElementById('date-badge').textContent = new Date().toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });

  await workoutView.mount(null, { units });
  historyView.mount(null, { units });
  progressView.mount(null, { units });
  settingsView.mount(null, {
    onUnitsChange: (u) => {
      workoutView.setUnits(u);
      historyView.setUnits(u);
      progressView.setUnits(u);
    },
  });

  document.querySelectorAll('.bottom-nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => switchTo(btn.dataset.view));
  });

  document.addEventListener('navigate', (e) => switchTo(e.detail));

  // Show workout by default; hide others.
  Object.entries(VIEWS).forEach(([name, view]) => {
    if (name !== 'workout') view.hide();
  });
  workoutView.show();

  // Register service worker (only when served over http(s); won't fire on file://)
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('./service-worker.js').catch((err) => {
      console.warn('SW registration failed:', err);
    });
  }

  // Initial sync: pull from GitHub, flush queued pushes. Best-effort; failures are silent.
  if (await sync.isConfigured()) {
    try {
      const result = await sync.syncNow();
      if (result.ok && result.pulledNew > 0) showToast(`Pulled ${result.pulledNew} session${result.pulledNew === 1 ? '' : 's'}`);
    } catch (e) {
      console.warn('Initial pull failed:', e);
    }
    if (await sync.isWriter()) {
      sync.flushQueue().catch((e) => console.warn('Queue flush failed:', e));
    }
  }
  await refreshSyncIndicator();

  window.addEventListener('online', async () => {
    if (await sync.isWriter()) {
      const r = await sync.flushQueue();
      if (r.pushed > 0) showToast(`Synced ${r.pushed} session${r.pushed === 1 ? '' : 's'}`);
      await refreshSyncIndicator();
    }
  });
}

init();
