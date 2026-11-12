// Planner: tasks & appointments, routines (morning/evening/skincare…), timetable, meal plan.
import * as db from './db.js';
import * as core from './core.js';
import * as N from './nutrition.js';
import { esc, icon, sheet, toast, confirmSheet, daychips, readDays, toggleHtml, initials, pageHead, glassBtn } from './ui.js';
import { state, register, rerender, setSub } from './state.js';
import { recipeDetail, generateSheet, targetBars } from './food.js';

const SUBS = [['tasks', 'Tasks'], ['routines', 'Routines'], ['timetable', 'Timetable']];
export const CATEGORIES = ['Task', 'Assignment', 'Study', 'Appointment', 'Personal'];
const PLAN_SLOTS = ['breakfast', 'lunch', 'dinner', 'snack'];
const PLAN_TO_DIARY = { breakfast: 'breakfast', lunch: 'lunch', dinner: 'dinner', snack: 'afternoon-snack' };

export async function render() {
  const sub = SUBS.some(x => x[0] === state.sub.planner) ? state.sub.planner : 'tasks';
  const seg = `<div class="seg-wrap"><div class="seg">${SUBS.map(([k, l]) => `<button class="${sub === k ? 'on' : ''}" data-act="planner-sub" data-v="${k}">${l}</button>`).join('')}</div></div>`;
  const add = { tasks: glassBtn('task-edit', 'plus', 'New task'), routines: glassBtn('routine-edit', 'plus', 'New routine'), timetable: glassBtn('class-edit', 'plus', 'Add class') }[sub];
  const fn = { tasks: renderTasks, routines: renderRoutines, timetable: renderTimetable }[sub];
  return pageHead({ title: 'Plan', actions: add }) + seg + (await fn());
}
export const renderMealPlan = () => renderMeals();

// ---------------- TASKS ----------------
export function taskRow(t) {
  const overdue = !t.done && t.date && t.date < core.today();
  return `<div class="li ${t.done ? 'done' : ''}"><button class="check ${t.done ? 'on' : ''}" data-act="task-toggle" data-id="${t.id}" aria-label="Complete">${icon('check')}</button><div class="main tap" data-act="task-edit" data-id="${t.id}"><div class="t">${esc(t.title)}</div><div class="s">${[t.category && t.category !== 'Task' ? t.category : '', t.date ? core.relDay(t.date) : 'No date', t.time || ''].filter(Boolean).join(' · ')}${overdue ? ' · <span style="color:var(--bad)">overdue</span>' : ''}</div></div></div>`;
}

