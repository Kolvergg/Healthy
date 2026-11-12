// Home: one glance at the day — rings, what's next, what's left to tick off.
import * as db from './db.js';
import * as core from './core.js';
import * as N from './nutrition.js';
import { esc, icon, ring, sheet, toast, pageHead, initials } from './ui.js';
import { state, register, rerender, go, push } from './state.js';
import { targetBars, entryRow } from './food.js';
import { medRow } from './health.js';
import { taskRow, classesFor } from './planner.js';

const CARD_NAMES = { schedule: 'Up next', checklist: 'Checklist', nutrition: 'Nutrition', meals: 'Meals', sleep: 'Sleep prompt', workout: 'Workout' };

async function lastSleep(date) {
  const logged = (await db.byDate('sleep', date)).sort((a, b) => (a.source === 'manual' ? 0 : 1) - (b.source === 'manual' ? 0 : 1))[0];
  return logged ? { log: logged, hrs: logged.hours ?? N.sleepMinutes(logged.bed, logged.wake) / 60 } : null;
}

export async function render() {
  const s = await core.getSettings();
  const date = core.today();
  const comp = await core.completion(date);
  const entries = await db.byDate('entries', date);
  const totals = N.dayTotals(entries).totals;
  const protein = s.targets.find(t => t.key === 'protein');
  const sl = await lastSleep(date);
  const night = s.sleep.nights[core.scheduleDay(s, core.addDays(date, -1))];
  const sleepTarget = N.sleepMinutes(night.bed, s.sleep.nights[core.scheduleDay(s, date)].wake) / 60 || 8;

  const head = pageHead({
    title: `Today, ${core.prettyDate(date, { day: 'numeric', month: 'long' })}`,
    sub: esc(core.greeting(s.name)),
    actions: `<button class="glass-btn wide" data-act="push" data-page="stats">${icon('trend')} Trends</button><button class="avatar" data-act="push" data-page="settings" aria-label="Settings">${s.name ? initials(s.name) : icon('user')}</button>`,
  });

  const r = (pct, color, inner, label, act) => `<div ${act}>${ring(pct, { size: 74, stroke: 8, color, inner })}<span class="lbl">${label}</span></div>`;
  const rings = `<div class="card" style="padding:0"><div class="rings four">
    ${r(comp.pct, 'var(--accent)', `<div class="num bold" style="font-size:17px">${Math.round(comp.pct * 100)}%</div>`, 'Day', '')}
    ${r(comp.water / s.water.target, 'var(--water)', `<div class="num bold" style="font-size:16px">${(comp.water / 1000).toFixed(1)}<span class="muted" style="font-size:10px">L</span></div>`, 'Water', 'class="pressable" data-act="goto" data-tab="health" data-sub="water"')}
    ${r(protein && totals.protein ? totals.protein / protein.value : 0, 'var(--protein)', `<div class="num bold" style="font-size:16px">${Math.round(totals.protein || 0)}<span class="muted" style="font-size:10px">g</span></div>`, 'Protein', 'class="pressable" data-act="goto" data-tab="nutrition" data-sub="diary"')}
    ${r(sl ? sl.hrs / sleepTarget : 0, 'var(--sleep)', `<div class="num bold" style="font-size:16px">${sl ? sl.hrs.toFixed(1) : '–'}<span class="muted" style="font-size:10px">h</span></div>`, 'Sleep', 'class="pressable" data-act="goto" data-tab="health" data-sub="sleep"')}
  </div><div class="chips" style="padding:0 14px 14px;margin:0">${s.water.sizes.slice(0, 4).map(ml => `<button class="chip" style="box-shadow:none;background:var(--fill)" data-act="water-add" data-ml="${ml}">${icon('drop')} +${ml}</button>`).join('')}</div></div>`;

  const ctx = { s, date, comp, entries, totals, sl };
  const cards = [];
  const order = s.today.order.filter(k => BUILDERS[k]);
  for (const k of Object.keys(BUILDERS)) if (!order.includes(k)) order.push(k);
  for (const key of order) {
    if (s.today.hidden.includes(key)) continue;
    const html = await BUILDERS[key](ctx);
    if (html) cards.push(html);
  }
  return `${head}${rings}${cards.join('')}<div class="center" style="margin-top:22px"><button class="link" data-act="today-customise">Edit Home</button></div>`;
}

