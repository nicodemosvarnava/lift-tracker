// GitHub-as-data layer.
// Pulls and pushes sessions.json in a public GitHub repo.
// Phone is the only writer (uses a fine-grained PAT). Computer is read-only.

import * as storage from './storage.js';

const DATA_PATH = 'data/sessions.json';

export async function getConfig() {
  return {
    owner: (await storage.getSetting('gh_owner')) || '',
    repo: (await storage.getSetting('gh_repo')) || '',
    branch: (await storage.getSetting('gh_branch')) || 'main',
    pat: (await storage.getSetting('gh_pat')) || '',
  };
}

export async function setConfig({ owner, repo, branch, pat }) {
  await storage.setSetting('gh_owner', owner || '');
  await storage.setSetting('gh_repo', repo || '');
  await storage.setSetting('gh_branch', branch || 'main');
  if (pat !== undefined) await storage.setSetting('gh_pat', pat || '');
}

export async function isConfigured() {
  const c = await getConfig();
  return !!(c.owner && c.repo);
}

export async function isWriter() {
  const c = await getConfig();
  return !!(c.owner && c.repo && c.pat);
}

// ---- Pull ----
// If PAT present, use API for freshest data. Otherwise, use raw URL (public, cache-busted).
export async function pullRemote() {
  const c = await getConfig();
  if (!c.owner || !c.repo) return null; // not configured

  if (c.pat) {
    return pullViaApi(c);
  }
  return pullViaRaw(c);
}

async function pullViaRaw(c) {
  const url = `https://raw.githubusercontent.com/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}/${encodeURIComponent(c.branch)}/${DATA_PATH}?t=${Date.now()}`;
  const res = await fetch(url, { cache: 'no-store' });
  if (res.status === 404) return { sessions: [], sha: null };
  if (!res.ok) throw new Error(`Pull failed: ${res.status}`);
  const arr = await res.json();
  if (!Array.isArray(arr)) throw new Error(`${DATA_PATH} is not an array`);
  return { sessions: arr, sha: null };
}

async function pullViaApi(c) {
  const url = `https://api.github.com/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}/contents/${DATA_PATH}?ref=${encodeURIComponent(c.branch)}`;
  const res = await fetch(url, { headers: authHeaders(c), cache: 'no-store' });
  if (res.status === 404) return { sessions: [], sha: null };
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Pull failed: ${res.status} ${body.slice(0, 120)}`);
  }
  const data = await res.json();
  // The contents endpoint omits the body for files over 1 MB (encoding "none");
  // the blob endpoint serves up to 100 MB.
  const b64 = data.encoding === 'base64' ? data.content : await fetchBlob(c, data.sha);
  // Never fall back to [] here: pushSession merges into whatever this returns,
  // so an empty list would overwrite the whole history with one session.
  let parsed;
  try {
    parsed = JSON.parse(decodeBase64Utf8(b64 || '') || '[]');
  } catch {
    throw new Error(`${DATA_PATH} is not valid JSON — not touching it`);
  }
  if (!Array.isArray(parsed)) throw new Error(`${DATA_PATH} is not an array — not touching it`);
  return { sessions: parsed, sha: data.sha };
}

async function fetchBlob(c, sha) {
  const url = `https://api.github.com/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}/git/blobs/${sha}`;
  const res = await fetch(url, { headers: authHeaders(c), cache: 'no-store' });
  if (!res.ok) throw new Error(`Blob fetch failed: ${res.status}`);
  return (await res.json()).content;
}

function authHeaders(c) {
  return { Authorization: `Bearer ${c.pat}`, Accept: 'application/vnd.github+json' };
}