async function renderTasks() {
  const all = await db.all('tasks');
  const t = core.today();
  const open = all.filter(x => !x.done);
  const sort = (a, b) => (a.date || '9999').localeCompare(b.date || '9999') || (a.time || '99').localeCompare(b.time || '99');
  const groups = [
    ['Overdue', open.filter(x => x.date && x.date < t)],
    ['Today', open.filter(x => x.date === t)],
    ['Upcoming', open.filter(x => x.date && x.date > t)],
    ['Someday', open.filter(x => !x.date)],
  ];
  const done = all.filter(x => x.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
  let html = `<div class="card row" style="padding:6px 8px 6px 16px"><span class="check" style="border-style:dashed"></span><input class="input grow" placeholder="Quick add for today…" data-act-enter="quick-add-task" style="background:transparent;border:0;padding-left:4px"><button class="btn sm" data-act="task-edit">Details</button></div>`;
  for (const [name, list] of groups) {
    if (!list.length) continue;
    html += `<div class="section-label">${name}</div><div class="card flush"><div class="list">${list.sort(sort).map(taskRow).join('')}</div></div>`;
  }
  if (!open.length) html += `<div class="card empty" style="margin-top:12px"><b>All clear</b>Nothing open. Tap + for a task, assignment or appointment.</div>`;
  if (done.length) html += `<div class="section-label row between"><span>Completed</span><button class="link" data-act="toggle-done">${state.showDone ? 'Hide' : `Show ${done.length}`}</button></div>${state.showDone ? `<div class="card flush"><div class="list">${done.slice(0, 30).map(taskRow).join('')}</div></div>` : ''}`;
  return html;
}

export async function taskEditor(id, defaults = {}) {
  const t = id ? await db.get('tasks', id) : { title: '', category: 'Task', date: core.today(), time: '', remind: true, lead: 0, ...defaults };
  const s = sheet({
    title: id ? 'Edit task' : 'New task',
    body: `<div class="fields"><label class="field"><span>Title</span><input class="input" id="tk-title" value="${esc(t.title)}" placeholder="e.g. Chemistry assignment draft"></label>
    <div class="chips">${CATEGORIES.map(c => `<button class="chip ${t.category === c ? 'on' : ''}" data-cat="${c}">${c}</button>`).join('')}</div>
    <div class="fields two"><label class="field"><span>Date</span><input class="input" type="date" id="tk-date" value="${t.date || ''}"></label><label class="field"><span>Time</span><input class="input" type="time" id="tk-time" value="${t.time || ''}"></label></div>
    <div class="row between"><div><div class="h3">Notification</div><div class="small muted">Needs a time</div></div><div class="row"><select class="input sm" id="tk-lead" style="width:130px">${[[0, 'At time'], [15, '15 min before'], [60, '1 h before'], [1440, '1 day before']].map(([v, l]) => `<option value="${v}" ${Number(t.lead) === v ? 'selected' : ''}>${l}</option>`).join('')}</select>${toggleHtml('tk-remind', t.remind !== false)}</div></div>
    <label class="field"><span>Notes</span><textarea class="input" id="tk-notes">${esc(t.notes || '')}</textarea></label></div>`,
    foot: `${id ? `<button class="btn" id="tk-snooze">Tomorrow</button><button class="btn danger" id="tk-del">Delete</button>` : ''}<button class="btn primary" id="tk-save">Save</button>`,
  });
  let cat = t.category || 'Task';
  s.body.querySelectorAll('[data-cat]').forEach(b => (b.onclick = () => {
    cat = b.dataset.cat;
    s.body.querySelectorAll('[data-cat]').forEach(x => x.classList.toggle('on', x === b));
  }));
  setTimeout(() => !id && s.body.querySelector('#tk-title').focus(), 300);
  s.foot.querySelector('#tk-save').onclick = async () => {
    const title = s.body.querySelector('#tk-title').value.trim();
    if (!title) return toast('Title required');
    await db.put('tasks', { ...t, title, category: cat, date: s.body.querySelector('#tk-date').value || null, time: s.body.querySelector('#tk-time').value || null, remind: s.body.querySelector('[name="tk-remind"]').checked, lead: Number(s.body.querySelector('#tk-lead').value), notes: s.body.querySelector('#tk-notes').value });
    s.close();
    toast('Saved');
  };
  if (id) {
    s.foot.querySelector('#tk-del').onclick = async () => {
      await db.del('tasks', id);
      s.close();
      toast('Deleted', { action: 'Undo', onAction: () => db.put('tasks', t) });
    };
    s.foot.querySelector('#tk-snooze').onclick = async () => {
      await db.put('tasks', { ...t, date: core.addDays(core.today(), 1) });
      s.close();
      toast('Moved to tomorrow');
    };
  }
}

// ---------------- ROUTINES ----------------
async function renderRoutines() {
  const list = (await core.routinesFor(core.today())).map(x => x.routine.id);
  const all = (await db.all('routines')).sort((a, b) => (core.toMin(a.time) ?? 9999) - (core.toMin(b.time) ?? 9999));
  const today = await core.routinesFor(core.today());
  let html = '';
  if (!all.length) html += `<div class="card empty"><b>No routines yet</b>Tap + to create a morning routine, evening wind-down, skincare AM/PM or any checklist — each with its own days and reminder.</div>`;
  for (const r of all) {
    const t = today.find(x => x.routine.id === r.id);
    const active = list.includes(r.id);
    const items = t ? t.items : (r.items || []).map(i => ({ ...i, done: false }));
    const done = items.filter(i => i.done).length;
    const complete = active && items.length && done === items.length;
    html += `<div class="card" style="padding:14px 16px 6px;margin-top:12px"><div class="row between"><div><div class="h2">${esc(r.name)}</div><div class="small muted">${r.time ? `${r.time}${r.remind !== false ? ' · reminder' : ''} · ` : ''}${active ? `${done}/${items.length} done` : 'not today'}</div></div><div class="row" style="gap:6px">${complete ? '<span class="badge good">Done</span>' : ''}<button class="icon-btn" data-act="routine-edit" data-id="${r.id}" aria-label="Edit">${icon('pen')}</button></div></div>
    ${complete ? '' : `<div class="list" style="margin-top:4px">${items.map(i => `<div class="li ${i.done ? 'done' : ''}">${active ? `<button class="check ${i.done ? 'on' : ''}" data-act="check-toggle" data-r="${r.id}" data-i="${i.id}">${icon('check')}</button>` : `<span class="check" style="opacity:.4"></span>`}<div class="main"><div class="t">${esc(i.text)}</div></div></div>`).join('') || '<div class="empty small">No steps.</div>'}</div>`}</div>`;
  }
  return html;
}

async function routineEditor(id) {
  const r = id ? await db.get('routines', id) : { name: '', days: [0, 1, 2, 3, 4, 5, 6], time: '', items: [], remind: true };
  const s = sheet({
    title: id ? 'Edit routine' : 'New routine',
    body: `<div class="fields"><label class="field"><span>Name</span><input class="input" id="ro-name" value="${esc(r.name)}" placeholder="e.g. Evening skincare"></label><label class="field"><span>Days</span>${daychips('ro-days', r.days || [])}</label>
    <div class="row between"><label class="field grow"><span>Reminder time</span><input class="input" type="time" id="ro-time" value="${r.time || ''}"></label><div style="padding-top:22px">${toggleHtml('ro-remind', r.remind !== false)}</div></div>
    <label class="field"><span>Steps — one per line</span><textarea class="input" id="ro-items" style="min-height:160px" placeholder="Cleanse&#10;Moisturise&#10;Lip balm">${esc((r.items || []).map(i => i.text).join('\n'))}</textarea></label></div>`,
    foot: `${id ? '<button class="btn danger" id="ro-del">Delete</button>' : ''}<button class="btn primary" id="ro-save">Save</button>`,
  });
  s.foot.querySelector('#ro-save').onclick = async () => {
    const name = s.body.querySelector('#ro-name').value.trim();
    if (!name) return toast('Name required');
    const lines = s.body.querySelector('#ro-items').value.split('\n').map(x => x.trim()).filter(Boolean);
    const items = lines.map(text => (r.items || []).find(i => i.text === text) || { id: db.uid().slice(0, 8), text });
    await db.put('routines', { ...r, name, days: readDays(s.body, 'ro-days'), time: s.body.querySelector('#ro-time').value || null, remind: s.body.querySelector('[name="ro-remind"]').checked, items });
    s.close();
    toast('Routine saved');
  };
  if (id) s.foot.querySelector('#ro-del').onclick = async () => {
    if (await confirmSheet(`Delete ${r.name}?`, { ok: 'Delete', danger: true })) {
      await db.del('routines', id);
      s.close();
    }
  };
}

// ---------------- TIMETABLE ----------------
export async function classesFor(date) {
  const s = await core.getSettings();
  if (core.holidayActive(s, date)) return [];
  const wd = core.weekday(date);
  return (await db.all('timetable')).filter(c => (c.days || []).includes(wd)).sort((a, b) => a.start.localeCompare(b.start));
}
async function renderTimetable() {
  const all = await db.all('timetable');
  const s = await core.getSettings();
  let html = '';
  if (core.holidayActive(s, core.today())) html += `<div class="notice" style="margin-bottom:12px">Holiday mode is on until ${core.prettyDate(s.holidayUntil, { day: 'numeric', month: 'short' })} — classes are hidden from Today.</div>`;
  for (const d of [1, 2, 3, 4, 5, 6, 0]) {
    const list = all.filter(c => (c.days || []).includes(d)).sort((a, b) => a.start.localeCompare(b.start));
    if (!list.length) continue;
    html += `<div class="section-label">${core.DAY_SHORT[d]}</div><div class="card agenda flush"><div class="list">${list.map(c => `<div class="li tap" data-act="class-edit" data-id="${c.id}"><span class="time">${c.start}</span><div class="main"><div class="t">${esc(c.subject)}</div><div class="s">${c.start}–${c.end}${c.room ? ' · ' + esc(c.room) : ''}</div></div></div>`).join('')}</div></div>`;
  }
  if (!all.length) html += `<div class="card empty"><b>No timetable yet</b>Tap + to add your classes; they appear on Home on the right days.</div>`;
  return html;
}
async function classEditor(id) {
  const c = id ? await db.get('timetable', id) : { subject: '', start: '09:00', end: '10:00', days: [1], room: '' };
  const s = sheet({
    title: id ? 'Edit class' : 'Add class',
    body: `<div class="fields"><label class="field"><span>Subject</span><input class="input" id="cl-sub" value="${esc(c.subject)}"></label><div class="fields two"><label class="field"><span>Start</span><input class="input" type="time" id="cl-start" value="${c.start}"></label><label class="field"><span>End</span><input class="input" type="time" id="cl-end" value="${c.end}"></label></div><label class="field"><span>Days</span>${daychips('cl-days', c.days)}</label><label class="field"><span>Room / teacher</span><input class="input" id="cl-room" value="${esc(c.room || '')}"></label></div>`,
    foot: `${id ? '<button class="btn danger" id="cl-del">Delete</button>' : ''}<button class="btn primary" id="cl-save">Save</button>`,
  });
  s.foot.querySelector('#cl-save').onclick = async () => {
    const subject = s.body.querySelector('#cl-sub').value.trim();
    if (!subject) return toast('Subject required');
    await db.put('timetable', { ...c, subject, start: s.body.querySelector('#cl-start').value, end: s.body.querySelector('#cl-end').value, days: readDays(s.body, 'cl-days'), room: s.body.querySelector('#cl-room').value.trim() });
    s.close();
  };
  if (id) s.foot.querySelector('#cl-del').onclick = async () => {
    await db.del('timetable', id);
    s.close();
  };
}

// ---------------- MEAL PLAN ----------------
async function renderMeals() {
  const s = await core.getSettings();
  const start = state.planWeek || core.startOfWeek(core.today());
  const days = Array.from({ length: 7 }, (_, i) => core.addDays(start, i));
  const plan = await db.range('plan', days[0], days[6]);
  const recipes = await db.all('recipes');
  const byId = new Map(recipes.map(r => [r.id, r]));
  let html = `<div class="date-nav"><button class="icon-btn" data-act="plan-week" data-v="-7">${icon('chevL')}</button><span class="lbl">Week of ${core.prettyDate(start, { day: 'numeric', month: 'short' })}</span><button class="icon-btn" data-act="plan-week" data-v="7">${icon('chevR')}</button></div>
  <div class="row" style="gap:8px;margin-bottom:4px"><button class="btn sm primary grow" data-act="plan-fill">${icon('sparkle')} Fill empty slots</button><button class="btn sm" data-act="plan-clear">Clear week</button></div>`;
  if (recipes.length < 3) html += `<div class="notice warn" style="margin-bottom:12px">The planner uses your recipe library (favourites and higher-rated recipes come up more, with no repeats within 3 days). Add a few recipes first — or <button class="link" data-act="plan-gen">generate some</button>.</div>`;
  for (const d of days) {
    const items = PLAN_SLOTS.map(slot => ({ slot, p: plan.find(x => x.date === d && x.slot === slot) })).filter(x => x.slot !== 'snack' || x.p);
    const planned = items.filter(x => x.p && byId.get(x.p.recipeId)).map(x => byId.get(x.p.recipeId));
    const totals = N.sumNutrients(planned.map(r => r.perServing || N.recipeNutrition(r).perServing)).totals;
    html += `<div class="card" style="padding:12px;margin-top:12px"><div class="row between" style="margin:0 4px 8px"><div><div class="h3">${core.relDay(d)}</div>${planned.length ? `<div class="tiny muted"><span class="num">${Math.round(totals.kcal || 0)}</span> kcal · <span class="num">${Math.round(totals.protein || 0)}</span> g protein</div>` : ''}</div><button class="icon-btn" data-act="plan-day" data-date="${d}" aria-label="Regenerate day">${icon('repeat')}</button></div><div class="fields" style="gap:6px">${items.map(({ slot, p }) => {
      const r = p && byId.get(p.recipeId);
      return `<button class="plan-cell ${r ? 'set' : ''}" data-act="plan-cell" data-date="${d}" data-slot="${slot}"><span class="tiny muted" style="width:62px;text-transform:capitalize">${slot}</span>${r ? `${r.photo ? `<img class="thumb" style="width:28px;height:28px;border-radius:8px" src="${r.photo}" alt="">` : ''}<span class="grow ellipsis bold">${esc(r.name)}</span>` : '<span class="muted">—</span>'}</button>`;
    }).join('')}</div>${planned.length ? `<details style="margin-top:10px"><summary class="link small">vs targets</summary><div style="margin-top:10px">${targetBars(totals, s.targets)}</div></details>` : ''}</div>`;
  }
  return html;
}

async function planCell(date, slot) {
  const id = `${date}|${slot}`;
  const cur = await db.get('plan', id);
  const recipes = (await db.all('recipes')).sort((a, b) => (b.favourite ? 1 : 0) - (a.favourite ? 1 : 0) || a.name.localeCompare(b.name));
  const r = cur && recipes.find(x => x.id === cur.recipeId);
  const s = sheet({
    title: `${core.relDay(date)} · ${slot}`,
    body: `${r ? `<div class="grid2" style="margin-bottom:12px"><button class="btn primary" id="pc-log">Log as eaten</button><button class="btn" id="pc-view">View recipe</button><button class="btn" id="pc-swap">${icon('sparkle')} Swap</button><button class="btn danger" id="pc-clear">Clear</button></div>` : ''}
    <div class="section-label" style="margin-top:0">Choose from library</div><div class="list">${recipes.map(x => `<div class="li tap" data-id="${x.id}">${x.photo ? `<img class="thumb" src="${x.photo}" alt="">` : `<div class="thumb">${initials(x.name)}</div>`}<div class="main"><div class="t">${x.favourite ? '♥ ' : ''}${esc(x.name)}</div><div class="s">${Math.round((x.perServing || {}).kcal || 0)} kcal · ${Math.round((x.perServing || {}).protein || 0)} g protein</div></div></div>`).join('') || '<div class="empty">No recipes yet.</div>'}</div>`,
  });
  s.body.querySelectorAll('[data-id]').forEach(el => (el.onclick = async () => {
    await db.put('plan', { id, date, slot, recipeId: el.dataset.id });
    s.close();
  }));
  if (r) {
    s.body.querySelector('#pc-clear').onclick = async () => {
      await db.del('plan', id);
      s.close();
    };
    s.body.querySelector('#pc-view').onclick = () => {
      s.close();
      recipeDetail(r.id);
    };
    s.body.querySelector('#pc-swap').onclick = async () => {
      await fill([date], [slot], { replace: true });
      s.close();
    };
    s.body.querySelector('#pc-log').onclick = async () => {
      await db.put('entries', { date, slot: PLAN_TO_DIARY[slot], name: r.name, source: 'recipe', photo: r.photo || null, items: [{ key: 'r', kind: 'recipe', name: r.name, recipeId: r.id, servings: 1, perServing: r.perServing || N.recipeNutrition(r).perServing, source: 'recipe' }], createdAt: Date.now() });
      s.close();
      toast(`Logged to ${core.slotName(PLAN_TO_DIARY[slot])}`);
    };
  }
}

async function fill(days, slots = PLAN_SLOTS, { replace = false } = {}) {
  const s = await core.getSettings();
  const recipes = await db.all('recipes');
  if (!recipes.length) return toast('Add recipes to your library first');
  const existing = await db.range('plan', core.addDays(days[0], -4), days[days.length - 1]);
  const keep = replace ? existing.filter(p => !(days.includes(p.date) && slots.includes(p.slot))) : existing.filter(p => days.includes(p.date));
  const history = existing.filter(p => p.date < days[0]).map(p => ({ date: p.date, recipeId: p.recipeId }));
  const out = N.planMeals({ recipes, days, slots, targets: s.targets, history, keep: keep.filter(k => days.includes(k.date)) });
  const fresh = out.filter(p => replace || !existing.some(e => e.date === p.date && e.slot === p.slot));
  await db.putMany('plan', fresh.map(p => ({ id: `${p.date}|${p.slot}`, ...p })));
  const missing = days.length * slots.length - out.length;
  toast(missing > 0 ? `Planned. ${missing} slot(s) left empty — no recipes tagged for them.` : 'Planned');
}

// ---------------- actions ----------------
register({
  'planner-sub': el => setSub('planner', el.dataset.v),
  'task-edit': el => taskEditor(el.dataset.id),
  'task-toggle': async el => {
    const t = await db.get('tasks', el.dataset.id);
    t.done = !t.done;
    t.doneAt = t.done ? Date.now() : null;
    await db.put('tasks', t);
  },
  'toggle-done': () => {
    state.showDone = !state.showDone;
    rerender();
  },
  'routine-edit': el => routineEditor(el.dataset.id),
  'check-toggle': el => core.toggleCheck(el.dataset.date || core.today(), el.dataset.r, el.dataset.i),
  'class-edit': el => classEditor(el.dataset.id),
  'plan-week': el => {
    state.planWeek = core.addDays(state.planWeek || core.startOfWeek(core.today()), Number(el.dataset.v));
    rerender();
  },
  'plan-fill': () => {
    const start = state.planWeek || core.startOfWeek(core.today());
    return fill(Array.from({ length: 7 }, (_, i) => core.addDays(start, i)), ['breakfast', 'lunch', 'dinner']);
  },
  'plan-day': el => fill([el.dataset.date], ['breakfast', 'lunch', 'dinner'], { replace: true }),
  'plan-clear': async () => {
    const start = state.planWeek || core.startOfWeek(core.today());
    const list = await db.range('plan', start, core.addDays(start, 6));
    if (list.length && (await confirmSheet('Clear this week’s plan?', { ok: 'Clear', danger: true }))) await db.delMany('plan', list.map(p => p.id));
  },
  'plan-cell': el => planCell(el.dataset.date, el.dataset.slot),
  'plan-gen': () => generateSheet('Five varied healthy dinners for the week'),
});
