// Settings: connection, notifications, targets, schedules, data, Apple Health.
import * as db from './db.js';
import * as core from './core.js';
import * as N from './nutrition.js';
import * as api from './api.js';
import { esc, icon, sheet, liveSheet, toast, confirmSheet, download, toggleHtml, pageHead } from './ui.js';
import { register, rerender } from './state.js';
import { afcdImport } from './food.js';

export const APP_VERSION = '2.0.0';
let connMsg = '';
const ago = t => (t ? new Date(t).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : 'never');
const mins = t => {
  const m = Math.round((Date.now() - t) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : ago(t);
};

let statusBusy = false;
async function refreshStatus(force = false) {
  if (statusBusy || !(await api.configured())) return;
  const c = await db.kvGet('cache:status', null);
  if (!force && c && Date.now() - c.fetchedAt < 60000) return;
  statusBusy = true;
  try {
    const st = await api.status();
    await db.kvSet('cache:status', { ...st, fetchedAt: Date.now() });
    await db.kvSet('cache:workerVersion', { v: st.version || 2, at: Date.now() }, { silent: true });
  } catch (e) {
    const old = /not found/i.test(e.message);
    await db.kvSet('cache:status', { error: old ? 'old' : e.message, fetchedAt: Date.now() });
    if (old) await db.kvSet('cache:workerVersion', { v: 1, at: Date.now() }, { silent: true });
  }
  statusBusy = false;
}

async function reminderCard() {
  const s = await core.getSettings();
  const conf = await api.configured();
  const sup = api.pushSupport();
  const sub = await api.currentSubscription().catch(() => null);
  if (!conf) return `<div class="card"><div class="status-line"><span class="dot" style="background:var(--warn)"></span>Reminders need your Worker</div><p class="small muted" style="margin:8px 0 12px">Notifications come from your Cloudflare Worker. ${s.geminiKey ? 'AI already works with the key on this phone.' : ''}</p><button class="btn primary block" data-act="st-open" data-k="conn">Connect Worker</button></div>`;
  refreshStatus();
  const st = await db.kvGet('cache:status', null);
  const lines = [];
  const line = (ok, text, extra = '') => lines.push(`<div class="status-line" style="margin-top:6px"><span class="dot" style="background:${ok === true ? 'var(--good)' : ok === false ? 'var(--bad)' : 'var(--warn)'}"></span><span class="grow">${text}</span>${extra}</div>`);
  if (!st) line(null, 'Checking the reminder engine…');
  else if (st.error === 'old') line(false, 'Your Worker runs old code — update it to get reminder status and cheaper AI', `<button class="btn sm" data-act="st-open" data-k="worker">Fix</button>`);
  else if (st.error) line(false, esc(st.error));
  else {
    line(st.cronOk, st.cronOk ? `Reminder engine running · checked ${mins(st.cronAt)}` : st.cronAt ? `Reminder engine stopped · last ran ${mins(st.cronAt)}` : 'Reminder engine is not running — the Worker has no Cron Trigger', st.cronOk ? '' : `<button class="btn sm" data-act="st-open" data-k="worker">Fix</button>`);
    line(!!st.configAt, st.configAt ? `Schedule synced ${mins(Date.parse(st.configAt))}` : 'No schedule on the Worker yet', st.configAt ? '' : `<button class="btn sm" data-act="st-sync">Sync</button>`);
  }
  const devOk = sub && sup.permission === 'granted';
  line(devOk ? true : sup.ios && !sup.standalone ? null : false, devOk ? 'Notifications on for this iPhone' : sup.ios && !sup.standalone ? 'Open HealthOS from the Home Screen icon to enable notifications' : sup.permission === 'denied' ? 'Notifications blocked in iOS Settings → Notifications → HealthOS' : 'Notifications are off on this iPhone', devOk ? '' : sup.ios && !sup.standalone ? '' : `<button class="btn sm primary" data-act="st-push-on">Turn on</button>`);
  const next = st && st.upcoming && st.upcoming.length ? `<div class="small bold muted" style="margin:14px 0 2px">Coming up</div><div class="list">${st.upcoming.slice(0, 4).map(u => `<div class="li" style="min-height:44px;padding:8px 0"><span class="num bold" style="width:46px">${u.time}</span><div class="main"><div class="t" style="font-size:14.5px">${esc(u.title)}</div><div class="s ellipsis">${u.day === 'tomorrow' ? 'Tomorrow · ' : ''}${esc(u.body || '')}</div></div></div>`).join('')}</div>` : '';
  return `<div class="card"><div class="row between"><div class="h2">Reminders</div><button class="icon-btn" data-act="st-status-refresh" aria-label="Refresh">${icon('repeat')}</button></div>${lines.join('')}${next}
  <div class="row" style="gap:8px;margin-top:14px">${devOk ? `<button class="btn sm grow" data-act="st-push-test">Test now</button><button class="btn sm grow" data-act="st-test-cron">Test in 2 min</button>` : ''}<button class="btn sm grow" data-act="notif-history">History</button></div></div>`;
}

const ROWS = [
  [
    ['conn', 'Connection', 'link', 'var(--ink-3)'],
    ['notif', 'Notifications', 'bell', 'var(--meds)'],
    ['medtimes', 'Medication times', 'pill', 'var(--meds)'],
    ['targets', 'Nutrition priorities', 'nutrition', 'var(--sugar)'],
  ],
  [
    ['apple', 'Apple Health', 'heart', 'var(--satfat)'],
    ['ai', 'AI & usage', 'sparkle', 'var(--protein)'],
    ['calendar', 'Calendar reminders', 'planner', 'var(--water)'],
  ],
  [
    ['profile', 'Profile & appearance', 'user', 'var(--accent)'],
    ['data', 'Data & backups', 'copy', 'var(--ink-3)'],
    ['worker', 'Worker setup & update', 'grid', 'var(--ink-3)'],
    ['about', 'About', 'note', 'var(--ink-3)'],
  ],
];

export async function render() {
  const s = await core.getSettings();
  const conf = await api.configured();
  const usage = await db.kvGet('aiUsage', null);
  const values = {
    conn: conf ? 'Worker' : s.geminiKey ? 'AI key only' : 'Not set',
    notif: s.privacy.hideMedNames ? 'Names hidden' : '',
    medtimes: `${s.medSlots.length}`,
    targets: `${s.targets.length}`,
    apple: (await db.kvGet('cache:healthPulledAt', null)) ? 'Connected' : '',
    ai: usage && usage.month === core.today().slice(0, 7) ? `${usage.calls} this month` : '',
    profile: s.theme[0].toUpperCase() + s.theme.slice(1),
    about: APP_VERSION,
  };
  return `${pageHead({ title: 'Settings', back: true })}${await reminderCard()}
  ${ROWS.map(g => `<div class="group" style="margin-top:14px"><div class="list">${g.map(([k, l, ic, c]) => `<div class="li tap" data-act="st-open" data-k="${k}"><span class="ico" style="background:${c}">${icon(ic)}</span><div class="main"><div class="t">${l}</div></div><span class="small muted">${esc(values[k] || '')}</span>${icon('chevR')}</div>`).join('')}</div></div>`).join('')}`;
}

// ---------------- sections (each opens as a sheet) ----------------
const SECTIONS = {
  conn: ['Connection', async () => {
    const s = await core.getSettings();
    return `<div class="card stack">
    <label class="field"><span>Gemini API key (stored only on this phone)</span><input class="input" id="st-gkey" type="password" value="${esc(s.geminiKey || '')}" autocomplete="off" placeholder="AQ.… or AIza…"></label>
    <p class="small muted" style="margin:0">With just the key, every AI feature works. The Worker is needed for notifications and backups.</p>
    <label class="field"><span>Worker URL</span><input class="input" id="st-url" value="${esc(s.worker.url)}" placeholder="https://healthos.<you>.workers.dev" autocapitalize="off" autocorrect="off"></label>
    <label class="field"><span>App token (the APP_TOKEN secret)</span><input class="input" id="st-token" type="password" value="${esc(s.worker.token)}" autocomplete="off"></label>
    <button class="btn primary block" data-act="st-save-conn">Save & test</button><div class="small" id="st-conn-out">${connMsg}</div></div>`;
  }],
  notif: ['Notifications', async () => {
    const s = await core.getSettings();
    const sub = await api.currentSubscription().catch(() => null);
    const synced = await db.kvGet('cache:configSyncedAt', null);
    const syncErr = await db.kvGet('cache:configSyncError', null);
    return `<div class="card stack">
    <div class="row" style="gap:8px;flex-wrap:wrap">${sub ? `<button class="btn grow" data-act="st-push-test">${icon('bell')} Send test</button><button class="btn grow" data-act="st-push-off">Turn off</button>` : `<button class="btn primary grow" data-act="st-push-on">${icon('bell')} Enable on this iPhone</button>`}</div>
    <button class="btn block" data-act="st-sync">Sync schedule now</button>
    <div class="small muted">Schedule last synced: ${ago(synced)}${syncErr ? ` <span style="color:var(--bad)">${esc(syncErr)}</span>` : ''}</div></div>
    <div class="card stack" style="margin-top:12px">
    <div class="row between"><div><div class="h3">Hide medication names</div><div class="small muted">Lock Screen shows “2 items to take”</div></div>${toggleHtml('st-hide', s.privacy.hideMedNames, 'data-chg="st-hide"')}</div>
    <div class="row between"><div><div class="h3">Follow-up if not logged</div><div class="small muted">Minutes after a medication reminder (0 = off)</div></div><input class="input sm num" style="width:80px" type="number" min="0" step="5" value="${s.medFollowUp}" data-chg="st-follow"></div>
    <div class="row between"><div><div class="h3">Refill reminder</div><div class="small muted">Daily, only when stock is low</div></div><input class="input sm" style="width:120px" type="time" value="${s.refillTime}" data-chg="st-refill"></div></div>
    <p class="tiny muted" style="margin:12px 6px">Water reminders are set in Health → Water. Bedtime and wake reminders in Health → Sleep → Schedule. Tasks and routines each have their own reminder switch.</p>`;
  }],
  medtimes: ['Medication times', async () => {
    const s = await core.getSettings();
    return `<p class="small muted" style="margin:0 4px 12px">Each medication belongs to one of these times. “Relative to bedtime” follows your sleep schedule.</p>
    ${s.medSlots.map((m, i) => `<div class="item-card"><div class="fields two"><label class="field"><span>Name</span><input class="input sm" data-slot="${i}" data-k="name" value="${esc(m.name)}"></label><label class="field"><span>Type</span><select class="input sm" data-slot="${i}" data-k="mode"><option value="fixed" ${m.mode !== 'bedtime' ? 'selected' : ''}>Fixed time</option><option value="bedtime" ${m.mode === 'bedtime' ? 'selected' : ''}>Relative to bedtime</option></select></label></div>${m.mode === 'bedtime' ? `<label class="field" style="margin-top:8px"><span>Minutes before bed</span><input class="input sm num" type="number" data-slot="${i}" data-k="offset" value="${-(m.offset || 0)}"></label>` : `<div class="fields two" style="margin-top:8px"><label class="field"><span>Weekdays</span><input class="input sm" type="time" data-slot="${i}" data-k="weekday" value="${m.weekday || ''}"></label><label class="field"><span>Weekends</span><input class="input sm" type="time" data-slot="${i}" data-k="weekend" value="${m.weekend || ''}"></label></div>`}<button class="link small" data-act="slot-del" data-i="${i}" style="margin-top:8px">Remove</button></div>`).join('')}
    <div class="row" style="gap:8px;margin-top:12px"><button class="btn grow" data-act="slot-add">${icon('plus')} Add time</button><button class="btn primary grow" data-act="slot-save">Save</button></div>`;
  }],
  targets: ['Nutrition priorities', async () => {
    const s = await core.getSettings();
    return `<p class="small muted" style="margin:0 4px 12px">Minimums are goals to reach; limits are ceilings. Weight (0–5) sets how much each counts in the priority score and meal planner. No calorie ceiling.</p>
    ${s.targets.map((t, i) => `<div class="item-card"><div class="row between"><b>${N.NUTRIENT[t.key].label}</b><button class="link small" data-act="target-del" data-i="${i}">Remove</button></div><div class="fields three" style="margin-top:8px"><label class="field"><span>Type</span><select class="input sm" data-t="${i}" data-k="kind"><option value="min" ${t.kind === 'min' ? 'selected' : ''}>At least</option><option value="max" ${t.kind === 'max' ? 'selected' : ''}>At most</option></select></label><label class="field"><span>${N.NUTRIENT[t.key].unit}/day</span><input class="input sm num" type="number" data-t="${i}" data-k="value" value="${t.value}"></label><label class="field"><span>Weight</span><input class="input sm num" type="number" min="0" max="5" data-t="${i}" data-k="weight" value="${t.weight}"></label></div><div class="row between" style="margin-top:8px"><span class="small ink2">Show on Home & diary</span>${toggleHtml('t-show-' + i, t.show, `data-t="${i}" data-k="show"`)}</div></div>`).join('')}
    <div class="row" style="gap:8px;margin-top:12px"><select class="input sm grow" id="st-addt">${N.NUTRIENTS.filter(n => !s.targets.some(t => t.key === n.key)).map(n => `<option value="${n.key}">${n.label}</option>`).join('')}</select><button class="btn sm" data-act="target-add">Add</button></div>
    <button class="btn primary block" style="margin-top:12px" data-act="target-save">Save priorities</button>`;
  }],
  apple: ['Apple Health', async () => {
    const s = await core.getSettings();
    const hkAt = await db.kvGet('cache:healthPulledAt', null);
    const url = (s.worker.url || 'https://YOUR-WORKER.workers.dev').replace(/\/+$/, '') + '/api/healthkit';
    return `<div class="notice small" style="margin-bottom:12px">Apple only lets native App Store apps read Health directly, so a web app can't. HealthOS gets your numbers through your Worker instead — pick one of these:</div>
    <div class="card stack"><div class="h3">Option A · Health Auto Export (automatic, easiest)</div>
    <p class="small ink2" style="margin:0">Install <b>Health Auto Export – JSON+CSV</b> from the App Store. Its automatic sync needs Premium (free trial available).</p>
    <ol class="small ink2" style="margin:0;padding-left:18px;line-height:1.55"><li>Automations → New → <b>REST API</b>.</li><li>URL: paste the address below.</li><li>Headers → add <b>Authorization</b> = <b>Bearer</b> + space + your app token.</li><li>Data type <b>Health Metrics</b>; pick Step Count, Active Energy, Exercise Time, Resting Heart Rate, Heart Rate, Weight, Sleep Analysis.</li><li>Format <b>JSON</b>, Aggregation <b>Day</b>, Date range <b>Since last sync</b>. Turn it on.</li></ol>
    <div class="row" style="gap:8px"><input class="input sm grow" readonly value="${esc(url)}"><button class="btn sm" data-act="st-copy" data-v="${esc(url)}">Copy</button></div></div>
    <div class="card stack" style="margin-top:12px"><div class="h3">Option B · Free iOS Shortcut</div>
    <p class="small ink2" style="margin:0">Shortcuts → Automation → Time of Day (e.g. 7:00, Run Immediately). Add <b>Find Health Samples</b> for each metric (today), then <b>Get Contents of URL</b>: POST to the address above, header Authorization = Bearer + token, JSON body with keys <code>steps</code>, <code>sleep_hours</code>, <code>resting_hr</code>, <code>weight_kg</code>, <code>active_kcal</code>, <code>exercise_min</code>. Full steps are in the README.</p></div>
    <div class="row between" style="margin-top:14px"><span class="small muted">Last pulled: ${ago(hkAt)}</span><button class="btn sm" data-act="st-hk">Pull now</button></div>`;
  }],
  ai: ['AI & usage', async () => {
    const s = await core.getSettings();
    const u = await db.kvGet('aiUsage', null);
    const cur = u && u.month === core.today().slice(0, 7) ? u : null;
    const wv = await db.kvGet('cache:workerVersion', null);
    return `<div class="card stack"><div class="h3">How AI is used</div>
    <p class="small ink2" style="margin:0">Every request uses <b>Gemini Flash-Lite</b> (Google's cheapest model) with thinking set to minimal, a hard cap on response length, and medium image resolution. Nutrition numbers never come from AI — only food names and portions do.</p>
    <div class="row between"><div><div class="h3">Higher-accuracy photos</div><div class="small muted">Uses Gemini Flash for meal photos only (≈5× the cost of Lite)</div></div>${toggleHtml('st-acc', s.aiAccurate, 'data-chg="st-accurate"')}</div></div>
    <div class="card" style="margin-top:12px"><div class="h3" style="margin-bottom:10px">This month</div>${cur ? `<div class="grid3"><div class="stat"><div class="k">Requests</div><div class="v num">${cur.calls}</div></div><div class="stat"><div class="k">Tokens in</div><div class="v num">${(cur.in / 1000).toFixed(1)}k</div></div><div class="stat"><div class="k">Tokens out</div><div class="v num">${(cur.out / 1000).toFixed(1)}k</div></div></div><div class="small muted" style="margin-top:10px">${Object.entries(cur.models).map(([m, n]) => `${esc(m)} × ${n}`).join(' · ')}</div>` : '<div class="small muted">No AI requests yet this month.</div>'}</div>
    ${wv && wv.v < 2 ? `<div class="notice warn small" style="margin-top:12px">Your Worker still runs the old, more expensive AI code. Until you update it (Settings → Worker setup & update), AI requests go directly from this phone with your key, using the cheap settings.</div>` : ''}`;
  }],
  calendar: ['Calendar reminders', async () => `<div class="card stack"><p class="small ink2" style="margin:0">A backup that needs no server: puts your medication, water, wind-down, routine, workout and task reminders into iPhone Calendar as alerts. They fire even offline. They don't know what you've already logged, so they can't skip a reminder once you've taken something — push notifications can.</p>
    <button class="btn primary block" data-act="st-ics">${icon('bell')} Add reminders to Calendar</button>
    <p class="tiny muted" style="margin:0">Tap → open in Calendar → <b>Add All</b> into a new calendar “HealthOS”. After changing times, delete that calendar and tap again.</p></div>`],
  profile: ['Profile & appearance', async () => {
    const s = await core.getSettings();
    return `<div class="card stack"><label class="field"><span>Your name (for the greeting)</span><input class="input" value="${esc(s.name)}" data-chg="st-name"></label>
    <label class="field"><span>Theme</span><div class="seg">${['auto', 'light', 'dark'].map(t => `<button class="${s.theme === t ? 'on' : ''}" data-act="st-theme" data-v="${t}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}</div></label></div>`;
  }],
  data: ['Data & backups', async () => {
    const s = await core.getSettings();
    const afcd = (await db.bySource('afcd')).length;
    const persisted = navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted() : false;
    return `<div class="card stack"><div class="small muted">Food database: ${afcd.toLocaleString('en-AU')} AFCD foods · storage ${persisted ? 'protected' : 'not yet protected (open from Home Screen)'}</div>
    <button class="btn block" data-act="afcd-import">${icon('book')} Import / update AFCD</button></div>
    <div class="card stack" style="margin-top:12px"><div class="row between"><div><div class="h3">Daily automatic backup</div><div class="small muted">To your Worker · last: ${ago(s.lastBackup)}</div></div>${toggleHtml('st-ab', s.autoBackup, 'data-chg="st-autobackup"')}</div>
    <div class="grid2"><button class="btn" data-act="st-backup">Back up now</button><button class="btn" data-act="st-restore">Restore…</button></div></div>
    <div class="card stack" style="margin-top:12px"><div class="grid2"><button class="btn" data-act="st-export-json">Export JSON</button><button class="btn" data-act="st-export-csv">Export CSV</button></div>
    <label class="btn block" style="position:relative">Import JSON / starter file<input type="file" accept="application/json,.json" data-chg="st-import" style="position:absolute;inset:0;opacity:0"></label>
    <button class="btn danger block" data-act="st-wipe">Erase all data on this device</button></div>`;
  }],
  worker: ['Worker setup & update', async () => {
    const st = await db.kvGet('cache:status', null);
    const wv = await db.kvGet('cache:workerVersion', null);
    const needCode = !wv || wv.v < 2;
    const needCron = st && !st.error && !st.cronOk;
    return `${needCode ? `<div class="notice warn small" style="margin-bottom:12px"><b>Update the Worker code.</b> Your Worker runs version ${wv ? wv.v : '?'}; this app expects version 2.</div>` : ''}${needCron ? `<div class="notice bad small" style="margin-bottom:12px"><b>The reminder engine isn't running.</b> Test notifications work because the app asks for them directly; scheduled ones need the Worker to wake up every minute, which only happens with a Cron Trigger.</div>` : ''}
    <div class="card stack"><div class="h3">1 · Update the code (only when asked)</div>
    <ol class="small ink2" style="margin:0;padding-left:18px;line-height:1.55"><li>Tap <b>Copy Worker code</b>.</li><li>dash.cloudflare.com → Workers & Pages → your worker → <b>Edit code</b>.</li><li>Select all, paste, tap <b>Deploy</b>.</li></ol>
    <button class="btn primary block" data-act="st-copy-worker">${icon('copy')} Copy Worker code</button></div>
    <div class="card stack" style="margin-top:12px"><div class="h3">2 · Make sure the Cron Trigger exists</div>
    <ol class="small ink2" style="margin:0;padding-left:18px;line-height:1.55"><li>Your worker → <b>Settings</b> → <b>Trigger events</b> (or Triggers) → <b>Add</b> → <b>Cron Triggers</b>.</li><li>Choose <b>Every minute</b> — the expression is <code>* * * * *</code>. Save.</li><li>Come back here and wait a minute: Settings shows “Reminder engine running”.</li></ol></div>
    <div class="card stack" style="margin-top:12px"><div class="h3">Required settings on the Worker</div><div class="small ink2">Variables and Secrets: <b>APP_TOKEN</b> (secret), <b>GEMINI_API_KEY</b> (secret), <b>VAPID_SUBJECT</b> (mailto:you@…). Bindings: KV namespace with variable name <b>KV</b>. Trigger: cron <b>* * * * *</b>.</div></div>`;
  }],
  about: ['About', async () => `<div class="card stack small ink2"><div>HealthOS ${APP_VERSION}. Your data lives on this device (IndexedDB). AI requests and reminders go through your own Cloudflare Worker; nothing is sent anywhere else.</div>
    <div>Nutrition numbers come from AFCD, labels you confirmed, or foods you entered. Anything AI-estimated is marked <span class="badge unverified">Unverified</span>.</div>
    <button class="btn block" data-act="st-update">Check for app update</button></div>`],
};

function openSection(k) {
  const [title, fn] = SECTIONS[k];
  if (k === 'conn') connMsg = '';
  liveSheet({ title, render: fn });
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
  if (meta) meta.content = dark ? '#000000' : '#f2f2f7';
}

register({
  'st-open': el => openSection(el.dataset.k),
  'st-status-refresh': async () => {
    await db.kvSet('cache:status', null, { silent: true });
    await refreshStatus(true);
  },
  'st-test-cron': async () => {
    try {
      await api.snooze(2, 'HealthOS', 'Scheduled test — if you see this, timed reminders work.', './');
      toast('Lock your phone — a scheduled test arrives in about 2 minutes', { ms: 5000 });
    } catch (e) {
      toast(e.message);
    }
  },
  'st-accurate': el => core.saveSettings({ aiAccurate: el.checked }),
  'st-copy': async el => {
    try {
      await navigator.clipboard.writeText(el.dataset.v);
      toast('Copied');
    } catch {
      toast('Copy failed — select the text and copy it');
    }
  },
  'st-copy-worker': async () => {
    try {
      const get = () => fetch('./worker/worker.js?v=' + Date.now(), { cache: 'no-store' }).then(r => r.text());
      // Safari only allows clipboard writes inside the tap, so hand it a promise instead of awaiting first.
      if (window.ClipboardItem && navigator.clipboard.write) await navigator.clipboard.write([new ClipboardItem({ 'text/plain': get().then(t => new Blob([t], { type: 'text/plain' })) })]);
      else await navigator.clipboard.writeText(await get());
      toast('Worker code copied — paste it in Cloudflare → Edit code → Deploy', { ms: 5000 });
    } catch (e) {
      toast('Could not copy: ' + e.message);
    }
  },
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
      connMsg = `<span style="color:var(--good)">Connected</span> · AI key ${p.ai ? '✓' : '✗ missing'} · ${p.subs} device(s)${p.subject ? '' : ' · set VAPID_SUBJECT'}${(p.version || 1) < 2 ? ' · <span style="color:var(--warn)">old Worker code</span>' : ''}`;
      await db.kvSet('cache:workerVersion', { v: p.version || 1, at: Date.now() }, { silent: true });
      await api.syncConfig(true, true);
      refreshStatus(true);
    } catch (e) {
      connMsg = `<span style="color:var(--bad)">${esc(e.message)}</span>`;
    }
    rerender();
  },
  'st-push-on': async () => {
    try {
      await api.enablePush();
      toast('Notifications on');
      refreshStatus(true);
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
    await api.syncConfig(true, true);
    refreshStatus(true);
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
