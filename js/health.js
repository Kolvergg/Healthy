// Health: hydration, medications, sleep, body, workouts, journal.
import * as db from './db.js';
import * as core from './core.js';
import * as N from './nutrition.js';
import * as api from './api.js';
import { esc, icon, sheet, toast, confirmSheet, promptSheet, ring, chart, daychips, readDays, toggleHtml } from './ui.js';
import { state, register, rerender } from './state.js';

const SUBS = [['water', 'Water'], ['meds', 'Meds'], ['sleep', 'Sleep'], ['body', 'Body'], ['workouts', 'Workouts'], ['journal', 'Journal']];

export async function render() {
  const sub = state.sub.health;
  const seg = `<div class="seg-wrap"><div class="seg">${SUBS.map(([k, l]) => `<button class="${sub === k ? 'on' : ''}" data-act="health-sub" data-v="${k}">${l}</button>`).join('')}</div></div>`;
  const head = `<div class="page-head"><div class="eyebrow">Health</div><h1 class="title">${Object.fromEntries(SUBS)[sub] === 'Meds' ? 'Medication' : Object.fromEntries(SUBS)[sub]}</h1></div>`;
  const fn = { water: renderWater, meds: renderMeds, sleep: renderSleep, body: renderBody, workouts: renderWorkouts, journal: renderJournal }[sub];
  return head + seg + (await fn());
}

const lastNDays = (n, end = core.today()) => Array.from({ length: n }, (_, i) => core.addDays(end, i - n + 1));
const shortLabel = d => core.parseYmd(d).toLocaleDateString('en-AU', { weekday: 'narrow' });
const dayNum = d => String(core.parseYmd(d).getDate());

// ---------------- WATER ----------------
export function waterCard(total, target, sizes, { compact = false } = {}) {
  const pct = target ? total / target : 0;
  return `<div class="hero">${ring(pct, { size: compact ? 96 : 130, stroke: compact ? 10 : 12, color: 'var(--water)', inner: `<div class="num bold" style="font-size:${compact ? 20 : 26}px">${(total / 1000).toFixed(2).replace(/0$/, '')}<span class="muted" style="font-size:12px"> L</span></div><div class="tiny muted">of ${(target / 1000).toFixed(1)} L</div>` })}<div class="grow"><div class="grid2" style="gap:8px">${sizes.map(ml => `<button class="btn sm" data-act="water-add" data-ml="${ml}">+${ml} ml</button>`).join('')}</div><div class="row" style="gap:8px;margin-top:8px"><button class="btn sm grow" data-act="water-custom">Custom</button><button class="btn sm" data-act="water-undo" aria-label="Undo last">Undo</button></div></div></div>`;
}

async function renderWater() {
  const s = await core.getSettings();
  const total = await core.waterTotal(core.today());
  const days = lastNDays(14);
  const rows = await db.range('water', days[0], days[days.length - 1]);
  const perDay = days.map(d => rows.filter(r => r.date === d).reduce((a, r) => a + r.ml, 0));
  const last7 = perDay.slice(-7);
  const avg7 = N.mean(last7);
  const prev7 = N.mean(perDay.slice(0, 7));
  const hit = last7.filter(v => v >= s.water.target).length;
  const todayLog = (await db.byDate('water', core.today())).sort((a, b) => (b.at || '').localeCompare(a.at || ''));
  const r = s.water.reminders;
  const wd = (x, k) => `<div class="fields three"><label class="field"><span>Start</span><input class="input sm" type="time" value="${x.start}" data-chg="water-rem" data-k="${k}.start"></label><label class="field"><span>End</span><input class="input sm" type="time" value="${x.end}" data-chg="water-rem" data-k="${k}.end"></label><label class="field"><span>Every (min)</span><input class="input sm num" type="number" min="15" step="15" value="${x.interval}" data-chg="water-rem" data-k="${k}.interval"></label></div>`;
  return `<div class="card">${waterCard(total, s.water.target, s.water.sizes)}</div>
  <div class="card"><div class="card-head"><div class="h3">Last 14 days</div><span class="small muted">dashed = target</span></div>${chart(days.map((d, i) => ({ label: dayNum(d), value: perDay[i], color: perDay[i] >= s.water.target ? 'var(--water)' : 'color-mix(in srgb, var(--water) 45%, transparent)', tip: `${core.relDay(d)}: ${perDay[i].toLocaleString('en-AU')} ml` })), { kind: 'bar', target: s.water.target, color: 'var(--water)', unit: 'ml' })}
  <div class="grid3" style="margin-top:12px"><div class="stat"><div class="k">7-day avg</div><div class="v num">${avg7 == null ? '—' : (avg7 / 1000).toFixed(2)}</div><div class="d">litres/day</div></div><div class="stat"><div class="k">vs prior week</div><div class="v num">${avg7 != null && prev7 ? `${avg7 >= prev7 ? '+' : ''}${Math.round(((avg7 - prev7) / prev7) * 100)}%` : '—'}</div><div class="d">average</div></div><div class="stat"><div class="k">Target hit</div><div class="v num">${hit}/7</div><div class="d">days</div></div></div></div>
  <div class="section-label">Today's log</div><div class="card" style="padding:4px 14px"><div class="list">${todayLog.length ? todayLog.map(w => `<div class="li"><div class="main"><div class="t num">${w.ml} ml</div><div class="s">${new Date(w.at).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })}</div></div><button class="icon-btn" data-act="water-del" data-id="${w.id}" aria-label="Delete">${icon('trash')}</button></div>`).join('') : '<div class="empty">Nothing logged yet today.</div>'}</div></div>
  <div class="section-label">Target & reminders</div>
  <div class="card stack"><div class="fields two"><label class="field"><span>Daily target (ml)</span><input class="input num" type="number" step="100" value="${s.water.target}" data-chg="water-target"></label><label class="field"><span>Quick-add sizes (ml)</span><input class="input" value="${s.water.sizes.join(', ')}" data-chg="water-sizes"></label></div>
  <div class="row between"><div><div class="h3">Reminders</div><div class="small muted">Stop automatically once you hit your target.</div></div>${toggleHtml('water-on', r.enabled, 'data-chg="water-rem-on"')}</div>
  <div class="small bold ink2">Weekdays</div>${wd(r.weekday, 'weekday')}<div class="small bold ink2">Weekends & holidays</div>${wd(r.weekend, 'weekend')}
  <div class="row" style="gap:8px"><button class="btn sm" data-act="snooze" data-min="30" data-title="Water" data-body="Time for a glass of water.">Remind me in 30 min</button><button class="btn sm" data-act="notif-history">Notification history</button></div></div>`;
}