// ---- Push ----
// Atomic: GET current sha+content, merge new session, PUT back with sha.
// Retries once on 409 (sha conflict — someone else committed in between).
export async function pushSession(session, { commitMessage } = {}) {
  const c = await getConfig();
  if (!c.owner || !c.repo || !c.pat) throw new Error('GitHub not configured for write');

  const msg = commitMessage || `Log ${session.day} session ${session.date}`;

  for (let attempt = 0; attempt < 2; attempt++) {
    const { sessions, sha } = await pullViaApi(c);
    const merged = mergeSession(sessions, session);
    const content = encodeBase64Utf8(JSON.stringify(merged, null, 2) + '\n');
    const url = `https://api.github.com/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}/contents/${DATA_PATH}`;
    const body = {
      message: msg,
      content,
      branch: c.branch,
    };
    if (sha) body.sha = sha;
    const res = await fetch(url, {
      method: 'PUT',
      headers: { ...authHeaders(c), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      await storage.setSetting('gh_lastSync', new Date().toISOString());
      return await res.json();
    }
    if (res.status === 409 && attempt === 0) continue; // retry once on sha conflict
    const text = await res.text();
    throw new Error(`Push failed: ${res.status} ${text.slice(0, 200)}`);
  }
  throw new Error('Push failed after retry');
}

function mergeSession(remoteSessions, newSession) {
  const map = new Map();
  for (const s of remoteSessions) map.set(s.id, s);
  map.set(newSession.id, newSession);
  return Array.from(map.values()).sort((a, b) => new Date(a.date) - new Date(b.date));
}

// ---- Queue ----

export async function enqueue(session) {
  const q = (await storage.getSetting('gh_queue')) || [];
  if (!q.find((s) => s.id === session.id)) q.push(session);
  await storage.setSetting('gh_queue', q);
}

export async function getQueue() {
  return (await storage.getSetting('gh_queue')) || [];
}

export async function flushQueue() {
  if (!(await isWriter())) return { pushed: 0, remaining: (await getQueue()).length };
  const q = (await storage.getSetting('gh_queue')) || [];
  let pushed = 0;
  const remaining = [];
  for (const s of q) {
    try {
      await pushSession(s);
      pushed++;
    } catch (e) {
      console.warn('Sync push failed, will retry:', e);
      remaining.push(s);
      // stop on first failure to avoid hammering
      remaining.push(...q.slice(q.indexOf(s) + 1));
      break;
    }
  }
  await storage.setSetting('gh_queue', remaining);
  return { pushed, remaining: remaining.length };
}

// ---- Test ----

// Tests `c` (defaults to the saved config) without saving anything.
export async function testConnection(c) {
  c = c || (await getConfig());
  if (!c.owner || !c.repo) return { ok: false, error: 'Owner and repo required' };
  try {
    if (c.pat) {
      const url = `https://api.github.com/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}`;
      const res = await fetch(url, { headers: authHeaders(c) });
      if (res.status === 404) return { ok: false, error: 'Repo not found (or token lacks access)' };
      if (res.status === 401) return { ok: false, error: 'Token invalid' };
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
      const repo = await res.json();
      return { ok: true, mode: 'write', private: repo.private, fullName: repo.full_name };
    }
    // read-only mode: try raw URL
    const url = `https://raw.githubusercontent.com/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}/${encodeURIComponent(c.branch)}/${DATA_PATH}`;
    const res = await fetch(url, { method: 'HEAD' });
    if (res.status === 404) return { ok: true, mode: 'read', note: 'data/sessions.json not yet created' };
    if (!res.ok) return { ok: false, error: `HTTP ${res.status} on raw URL` };
    return { ok: true, mode: 'read' };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

// ---- Sync (pull then merge into local IndexedDB) ----

export async function syncNow() {
  if (!(await isConfigured())) return { ok: false, error: 'Not configured' };
  const remote = await pullRemote();
  if (!remote) return { ok: false, error: 'No remote' };

  const local = await storage.getSessions();
  const localById = new Map(local.map((s) => [s.id, s]));
  let added = 0;
  for (const s of remote.sessions) {
    if (!s || !s.id) continue;
    if (!localById.has(s.id)) {
      await storage.saveSession(s);
      added++;
    }
  }
  await storage.setSetting('gh_lastSync', new Date().toISOString());
  return { ok: true, pulledNew: added, totalRemote: remote.sessions.length };
}

// ---- base64 helpers (UTF-8 safe) ----

function encodeBase64Utf8(str) {
  // btoa only handles latin1; encode UTF-8 first.
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function decodeBase64Utf8(b64) {
  const cleaned = b64.replace(/\s/g, '');
  if (!cleaned) return '';
  const bin = atob(cleaned);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
