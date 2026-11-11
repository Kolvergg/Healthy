// IndexedDB: the single on-device database every section reads from and writes to.
// Every write emits a 'change' event so all views and the reminder sync update automatically.

const DB_NAME = 'healthos';
const VERSION = 1;
export const STORES = {
  foods: ['source'],
  entries: ['date'],
  recipes: [],
  meds: [],
  medlog: ['date'],
  water: ['date'],
  sleep: ['date'],
  weight: ['date'],
  journal: ['date'],
  workouts: ['date'],
  templates: [],
  tasks: ['date'],
  routines: [],
  checks: ['date'],
  timetable: [],
  plan: ['date'],
  health: ['date'],
  kv: [],
};

export const bus = new EventTarget();
const emit = store => bus.dispatchEvent(new CustomEvent('change', { detail: { store } }));

let dbp;
function open() {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const r = indexedDB.open(DB_NAME, VERSION);
      r.onupgradeneeded = () => {
        const db = r.result;
        for (const [name, idx] of Object.entries(STORES)) {
          if (db.objectStoreNames.contains(name)) continue;
          const s = db.createObjectStore(name, { keyPath: name === 'kv' ? 'key' : 'id' });
          for (const i of idx) s.createIndex(i, i);
        }
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  return dbp;
}

const req = r => new Promise((res, rej) => {
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
});
const done = t => new Promise((res, rej) => {
  t.oncomplete = () => res();
  t.onerror = () => rej(t.error);
  t.onabort = () => rej(t.error);
});

export function uid() {
  return crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
}

export async function get(store, key) {
  const db = await open();
  return req(db.transaction(store).objectStore(store).get(key));
}
export async function all(store) {
  const db = await open();
  return req(db.transaction(store).objectStore(store).getAll());
}
export async function byDate(store, date) {
  const db = await open();
  return req(db.transaction(store).objectStore(store).index('date').getAll(IDBKeyRange.only(date)));
}
export async function range(store, from, to) {
  const db = await open();
  return req(db.transaction(store).objectStore(store).index('date').getAll(IDBKeyRange.bound(from, to)));
}
export async function bySource(source) {
  const db = await open();
  return req(db.transaction('foods').objectStore('foods').index('source').getAll(IDBKeyRange.only(source)));
}
export async function put(store, obj, { silent = false } = {}) {
  if (store !== 'kv' && !obj.id) obj.id = uid();
  obj.updatedAt = Date.now();
  const db = await open();
  const t = db.transaction(store, 'readwrite');
  t.objectStore(store).put(obj);
  await done(t);
  if (!silent) emit(store);
  return obj;
}
export async function putMany(store, list, { silent = false } = {}) {
  const db = await open();
  const t = db.transaction(store, 'readwrite');
  const s = t.objectStore(store);
  const now = Date.now();
  for (const o of list) {
    if (store !== 'kv' && !o.id) o.id = uid();
    o.updatedAt = o.updatedAt || now;
    s.put(o);
  }
  await done(t);
  if (!silent) emit(store);
}
export async function del(store, id) {
  const db = await open();
  const t = db.transaction(store, 'readwrite');
  t.objectStore(store).delete(id);
  await done(t);
  emit(store);
}
export async function delMany(store, ids) {
  const db = await open();
  const t = db.transaction(store, 'readwrite');
  for (const id of ids) t.objectStore(store).delete(id);
  await done(t);
  emit(store);
}
export async function clear(store) {
  const db = await open();
  const t = db.transaction(store, 'readwrite');
  t.objectStore(store).clear();
  await done(t);
  emit(store);
}
export async function count(store) {
  const db = await open();
  return req(db.transaction(store).objectStore(store).count());
}
export async function kvGet(key, fallback) {
  const r = await get('kv', key);
  return r ? r.value : fallback;
}
export async function kvSet(key, value, opts) {
  return put('kv', { key, value }, opts);
}

/** Full export. AFCD rows are public reference data and are re-imported, not backed up. */
export async function exportAll({ photos = true, secrets = false } = {}) {
  const out = { app: 'HealthOS', version: 1, exportedAt: new Date().toISOString(), stores: {} };
  for (const store of Object.keys(STORES)) {
    let rows = await all(store);
    if (store === 'foods') rows = rows.filter(f => f.source !== 'afcd');
    if (store === 'kv') rows = rows.filter(r => !r.key.startsWith('cache:'));
    if (!photos) rows = rows.map(r => (r.photo ? { ...r, photo: undefined } : r));
    if (!secrets && store === 'kv') rows = rows.map(r => (r.key === 'settings' ? { ...r, value: { ...r.value, geminiKey: '', worker: { url: r.value.worker?.url || '', token: '' } } } : r));
    out.stores[store] = rows;
  }
  return out;
}

export async function importAll(data, { replace = false } = {}) {
  if (!data || !data.stores) throw new Error('Not a HealthOS backup file');
  for (const [store, rows] of Object.entries(data.stores)) {
    if (!STORES[store] || !Array.isArray(rows)) continue;
    if (replace) {
      if (store === 'foods') {
        const keep = await all('foods');
        await delMany('foods', keep.filter(f => f.source !== 'afcd').map(f => f.id));
      } else if (store !== 'kv') await clear(store);
    }
    let list = rows;
    if (store === 'kv') {
      const current = await kvGet('settings', null);
      list = rows.map(r => (r.key === 'settings' && current ? { ...r, value: { ...r.value, worker: r.value.worker && r.value.worker.token ? r.value.worker : current.worker } } : r));
    }
    await putMany(store, list, { silent: true });
  }
  for (const s of Object.keys(STORES)) emit(s);
}

export async function persist() {
  try {
    if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist();
  } catch {}
  return false;
}