// ---------------- MEDS ----------------
const STATUS_TXT = { taken: 'Taken', skipped: 'Skipped', missed: 'Missed', due: 'Due', upcoming: 'Later', optional: 'Optional' };
export function medRow(date, g, it) {
  const st = it.status;
  const cls = st === 'taken' ? 'on' : st === 'skipped' ? 'skip' : st === 'missed' ? 'missed' : '';
  return `<div class="li ${st === 'taken' || st === 'skipped' ? 'done' : ''}"><button class="check ${cls}" data-act="med-tap" data-date="${date}" data-med="${it.med.id}" data-slot="${g.slot.id}" aria-label="Mark taken">${icon(st === 'skipped' ? 'minus' : 'check')}</button><div class="main"><div class="t">${esc(it.med.name)} <span class="muted" style="font-weight:500">${esc([it.med.dose, it.med.qty].filter(Boolean).join(' · '))}</span></div><div class="s">${it.med.optional ? 'Optional · ' : ''}${it.med.kind === 'supplement' ? 'Supplement · ' : ''}${STATUS_TXT[st] || ''}${it.log && it.log.at ? ' ' + new Date(it.log.at).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' }) : ''}${it.med.note ? ` · <span style="color:var(--warn)">${esc(it.med.note)}</span>` : ''}</div></div><button class="btn sm ghost" data-act="med-more" data-date="${date}" data-med="${it.med.id}" data-slot="${g.slot.id}">•••</button></div>`;
}

async function renderMeds() {
  const date = state.date;
  const groups = await core.medDay(date);
  const meds = await db.all('meds');
  const slotNames = Object.fromEntries((await core.getSettings()).medSlots.map(x => [x.id, x.name]));
  const low = core.lowStock(meds);
  const days = lastNDays(14);
  const logs = await db.range('medlog', days[0], days[13]);
  const adherence = [];
  for (const d of days) {
    const req = meds.filter(m => !m.optional && core.medActiveOn(m, d));
    if (!req.length) {
      adherence.push({ d, cls: '' });
      continue;
    }
    const taken = req.filter(m => logs.some(l => l.date === d && l.medId === m.id && l.status === 'taken')).length;
    adherence.push({ d, cls: taken === req.length ? 'full' : taken ? 'part' : d === core.today() ? '' : 'none', t: `${taken}/${req.length}` });
  }
  let html = `<div class="date-nav"><button class="icon-btn" data-act="date-shift" data-v="-1">${icon('chevL')}</button><span class="lbl">${core.relDay(date)}</span><button class="icon-btn" data-act="date-shift" data-v="1">${icon('chevR')}</button></div>`;
  if (low.length) html += `<div class="notice warn" style="margin-bottom:12px"><b>Refill soon:</b> ${low.map(m => `${esc(m.name)} (${m.stock} left)`).join(', ')}</div>`;
  if (!meds.length) html += `<div class="card empty"><b>No medications yet</b>Add each medication or supplement with its exact prescribed dose. You can also import a starter file in Settings → Data.</div>`;
  for (const g of groups) html += `<div class="section-label row between"><span>${esc(g.slot.name)} · <span class="num">${g.time}</span></span><button class="link" data-act="med-slot-all" data-date="${date}" data-slot="${g.slot.id}">Mark all taken</button></div><div class="card" style="padding:4px 14px"><div class="list">${g.items.map(it => medRow(date, g, it)).join('')}</div></div>`;
  html += `<div class="card" style="margin-top:14px"><div class="card-head"><div class="h3">Adherence · 14 days</div><span class="small muted">required doses</span></div><div class="adherence">${adherence.map(a => `<i class="${a.cls}" title="${a.d}: ${a.t || 'n/a'}"></i>`).join('')}</div><div class="row small muted" style="gap:12px;margin-top:8px"><span><span class="dot" style="background:var(--good)"></span> all</span><span><span class="dot" style="background:var(--warn)"></span> some</span><span><span class="dot" style="background:var(--bad)"></span> none logged</span></div></div>`;
  html += `<div class="section-label row between"><span>All medications & supplements</span><button class="icon-btn" data-act="med-edit" aria-label="Add">${icon('plus')}</button></div><div class="card" style="padding:4px 14px"><div class="list">${meds.length ? meds.sort((a, b) => (a.active === b.active ? 0 : a.active ? -1 : 1) || a.name.localeCompare(b.name)).map(m => `<div class="li tap" data-act="med-edit" data-id="${m.id}"><div class="main"><div class="t">${esc(m.name)} <span class="muted" style="font-weight:500">${esc(m.dose || '')}</span></div><div class="s">${esc(slotNames[m.slotId] || 'No time')}${m.stock != null && m.stock !== '' ? ` · ${m.stock} left` : ''}${m.active ? '' : ' · paused'}</div></div>${m.active ? '' : '<span class="badge">Paused</span>'}${m.kind === 'supplement' ? '<span class="badge">Supp</span>' : ''}</div>`).join('') : '<div class="empty">Tap + to add one.</div>'}</div></div>`;
  html += `<p class="tiny muted" style="margin:12px 6px">This app only records what you enter. It never changes doses or tells you what to do after a missed dose — use the instructions from your pharmacist or the medicine's leaflet (CMI), which you can paste into each medication.</p>`;
  return html;
}

