// Shared domain logic: settings, dates, schedules, medication status, daily completion.
import * as db from './db.js';
import { DEFAULT_TARGETS, dayTotals, progress } from './nutrition.js';

export const pad = n => String(n).padStart(2, '0');
export function ymd(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export function parseYmd(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
export function addDays(s, n) {
  const d = parseYmd(s);
  d.setDate(d.getDate() + n);
  return ymd(d);
}
export const today = () => ymd();
export const weekday = s => parseYmd(s).getDay();
export const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const DAY_LETTER = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
export const nowHM = () => {
  const d = new Date();
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
export const toMin = t => {
  if (!t) return null;
  const [h, m] = String(t).split(':').map(Number);
  return h * 60 + m;
};
export const fromMin = m => {
  const x = ((m % 1440) + 1440) % 1440;
  return `${pad(Math.floor(x / 60))}:${pad(x % 60)}`;
};
export function prettyDate(s, opts = { weekday: 'long', day: 'numeric', month: 'long' }) {
  return parseYmd(s).toLocaleDateString('en-AU', opts);
}
export function relDay(s) {
  const t = today();
  if (s === t) return 'Today';
  if (s === addDays(t, -1)) return 'Yesterday';
  if (s === addDays(t, 1)) return 'Tomorrow';
  return prettyDate(s, { weekday: 'short', day: 'numeric', month: 'short' });
}
export function startOfWeek(s) {
  const wd = weekday(s);
  return addDays(s, wd === 0 ? -6 : 1 - wd);
}
export const isWeekend = wd => wd === 0 || wd === 6;

export const DIARY_SLOTS = [
  { id: 'breakfast', name: 'Breakfast', meal: 'breakfast' },
  { id: 'morning-snack', name: 'Morning snack', meal: 'snack' },
  { id: 'lunch', name: 'Lunch', meal: 'lunch' },
  { id: 'afternoon-snack', name: 'Afternoon snack', meal: 'snack' },
  { id: 'dinner', name: 'Dinner', meal: 'dinner' },
  { id: 'evening-snack', name: 'Evening snack', meal: 'snack' },
];
export const slotName = id => (DIARY_SLOTS.find(s => s.id === id) || { name: id }).name;
export function defaultSlotForNow() {
  const m = toMin(nowHM());
  if (m < 630) return 'breakfast';
  if (m < 720) return 'morning-snack';
  if (m < 870) return 'lunch';
  if (m < 1050) return 'afternoon-snack';
  if (m < 1230) return 'dinner';
  return 'evening-snack';
}

// ---------------- settings ----------------
const nights = () => {
  // index = weekday; wake = morning of that day, bed = night of that day
  const n = [];
  for (let d = 0; d < 7; d++) {
    const weekendMorning = d === 0 || d === 6;
    const weekendNight = d === 5 || d === 6;
    n.push({ wake: weekendMorning ? '09:00' : '07:45', bed: weekendNight ? '23:15' : '22:00' });
  }
  return n;
};

export const DEFAULT_SETTINGS = {
  name: '',
  theme: 'auto',
  targets: DEFAULT_TARGETS,
  water: {
    target: 2500,
    sizes: [150, 250, 400, 600],
    reminders: { enabled: true, weekday: { start: '08:00', end: '21:00', interval: 90 }, weekend: { start: '09:30', end: '21:30', interval: 90 } },
  },
  sleep: { nights: nights(), windDown: { enabled: true, minutes: 45 }, wakeReminder: false },
  medSlots: [
    { id: 'morning', name: 'Morning', mode: 'fixed', weekday: '08:00', weekend: '09:15' },
    { id: 'dinner', name: 'After dinner', mode: 'fixed', weekday: '19:30', weekend: '19:30' },
    { id: 'bed', name: 'Before bed', mode: 'bedtime', offset: -30 },
  ],
  medFollowUp: 30,
  refillTime: '10:00',
  privacy: { hideMedNames: false },
  holidayUntil: null,
  today: { order: ['schedule', 'checklist', 'water', 'nutrition', 'meals', 'sleep', 'workout'], hidden: [] },
  worker: { url: '', token: '' },
  autoBackup: true,
};

let settingsCache = null;
export async function getSettings() {
  if (settingsCache) return settingsCache;
  const s = await db.kvGet('settings', null);
  settingsCache = mergeDeep(structuredClone(DEFAULT_SETTINGS), s || {});
  return settingsCache;
}
export async function saveSettings(patch) {
  const s = await getSettings();
  settingsCache = mergeDeep(s, patch);
  await db.kvSet('settings', settingsCache);
  return settingsCache;
}
export function invalidateSettings() {
  settingsCache = null;
}
function mergeDeep(a, b) {
  for (const [k, v] of Object.entries(b || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && a[k] && typeof a[k] === 'object' && !Array.isArray(a[k])) a[k] = mergeDeep(a[k], v);
    else a[k] = v;
  }
  return a;
}

export function holidayActive(s, date) {
  return !!(s.holidayUntil && date <= s.holidayUntil);
}
/** The day-of-week whose schedule applies (holiday → Saturday schedule). */
export function scheduleDay(s, date) {
  return holidayActive(s, date) ? 6 : weekday(date);
}
export function slotTime(slot, wd, s) {
  if (slot.mode === 'bedtime') return fromMin(toMin(s.sleep.nights[wd].bed) + (Number(slot.offset) || 0));
  return isWeekend(wd) ? slot.weekend || slot.weekday : slot.weekday;
}
export function waterWindow(s, wd) {
  return isWeekend(wd) ? s.water.reminders.weekend : s.water.reminders.weekday;
}

// ---------------- medications ----------------
export function medActiveOn(med, date) {
  if (!med.active) return false;
  const days = med.days && med.days.length ? med.days : [0, 1, 2, 3, 4, 5, 6];
  return days.includes(weekday(date));
}

export async function medDay(date) {
  const s = await getSettings();
  const meds = (await db.all('meds')).filter(m => medActiveOn(m, date));
  const logs = await db.byDate('medlog', date);
  const wd = scheduleDay(s, date);
  const isToday = date === today();
  const nowM = toMin(nowHM());
  const past = date < today();
  return s.medSlots
    .map(slot => {
      const time = slotTime(slot, wd, s);
      const list = meds
        .filter(m => m.slotId === slot.id)
        .sort((a, b) => (a.order || 0) - (b.order || 0))
        .map(med => {
          const log = logs.find(l => l.medId === med.id && l.slotId === slot.id);
          let status = log ? log.status : 'due';
          if (!log) {
            const overdue = past || (isToday && nowM > toMin(time) + 120);
            if (overdue) status = med.optional ? 'optional' : 'missed';
            else if (isToday && nowM < toMin(time) - 60) status = 'upcoming';
            else if (!isToday && date > today()) status = 'upcoming';
          }
          return { med, log, status };
        });
      return { slot, time, items: list };
    })
    .filter(g => g.items.length);
}

export async function setMedStatus(date, med, slotId, status) {
  const id = `${date}|${med.id}|${slotId}`;
  const prev = await db.get('medlog', id);
  const units = Number(med.unitsPerDose) || 1;
  let stockDelta = 0;
  if (!status) {
    if (prev) {
      await db.del('medlog', id);
      if (prev.status === 'taken') stockDelta = units;
    }
  } else {
    await db.put('medlog', { id, date, medId: med.id, slotId, status, at: new Date().toISOString() });
    if (status === 'taken' && (!prev || prev.status !== 'taken')) stockDelta = -units;
    if (status !== 'taken' && prev && prev.status === 'taken') stockDelta = units;
  }
  if (stockDelta && med.stock != null && med.stock !== '') {
    const fresh = await db.get('meds', med.id);
    fresh.stock = Math.max(0, Number(fresh.stock) + stockDelta);
    await db.put('meds', fresh);
  }
}

export function lowStock(meds) {
  return meds.filter(m => m.active && m.stock != null && m.stock !== '' && m.refillAt != null && m.refillAt !== '' && Number(m.stock) <= Number(m.refillAt));
}

// ---------------- water ----------------
export async function waterTotal(date) {
  return (await db.byDate('water', date)).reduce((a, w) => a + (Number(w.ml) || 0), 0);
}
export async function addWater(ml, date = today()) {
  if (!ml || ml <= 0) return;
  await db.put('water', { date, ml: Math.round(ml), at: new Date().toISOString() });
}

// ---------------- routines ----------------
export function routineOn(r, date) {
  const days = r.days && r.days.length ? r.days : [0, 1, 2, 3, 4, 5, 6];
  return days.includes(weekday(date));
}
export async function routinesFor(date) {
  const rs = (await db.all('routines')).filter(r => routineOn(r, date)).sort((a, b) => (toMin(a.time) ?? 9999) - (toMin(b.time) ?? 9999));
  const checks = new Set((await db.byDate('checks', date)).map(c => c.id));
  return rs.map(r => ({ routine: r, items: (r.items || []).map(it => ({ ...it, done: checks.has(`${date}|${r.id}|${it.id}`) })) }));
}
export async function toggleCheck(date, routineId, itemId) {
  const id = `${date}|${routineId}|${itemId}`;
  if (await db.get('checks', id)) await db.del('checks', id);
  else await db.put('checks', { id, date });
}

// ---------------- tasks ----------------
export async function tasksFor(date) {
  const all = await db.all('tasks');
  return all.filter(t => t.date === date || (!t.done && t.date && t.date < date && date === today()));
}

// ---------------- daily completion ----------------
export async function completion(date) {
  const s = await getSettings();
  const parts = [];
  for (const g of await medDay(date)) for (const it of g.items) if (!it.med.optional) parts.push({ k: 'med', done: it.status === 'taken' || it.status === 'skipped' });
  const water = await waterTotal(date);
  parts.push({ k: 'water', done: water >= s.water.target });
  for (const r of await routinesFor(date)) for (const it of r.items) parts.push({ k: 'routine', done: it.done });
  for (const t of (await db.all('tasks')).filter(t => t.date === date)) parts.push({ k: 'task', done: !!t.done });
  const entries = await db.byDate('entries', date);
  if (entries.length) {
    const tot = dayTotals(entries).totals;
    for (const p of progress(tot, s.targets.filter(t => t.kind === 'min' && t.show))) parts.push({ k: 'nutrition', done: p.status === 'met' });
  } else {
    for (const _ of s.targets.filter(t => t.kind === 'min' && t.show)) parts.push({ k: 'nutrition', done: false });
  }
  const done = parts.filter(p => p.done).length;
  return { done, total: parts.length, pct: parts.length ? done / parts.length : 0, water };
}

export function greeting(name) {
  const h = new Date().getHours();
  const g = h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  return name ? `${g}, ${name}` : g;
}
