// Today: the dashboard that pulls every section together.
import * as db from './db.js';
import * as core from './core.js';
import * as N from './nutrition.js';
import { esc, icon, ring, sheet, toast } from './ui.js';
import { state, register, rerender, go } from './state.js';
import { targetBars, entryRow } from './food.js';
import { waterCard, medRow } from './health.js';
import { taskRow, classesFor } from './planner.js';

const CARD_NAMES = { schedule: 'Schedule', checklist: 'Checklist', water: 'Water', nutrition: 'Nutrition', meals: 'Meals', sleep: 'Sleep', workout: 'Workout' };

export async function render() {
  const s = await core.getSettings();
  const date = core.today();
  const comp = await core.completion(date);
  const pct = Math.round(comp.pct * 100);
  const head = `<div class="page-head row between" style="align-items:flex-end"><div><div class="eyebrow">${core.prettyDate(date)}</div><h1 class="title">${esc(core.greeting(s.name))}</h1></div>${ring(comp.pct, { size: 64, stroke: 7, inner: `<div class="num bold" style="font-size:16px">${pct}%</div>` })}</div>`;
  const ctx = { s, date, comp };
  const cards = [];
  for (const key of s.today.order) {
    if (s.today.hidden.includes(key) || !BUILDERS[key]) continue;
    const html = await BUILDERS[key](ctx);
    if (html) cards.push(html);
  }
  return `${head}<div class="cards">${cards.join('')}</div><div class="center" style="margin-top:18px"><button class="link" data-act="today-customise">Customise dashboard</button></div>`;
}