async function medEditor(id) {
  const s0 = await core.getSettings();
  const m = id ? await db.get('meds', id) : { active: true, kind: 'medication', days: [0, 1, 2, 3, 4, 5, 6], unitsPerDose: 1, slotId: s0.medSlots[0].id };
  const s = sheet({
    title: id ? 'Edit medication' : 'Add medication',
    body: `<div class="fields"><label class="field"><span>Name</span><input class="input" id="me-name" value="${esc(m.name || '')}" placeholder="e.g. Candesartan"></label>
    <div class="fields two"><label class="field"><span>Dose (exactly as prescribed)</span><input class="input" id="me-dose" value="${esc(m.dose || '')}" placeholder="e.g. 16 mg"></label><label class="field"><span>Amount per dose</span><input class="input" id="me-qty" value="${esc(m.qty || '')}" placeholder="e.g. 2 tablets"></label></div>
    <div class="fields two"><label class="field"><span>When</span><select class="input" id="me-slot">${s0.medSlots.map(x => `<option value="${x.id}" ${x.id === m.slotId ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label><label class="field"><span>Type</span><select class="input" id="me-kind"><option value="medication" ${m.kind !== 'supplement' ? 'selected' : ''}>Medication</option><option value="supplement" ${m.kind === 'supplement' ? 'selected' : ''}>Supplement</option></select></label></div>
    <label class="field"><span>Days</span>${daychips('me-days', m.days || [0, 1, 2, 3, 4, 5, 6])}</label>
    <div class="row between"><span class="h3">Optional (not counted as missed)</span>${toggleHtml('me-opt', m.optional)}</div>
    <div class="row between"><span class="h3">Active</span>${toggleHtml('me-active', m.active !== false)}</div>
    <div class="fields three"><label class="field"><span>In stock</span><input class="input num" type="number" id="me-stock" value="${m.stock ?? ''}"></label><label class="field"><span>Units/dose</span><input class="input num" type="number" step="0.5" id="me-units" value="${m.unitsPerDose ?? 1}"></label><label class="field"><span>Refill at</span><input class="input num" type="number" id="me-refill" value="${m.refillAt ?? ''}"></label></div>
    <label class="field"><span>Instructions</span><textarea class="input" id="me-ins" placeholder="e.g. Take with food">${esc(m.instructions || '')}</textarea></label>
    <label class="field"><span>Missed-dose instructions (from pharmacist / CMI)</span><textarea class="input" id="me-missed" placeholder="Paste exactly what your pharmacist or the leaflet says">${esc(m.missedDose || '')}</textarea></label>
    <label class="field"><span>Note / flag (shows next to the dose)</span><input class="input" id="me-note" value="${esc(m.note || '')}" placeholder="e.g. Confirm frequency with prescriber"></label></div>`,
    foot: `${id ? '<button class="btn danger" id="me-del">Delete</button>' : ''}<button class="btn primary" id="me-save">Save</button>`,
  });
  const b = s.body;
  s.foot.querySelector('#me-save').onclick = async () => {
    const name = b.querySelector('#me-name').value.trim();
    if (!name) return toast('Name required');
    Object.assign(m, {
      name,
      dose: b.querySelector('#me-dose').value.trim(),
      qty: b.querySelector('#me-qty').value.trim(),
      slotId: b.querySelector('#me-slot').value,
      kind: b.querySelector('#me-kind').value,
      days: readDays(b, 'me-days'),
      optional: b.querySelector('[name="me-opt"]').checked,
      active: b.querySelector('[name="me-active"]').checked,
      stock: N.num(b.querySelector('#me-stock').value),
      unitsPerDose: N.num(b.querySelector('#me-units').value) || 1,
      refillAt: N.num(b.querySelector('#me-refill').value),
      instructions: b.querySelector('#me-ins').value,
      missedDose: b.querySelector('#me-missed').value,
      note: b.querySelector('#me-note').value.trim(),
    });
    await db.put('meds', m);
    s.close();
    toast('Saved');
  };
  if (id)
    s.foot.querySelector('#me-del').onclick = async () => {
      if (await confirmSheet(`Delete ${m.name}? History stays.`, { ok: 'Delete', danger: true })) {
        await db.del('meds', id);
        s.close();
      }
    };
}

async function medMore(date, medId, slotId) {
  const med = await db.get('meds', medId);
  const log = await db.get('medlog', `${date}|${medId}|${slotId}`);
  const s = sheet({
    title: esc(med.name),
    body: `<div class="kv" style="margin-bottom:14px"><span>Dose</span><span>${esc(med.dose || '—')}</span><span>Amount</span><span>${esc(med.qty || '—')}</span>${med.stock != null && med.stock !== '' ? `<span>In stock</span><span>${med.stock}</span>` : ''}</div>
    ${med.instructions ? `<div class="notice small" style="margin-bottom:10px"><b>Instructions:</b> ${esc(med.instructions)}</div>` : ''}
    ${med.missedDose ? `<div class="notice small" style="margin-bottom:10px"><b>If missed (your saved instructions):</b> ${esc(med.missedDose)}</div>` : `<div class="notice warn small" style="margin-bottom:10px">No missed-dose instructions saved. Ask your pharmacist and add them in Edit.</div>`}
    <div class="grid2"><button class="btn" data-s="taken">Taken</button><button class="btn" data-s="skipped">Skipped</button><button class="btn" data-s="">Clear</button><button class="btn" data-snooze>Snooze 30 min</button></div>
    <button class="btn block" style="margin-top:10px" data-edit>Edit medication</button>
    ${log ? `<p class="small muted center">Logged ${esc(log.status)} at ${new Date(log.at).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })}</p>` : ''}`,
  });
  s.body.querySelectorAll('[data-s]').forEach(b => (b.onclick = async () => {
    await core.setMedStatus(date, med, slotId, b.dataset.s || null);
    s.close();
  }));
  s.body.querySelector('[data-snooze]').onclick = async () => {
    try {
      await api.snooze(30, 'Medication', `${med.name} ${med.dose || ''}`, './?go=meds');
      toast('Reminder in 30 minutes');
    } catch (e) {
      toast(e.message);
    }
    s.close();
  };
  s.body.querySelector('[data-edit]').onclick = () => {
    s.close();
    medEditor(medId);
  };
}

// ---------------- SLEEP ----------------
async function renderSleep() {
  const s = await core.getSettings();
  const days = lastNDays(14);
  const logs = await db.range('sleep', days[0], days[13]);
  const pick = d => logs.find(l => l.date === d && l.source !== 'Apple Health') || logs.find(l => l.date === d);
  const hours = days.map(d => {
    const l = pick(d);
    if (!l) return null;
    return l.hours != null ? l.hours : l.bed && l.wake ? N.sleepMinutes(l.bed, l.wake) / 60 : null;
  });
  const beds = days.map(d => pick(d)).filter(l => l && l.bed).map(l => N.bedtimeOffset(l.bed));
  const sd = N.stdev(beds);
  const avg = N.mean(hours.slice(-7));
  const wdIdx = core.scheduleDay(s, core.today());
  const tonight = s.sleep.nights[wdIdx];
  const tomorrow = s.sleep.nights[core.scheduleDay(s, core.addDays(core.today(), 1))];
  const target = N.sleepMinutes(tonight.bed, tomorrow.wake) / 60;
  const recent = logs.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10);
  return `<div class="card"><div class="row between"><div><div class="eyebrow">Tonight</div><div class="big-num num">${tonight.bed}</div><div class="small muted">wake ${tomorrow.wake} · ${target.toFixed(1)} h opportunity${core.holidayActive(s, core.today()) ? ' · holiday schedule' : ''}</div></div>${ring(avg ? avg / target : 0, { size: 92, stroke: 9, color: 'var(--sleep)', inner: `<div class="num bold">${avg ? avg.toFixed(1) : '—'}</div><div class="tiny muted">7-day h</div>` })}</div>
  <div class="row" style="gap:8px;margin-top:14px"><button class="btn primary grow" data-act="sleep-log">Log last night</button><button class="btn" data-act="sleep-schedule">Schedule</button></div></div>
  <div class="card"><div class="card-head"><div class="h3">Sleep duration</div><span class="small muted">hours</span></div>${chart(days.map((d, i) => ({ label: dayNum(d), value: hours[i], tip: hours[i] == null ? `${core.relDay(d)}: not logged` : `${core.relDay(d)}: ${hours[i].toFixed(1)} h` })), { kind: 'bar', color: 'var(--sleep)', target, fmt: v => v.toFixed(0) })}
  <div class="grid3" style="margin-top:12px"><div class="stat"><div class="k">7-day avg</div><div class="v num">${avg ? avg.toFixed(1) : '—'}</div><div class="d">hours</div></div><div class="stat"><div class="k">Bedtime spread</div><div class="v num">${sd == null ? '—' : '±' + Math.round(sd)}</div><div class="d">minutes (SD)</div></div><div class="stat"><div class="k">Logged</div><div class="v num">${hours.filter(h => h != null).length}/14</div><div class="d">nights</div></div></div></div>
  <div class="section-label">Recent</div><div class="card" style="padding:4px 14px"><div class="list">${recent.length ? recent.map(l => `<div class="li tap" data-act="sleep-log" data-id="${l.id}"><div class="main"><div class="t">${core.relDay(l.date)}</div><div class="s">${l.bed ? `${l.bed} → ${l.wake} · ` : ''}${(l.hours ?? N.sleepMinutes(l.bed, l.wake) / 60).toFixed(1)} h${l.quality ? ` · quality ${l.quality}/5` : ''}</div></div>${l.source === 'Apple Health' ? '<span class="badge apple">Apple Health</span>' : ''}</div>`).join('') : '<div class="empty">No sleep logged yet.</div>'}</div></div>
  <p class="tiny muted" style="margin:12px 6px">For waking up, use the iPhone Clock alarm — web notifications can't play alarm sounds or break through Silent mode.</p>`;
}

async function sleepLog(id) {
  const s0 = await core.getSettings();
  const existing = id ? await db.get('sleep', id) : null;
  const date = existing ? existing.date : core.today();
  const sched = s0.sleep.nights[core.weekday(core.addDays(date, -1))];
  const l = existing || { date, bed: sched.bed, wake: s0.sleep.nights[core.weekday(date)].wake, quality: 3 };
  const s = sheet({
    title: 'Log sleep',
    body: `<label class="field"><span>Morning of</span><input class="input" type="date" id="sl-date" value="${l.date}"></label><div class="fields two" style="margin-top:12px"><label class="field"><span>Went to bed</span><input class="input" type="time" id="sl-bed" value="${l.bed || ''}"></label><label class="field"><span>Woke up</span><input class="input" type="time" id="sl-wake" value="${l.wake || ''}"></label></div>
    <label class="field" style="margin-top:12px"><span>Quality</span><div class="seg" id="sl-q">${[1, 2, 3, 4, 5].map(q => `<button class="${(l.quality || 3) === q ? 'on' : ''}" data-q="${q}">${q}</button>`).join('')}</div></label>
    <label class="field" style="margin-top:12px"><span>Notes</span><input class="input" id="sl-notes" value="${esc(l.notes || '')}"></label>${l.source === 'Apple Health' ? '<p class="small muted">Imported from Apple Health. Saving creates a manual entry, which takes priority.</p>' : ''}`,
    foot: `${existing && existing.source !== 'Apple Health' ? '<button class="btn danger" id="sl-del">Delete</button>' : ''}<button class="btn primary" id="sl-save">Save</button>`,
  });
  let q = l.quality || 3;
  s.body.querySelectorAll('[data-q]').forEach(b => (b.onclick = () => {
    q = Number(b.dataset.q);
    s.body.querySelectorAll('[data-q]').forEach(x => x.classList.toggle('on', x === b));
  }));
  s.foot.querySelector('#sl-save').onclick = async () => {
    const bed = s.body.querySelector('#sl-bed').value;
    const wake = s.body.querySelector('#sl-wake').value;
    if (!bed || !wake) return toast('Enter both times');
    const obj = { ...(existing && existing.source !== 'Apple Health' ? existing : {}), date: s.body.querySelector('#sl-date').value, bed, wake, hours: N.sleepMinutes(bed, wake) / 60, quality: q, notes: s.body.querySelector('#sl-notes').value, source: 'manual' };
    await db.put('sleep', obj);
    s.close();
    toast(`${obj.hours.toFixed(1)} h logged`);
  };
  const del = s.foot.querySelector('#sl-del');
  if (del) del.onclick = async () => {
    await db.del('sleep', existing.id);
    s.close();
  };
}

async function sleepSchedule() {
  const s0 = await core.getSettings();
  const order = [1, 2, 3, 4, 5, 6, 0];
  const s = sheet({
    title: 'Sleep schedule',
    body: `<p class="small muted" style="margin-top:0">Wake = morning of that day. Bed = night of that day.</p><table class="t"><thead><tr><th>Day</th><th>Wake</th><th>Bed</th></tr></thead><tbody>${order.map(d => `<tr><td class="bold">${core.DAY_SHORT[d]}</td><td><input class="input sm" type="time" data-d="${d}" data-k="wake" value="${s0.sleep.nights[d].wake}"></td><td><input class="input sm" type="time" data-d="${d}" data-k="bed" value="${s0.sleep.nights[d].bed}"></td></tr>`).join('')}</tbody></table>
    <div class="row between" style="margin-top:16px"><div><div class="h3">Wind-down reminder</div><div class="small muted">Minutes before bed</div></div><div class="row"><input class="input sm num" style="width:70px" type="number" id="ss-wd" value="${s0.sleep.windDown.minutes}">${toggleHtml('ss-wdon', s0.sleep.windDown.enabled)}</div></div>
    <div class="row between" style="margin-top:12px"><div><div class="h3">Wake-up nudge</div><div class="small muted">A notification at wake time (not an alarm)</div></div>${toggleHtml('ss-wake', s0.sleep.wakeReminder)}</div>
    <div class="row between" style="margin-top:12px"><div><div class="h3">Holiday mode until</div><div class="small muted">Uses Saturday's times every day</div></div><input class="input sm" style="width:150px" type="date" id="ss-hol" value="${s0.holidayUntil || ''}"></div>`,
    foot: `<button class="btn primary" id="ss-save">Save</button>`,
  });
  s.foot.querySelector('#ss-save').onclick = async () => {
    const nights = structuredClone(s0.sleep.nights);
    s.body.querySelectorAll('[data-d]').forEach(i => (nights[i.dataset.d][i.dataset.k] = i.value));
    await core.saveSettings({ sleep: { nights, windDown: { enabled: s.body.querySelector('[name="ss-wdon"]').checked, minutes: Number(s.body.querySelector('#ss-wd').value) || 45 }, wakeReminder: s.body.querySelector('[name="ss-wake"]').checked }, holidayUntil: s.body.querySelector('#ss-hol').value || null });
    s.close();
    toast('Schedule saved');
    rerender();
  };
}

// ---------------- BODY ----------------
async function renderBody() {
  const w = (await db.all('weight')).sort((a, b) => a.date.localeCompare(b.date));
  const last90 = w.filter(x => x.date >= core.addDays(core.today(), -90));
  const hk = (await db.all('health')).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 7);
  return `<div class="card"><div class="row between"><div><div class="eyebrow">Latest weight</div><div class="big-num num">${w.length ? w[w.length - 1].kg.toFixed(1) : '—'}<span class="muted" style="font-size:16px"> kg</span></div><div class="small muted">${w.length ? core.relDay(w[w.length - 1].date) : 'Not logged yet'}</div></div><button class="btn primary" data-act="weight-add">Log weight</button></div>
  <div style="margin-top:14px">${chart(last90.map(x => ({ label: core.parseYmd(x.date).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }), value: x.kg, tip: `${core.relDay(x.date)}: ${x.kg.toFixed(1)} kg${x.source === 'Apple Health' ? ' (Apple Health)' : ''}` })), { kind: 'line', color: 'var(--accent)', fmt: v => v.toFixed(1), yMin: -1 })}</div></div>
  <div class="section-label">History</div><div class="card" style="padding:4px 14px"><div class="list">${w.length ? w.slice().reverse().slice(0, 20).map(x => `<div class="li"><div class="main"><div class="t num">${x.kg.toFixed(1)} kg</div><div class="s">${core.relDay(x.date)}</div></div>${x.source === 'Apple Health' ? '<span class="badge apple">Apple Health</span>' : `<button class="icon-btn" data-act="weight-del" data-id="${x.id}">${icon('trash')}</button>`}</div>`).join('') : '<div class="empty">No entries.</div>'}</div></div>
  <div class="section-label">Activity (Apple Health)</div><div class="card">${hk.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>Day</th><th class="n">Steps</th><th class="n">Exercise</th><th class="n">Rest HR</th></tr></thead><tbody>${hk.map(h => `<tr><td>${core.relDay(h.date)}</td><td class="n">${h.steps != null ? Math.round(h.steps).toLocaleString('en-AU') : '—'}</td><td class="n">${h.exerciseMin != null ? Math.round(h.exerciseMin) + ' min' : '—'}</td><td class="n">${h.restingHr != null ? Math.round(h.restingHr) : '—'}</td></tr>`).join('')}</tbody></table></div>` : `<div class="empty small">No Apple Health data yet. Set up the iOS Shortcut described in the README, then tap Sync in Settings.</div>`}</div>`;
}

// ---------------- WORKOUTS ----------------
function bestSet(sets) {
  return (sets || []).reduce((b, s) => (!b || (s.kg || 0) > (b.kg || 0) || ((s.kg || 0) === (b.kg || 0) && (s.reps || 0) > (b.reps || 0)) ? s : b), null);
}
export async function lastFor(exName, beforeDate = '9999') {
  const all = (await db.all('workouts')).filter(w => w.date < beforeDate).sort((a, b) => b.date.localeCompare(a.date));
  for (const w of all) {
    const ex = (w.exercises || []).find(e => e.name.toLowerCase() === exName.toLowerCase());
    if (ex && ex.sets && ex.sets.length) return { date: w.date, sets: ex.sets };
  }
  return null;
}
/** Simple, transparent progressive-overload rule. */
export function overloadHint(last, target) {
  if (!last) return 'First time — pick a weight you can do with good form.';
  const tReps = Number(target && target.reps) || null;
  const done = last.sets.filter(s => s.reps != null);
  const b = bestSet(done);
  if (!b) return '';
  const allHit = tReps ? done.length >= (Number(target.sets) || 1) && done.every(s => (s.reps || 0) >= tReps) : false;
  if (allHit) return `Hit all ${target.sets}×${tReps} at ${b.kg ?? 0} kg last time → try ${((b.kg || 0) + 2.5).toFixed(1)} kg.`;
  return `Last: best ${b.reps} × ${b.kg ?? 0} kg. Aim for ${tReps ? `${tReps} reps on every set` : 'one more rep'} at the same weight.`;
}

async function renderWorkouts() {
  const templates = await db.all('templates');
  const hist = (await db.all('workouts')).sort((a, b) => b.date.localeCompare(a.date));
  const wd = core.weekday(core.today());
  const weekStart = core.startOfWeek(core.today());
  const thisWeek = hist.filter(w => w.date >= weekStart).length;
  const exNames = [...new Set(hist.flatMap(w => (w.exercises || []).map(e => e.name)))].sort();
  return `<div class="card"><div class="row between"><div><div class="eyebrow">This week</div><div class="big-num num">${thisWeek}</div><div class="small muted">workouts logged</div></div><button class="btn primary" data-act="workout-start">${icon('plus')} Log workout</button></div></div>
  <div class="section-label row between"><span>Plans</span><button class="icon-btn" data-act="template-edit">${icon('plus')}</button></div>
  <div class="card" style="padding:4px 14px"><div class="list">${templates.length ? templates.map(t => `<div class="li"><div class="main tap" data-act="template-edit" data-id="${t.id}"><div class="t">${esc(t.name)} ${(t.days || []).includes(wd) ? '<span class="badge good">Today</span>' : ''}</div><div class="s">${(t.days || []).map(d => core.DAY_SHORT[d]).join(' ')}${t.time ? ' · ' + t.time : ''} · ${(t.exercises || []).length} exercises</div></div><button class="btn sm" data-act="workout-start" data-id="${t.id}">Start</button></div>`).join('') : '<div class="empty">Create a plan (e.g. Push, Pull, Legs) with days and an optional reminder time.</div>'}</div></div>
  <div class="section-label">History</div><div class="card" style="padding:4px 14px"><div class="list">${hist.length ? hist.slice(0, 15).map(w => `<div class="li tap" data-act="workout-open" data-id="${w.id}"><div class="main"><div class="t">${esc(w.name || 'Workout')}</div><div class="s">${core.relDay(w.date)} · ${(w.exercises || []).length} exercises · ${(w.exercises || []).reduce((a, e) => a + (e.sets || []).length, 0)} sets</div></div></div>`).join('') : '<div class="empty">No workouts yet.</div>'}</div></div>
  ${exNames.length ? `<div class="section-label">Exercise library</div><div class="card" style="padding:4px 14px"><div class="list">${(await Promise.all(exNames.map(async n => ({ n, last: await lastFor(n) })))).map(({ n, last }) => { const b = last && bestSet(last.sets); return `<div class="li tap" data-act="exercise-open" data-name="${esc(n)}"><div class="main"><div class="t">${esc(n)}</div><div class="s">${b ? `Last best ${b.reps} × ${b.kg ?? 0} kg · ${core.relDay(last.date)}` : ''}</div></div></div>`; }).join('')}</div></div>` : ''}`;
}

async function templateEditor(id) {
  const t = id ? await db.get('templates', id) : { name: '', days: [], exercises: [] };
  const s = sheet({
    title: id ? 'Edit plan' : 'New plan',
    body: `<div class="fields"><label class="field"><span>Name</span><input class="input" id="te-name" value="${esc(t.name)}" placeholder="e.g. Upper body"></label><label class="field"><span>Days</span>${daychips('te-days', t.days || [])}</label><label class="field"><span>Reminder time (optional)</span><input class="input" type="time" id="te-time" value="${t.time || ''}"></label>
    <label class="field"><span>Exercises — one per line as “Name, sets x reps”</span><textarea class="input" id="te-ex" style="min-height:150px" placeholder="Bench press, 3x8&#10;Lat pulldown, 3x10">${esc((t.exercises || []).map(e => `${e.name}, ${e.sets}x${e.reps}`).join('\n'))}</textarea></label></div>`,
    foot: `${id ? '<button class="btn danger" id="te-del">Delete</button>' : ''}<button class="btn primary" id="te-save">Save</button>`,
  });
  s.foot.querySelector('#te-save').onclick = async () => {
    const name = s.body.querySelector('#te-name').value.trim();
    if (!name) return toast('Name required');
    const exercises = s.body.querySelector('#te-ex').value.split('\n').map(l => l.trim()).filter(Boolean).map(l => {
      const m = l.match(/^(.*?)[,\s]+(\d+)\s*[x×]\s*(\d+)\s*$/i);
      return m ? { name: m[1].trim(), sets: Number(m[2]), reps: Number(m[3]) } : { name: l, sets: 3, reps: 10 };
    });
    await db.put('templates', { ...t, name, days: readDays(s.body, 'te-days'), time: s.body.querySelector('#te-time').value || null, exercises });
    s.close();
  };
  if (id) s.foot.querySelector('#te-del').onclick = async () => {
    await db.del('templates', id);
    s.close();
  };
}

async function workoutLogger(templateId, existingId) {
  const existing = existingId ? await db.get('workouts', existingId) : null;
  const tpl = templateId ? await db.get('templates', templateId) : null;
  const w = existing || { date: core.today(), name: tpl ? tpl.name : 'Workout', templateId: tpl ? tpl.id : null, exercises: tpl ? tpl.exercises.map(e => ({ name: e.name, target: { sets: e.sets, reps: e.reps }, sets: Array.from({ length: e.sets }, () => ({ reps: null, kg: null })) })) : [] };
  const hints = {};
  for (const e of w.exercises) hints[e.name] = overloadHint(await lastFor(e.name, w.date), e.target);
  const s = sheet({ title: existing ? 'Edit workout' : 'Log workout', body: '', foot: '' });
  const paint = () => {
    s.setBody(`<div class="fields two"><label class="field"><span>Name</span><input class="input" id="wl-name" value="${esc(w.name)}"></label><label class="field"><span>Date</span><input class="input" type="date" id="wl-date" value="${w.date}"></label></div>
    ${w.exercises.map((e, ei) => `<div class="item-card" style="margin-top:12px"><div class="row between"><input class="input sm grow" value="${esc(e.name)}" data-e="${ei}" data-f="name"><button class="icon-btn" data-rmx="${ei}" style="margin-left:8px">${icon('x')}</button></div>${hints[e.name] ? `<div class="tiny" style="color:var(--accent);margin:6px 2px">${esc(hints[e.name])}</div>` : ''}
      <table class="t" style="margin-top:4px"><thead><tr><th>Set</th><th>Reps</th><th>kg</th><th></th></tr></thead><tbody>${e.sets.map((st, si) => `<tr><td class="muted">${si + 1}</td><td><input class="input sm num" type="number" inputmode="numeric" value="${st.reps ?? ''}" data-e="${ei}" data-s="${si}" data-f="reps" placeholder="${e.target ? e.target.reps : ''}"></td><td><input class="input sm num" type="number" inputmode="decimal" step="0.5" value="${st.kg ?? ''}" data-e="${ei}" data-s="${si}" data-f="kg"></td><td><button class="icon-btn" data-rms="${ei}:${si}">${icon('minus')}</button></td></tr>`).join('')}</tbody></table>
      <button class="btn sm" data-adds="${ei}" style="margin-top:8px">${icon('plus')} Set</button></div>`).join('')}
    <button class="btn block" id="wl-addex" style="margin-top:12px">${icon('plus')} Add exercise</button>
    <label class="field" style="margin-top:12px"><span>Notes</span><textarea class="input" id="wl-notes">${esc(w.notes || '')}</textarea></label>`);
    s.setFoot(`${existing ? '<button class="btn danger" id="wl-del">Delete</button>' : ''}<button class="btn primary" id="wl-save">Save workout</button>`);
    const b = s.body;
    b.querySelectorAll('[data-f]').forEach(i => (i.oninput = () => {
      const e = w.exercises[i.dataset.e];
      if (i.dataset.f === 'name') e.name = i.value;
      else e.sets[i.dataset.s][i.dataset.f] = N.num(i.value);
    }));
    b.querySelectorAll('[data-adds]').forEach(x => (x.onclick = () => {
      const e = w.exercises[x.dataset.adds];
      const prev = e.sets[e.sets.length - 1];
      e.sets.push({ reps: prev ? prev.reps : null, kg: prev ? prev.kg : null });
      paint();
    }));
    b.querySelectorAll('[data-rms]').forEach(x => (x.onclick = () => {
      const [ei, si] = x.dataset.rms.split(':').map(Number);
      w.exercises[ei].sets.splice(si, 1);
      paint();
    }));
    b.querySelectorAll('[data-rmx]').forEach(x => (x.onclick = () => {
      w.exercises.splice(Number(x.dataset.rmx), 1);
      paint();
    }));
    b.querySelector('#wl-addex').onclick = async () => {
      const name = await promptSheet('Add exercise', { label: 'Exercise name', placeholder: 'e.g. Romanian deadlift', ok: 'Add' });
      if (!name) return;
      hints[name] = overloadHint(await lastFor(name, w.date), null);
      w.exercises.push({ name, sets: [{ reps: null, kg: null }] });
      paint();
    };
    s.foot.querySelector('#wl-save').onclick = async () => {
      w.name = b.querySelector('#wl-name').value.trim() || 'Workout';
      w.date = b.querySelector('#wl-date').value || core.today();
      w.notes = b.querySelector('#wl-notes').value;
      w.exercises = w.exercises.map(e => ({ ...e, sets: e.sets.filter(st => st.reps != null || st.kg != null) })).filter(e => e.sets.length);
      if (!w.exercises.length) return toast('Enter at least one set');
      await db.put('workouts', w);
      s.close();
      toast('Workout saved');
    };
    const del = s.foot.querySelector('#wl-del');
    if (del) del.onclick = async () => {
      if (await confirmSheet('Delete this workout?', { ok: 'Delete', danger: true })) {
        await db.del('workouts', w.id);
        s.close();
      }
    };
  };
  paint();
}

async function exerciseDetail(name) {
  const all = (await db.all('workouts')).sort((a, b) => a.date.localeCompare(b.date));
  const pts = [];
  for (const w of all) {
    const e = (w.exercises || []).find(x => x.name.toLowerCase() === name.toLowerCase());
    if (!e) continue;
    const b = bestSet(e.sets);
    const e1rm = b && b.kg ? b.kg * (1 + (b.reps || 1) / 30) : null;
    pts.push({ date: w.date, best: b, e1rm });
  }
  sheet({
    title: esc(name),
    body: `<div class="card"><div class="card-head"><div class="h3">Estimated 1-rep max</div><span class="small muted">Epley, kg</span></div>${chart(pts.map(p => ({ label: core.parseYmd(p.date).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }), value: p.e1rm, tip: `${core.relDay(p.date)}: ${p.best.reps} × ${p.best.kg} kg` })), { kind: 'line', fmt: v => v.toFixed(0), yMin: -1 })}</div>
    <div class="card" style="padding:4px 14px;margin-top:12px"><div class="list">${pts.slice().reverse().map(p => `<div class="li"><div class="main"><div class="t">${p.best ? `${p.best.reps} × ${p.best.kg ?? 0} kg` : '—'}</div><div class="s">${core.relDay(p.date)}</div></div></div>`).join('')}</div></div>`,
  });
}

// ---------------- JOURNAL ----------------
async function renderJournal() {
  const all = (await db.all('journal')).sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || 0) - (a.createdAt || 0));
  const since = core.addDays(core.today(), -30);
  const last30 = all.filter(j => j.date >= since);
  const mig = last30.filter(j => j.migraine && j.migraine.yes);
  const energy = N.mean(last30.map(j => j.energy));
  const mood = N.mean(last30.map(j => j.mood));
  return `<div class="card"><div class="grid3"><div class="stat"><div class="k">Energy</div><div class="v num">${energy ? energy.toFixed(1) : '—'}</div><div class="d">30-day avg /5</div></div><div class="stat"><div class="k">Mood</div><div class="v num">${mood ? mood.toFixed(1) : '—'}</div><div class="d">30-day avg /5</div></div><div class="stat"><div class="k">Migraines</div><div class="v num">${mig.length}</div><div class="d">last 30 days</div></div></div><button class="btn primary block" style="margin-top:12px" data-act="journal-edit">${icon('plus')} New entry</button></div>
  <div class="section-label">Entries</div><div class="card" style="padding:4px 14px"><div class="list">${all.length ? all.slice(0, 40).map(j => `<div class="li tap" data-act="journal-edit" data-id="${j.id}"><div class="main"><div class="t">${core.relDay(j.date)}${j.migraine && j.migraine.yes ? ` <span class="badge bad">Migraine ${j.migraine.severity || ''}</span>` : ''}</div><div class="s">${[j.energy && `Energy ${j.energy}/5`, j.mood && `Mood ${j.mood}/5`, j.symptoms].filter(Boolean).map(esc).join(' · ') || esc((j.notes || '').slice(0, 60))}</div></div></div>`).join('') : '<div class="empty">Log energy, mood, migraines and symptoms. Patterns show up in Statistics.</div>'}</div></div>
  <p class="tiny muted" style="margin:12px 6px">Health appointments live in Planner → Tasks with the “Appointment” category, so they get reminders.</p>`;
}

async function journalEditor(id) {
  const j = id ? await db.get('journal', id) : { date: core.today(), energy: null, mood: null, migraine: { yes: false }, createdAt: Date.now() };
  const scale = (name, v) => `<div class="seg" data-scale="${name}">${[1, 2, 3, 4, 5].map(q => `<button class="${v === q ? 'on' : ''}" data-q="${q}">${q}</button>`).join('')}</div>`;
  const s = sheet({
    title: id ? 'Edit entry' : 'Journal',
    body: `<label class="field"><span>Date</span><input class="input" type="date" id="jn-date" value="${j.date}"></label>
    <label class="field" style="margin-top:12px"><span>Energy</span>${scale('energy', j.energy)}</label>
    <label class="field" style="margin-top:12px"><span>Mood</span>${scale('mood', j.mood)}</label>
    <div class="row between" style="margin-top:14px"><span class="h3">Migraine</span>${toggleHtml('jn-mig', j.migraine && j.migraine.yes)}</div>
    <div id="jn-migbox" class="${j.migraine && j.migraine.yes ? '' : 'hidden'}"><div class="fields two" style="margin-top:10px"><label class="field"><span>Severity (1–10)</span><input class="input num" type="number" min="1" max="10" id="jn-sev" value="${(j.migraine && j.migraine.severity) || ''}"></label><label class="field"><span>Duration (h)</span><input class="input num" type="number" step="0.5" id="jn-dur" value="${(j.migraine && j.migraine.hours) || ''}"></label></div><label class="field" style="margin-top:10px"><span>Possible triggers</span><input class="input" id="jn-trig" value="${esc((j.migraine && j.migraine.triggers) || '')}" placeholder="e.g. poor sleep, skipped lunch, screens"></label><label class="field" style="margin-top:10px"><span>What you took / did</span><input class="input" id="jn-mmed" value="${esc((j.migraine && j.migraine.relief) || '')}"></label></div>
    <label class="field" style="margin-top:12px"><span>Symptoms</span><input class="input" id="jn-sym" value="${esc(j.symptoms || '')}" placeholder="e.g. dry lips, headache, nausea"></label>
    <label class="field" style="margin-top:12px"><span>Notes</span><textarea class="input" id="jn-notes">${esc(j.notes || '')}</textarea></label>`,
    foot: `${id ? '<button class="btn danger" id="jn-del">Delete</button>' : ''}<button class="btn primary" id="jn-save">Save</button>`,
  });
  const vals = { energy: j.energy, mood: j.mood };
  s.body.querySelectorAll('[data-scale]').forEach(seg => seg.querySelectorAll('[data-q]').forEach(b => (b.onclick = e => {
    e.preventDefault();
    vals[seg.dataset.scale] = Number(b.dataset.q);
    seg.querySelectorAll('[data-q]').forEach(x => x.classList.toggle('on', x === b));
  })));
  s.body.querySelector('[name="jn-mig"]').onchange = e => s.body.querySelector('#jn-migbox').classList.toggle('hidden', !e.target.checked);
  s.foot.querySelector('#jn-save').onclick = async () => {
    const b = s.body;
    await db.put('journal', { ...j, date: b.querySelector('#jn-date').value, energy: vals.energy, mood: vals.mood, migraine: { yes: b.querySelector('[name="jn-mig"]').checked, severity: N.num(b.querySelector('#jn-sev').value), hours: N.num(b.querySelector('#jn-dur').value), triggers: b.querySelector('#jn-trig').value, relief: b.querySelector('#jn-mmed').value }, symptoms: b.querySelector('#jn-sym').value, notes: b.querySelector('#jn-notes').value });
    s.close();
    toast('Saved');
  };
  if (id) s.foot.querySelector('#jn-del').onclick = async () => {
    await db.del('journal', id);
    s.close();
  };
}

// ---------------- actions ----------------
async function saveWaterRem(path, value) {
  const s = await core.getSettings();
  const r = structuredClone(s.water.reminders);
  const [a, b] = path.split('.');
  r[a][b] = b === 'interval' ? Math.max(15, Number(value) || 90) : value;
  await core.saveSettings({ water: { reminders: r } });
}
register({
  'health-sub': el => {
    state.sub.health = el.dataset.v;
    rerender();
  },
  'water-add': async el => {
    await core.addWater(Number(el.dataset.ml));
    const s = await core.getSettings();
    const t = await core.waterTotal(core.today());
    toast(t >= s.water.target ? 'Target reached 🎉' : `+${el.dataset.ml} ml`);
  },
  'water-custom': async () => {
    const v = await promptSheet('Add water', { label: 'Millilitres', type: 'number', placeholder: '330', ok: 'Add' });
    if (N.num(v)) await core.addWater(N.num(v));
  },
  'water-undo': async () => {
    const list = (await db.byDate('water', core.today())).sort((a, b) => (b.at || '').localeCompare(a.at || ''));
    if (list[0]) {
      await db.del('water', list[0].id);
      toast(`Removed ${list[0].ml} ml`);
    }
  },
  'water-del': el => db.del('water', el.dataset.id),
  'water-target': async el => {
    const v = N.num(el.value);
    if (v > 0) await core.saveSettings({ water: { target: v } });
  },
  'water-sizes': async el => {
    const sizes = el.value.split(/[,\s]+/).map(Number).filter(v => v > 0).slice(0, 6);
    if (sizes.length) await core.saveSettings({ water: { sizes } });
  },
  'water-rem': el => saveWaterRem(el.dataset.k, el.value),
  'water-rem-on': async el => {
    const s = await core.getSettings();
    await core.saveSettings({ water: { reminders: { ...s.water.reminders, enabled: el.checked } } });
  },
  'med-tap': async el => {
    const med = await db.get('meds', el.dataset.med);
    const log = await db.get('medlog', `${el.dataset.date}|${med.id}|${el.dataset.slot}`);
    await core.setMedStatus(el.dataset.date, med, el.dataset.slot, log && log.status === 'taken' ? null : 'taken');
  },
  'med-more': el => medMore(el.dataset.date, el.dataset.med, el.dataset.slot),
  'med-slot-all': async el => {
    const groups = await core.medDay(el.dataset.date);
    const g = groups.find(x => x.slot.id === el.dataset.slot);
    for (const it of g.items) if (it.status !== 'taken' && it.status !== 'skipped') await core.setMedStatus(el.dataset.date, it.med, g.slot.id, 'taken');
    toast(`${g.slot.name} done`);
  },
  'med-edit': el => medEditor(el.dataset.id),
  'sleep-log': el => sleepLog(el.dataset.id),
  'sleep-schedule': () => sleepSchedule(),
  'weight-add': async () => {
    const v = await promptSheet('Log weight', { label: 'Kilograms', type: 'number', ok: 'Save' });
    const kg = N.num(v);
    if (kg) await db.put('weight', { date: core.today(), kg, source: 'manual' });
  },
  'weight-del': el => db.del('weight', el.dataset.id),
  'workout-start': el => workoutLogger(el.dataset.id),
  'workout-open': async el => {
    const w = await db.get('workouts', el.dataset.id);
    workoutLogger(w.templateId, w.id);
  },
  'template-edit': el => templateEditor(el.dataset.id),
  'exercise-open': el => exerciseDetail(el.dataset.name),
  'journal-edit': el => journalEditor(el.dataset.id),
  snooze: async el => {
    try {
      await api.snooze(Number(el.dataset.min) || 30, el.dataset.title || 'Reminder', el.dataset.body || '', el.dataset.url || './');
      toast(`Reminder in ${el.dataset.min || 30} min`);
    } catch (e) {
      toast(e.message);
    }
  },
});
