// Settings: connection, notifications, targets, schedules, data, Apple Health.
import * as db from './db.js';
import * as core from './core.js';
import * as N from './nutrition.js';
import * as api from './api.js';
import { esc, icon, sheet, toast, confirmSheet, download, toggleHtml } from './ui.js';
import { register, rerender } from './state.js';
import { afcdImport } from './food.js';

export const APP_VERSION = '1.0.0';
let connMsg = '';

export async function render() {
  const s = await core.getSettings();
  const sup = api.pushSupport();
  const sub = await api.currentSubscription().catch(() => null);
  const conf = await api.configured();
  const synced = await db.kvGet('cache:configSyncedAt', null);
  const syncErr = await db.kvGet('cache:configSyncError', null);
  const hkAt = await db.kvGet('cache:healthPulledAt', null);
  const afcd = (await db.bySource('afcd')).length;
  const persisted = navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted() : false;
  const ago = t => (t ? new Date(t).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : 'never');

  const notifStatus = !conf ? ['bad', 'Connect your Worker first'] : sup.ios && !sup.standalone ? ['warn', 'Open from the Home Screen icon to enable'] : sup.permission === 'denied' ? ['bad', 'Blocked in iOS Settings'] : sub ? ['good', 'On for this device'] : ['warn', 'Off'];

  return `<div class="page-head"><div class="eyebrow">Settings</div><h1 class="title">Settings</h1></div>

  <details class="set" ${conf ? '' : 'open'}><summary>Connection <span class="badge ${conf || s.geminiKey ? 'good' : 'bad'}" style="margin-left:auto;margin-right:8px">${conf ? 'Worker' : s.geminiKey ? 'AI key' : 'Needed'}</span></summary><div class="body stack">
    <p class="small muted" style="margin:0">Your Cloudflare Worker holds the AI key and sends reminders. See README for the 10-minute setup.</p>
    <label class="field"><span>Gemini API key (stored only on this phone)</span><input class="input" id="st-gkey" type="password" value="${esc(s.geminiKey || '')}" autocomplete="off" placeholder="AQ.… or AIza…"></label>
    <p class="small muted" style="margin:0">With just the key, all AI features work. The Worker below is only needed for notifications and backups.</p>
    <label class="field"><span>Worker URL</span><input class="input" id="st-url" value="${esc(s.worker.url)}" placeholder="https://healthos.<you>.workers.dev" autocapitalize="off" autocorrect="off"></label>
    <label class="field"><span>App token (the APP_TOKEN secret)</span><input class="input" id="st-token" type="password" value="${esc(s.worker.token)}" autocomplete="off"></label>
    <div class="row" style="gap:8px"><button class="btn primary" data-act="st-save-conn">Save & test</button><span class="small muted" id="st-conn-out">${connMsg}</span></div>
  </div></details>

  <details class="set" open><summary>Reminders (no server needed) <span class="badge good" style="margin-left:auto;margin-right:8px">Recommended</span></summary><div class="body stack">
    <p class="small ink2" style="margin:0">Puts your medication, water, wind-down, routine, workout and task reminders into iPhone Calendar as alerts. They fire on the phone itself — offline, with HealthOS closed, no Cloudflare needed.</p>
    <button class="btn primary" data-act="st-ics">${icon('bell')} Add reminders to Calendar</button>
    <p class="tiny muted" style="margin:0">On iPhone: tap the button → choose Calendar (or open the file) → <b>Add All</b> into a new calendar named “HealthOS”. After changing times or medications, delete that calendar (Calendar → Calendars → HealthOS → Delete) and tap the button again.</p>
  </div></details>

  <details class="set"><summary>Push notifications (needs Worker) <span class="badge ${notifStatus[0]}" style="margin-left:auto;margin-right:8px">${notifStatus[1]}</span></summary><div class="body stack">
    ${sup.ios && !sup.standalone ? `<div class="notice warn small">iPhone only delivers web notifications to apps added to the Home Screen. In Safari tap <b>Share → Add to Home Screen</b>, open HealthOS from that icon, then come back here.</div>` : ''}
    <div class="row" style="gap:8px;flex-wrap:wrap">${sub ? `<button class="btn" data-act="st-push-test">${icon('bell')} Send test</button><button class="btn" data-act="st-push-off">Turn off</button>` : `<button class="btn primary" data-act="st-push-on">${icon('bell')} Enable notifications</button>`}<button class="btn" data-act="st-sync">Sync reminders now</button></div>
    <div class="small muted">Reminder schedule last synced: ${ago(synced)}${syncErr && (!synced || syncErr) ? ` <span style="color:var(--bad)">${esc(syncErr)}</span>` : ''}</div>
    <div class="row between"><div><div class="h3">Hide medication names on Lock Screen</div><div class="small muted">Shows “2 items to take” instead</div></div>${toggleHtml('st-hide', s.privacy.hideMedNames, 'data-chg="st-hide"')}</div>
    <div class="row between"><div><div class="h3">Follow-up if not logged</div><div class="small muted">Minutes after a medication reminder (0 = off)</div></div><input class="input sm num" style="width:80px" type="number" min="0" step="5" value="${s.medFollowUp}" data-chg="st-follow"></div>
    <div class="row between"><div><div class="h3">Refill reminder time</div><div class="small muted">Daily, only when stock is low</div></div><input class="input sm" style="width:120px" type="time" value="${s.refillTime}" data-chg="st-refill"></div>
    <button class="btn" data-act="notif-history">Notification history</button>
  </div></details>

  <details class="set"><summary>Medication times</summary><div class="body stack">
    <p class="small muted" style="margin:0">Each medication is attached to one of these. “Bedtime” slots follow your sleep schedule.</p>
    ${s.medSlots.map((m, i) => `<div class="item-card"><div class="fields two"><label class="field"><span>Name</span><input class="input sm" data-slot="${i}" data-k="name" value="${esc(m.name)}"></label><label class="field"><span>Type</span><select class="input sm" data-slot="${i}" data-k="mode"><option value="fixed" ${m.mode !== 'bedtime' ? 'selected' : ''}>Fixed time</option><option value="bedtime" ${m.mode === 'bedtime' ? 'selected' : ''}>Relative to bedtime</option></select></label></div>${m.mode === 'bedtime' ? `<label class="field" style="margin-top:8px"><span>Minutes before bed</span><input class="input sm num" type="number" data-slot="${i}" data-k="offset" value="${-(m.offset || 0)}"></label>` : `<div class="fields two" style="margin-top:8px"><label class="field"><span>Weekdays</span><input class="input sm" type="time" data-slot="${i}" data-k="weekday" value="${m.weekday || ''}"></label><label class="field"><span>Weekends</span><input class="input sm" type="time" data-slot="${i}" data-k="weekend" value="${m.weekend || ''}"></label></div>`}<button class="link small" data-act="slot-del" data-i="${i}" style="margin-top:8px">Remove</button></div>`).join('')}
    <div class="row" style="gap:8px"><button class="btn" data-act="slot-add">${icon('plus')} Add time</button><button class="btn primary" data-act="slot-save">Save times</button></div>
  </div></details>

  <details class="set"><summary>Nutrition priorities</summary><div class="body stack">
    <p class="small muted" style="margin:0">Minimums are goals to reach; limits are ceilings. Weight (0–5) sets how much each counts in the priority score and the meal planner. No calorie ceiling is applied.</p>
    ${s.targets.map((t, i) => `<div class="item-card"><div class="row between"><b>${N.NUTRIENT[t.key].label}</b><button class="link small" data-act="target-del" data-i="${i}">Remove</button></div><div class="fields three" style="margin-top:8px"><label class="field"><span>Type</span><select class="input sm" data-t="${i}" data-k="kind"><option value="min" ${t.kind === 'min' ? 'selected' : ''}>At least</option><option value="max" ${t.kind === 'max' ? 'selected' : ''}>At most</option></select></label><label class="field"><span>${N.NUTRIENT[t.key].unit}/day</span><input class="input sm num" type="number" data-t="${i}" data-k="value" value="${t.value}"></label><label class="field"><span>Weight</span><input class="input sm num" type="number" min="0" max="5" data-t="${i}" data-k="weight" value="${t.weight}"></label></div><div class="row between" style="margin-top:8px"><span class="small ink2">Show on Today & diary</span>${toggleHtml('t-show-' + i, t.show, `data-t="${i}" data-k="show"`)}</div></div>`).join('')}
    <div class="row" style="gap:8px"><select class="input sm grow" id="st-addt">${N.NUTRIENTS.filter(n => !s.targets.some(t => t.key === n.key)).map(n => `<option value="${n.key}">${n.label}</option>`).join('')}</select><button class="btn sm" data-act="target-add">Add</button></div>
    <button class="btn primary" data-act="target-save">Save priorities</button>
  </div></details>

  <details class="set"><summary>Profile & appearance</summary><div class="body stack">
    <label class="field"><span>Your name (for the greeting)</span><input class="input" value="${esc(s.name)}" data-chg="st-name"></label>
    <label class="field"><span>Theme</span><div class="seg">${['auto', 'light', 'dark'].map(t => `<button class="${s.theme === t ? 'on' : ''}" data-act="st-theme" data-v="${t}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}</div></label>
  </div></details>

  <details class="set"><summary>Data, backups & export</summary><div class="body stack">
    <div class="small muted">Food database: ${afcd.toLocaleString('en-AU')} AFCD foods · storage ${persisted ? 'protected from eviction' : 'not yet protected (install to Home Screen)'}</div>
    <button class="btn" data-act="afcd-import">${icon('book')} Import / update AFCD</button>
    <div class="row between"><div><div class="h3">Daily automatic backup</div><div class="small muted">To your Worker · last: ${ago(s.lastBackup)}</div></div>${toggleHtml('st-ab', s.autoBackup, 'data-chg="st-autobackup"')}</div>
    <div class="grid2"><button class="btn" data-act="st-backup">Back up now</button><button class="btn" data-act="st-restore">Restore…</button></div>
    <div class="grid2"><button class="btn" data-act="st-export-json">Export JSON</button><button class="btn" data-act="st-export-csv">Export CSV</button></div>
    <label class="btn" style="position:relative">Import JSON backup / starter file<input type="file" accept="application/json,.json" data-chg="st-import" style="position:absolute;inset:0;opacity:0"></label>
    <button class="btn danger" data-act="st-wipe">Erase all data on this device</button>
  </div></details>

  <details class="set"><summary>Apple Health</summary><div class="body stack">
    <p class="small ink2" style="margin:0">A web app can't read HealthKit directly — Apple only allows that for native apps. Instead, an iOS Shortcut (set up once, runs automatically each morning) reads steps, sleep, heart rate and weight from Health and sends them to your Worker. HealthOS pulls them in and labels them <span class="badge apple">Apple Health</span> so they're never confused with what you typed. Step-by-step instructions are in the README.</p>
    <div class="row between"><span class="small muted">Last pulled: ${ago(hkAt)}</span><button class="btn sm" data-act="st-hk">Sync now</button></div>
  </div></details>

  <details class="set"><summary>About</summary><div class="body stack small ink2">
    <div>HealthOS ${APP_VERSION}. Your data lives on this device (IndexedDB). AI requests and reminders go through your own Cloudflare Worker; nothing is sent anywhere else.</div>
    <div>Nutrition numbers come from AFCD, labels you confirmed, or foods you entered. Anything AI-estimated is marked <span class="badge unverified">Unverified</span>.</div>
    <button class="btn" data-act="st-update">Check for app update</button>
  </div></details>`;
}

function toCsv(rows, cols) {
  const q = v => {
    if (v == null) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...rows.map(r => cols.map(c => q(r[c])).join(','))].join('\n');
}

async function exportCsv() {
  const s = sheet({
    title: 'Export CSV',
    body: `<div class="list">${[['diary', 'Food diary (one row per item)'], ['daily', 'Daily summary'], ['water', 'Water'], ['meds', 'Medication log'], ['sleep', 'Sleep'], ['weight', 'Weight'], ['workouts', 'Workouts (one row per set)'], ['journal', 'Journal']].map(([k, l]) => `<div class="li tap" data-k="${k}"><div class="main"><div class="t">${l}</div></div>${icon('chevR')}</div>`).join('')}</div>`,
  });
  s.body.querySelectorAll('[data-k]').forEach(el => (el.onclick = async () => {
    const k = el.dataset.k;
    let csv = '';
    const sortD = a => a.sort((x, y) => (x.date || '').localeCompare(y.date || ''));
    if (k === 'diary') {
      const rows = [];
      for (const e of sortD(await db.all('entries'))) for (const it of e.items || []) {
        const n = N.itemNutrients(it);
        rows.push({ date: e.date, meal: core.slotName(e.slot), entry: e.name, item: it.foodName || it.name, grams: it.grams ?? '', servings: it.servings ?? '', source: it.source || '', ...Object.fromEntries(N.NUTRIENT_KEYS.map(x => [x, n[x] == null ? '' : N.round(n[x], 2)])) });
      }
      csv = toCsv(rows, ['date', 'meal', 'entry', 'item', 'grams', 'servings', 'source', ...N.NUTRIENT_KEYS]);
    } else if (k === 'daily') {
      const by = {};
      for (const e of await db.all('entries')) (by[e.date] = by[e.date] || []).push(e);
      csv = toCsv(Object.keys(by).sort().map(d => {
        const t = N.dayTotals(by[d]).totals;
        return { date: d, ...Object.fromEntries(N.NUTRIENT_KEYS.map(x => [x, t[x] == null ? '' : N.round(t[x], 1)])) };
      }), ['date', ...N.NUTRIENT_KEYS]);
    } else if (k === 'water') csv = toCsv(sortD(await db.all('water')), ['date', 'at', 'ml']);
    else if (k === 'meds') {
      const meds = new Map((await db.all('meds')).map(m => [m.id, m]));
      csv = toCsv(sortD(await db.all('medlog')).map(l => ({ ...l, medication: (meds.get(l.medId) || {}).name, dose: (meds.get(l.medId) || {}).dose })), ['date', 'slotId', 'medication', 'dose', 'status', 'at']);
    } else if (k === 'sleep') csv = toCsv(sortD(await db.all('sleep')), ['date', 'bed', 'wake', 'hours', 'quality', 'source', 'notes']);
    else if (k === 'weight') csv = toCsv(sortD(await db.all('weight')), ['date', 'kg', 'source']);
    else if (k === 'workouts') {
      const rows = [];
      for (const w of sortD(await db.all('workouts'))) for (const e of w.exercises || []) (e.sets || []).forEach((st, i) => rows.push({ date: w.date, workout: w.name, exercise: e.name, set: i + 1, reps: st.reps, kg: st.kg }));
      csv = toCsv(rows, ['date', 'workout', 'exercise', 'set', 'reps', 'kg']);
    } else if (k === 'journal') csv = toCsv(sortD(await db.all('journal')).map(j => ({ ...j, migraine: j.migraine && j.migraine.yes ? 'yes' : '', severity: j.migraine && j.migraine.severity, triggers: j.migraine && j.migraine.triggers })), ['date', 'energy', 'mood', 'migraine', 'severity', 'triggers', 'symptoms', 'notes']);
    download(`healthos-${k}-${core.today()}.csv`, csv, 'text/csv');
  }));
}

async function notifHistory() {
  const s = sheet({ title: 'Notification history', body: `<div class="loading-block"><span class="spinner"></span></div>` });
  try {
    const list = await api.call('/api/history');
    s.setBody(list.length ? `<div class="list">${list.map(h => `<div class="li"><div class="main"><div class="t">${esc(h.title)}</div><div class="s">${new Date(h.at).toLocaleString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })} · ${esc(h.body || '')}</div></div><span class="badge ${h.ok ? 'good' : 'bad'}">${h.ok ? 'Sent' : 'Failed'}</span></div>`).join('')}</div>` : `<div class="empty">No notifications sent yet.</div>`);
  } catch (e) {
    s.setBody(`<div class="notice bad">${esc(e.message)}</div>`);
  }
}

async function readSlots() {
  const s = await core.getSettings();
  const slots = structuredClone(s.medSlots);
  document.querySelectorAll('[data-slot]').forEach(i => {
    const sl = slots[i.dataset.slot];
    if (!sl) return;
    if (i.dataset.k === 'offset') sl.offset = -(Number(i.value) || 0);
    else sl[i.dataset.k] = i.value;
  });
  return slots;
}
async function readTargets() {
  const s = await core.getSettings();
  const t = structuredClone(s.targets);
  document.querySelectorAll('[data-t]').forEach(i => {
    const x = t[i.dataset.t];
    if (!x) return;
    if (i.dataset.k === 'show') x.show = i.checked;
    else if (i.dataset.k === 'kind') x.kind = i.value;
    else x[i.dataset.k] = Math.max(0, Number(i.value) || 0);
  });
  return t;
}

export function applyTheme(theme) {
  const dark = theme === 'dark' || (theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = dark ? '#0c0d0f' : '#f4f3ef';
}

register({
  'st-ics': async () => {
    const { exportCalendar } = await import('./calendar.js');
    const n = await exportCalendar();
    if (n) toast(`${n} reminder series ready — choose Add All`, { ms: 5000 });
  },
  'st-save-conn': async () => {
    const url = document.getElementById('st-url').value.trim().replace(/\/+$/, '');
    const token = document.getElementById('st-token').value.trim();
    const geminiKey = document.getElementById('st-gkey').value.trim();
    await core.saveSettings({ worker: { url, token }, geminiKey });
    if (!url || !token) {
      connMsg = geminiKey ? '<span style="color:var(--good)">Key saved — AI works directly.</span> Add a Worker for notifications.' : 'Enter a Gemini key or a Worker.';
      return rerender();
    }
    connMsg = 'Testing…';
    rerender();
    try {
      const p = await api.call('/api/ping');
      connMsg = `<span style="color:var(--good)">Connected</span> · AI key ${p.ai ? '✓' : '✗ missing'} · ${p.subs} device(s)${p.subject ? '' : ' · set VAPID_SUBJECT'}`;
      await api.syncConfig(true);
    } catch (e) {
      connMsg = `<span style="color:var(--bad)">${esc(e.message)}</span>`;
    }
    rerender();
  },
  'st-push-on': async () => {
    try {
      await api.enablePush();
      toast('Notifications on');
      rerender();
    } catch (e) {
      toast(e.message, { ms: 6000 });
    }
  },
  'st-push-off': async () => {
    await api.disablePush();
    toast('Notifications off for this device');
    rerender();
  },
  'st-push-test': async () => {
    try {
      const r = await api.call('/api/test', { method: 'POST' });
      toast(r.sent ? 'Sent — it should arrive in a few seconds' : `Not delivered: ${(r.results[0] && (r.results[0].error || r.results[0].status)) || 'no devices'}`, { ms: 5000 });
    } catch (e) {
      toast(e.message);
    }
  },
  'st-sync': async () => {
    await db.kvSet('cache:configSyncError', null, { silent: true });
    await api.syncConfig(true);
    const err = await db.kvGet('cache:configSyncError', null);
    toast(err ? err : 'Reminders synced');
    rerender();
  },
  'st-hide': async el => core.saveSettings({ privacy: { hideMedNames: el.checked } }),
  'st-follow': async el => core.saveSettings({ medFollowUp: Math.max(0, Number(el.value) || 0) }),
  'st-refill': async el => el.value && core.saveSettings({ refillTime: el.value }),
  'notif-history': () => notifHistory(),
  'slot-add': async () => {
    const slots = await readSlots();
    slots.push({ id: db.uid().slice(0, 8), name: 'New time', mode: 'fixed', weekday: '12:00', weekend: '12:00' });
    await core.saveSettings({ medSlots: slots });
    rerender();
  },
  'slot-del': async el => {
    const slots = await readSlots();
    const sl = slots[Number(el.dataset.i)];
    const used = (await db.all('meds')).filter(m => m.slotId === sl.id);
    if (used.length) return toast(`Move ${used.map(m => m.name).join(', ')} to another time first`);
    slots.splice(Number(el.dataset.i), 1);
    await core.saveSettings({ medSlots: slots });
    rerender();
  },
  'slot-save': async () => {
    await core.saveSettings({ medSlots: await readSlots() });
    toast('Times saved');
    rerender();
  },
  'target-add': async () => {
    const key = document.getElementById('st-addt').value;
    if (!key) return;
    const t = await readTargets();
    t.push({ key, kind: ['sodium', 'satfat', 'addedSugars', 'sugars'].includes(key) ? 'max' : 'min', value: 10, weight: 2, show: true });
    await core.saveSettings({ targets: t });
    rerender();
  },
  'target-del': async el => {
    const t = await readTargets();
    t.splice(Number(el.dataset.i), 1);
    await core.saveSettings({ targets: t });
    rerender();
  },
  'target-save': async () => {
    await core.saveSettings({ targets: await readTargets() });
    toast('Priorities saved');
  },
  'st-name': el => core.saveSettings({ name: el.value.trim() }),
  'st-theme': async el => {
    await core.saveSettings({ theme: el.dataset.v });
    applyTheme(el.dataset.v);
    rerender();
  },
  'st-autobackup': el => core.saveSettings({ autoBackup: el.checked }),
  'st-backup': async () => {
    try {
      const bytes = await api.backupNow();
      toast(`Backed up (${Math.round(bytes / 1024)} KB)`);
      rerender();
    } catch (e) {
      toast(e.message);
    }
  },
  'st-restore': async () => {
    const s = sheet({
      title: 'Restore from Worker',
      body: `<p class="small ink2" style="margin-top:0">This replaces everything on this device with the backup. Photos aren't included in Worker backups (export JSON for those).</p><div class="grid2"><button class="btn" data-p="0">Latest backup</button><button class="btn" data-p="1">The one before</button></div>`,
    });
    s.body.querySelectorAll('[data-p]').forEach(b => (b.onclick = async () => {
      if (!(await confirmSheet('Replace all data on this device with the backup?', { ok: 'Restore', danger: true }))) return;
      try {
        await api.restoreBackup(b.dataset.p === '1');
        core.invalidateSettings();
        s.close();
        toast('Restored');
        rerender();
      } catch (e) {
        toast(e.message);
      }
    }));
  },
  'st-export-json': async () => download(`healthos-backup-${core.today()}.json`, JSON.stringify(await db.exportAll({ photos: true }))),
  'st-export-csv': () => exportCsv(),
  'st-import': async el => {
    const f = el.files[0];
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      const s = sheet({
        title: 'Import',
        body: `<p class="small ink2" style="margin-top:0">${esc(f.name)} · ${Object.entries(data.stores || {}).filter(([, v]) => v.length).map(([k, v]) => `${v.length} ${k}`).join(', ')}</p><div class="grid2"><button class="btn primary" data-m="merge">Merge</button><button class="btn danger" data-m="replace">Replace all</button></div><p class="tiny muted">Merge adds and updates records; Replace wipes this device first.</p>`,
      });
      s.body.querySelectorAll('[data-m]').forEach(b => (b.onclick = async () => {
        await db.importAll(data, { replace: b.dataset.m === 'replace' });
        core.invalidateSettings();
        s.close();
        toast('Imported');
        rerender();
      }));
    } catch (e) {
      toast('Not a valid HealthOS JSON file');
    }
    el.value = '';
  },
  'st-wipe': async () => {
    if (!(await confirmSheet('Erase every record on this device? Export or back up first.', { ok: 'Erase everything', danger: true }))) return;
    for (const st of Object.keys(db.STORES)) await db.clear(st);
    core.invalidateSettings();
    toast('Erased');
    rerender();
  },
  'st-hk': async () => {
    try {
      const n = await api.pullHealth();
      toast(n ? `Pulled ${n} day(s) from Apple Health` : 'Nothing new from the Shortcut yet');
      rerender();
    } catch (e) {
      toast(e.message);
    }
  },
  'st-update': async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    if (reg) await reg.update();
    toast('Checking… the app reloads if there is an update');
    setTimeout(() => location.reload(), 1500);
  },
});