const BUILDERS = {
  async schedule({ s, date }) {
    const items = [];
    for (const c of await classesFor(date)) items.push({ t: c.start, title: c.subject, sub: `${c.start}–${c.end}${c.room ? ' · ' + c.room : ''}`, kind: 'class' });
    for (const g of await core.medDay(date)) items.push({ t: g.time, title: g.slot.name, sub: g.items.map(i => i.med.name).join(', '), kind: 'med', done: g.items.every(i => i.status === 'taken' || i.status === 'skipped') });
    for (const t of (await db.all('tasks')).filter(t => t.date === date && t.time)) items.push({ t: t.time, title: t.title, sub: t.category, kind: 'task', done: t.done });
    for (const r of (await core.routinesFor(date)).filter(r => r.routine.time)) items.push({ t: r.routine.time, title: r.routine.name, sub: `${r.items.filter(i => i.done).length}/${r.items.length} done`, kind: 'routine', done: r.items.length && r.items.every(i => i.done) });
    const wd = core.weekday(date);
    for (const tp of (await db.all('templates')).filter(t => (t.days || []).includes(wd))) items.push({ t: tp.time || '—', title: `Workout: ${tp.name}`, sub: `${(tp.exercises || []).length} exercises`, kind: 'workout' });
    const night = s.sleep.nights[core.scheduleDay(s, date)];
    items.push({ t: night.bed, title: 'Bedtime', sub: s.sleep.windDown.enabled ? `wind down from ${core.fromMin(core.toMin(night.bed) - s.sleep.windDown.minutes)}` : '', kind: 'sleep' });
    items.sort((a, b) => (core.toMin(a.t) ?? 1e9) - (core.toMin(b.t) ?? 1e9));
    const now = core.toMin(core.nowHM());
    return `<div class="card agenda"><div class="card-head"><div class="h2">Schedule</div><button class="link" data-act="quick-task">${icon('plus', '')}</button></div><div class="list">${items.map(i => `<div class="li" style="${(core.toMin(i.t) ?? 1e9) < now - 30 || i.done ? 'opacity:.5' : ''}"><span class="time">${i.t}</span><div class="main"><div class="t">${esc(i.title)}</div>${i.sub ? `<div class="s">${esc(i.sub)}</div>` : ''}</div>${i.done ? `<span class="check on" style="width:22px;height:22px">${icon('check')}</span>` : ''}</div>`).join('')}</div></div>`;
  },

  async checklist({ date }) {
    const meds = await core.medDay(date);
    const routines = await core.routinesFor(date);
    const tasks = (await core.tasksFor(date)).filter(t => !t.done || t.date === date);
    let body = '';
    for (const g of meds) body += `<div class="small bold ink2" style="margin:10px 2px 0">${esc(g.slot.name)} · ${g.time}</div><div class="list">${g.items.map(it => medRow(date, g, it)).join('')}</div>`;
    for (const r of routines) {
      if (!r.items.length) continue;
      body += `<div class="small bold ink2" style="margin:10px 2px 0">${esc(r.routine.name)}</div><div class="list">${r.items.map(i => `<div class="li ${i.done ? 'done' : ''}"><button class="check ${i.done ? 'on' : ''}" data-act="check-toggle" data-date="${date}" data-r="${r.routine.id}" data-i="${i.id}">${icon('check')}</button><div class="main"><div class="t">${esc(i.text)}</div></div></div>`).join('')}</div>`;
    }
    body += `<div class="small bold ink2" style="margin:10px 2px 0">Tasks</div><div class="list">${tasks.map(taskRow).join('')}<div class="li"><span class="check" style="border-style:dashed"></span><input class="input sm grow" placeholder="Add a task for today…" data-act-enter="quick-add-task" style="border:0;background:transparent;padding-left:0"></div></div>`;
    return `<div class="card"><div class="card-head"><div class="h2">Checklist</div><span class="small muted">tap to complete</span></div>${body}</div>`;
  },

  async water({ s, comp }) {
    return `<div class="card"><div class="card-head"><div class="h2" style="color:var(--water)">${icon('drop')} <span style="color:var(--ink)">Water</span></div><button class="link" data-act="goto" data-tab="health" data-sub="water">Details</button></div>${waterCard(comp.water, s.water.target, s.water.sizes.slice(0, 4), { compact: true })}</div>`;
  },

  async nutrition({ s, date }) {
    const entries = await db.byDate('entries', date);
    const d = N.dayTotals(entries);
    return `<div class="card"><div class="card-head"><div class="h2">Nutrition</div><span class="num small ink2">${Math.round(d.totals.kcal || 0).toLocaleString('en-AU')} kcal</span></div>${targetBars(d.totals, s.targets, d.missing)}<div class="row" style="gap:8px;margin-top:14px"><button class="btn primary grow" data-act="log-open">${icon('camera')} Log food</button><button class="btn" data-act="goto" data-tab="nutrition" data-sub="diary">Diary</button></div></div>`;
  },

  async meals({ date }) {
    const entries = (await db.byDate('entries', date)).sort((a, b) => core.DIARY_SLOTS.findIndex(x => x.id === a.slot) - core.DIARY_SLOTS.findIndex(x => x.id === b.slot));
    const plan = await db.byDate('plan', date);
    const recipes = new Map((await db.all('recipes')).map(r => [r.id, r]));
    const upcoming = plan.filter(p => recipes.has(p.recipeId) && !entries.some(e => e.items.some(i => i.recipeId === p.recipeId)));
    if (!entries.length && !upcoming.length) return `<div class="card"><div class="card-head"><div class="h2">Meals</div></div><div class="empty small">Nothing logged or planned today. <button class="link" data-act="goto" data-tab="planner" data-sub="meals">Plan meals</button></div></div>`;
    return `<div class="card"><div class="card-head"><div class="h2">Meals</div></div>${entries.length ? `<div class="list">${entries.map(entryRow).join('')}</div>` : ''}${upcoming.length ? `<div class="small bold ink2" style="margin:10px 2px 4px">Planned</div><div class="list">${upcoming.map(p => `<div class="li tap" data-act="plan-cell" data-date="${date}" data-slot="${p.slot}"><div class="thumb">${icon('book')}</div><div class="main"><div class="t">${esc(recipes.get(p.recipeId).name)}</div><div class="s" style="text-transform:capitalize">${p.slot} · tap to log</div></div></div>`).join('')}</div>` : ''}</div>`;
  },

  async sleep({ s, date }) {
    const night = s.sleep.nights[core.scheduleDay(s, date)];
    const wake = s.sleep.nights[core.scheduleDay(s, core.addDays(date, 1))].wake;
    const logged = (await db.byDate('sleep', date)).sort((a, b) => (a.source === 'manual' ? 0 : 1) - (b.source === 'manual' ? 0 : 1))[0];
    const hrs = logged ? logged.hours ?? N.sleepMinutes(logged.bed, logged.wake) / 60 : null;
    return `<div class="card"><div class="card-head"><div class="h2" style="color:var(--sleep)">${icon('moon')} <span style="color:var(--ink)">Sleep</span></div><button class="link" data-act="goto" data-tab="health" data-sub="sleep">Details</button></div><div class="grid3"><div class="stat"><div class="k">Last night</div><div class="v num">${hrs ? hrs.toFixed(1) + 'h' : '—'}</div></div><div class="stat"><div class="k">Bed tonight</div><div class="v num">${night.bed}</div></div><div class="stat"><div class="k">Wake</div><div class="v num">${wake}</div></div></div>${logged ? '' : '<button class="btn block" style="margin-top:10px" data-act="sleep-log">Log last night</button>'}</div>`;
  },

  async workout({ date }) {
    const wd = core.weekday(date);
    const tps = (await db.all('templates')).filter(t => (t.days || []).includes(wd));
    const done = await db.byDate('workouts', date);
    if (!tps.length && !done.length) return '';
    return `<div class="card"><div class="card-head"><div class="h2">${icon('dumbbell')} Workout</div></div><div class="list">${done.map(w => `<div class="li tap" data-act="workout-open" data-id="${w.id}"><span class="check on">${icon('check')}</span><div class="main"><div class="t">${esc(w.name)}</div><div class="s">${(w.exercises || []).length} exercises logged</div></div></div>`).join('')}${tps.filter(t => !done.some(w => w.templateId === t.id)).map(t => `<div class="li"><span class="check"></span><div class="main"><div class="t">${esc(t.name)}</div><div class="s">${t.time || 'Any time'} · ${(t.exercises || []).length} exercises</div></div><button class="btn sm primary" data-act="workout-start" data-id="${t.id}">Start</button></div>`).join('')}</div></div>`;
  },
};

async function customise() {
  const s = await core.getSettings();
  let order = [...s.today.order];
  let hidden = new Set(s.today.hidden);
  for (const k of Object.keys(CARD_NAMES)) if (!order.includes(k)) order.push(k);
  const sh = sheet({ title: 'Customise Today', body: '', foot: `<button class="btn primary" id="cu-save">Done</button>` });
  const paint = () => {
    sh.setBody(`<p class="small muted" style="margin-top:0">Reorder and hide cards.</p><div class="card" style="padding:4px 14px"><div class="list">${order.map((k, i) => `<div class="li"><label class="toggle"><input type="checkbox" data-k="${k}" ${hidden.has(k) ? '' : 'checked'}><i></i></label><div class="main"><div class="t">${CARD_NAMES[k]}</div></div><button class="icon-btn" data-up="${i}" ${i === 0 ? 'disabled style="opacity:.3"' : ''}>↑</button><button class="icon-btn" data-down="${i}" ${i === order.length - 1 ? 'disabled style="opacity:.3"' : ''}>↓</button></div>`).join('')}</div></div>`);
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
