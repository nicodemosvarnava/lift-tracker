import * as storage from '../storage.js';
import * as sync from '../sync.js';
import { showToast, refreshSyncIndicator } from '../app.js';

const APP_VERSION = '1.0.0';

let onUnitsChange = null;

export function mount(_container, { onUnitsChange: cb } = {}) {
  onUnitsChange = cb;
}

export function show() {
  document.getElementById('settings-view').classList.add('visible');
  render();
}

export function hide() {
  document.getElementById('settings-view').classList.remove('visible');
}

async function render() {
  const container = document.getElementById('settings-content');
  const sessions = await storage.getSessions();
  const lastBackup = await storage.lastBackupDate();
  const units = (await storage.getSetting('units')) || 'kg';
  const sessionCount = sessions.length;
  const ghCfg = await sync.getConfig();
  const lastSync = await storage.getSetting('gh_lastSync');
  const queue = await sync.getQueue();
  const queueCount = queue.length;

  const lastBackupStr = lastBackup
    ? formatRelative(new Date(lastBackup))
    : 'never';
  const daysSinceBackup = lastBackup
    ? Math.floor((Date.now() - new Date(lastBackup).getTime()) / (24 * 3600 * 1000))
    : Infinity;
  const backupNudge = daysSinceBackup >= 14 && sessionCount > 0
    ? `<div class="backup-nudge">Last backup: ${lastBackupStr}. Consider exporting.</div>`
    : `<div class="backup-info">Last backup: ${lastBackupStr}.</div>`;

  const lastSyncStr = lastSync ? formatRelative(new Date(lastSync)) : 'never';
  const syncStatus = !ghCfg.owner || !ghCfg.repo
    ? `<div class="settings-hint">Not configured. Sessions stay on this device.</div>`
    : ghCfg.pat
    ? `<div class="settings-hint">Mode: <span style="color:var(--accent)">read + write</span> · last sync ${lastSyncStr}${queueCount ? ` · <span style="color:var(--accent2)">${queueCount} queued</span>` : ''}</div>`
    : `<div class="settings-hint">Mode: <span style="color:var(--muted)">read-only</span> · last sync ${lastSyncStr}</div>`;

  container.innerHTML = `
    <section class="settings-section">
      <div class="section-title">GitHub Sync</div>
      ${syncStatus}
      <label class="field-label">Owner</label>
      <input class="field-input" id="gh-owner" placeholder="your-github-username" value="${escapeAttr(ghCfg.owner)}">
      <label class="field-label">Repo</label>
      <input class="field-input" id="gh-repo" placeholder="lift-tracker" value="${escapeAttr(ghCfg.repo)}">
      <label class="field-label">Branch</label>
      <input class="field-input" id="gh-branch" placeholder="main" value="${escapeAttr(ghCfg.branch || 'main')}">
      <label class="field-label">Personal Access Token <span class="field-hint">(leave blank for read-only on this device)</span></label>
      <input class="field-input" id="gh-pat" type="password" placeholder="${ghCfg.pat ? '••••••••' : 'github_pat_…'}" autocomplete="off">
      <div class="settings-btn-row">
        <button class="settings-btn" id="btn-test">Test connection</button>
        <button class="settings-btn primary" id="btn-save-sync">Save</button>
      </div>
      <button class="settings-btn" id="btn-sync-now">Sync now</button>
      <div id="sync-test-result" class="sync-test-result"></div>
    </section>

    <section class="settings-section">
      <div class="section-title">Local backup</div>
      ${backupNudge}
      <button class="settings-btn primary" id="btn-export">Export backup</button>
      <button class="settings-btn" id="btn-import">Import backup…</button>
      <button class="settings-btn" id="btn-import-merge">Merge import…</button>
      <input type="file" id="import-file" accept="application/json,.json" style="display:none">
      <input type="file" id="import-merge-file" accept="application/json,.json" style="display:none">
      <div class="settings-hint">${sessionCount} session${sessionCount === 1 ? '' : 's'} stored locally on this device.</div>
      <div class="settings-hint">Import = replace everything. Merge = update matching sessions, keep your settings &amp; token.</div>
    </section>

    <section class="settings-section">
      <div class="section-title">Units</div>
      <div class="radio-row">
        <label class="radio-pill ${units === 'kg' ? 'active' : ''}"><input type="radio" name="units" value="kg" ${units === 'kg' ? 'checked' : ''}> kg</label>
        <label class="radio-pill ${units === 'lb' ? 'active' : ''}"><input type="radio" name="units" value="lb" ${units === 'lb' ? 'checked' : ''}> lb</label>
      </div>
      <div class="settings-hint">Display only — your saved numbers don't change.</div>
    </section>

    <section class="settings-section">
      <div class="section-title">About</div>
      <div class="settings-hint">Lift Tracker · v${APP_VERSION}</div>
    </section>
  `;

  document.getElementById('btn-export').addEventListener('click', exportBackup);
  document.getElementById('btn-import').addEventListener('click', () => {
    document.getElementById('import-file').click();
  });
  document.getElementById('import-file').addEventListener('change', importBackup);
  document.getElementById('btn-import-merge').addEventListener('click', () => {
    document.getElementById('import-merge-file').click();
  });
  document.getElementById('import-merge-file').addEventListener('change', importMerge);
  container.querySelectorAll('input[name="units"]').forEach((el) => {
    el.addEventListener('change', async () => {
      await storage.setSetting('units', el.value);
      if (onUnitsChange) onUnitsChange(el.value);
      showToast(`Switched to ${el.value}`);
      render();
    });
  });

  document.getElementById('btn-save-sync').addEventListener('click', saveSyncConfig);
  document.getElementById('btn-test').addEventListener('click', testSyncConnection);
  document.getElementById('btn-sync-now').addEventListener('click', runSyncNow);
}

