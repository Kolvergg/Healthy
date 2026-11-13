// Talks to your Cloudflare Worker. The API key never touches this code.
import * as db from './db.js';
import * as core from './core.js';

export async function workerConf() {
  const s = await core.getSettings();
  return { url: (s.worker.url || '').replace(/\/+$/, ''), token: s.worker.token || '' };
}
export async function configured() {
  const w = await workerConf();
  return !!(w.url && w.token);
}

export async function call(path, { method = 'GET', body, raw = false, timeout = 60000 } = {}) {
  const w = await workerConf();
  if (!w.url || !w.token) throw new Error('Connect your Worker in Settings → Connection first.');
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  let res;
  try {
    res = await fetch(w.url + path, {
      method,
      headers: { authorization: 'Bearer ' + w.token, ...(body !== undefined && !raw ? { 'content-type': 'application/json' } : {}) },
      body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
      signal: ctl.signal,
    });
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? 'The request timed out.' : navigator.onLine ? 'Could not reach your Worker.' : 'You are offline.');
  } finally {
    clearTimeout(timer);
  }
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json().catch(() => null) : await res.text();
  if (!res.ok) throw new Error((data && data.error) || `Worker error ${res.status}`);
  return data;
}

export const UPDATE_WORKER = 'Your Worker needs the latest code for this (version 4). Settings → Worker setup & update → Copy Worker code, then in Cloudflare: Edit code → paste → Deploy.';
export async function ai(task, payload = {}, { timeout = 90000 } = {}) {
  const s = await core.getSettings();
  const body = { task, ...payload, accurate: task === 'photo' && s.aiAccurate ? true : undefined };
  let r;
  // Until the Worker is updated to v2 (cheap models), use the key on this phone if there is one.
  // Links always go through the Worker: a phone browser can't fetch other sites directly.
  const viaWorker = (await configured()) && (!s.geminiKey || task === 'url' || (await workerVersion()) >= 3);
  if (viaWorker) {
    try {
      r = await call('/api/ai', { method: 'POST', body, timeout });
    } catch (e) {
      // An old Worker, or a Worker without the key: fall back to the key on this phone if there is one.
      if (!s.geminiKey || !/GEMINI_API_KEY|Unknown AI task|not found/i.test(e.message)) throw e;
    }
  }
  if (!r) {
    if (!s.geminiKey) throw new Error('Add your Gemini API key in Settings → Connection.');
    // Direct mode: same prompts and cost limits as the Worker, run with the key stored on this device.
    const worker = (await import('../worker/worker.js')).default;
    const x = await worker._test.aiTask({ GEMINI_API_KEY: s.geminiKey }, body);
    r = { ok: true, model: x.model, source: x.source || null, data: x.data, usage: x.usage };
  }
  trackUsage(r);
  return r;
}
/** Sends a cooking video from the phone to the Worker, which has Gemini watch it. */
export async function video(file) {
  if (!(await configured())) throw new Error('Connect your Worker in Settings → Connection first.');
  if ((await workerVersion(true)) < 4) throw new Error(UPDATE_WORKER);
  if (file.size > 95e6) throw new Error('That video is over 95 MB. Trim it in Photos first.');
  const r = await call('/api/video', { method: 'POST', body: file, raw: true, timeout: 240000 });
  trackUsage(r);
  return r;
}
/** Worker code version (cached 12 h). 1 = original, 2 = cheap AI + reminder status. */
export async function workerVersion(fresh = false) {
  const c = await db.kvGet('cache:workerVersion', null);
  if (!fresh && c && Date.now() - c.at < 12 * 3600 * 1000) return c.v;
  try {
    const p = await call('/api/ping', { timeout: 8000 });
    const v = p.version || 1;
    await db.kvSet('cache:workerVersion', { v, at: Date.now() }, { silent: true });
    return v;
  } catch {
    return c ? c.v : 1;
  }
}
async function trackUsage(r) {
  try {
    const month = core.today().slice(0, 7);
    const u = (await db.kvGet('aiUsage', null)) || {};
    const m = u.month === month ? u : { month, calls: 0, in: 0, out: 0, models: {} };
    m.calls++;
    if (r.usage) {
      m.in += r.usage.in || 0;
      m.out += (r.usage.out || 0) + (r.usage.think || 0);
    }
    if (r.model) m.models[r.model] = (m.models[r.model] || 0) + 1;
    await db.kvSet('aiUsage', m, { silent: true });
  } catch {}
}