async function agenda(date, s) {
  const items = [];
  for (const c of await classesFor(date)) items.push({ t: c.start, title: c.subject, sub: `${c.start}–${c.end}${c.room ? ' · ' + c.room : ''}`, ic: 'book', color: 'var(--protein)' });
  for (const g of await core.medDay(date)) items.push({ t: g.time, title: g.slot.name, sub: g.items.map(i => i.med.name).join(', '), ic: 'pill', color: 'var(--meds)', done: g.items.every(i => i.status === 'taken' || i.status === 'skipped'), act: 'data-act="goto" data-tab="health" data-sub="meds"' });
  for (const t of (await db.all('tasks')).filter(t => t.date === date && t.time)) items.push({ t: t.time, title: t.title, sub: t.category, ic: 'checklist', color: 'var(--protein)', done: t.done, act: `data-act="task-edit" data-id="${t.id}"` });
  for (const r of (await core.routinesFor(date)).filter(r => r.routine.time)) items.push({ t: r.routine.time, title: r.routine.name, sub: `${r.items.filter(i => i.done).length}/${r.items.length} done`, ic: 'repeat', color: 'var(--accent)', done: r.items.length && r.items.every(i => i.done) });
  const wd = core.weekday(date);
  for (const tp of (await db.all('templates')).filter(t => (t.days || []).includes(wd) && t.time)) items.push({ t: tp.time, title: `Workout: ${tp.name}`, sub: `${(tp.exercises || []).length} exercises`, ic: 'dumbbell', color: 'var(--workout)', act: `data-act="workout-start" data-id="${tp.id}"` });
  const night = s.sleep.nights[core.scheduleDay(s, date)];
  if (s.sleep.windDown.enabled) items.push({ t: core.fromMin(core.toMin(night.bed) - s.sleep.windDown.minutes), title: 'Wind down', sub: 'Screens away, evening routine', ic: 'moon', color: 'var(--sleep)' });
  items.push({ t: night.bed, title: 'Bedtime', sub: '', ic: 'moon', color: 'var(--sleep)' });
  items.sort((a, b) => (core.toMin(a.t) ?? 1e9) - (core.toMin(b.t) ?? 1e9));
  return items;
}
const agendaRow = (i, now) => `<div class="li ${i.act ? 'tap' : ''} ${(core.toMin(i.t) ?? 1e9) < now - 30 || i.done ? 'past' : ''}" ${i.act || ''}><span class="time">${i.t}</span><span class="ico" style="background:${i.color};width:30px;height:30px;border-radius:9px">${icon(i.ic)}</span><div class="main"><div class="t">${esc(i.title)}</div>${i.sub ? `<div class="s ellipsis">${esc(i.sub)}</div>` : ''}</div>${i.done ? `<span class="check on" style="width:22px;height:22px">${icon('check')}</span>` : ''}</div>`;