async function saveSyncConfig() {
  const owner = document.getElementById('gh-owner').value.trim();
  const repo = document.getElementById('gh-repo').value.trim();
  const branch = document.getElementById('gh-branch').value.trim() || 'main';
  const patEntered = document.getElementById('gh-pat').value;
  // Only update PAT if user typed something. Empty input means "keep existing".
  const cfg = { owner, repo, branch };
  if (patEntered) cfg.pat = patEntered;
  await sync.setConfig(cfg);
  showToast('Saved');
  await refreshSyncIndicator();
  render();
}

async function testSyncConnection() {
  const resultEl = document.getElementById('sync-test-result');
  resultEl.textContent = 'Testing…';
  resultEl.className = 'sync-test-result pending';

  // Stage current form values temporarily so test reflects what's typed
  const owner = document.getElementById('gh-owner').value.trim();
  const repo = document.getElementById('gh-repo').value.trim();
  const branch = document.getElementById('gh-branch').value.trim() || 'main';
  const patEntered = document.getElementById('gh-pat').value;
  const before = await sync.getConfig();
  const stash = { owner: before.owner, repo: before.repo, branch: before.branch, pat: before.pat };
  await sync.setConfig({ owner, repo, branch, pat: patEntered || before.pat });
  try {
    const r = await sync.testConnection();
    if (r.ok) {
      resultEl.textContent = `OK · ${r.mode === 'write' ? 'read+write' : 'read-only'}${r.fullName ? ` · ${r.fullName}` : ''}${r.note ? ` · ${r.note}` : ''}`;
      resultEl.className = 'sync-test-result ok';
    } else {
      resultEl.textContent = `Failed: ${r.error}`;
      resultEl.className = 'sync-test-result err';
    }
  } finally {
    // Restore previous config if user didn't click Save
    await sync.setConfig({ owner: stash.owner, repo: stash.repo, branch: stash.branch, pat: stash.pat });
  }
}

async function runSyncNow() {
  showToast('Syncing…');
  try {
    const r = await sync.syncNow();
    if (!r.ok) {
      showToast(`Sync failed: ${r.error}`);
      return;
    }
    if (await sync.isWriter()) {
      const flush = await sync.flushQueue();
      if (flush.pushed > 0) showToast(`Pushed ${flush.pushed}, pulled ${r.pulledNew}`);
      else showToast(r.pulledNew > 0 ? `Pulled ${r.pulledNew} new` : 'Already in sync');
    } else {
      showToast(r.pulledNew > 0 ? `Pulled ${r.pulledNew} new` : 'Already in sync');
    }
  } catch (e) {
    showToast(`Sync error: ${e.message}`);
  }
  await refreshSyncIndicator();
  render();
}

function escapeAttr(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

async function exportBackup() {
  const data = await storage.exportAll();
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const datestr = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `gym-backup-${datestr}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  await storage.recordBackup();
  showToast('Backup exported');
  render();
}

// Accept either a full export object { schemaVersion, sessions, … } or a bare
// sessions array (e.g. the repo's data/sessions.json downloaded directly).
function parsePayload(text) {
  const raw = JSON.parse(text);
  const payload = Array.isArray(raw) ? { schemaVersion: 1, sessions: raw } : raw;
  if (!payload || !Array.isArray(payload.sessions)) throw new Error('File is not a valid backup');
  if (typeof payload.schemaVersion !== 'number') payload.schemaVersion = 1;
  return payload;
}

async function importBackup(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  try {
    const payload = parsePayload(await file.text());
    const sessionCount = payload.sessions.length;
    const dateStr = payload.exportedAt ? new Date(payload.exportedAt).toLocaleDateString('en-GB') : 'unknown date';
    const ok = window.confirm(`Replace all data with ${sessionCount} session${sessionCount === 1 ? '' : 's'} from ${dateStr}?\n\nYour current data will be deleted.`);
    if (!ok) {
      e.target.value = '';
      return;
    }
    await storage.importAll(payload, { replace: true });
    showToast('Backup imported');
    e.target.value = '';
    render();
  } catch (err) {
    alert(`Import failed: ${err.message || err}`);
    e.target.value = '';
  }
}

// Merge: overwrite sessions with a matching id, add any new ones, and KEEP
// existing settings (GitHub token, units, …), draft, and other sessions.
async function importMerge(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  try {
    const payload = parsePayload(await file.text());
    const n = payload.sessions.length;
    const ok = window.confirm(`Merge ${n} session${n === 1 ? '' : 's'} into this device?\n\nSessions with the same id are overwritten; your settings, GitHub token, and other sessions are kept.`);
    if (!ok) {
      e.target.value = '';
      return;
    }
    await storage.importAll(payload, { replace: false });
    showToast(`Merged ${n} session${n === 1 ? '' : 's'}`);
    e.target.value = '';
    render();
  } catch (err) {
    alert(`Merge failed: ${err.message || err}`);
    e.target.value = '';
  }
}

function formatRelative(date) {
  const days = Math.floor((Date.now() - date.getTime()) / (24 * 3600 * 1000));
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
  return date.toLocaleDateString('en-GB');
}
