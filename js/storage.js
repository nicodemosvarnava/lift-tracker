const DB_NAME = 'liftDB';
const DB_VERSION = 1;
const SCHEMA_VERSION = 1;

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('sessions')) {
        const s = db.createObjectStore('sessions', { keyPath: 'id' });
        s.createIndex('byDate', 'date');
        s.createIndex('byDay', 'day');
      }
      if (!db.objectStoreNames.contains('draft')) {
        db.createObjectStore('draft', { keyPath: 'day' });
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(storeName, mode = 'readonly') {
  return openDB().then((db) => db.transaction(storeName, mode).objectStore(storeName));
}

function reqAsPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export async function init() {
  await openDB();
  const migrated = await getSetting('migratedFromLS');
  if (!migrated) {
    await migrateFromLocalStorage();
    await setSetting('migratedFromLS', true);
    await setSetting('schemaVersion', SCHEMA_VERSION);
  }
}

async function migrateFromLocalStorage() {
  try {
    const histRaw = localStorage.getItem('liftHistory');
    if (histRaw) {
      const hist = JSON.parse(histRaw);
      if (Array.isArray(hist)) {
        for (const s of hist) {
          await saveSession({
            id: s.id || genId(),
            day: s.day,
            date: s.date,
            durationMin: s.durationMin || null,
            exercises: s.exercises || [],
          });
        }
      }
    }
    const stateRaw = localStorage.getItem('liftState');
    if (stateRaw) {
      const state = JSON.parse(stateRaw);
      for (const day of Object.keys(state || {})) {
        await setDraft(day, state[day] || {});
      }
    }
  } catch (e) {
    console.warn('Migration from localStorage failed:', e);
  }
}

// ---- sessions ----

export async function getSessions() {
  const store = await tx('sessions');
  const req = store.index('byDate').getAll();
  const list = await reqAsPromise(req);
  return list.sort((a, b) => new Date(a.date) - new Date(b.date));
}

export async function saveSession(session) {
  const s = { ...session, id: session.id || genId() };
  const store = await tx('sessions', 'readwrite');
  await reqAsPromise(store.put(s));
  return s;
}

export async function getLastSession(day, exName) {
  const all = await getSessions();
  for (let i = all.length - 1; i >= 0; i--) {
    const s = all[i];
    if (s.day !== day) continue;
    const ex = (s.exercises || []).find((e) => e.name === exName);
    if (ex) return ex;
  }
  return null;
}

export async function getLastSets(day, exName) {
  const ex = await getLastSession(day, exName);
  return ex ? ex.sets : null;
}

// ---- draft ----

export async function getDraft(day) {
  const store = await tx('draft');
  const rec = await reqAsPromise(store.get(day));
  return rec ? rec.exercises : {};
}

export async function setDraft(day, exercises) {
  const store = await tx('draft', 'readwrite');
  await reqAsPromise(store.put({ day, exercises }));
}

export async function clearDraft(day) {
  const store = await tx('draft', 'readwrite');
  await reqAsPromise(store.delete(day));
}

// ---- settings ----

export async function getSetting(key) {
  const store = await tx('settings');
  const rec = await reqAsPromise(store.get(key));
  return rec ? rec.value : null;
}

export async function setSetting(key, value) {
  const store = await tx('settings', 'readwrite');
  await reqAsPromise(store.put({ key, value }));
}

export async function getAllSettings() {
  const store = await tx('settings');
  const list = await reqAsPromise(store.getAll());
  const out = {};
  for (const r of list) out[r.key] = r.value;
  return out;
}

// ---- export / import ----

export async function exportAll() {
  const sessions = await getSessions();
  const draft = await (async () => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const req = db.transaction('draft').objectStore('draft').getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  })();
  const settings = await getAllSettings();
  return {
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    sessions,
    draft,
    settings,
  };
}

export async function importAll(payload, { replace = true } = {}) {
  if (!payload || typeof payload !== 'object') throw new Error('Invalid payload');
  if (!Array.isArray(payload.sessions)) throw new Error('Invalid: sessions missing');
  if (typeof payload.schemaVersion !== 'number') throw new Error('Invalid: schemaVersion missing');

  const db = await openDB();
  await new Promise((resolve, reject) => {
    const t = db.transaction(['sessions', 'draft', 'settings'], 'readwrite');
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);

    if (replace) {
      t.objectStore('sessions').clear();
      t.objectStore('draft').clear();
      t.objectStore('settings').clear();
    }

    for (const s of payload.sessions) {
      t.objectStore('sessions').put({ ...s, id: s.id || genId() });
    }
    if (Array.isArray(payload.draft)) {
      for (const d of payload.draft) {
        t.objectStore('draft').put(d);
      }
    }
    if (payload.settings && typeof payload.settings === 'object') {
      for (const [k, v] of Object.entries(payload.settings)) {
        t.objectStore('settings').put({ key: k, value: v });
      }
    }
    // keep migration flag and schema version after replace
    t.objectStore('settings').put({ key: 'migratedFromLS', value: true });
    t.objectStore('settings').put({ key: 'schemaVersion', value: SCHEMA_VERSION });
  });
}

export async function lastBackupDate() {
  return await getSetting('lastBackupAt');
}

export async function recordBackup() {
  await setSetting('lastBackupAt', new Date().toISOString());
}