const BUILDERS = {
  async schedule({ s, date }) {
    const items = await agenda(date, s);
    const now = core.toMin(core.nowHM());
    const next = items.filter(i => !i.done && (core.toMin(i.t) ?? 1e9) >= now - 15).slice(0, 3);
    return `<div class="section-label row between"><span>Up next</span><button class="link" data-act="today-agenda">Full day</button></div><div class="card flush agenda"><div class="list">${next.length ? next.map(i => agendaRow(i, now)).join('') : '<div class="empty small">Nothing else scheduled today.</div>'}</div></div>`;
  },

  async checklist({ date }) {
    const meds = await core.medDay(date);
    const routines = await core.routinesFor(date);
    const tasks = (await core.tasksFor(date)).filter(t => !t.done || t.date === date);
    const showAll = state.showDone;
    let body = '';
    let done = 0;
    let total = 0;
    const group = (title, rows) => (rows.length ? `<div class="small bold muted" style="margin:12px 0 0">${title}</div><div class="list">${rows.join('')}</div>` : '');
    for (const g of meds) {
      const rows = [];
      for (const it of g.items) {
        total++;
        const d = it.status === 'taken' || it.status === 'skipped';
        if (d) done++;
        if (!d || showAll) rows.push(medRow(date, g, it));
      }
      body += group(`${esc(g.slot.name)} · ${g.time}`, rows);
    }
    for (const r of routines) {
      const rows = [];
      for (const i of r.items) {
        total++;
        if (i.done) done++;
        if (!i.done || showAll) rows.push(`<div class="li ${i.done ? 'done' : ''}"><button class="check ${i.done ? 'on' : ''}" data-act="check-toggle" data-date="${date}" data-r="${r.routine.id}" data-i="${i.id}">${icon('check')}</button><div class="main"><div class="t">${esc(i.text)}</div></div></div>`);
      }
      body += group(esc(r.routine.name), rows);
    }
    const trows = [];
    for (const t of tasks) {
      total++;
      if (t.done) done++;
      if (!t.done || showAll) trows.push(taskRow(t));
    }
    trows.push(`<div class="li"><span class="check" style="border-style:dashed"></span><input class="input sm grow" placeholder="Add a task for today…" data-act-enter="quick-add-task" style="background:transparent;padding-left:0;border:0"></div>`);
    body += group('Tasks', trows);
    return `<div class="section-label row between"><span>Checklist</span><button class="link" data-act="toggle-done">${showAll ? 'Hide done' : `${done}/${total} done`}</button></div><div class="card" style="padding:4px 16px 8px">${body}</div>`;
  },

  async nutrition({ s, totals, entries }) {
    const d = N.dayTotals(entries);
    return `<div class="section-label row between"><span>Nutrition</span><button class="link" data-act="goto" data-tab="nutrition" data-sub="diary">Diary</button></div><div class="card"><div class="row between" style="margin-bottom:14px"><div><span class="big-num num" style="font-size:30px">${Math.round(totals.kcal || 0).toLocaleString('en-AU')}</span> <span class="muted small bold">kcal</span></div><button class="btn sm primary" data-act="log-open">${icon('camera')} Log food</button></div>${targetBars(totals, s.targets, d.missing)}</div>`;
  },

  async meals({ date, entries }) {
    const sorted = entries.slice().sort((a, b) => core.DIARY_SLOTS.findIndex(x => x.id === a.slot) - core.DIARY_SLOTS.findIndex(x => x.id === b.slot));
    const plan = await db.byDate('plan', date);
    const recipes = new Map((await db.all('recipes')).map(r => [r.id, r]));
    const upcoming = plan.filter(p => recipes.has(p.recipeId) && !entries.some(e => e.items.some(i => i.recipeId === p.recipeId)));
    if (!sorted.length && !upcoming.length) return '';
    return `<div class="section-label">Meals</div><div class="card flush"><div class="list">${sorted.map(entryRow).join('')}${upcoming.map(p => `<div class="li tap" data-act="plan-cell" data-date="${date}" data-slot="${p.slot}"><div class="thumb">${icon('book')}</div><div class="main"><div class="t">${esc(recipes.get(p.recipeId).name)}</div><div class="s" style="text-transform:capitalize">Planned ${p.slot} · tap to log</div></div></div>`).join('')}</div></div>`;
  },

  async sleep({ sl }) {
    if (sl) return '';
    const h = new Date().getHours();
    if (h >= 15) return '';
    return `<div class="card tap row" style="margin-top:12px;gap:14px" data-act="sleep-log"><span class="ico" style="background:var(--sleep);width:42px;height:42px;border-radius:13px">${icon('moon')}</span><div class="grow"><div class="h3">How did you sleep?</div><div class="small muted">Log last night in two taps</div></div>${icon('chevR')}</div>`;
  },

  async workout({ date }) {
    const wd = core.weekday(date);
    const tps = (await db.all('templates')).filter(t => (t.days || []).includes(wd));
    const done = await db.byDate('workouts', date);
    if (!tps.length && !done.length) return '';
    return `<div class="section-label">Workout</div><div class="card flush"><div class="list">${done.map(w => `<div class="li tap" data-act="workout-open" data-id="${w.id}"><span class="check on">${icon('check')}</span><div class="main"><div class="t">${esc(w.name)}</div><div class="s">${(w.exercises || []).length} exercises logged</div></div></div>`).join('')}${tps.filter(t => !done.some(w => w.templateId === t.id)).map(t => `<div class="li"><span class="ico" style="background:var(--workout)">${icon('dumbbell')}</span><div class="main"><div class="t">${esc(t.name)}</div><div class="s">${t.time || 'Any time'} · ${(t.exercises || []).length} exercises</div></div><button class="btn sm primary" data-act="workout-start" data-id="${t.id}">Start</button></div>`).join('')}</div></div>`;
  },
};