// ---------------- push ----------------
function urlB64ToUint8Array(s) {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const b = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(b, c => c.charCodeAt(0));
}
export function pushSupport() {
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  return {
    sw: 'serviceWorker' in navigator,
    push: 'PushManager' in window,
    notif: 'Notification' in window,
    standalone,
    ios,
    permission: 'Notification' in window ? Notification.permission : 'unsupported',
  };
}
export async function currentSubscription() {
  if (!('serviceWorker' in navigator)) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager ? reg.pushManager.getSubscription() : null;
}
export async function enablePush() {
  const sup = pushSupport();
  if (sup.ios && !sup.standalone) throw new Error('On iPhone, notifications only work after Share → Add to Home Screen, then opening HealthOS from the home screen icon.');
  if (!sup.sw || !sup.push || !sup.notif) throw new Error('This browser does not support web push.');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Notifications were not allowed. Enable them in iOS Settings → Notifications → HealthOS.');
  const { publicKey } = await call('/api/vapid');
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (sub) {
    const key = sub.options && sub.options.applicationServerKey ? new Uint8Array(sub.options.applicationServerKey) : null;
    const want = urlB64ToUint8Array(publicKey);
    if (!key || key.length !== want.length || key.some((b, i) => b !== want[i])) {
      await sub.unsubscribe();
      sub = null;
    }
  }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8Array(publicKey) });
  await call('/api/subscribe', { method: 'POST', body: { subscription: sub.toJSON(), label: navigator.userAgent.slice(0, 80) } });
  await syncConfig(true, true);
  return sub;
}
export async function disablePush() {
  const sub = await currentSubscription();
  if (sub) {
    try {
      await call('/api/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } });
    } catch {}
    await sub.unsubscribe();
  }
}

// ---------------- reminder config ----------------
export async function buildConfig() {
  const s = await core.getSettings();
  const meds = (await db.all('meds')).filter(m => m.active);
  const days = [0, 1, 2, 3, 4, 5, 6];
  const medSlots = s.medSlots
    .map(slot => ({
      id: slot.id,
      name: slot.name,
      times: days.map(wd => (meds.some(m => m.slotId === slot.id && (!m.days || !m.days.length || m.days.includes(wd))) ? core.slotTime(slot, wd, s) : null)),
      meds: meds.filter(m => m.slotId === slot.id).map(m => ({ id: m.id, name: m.name, dose: [m.dose, m.qty].filter(Boolean).join(' · '), optional: !!m.optional })),
    }))
    .filter(x => x.meds.length);

  const recurring = [];
  if (s.sleep.windDown.enabled) recurring.push({ id: 'winddown', title: 'Wind down', body: 'Bedtime soon — start your evening routine.', url: './?go=sleep', times: days.map(wd => core.fromMin(core.toMin(s.sleep.nights[wd].bed) - (Number(s.sleep.windDown.minutes) || 45))) });
  if (s.sleep.wakeReminder) recurring.push({ id: 'wake', title: 'Good morning', body: 'Log last night’s sleep and start your morning routine.', url: './?go=sleep', times: days.map(wd => s.sleep.nights[wd].wake) });
  for (const r of await db.all('routines')) {
    if (!r.time || r.remind === false) continue;
    recurring.push({ id: 'routine-' + r.id, title: r.name, body: `${(r.items || []).length} steps`, url: './?go=today', times: days.map(wd => (!r.days || !r.days.length || r.days.includes(wd) ? r.time : null)) });
  }
  for (const t of await db.all('templates')) {
    if (!t.time || !t.days || !t.days.length) continue;
    recurring.push({ id: 'workout-' + t.id, title: `Workout: ${t.name}`, body: `${(t.exercises || []).length} exercises`, url: './?go=workouts', times: days.map(wd => (t.days.includes(wd) ? t.time : null)) });
  }
  const horizon = core.addDays(core.today(), 30);
  const timed = (await db.all('tasks'))
    .filter(t => !t.done && t.remind !== false && t.date && t.time && t.date >= core.today() && t.date <= horizon)
    .map(t => {
      const lead = Number(t.lead) || 0;
      const m = core.toMin(t.time) - lead;
      const date = m < 0 ? core.addDays(t.date, -1) : t.date;
      return { id: 'task-' + t.id, at: `${date}T${core.fromMin(m)}`, title: t.title, body: [t.category && t.category !== 'Task' ? t.category : '', `${t.time}${lead ? ` (in ${lead} min)` : ''}`].filter(Boolean).join(' · '), url: './?go=planner' };
    });
  const low = core.lowStock(meds);
  const r = s.water.reminders;
  return {
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Australia/Melbourne',
    holidayUntil: s.holidayUntil || null,
    privacy: s.privacy,
    water: { enabled: !!r.enabled, target: s.water.target, days: days.map(wd => (core.isWeekend(wd) ? r.weekend : r.weekday)) },
    medSlots,
    medFollowUp: Number(s.medFollowUp) || 0,
    recurring,
    timed,
    refill: { time: s.refillTime, items: low.map(m => `${m.name} (${m.stock} left)`) },
    updatedAt: new Date().toISOString(),
  };
}

let cfgTimer = null;
const hash = str => {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return String(h);
};
/**
 * Sends the reminder schedule to the Worker. Skips the upload when nothing changed and the
 * last sync is recent (keeps Cloudflare KV writes low); `force` always uploads.
 */
export async function syncConfig(now = false, force = false) {
  if (!(await configured())) return;
  clearTimeout(cfgTimer);
  const run = async () => {
    try {
      const cfg = await buildConfig();
      const { updatedAt, ...rest } = cfg;
      const h = hash(JSON.stringify(rest));
      const prevH = await db.kvGet('cache:configHash', null);
      const at = await db.kvGet('cache:configSyncedAt', 0);
      if (!force && h === prevH && Date.now() - (at || 0) < 6 * 3600 * 1000) return;
      await call('/api/config', { method: 'POST', body: cfg });
      await db.kvSet('cache:configHash', h, { silent: true });
      await db.kvSet('cache:configSyncedAt', Date.now(), { silent: true });
      await db.kvSet('cache:configSyncError', null, { silent: true });
    } catch (e) {
      await db.kvSet('cache:configSyncError', String(e.message), { silent: true });
    }
  };
  if (now) return run();
  cfgTimer = setTimeout(run, 1500);
}

let dayTimer = null;
export async function syncDay(date = core.today()) {
  if (!(await configured()) || date !== core.today()) return;
  clearTimeout(dayTimer);
  dayTimer = setTimeout(async () => {
    try {
      const logs = await db.byDate('medlog', date);
      const taken = {};
      for (const l of logs) if (l.status === 'taken' || l.status === 'skipped') (taken[l.slotId] = taken[l.slotId] || []).push(l.medId);
      await call('/api/day', { method: 'POST', body: { date, taken, waterMl: await core.waterTotal(date) } });
    } catch {}
  }, 800);
}

export async function status() {
  return call('/api/status');
}
export async function snooze(minutes, title, body, url = './') {
  return call('/api/snooze', { method: 'POST', body: { minutes, title, body, url } });
}

// ---------------- backup ----------------
export async function backupNow() {
  const data = await db.exportAll({ photos: false });
  const text = JSON.stringify(data);
  await call('/api/backup', { method: 'PUT', body: text, raw: true, timeout: 120000 });
  await core.saveSettings({ lastBackup: Date.now() });
  return text.length;
}
export async function maybeAutoBackup() {
  const s = await core.getSettings();
  if (!s.autoBackup || !(await configured())) return;
  if (s.lastBackup && Date.now() - s.lastBackup < 20 * 3600 * 1000) return;
  try {
    await backupNow();
  } catch {}
}
export async function restoreBackup(prev = false) {
  const text = await call('/api/backup' + (prev ? '?prev=1' : ''));
  const data = typeof text === 'string' ? JSON.parse(text) : text;
  await db.importAll(data, { replace: true });
}

// ---------------- Apple Health (via iOS Shortcut → Worker) ----------------
const n = v => {
  if (v == null || v === '') return null;
  const x = parseFloat(String(v).replace(/,/g, '').replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(x) ? x : null;
};
export async function pullHealth() {
  if (!(await configured())) return 0;
  const rows = await call('/api/healthkit');
  let count = 0;
  for (const r of rows || []) {
    if (!r.date) continue;
    const rec = {
      id: r.date,
      date: r.date,
      source: 'Apple Health',
      steps: n(r.steps),
      distanceKm: n(r.distance_km ?? r.distance),
      exerciseMin: n(r.exercise_min ?? r.exercise),
      activeKcal: n(r.active_kcal ?? r.active_energy),
      restingHr: n(r.resting_hr),
      avgHr: n(r.avg_hr ?? r.heart_rate),
      sleepHours: n(r.sleep_hours),
      weightKg: n(r.weight_kg ?? r.weight),
      receivedAt: r.receivedAt,
    };
    await db.put('health', rec, { silent: true });
    if (rec.weightKg) await db.put('weight', { id: 'hk-' + r.date, date: r.date, kg: rec.weightKg, source: 'Apple Health' }, { silent: true });
    if (rec.sleepHours) {
      const id = 'hk-' + r.date;
      await db.put('sleep', { id, date: r.date, hours: rec.sleepHours, source: 'Apple Health' }, { silent: true });
    }
    count++;
  }
  db.bus.dispatchEvent(new CustomEvent('change', { detail: { store: 'health' } }));
  await db.kvSet('cache:healthPulledAt', Date.now(), { silent: true });
  return count;
}