async function fullDay() {
  const s = await core.getSettings();
  const items = await agenda(core.today(), s);
  const now = core.toMin(core.nowHM());
  sheet({ title: 'Today', body: `<div class="card flush agenda"><div class="list">${items.map(i => agendaRow(i, now)).join('')}</div></div>` });
}

async function customise() {
  const s = await core.getSettings();
  let order = s.today.order.filter(k => CARD_NAMES[k]);
  const hidden = new Set(s.today.hidden);
  for (const k of Object.keys(CARD_NAMES)) if (!order.includes(k)) order.push(k);
  const sh = sheet({ title: 'Edit Home', body: '', foot: `<button class="btn primary" id="cu-save">Done</button>` });
  const paint = () => {
    sh.setBody(`<p class="small muted" style="margin-top:0">Reorder and hide sections. The rings always stay on top.</p><div class="group"><div class="list">${order.map((k, i) => `<div class="li"><label class="toggle"><input type="checkbox" data-k="${k}" ${hidden.has(k) ? '' : 'checked'}><i></i></label><div class="main"><div class="t">${CARD_NAMES[k]}</div></div><button class="icon-btn" data-up="${i}" ${i === 0 ? 'disabled style="opacity:.3"' : ''}>↑</button><button class="icon-btn" data-down="${i}" ${i === order.length - 1 ? 'disabled style="opacity:.3"' : ''}>↓</button></div>`).join('')}</div></div>`);
    sh.body.querySelectorAll('[data-k]').forEach(c => (c.onchange = () => (c.checked ? hidden.delete(c.dataset.k) : hidden.add(c.dataset.k))));
    sh.body.querySelectorAll('[data-up]').forEach(b => (b.onclick = () => {
      const i = Number(b.dataset.up);
      [order[i - 1], order[i]] = [order[i], order[i - 1]];
      paint();
    }));
    sh.body.querySelectorAll('[data-down]').forEach(b => (b.onclick = () => {
      const i = Number(b.dataset.down);
      [order[i + 1], order[i]] = [order[i], order[i + 1]];
      paint();
    }));
  };
  paint();
  sh.foot.querySelector('#cu-save').onclick = async () => {
    await core.saveSettings({ today: { order, hidden: [...hidden] } });
    sh.close();
    rerender();
  };
}

register({
  'today-customise': () => customise(),
  'today-agenda': () => fullDay(),
  goto: el => go(el.dataset.tab, el.dataset.sub),
  'quick-task': async () => (await import('./planner.js')).taskEditor(null, { date: core.today() }),
  'quick-add-task': async el => {
    const title = el.value.trim();
    if (!title) return;
    el.value = '';
    await db.put('tasks', { title, date: core.today(), category: 'Task', done: false, remind: false });
    toast('Task added');
  },
});

