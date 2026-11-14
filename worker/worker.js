// HealthOS backend — one Cloudflare Worker, no dependencies.
// Paste this whole file into the Cloudflare dashboard editor (see README).
//
// It does four things:
//   1. Keeps your Gemini API key secret and proxies AI requests (/api/ai).
//   2. Stores your reminder schedule and sends Web Push notifications every minute (cron).
//   3. Stores one off-device backup of your data (/api/backup).
//   4. Receives Apple Health numbers sent by an iOS Shortcut (/api/healthkit).
//
// Required settings (Worker → Settings → Variables and Secrets / Bindings / Triggers):
//   KV namespace binding named  KV
//   Secret  GEMINI_API_KEY      your Google AI Studio key
//   Secret  APP_TOKEN           a long random password you also type into the app once
//   Variable VAPID_SUBJECT      mailto:you@example.com  (Apple requires a real contact)
//   Variable ALLOWED_ORIGIN     https://<you>.github.io  (optional, restricts browsers)
//   Variable GEMINI_TEXT_MODEL / GEMINI_VISION_MODEL  optional model overrides
//   Cron trigger                * * * * *   (every minute)

const WORKER_VERSION = 5;
const enc = new TextEncoder();

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// ---------------- base64url ----------------
function b64urlEncode(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(str) {
  const s = str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4);
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function concat(...arrs) {
  const len = arrs.reduce((a, b) => a + b.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const a of arrs) {
    out.set(a, o);
    o += a.length;
  }
  return out;
}

// ---------------- Web Push (RFC 8291 aes128gcm + RFC 8292 VAPID) ----------------
async function hkdf(salt, ikm, info, length) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8);
  return new Uint8Array(bits);
}

async function encryptPayload(subscription, plaintext, { salt, localKeys } = {}) {
  const uaPublic = b64urlDecode(subscription.keys.p256dh);
  const authSecret = b64urlDecode(subscription.keys.auth);
  const local = localKeys || (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']));
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', local.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, local.privateKey, 256));
  const ikm = await hkdf(authSecret, shared, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  salt = salt || crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const padded = concat(plaintext, new Uint8Array([2]));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, padded));
  const rs = new Uint8Array([0, 0, 16, 0]); // 4096
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, ct);
}

async function createVapidKeys() {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  return {
    publicKey: b64urlEncode(await crypto.subtle.exportKey('raw', kp.publicKey)),
    privateJwk: await crypto.subtle.exportKey('jwk', kp.privateKey),
  };
}

async function vapidJwt(audience, vapid, subject, nowSec = Math.floor(Date.now() / 1000)) {
  const header = b64urlEncode(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64urlEncode(enc.encode(JSON.stringify({ aud: audience, exp: nowSec + 12 * 3600, sub: subject })));
  const key = await crypto.subtle.importKey('jwk', vapid.privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${header}.${claims}`));
  return `${header}.${claims}.${b64urlEncode(sig)}`;
}

async function getVapid(env) {
  let v = await env.KV.get('vapid', 'json');
  if (!v) {
    v = await createVapidKeys();
    await env.KV.put('vapid', JSON.stringify(v));
  }
  return v;
}

async function sendPush(env, subscription, payload, vapid) {
  const body = await encryptPayload(subscription, enc.encode(JSON.stringify(payload)));
  const aud = new URL(subscription.endpoint).origin;
  const jwt = await vapidJwt(aud, vapid, env.VAPID_SUBJECT || 'mailto:healthos@users.noreply.github.com');
  const res = await fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      Authorization: `vapid t=${jwt}, k=${vapid.publicKey}`,
      TTL: '3600',
      Urgency: 'high',
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
    },
    body,
  });
  return { status: res.status, ok: res.ok, text: res.ok ? '' : (await res.text()).slice(0, 300) };
}

async function pushToAll(env, payloads) {
  const subs = (await env.KV.get('subs', 'json')) || [];
  if (!subs.length || !payloads.length) return { sent: 0, results: [], subs: 0 };
  const vapid = await getVapid(env);
  const alive = [];
  const results = [];
  for (const sub of subs) {
    let gone = false;
    for (const p of payloads) {
      try {
        const r = await sendPush(env, sub, p, vapid);
        results.push({ tag: p.tag, status: r.status, error: r.text || undefined });
        if (r.status === 404 || r.status === 410) gone = true;
      } catch (e) {
        results.push({ tag: p.tag, status: 0, error: String(e.message || e) });
      }
    }
    if (!gone) alive.push(sub);
  }
  if (alive.length !== subs.length) await env.KV.put('subs', JSON.stringify(alive));
  const history = (await env.KV.get('history', 'json')) || [];
  const at = Date.now();
  for (const p of payloads) history.unshift({ at, tag: p.tag, title: p.title, body: p.body, ok: results.some(r => r.tag === p.tag && r.status >= 200 && r.status < 300) });
  await env.KV.put('history', JSON.stringify(history.slice(0, 200)));
  return { sent: results.filter(r => r.status >= 200 && r.status < 300).length, results, subs: alive.length };
}

// ---------------- Schedule ----------------
const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
function localParts(ms, tz) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' });
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  const hh = Number(p.hour) % 24;
  const mm = Number(p.minute);
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: hh * 60 + mm, weekday: WEEKDAYS[p.weekday], hhmm: `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}` };
}
const hm = t => {
  if (!t || typeof t !== 'string' || !t.includes(':')) return null;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};

/** Pure: which reminders fire at this local minute. */
function dueReminders(cfg, local, day = {}) {
  const out = [];
  if (!cfg) return out;
  const holiday = cfg.holidayUntil && local.date <= cfg.holidayUntil;
  const di = holiday ? 6 : local.weekday;
  const m = local.minutes;
  const hide = cfg.privacy && cfg.privacy.hideMedNames;

  const w = cfg.water;
  if (w && w.enabled) {
    const s = w.days && w.days[di];
    if (s && s.on !== false) {
      const st = hm(s.start);
      const en = hm(s.end);
      const iv = Math.max(15, Number(s.interval) || 90);
      const drunk = Number(day.waterMl) || 0;
      if (st != null && en != null && m >= st && m <= en && (m - st) % iv === 0 && drunk < (Number(w.target) || Infinity)) {
        out.push({ tag: 'water', title: 'Water', body: `${drunk} of ${w.target} ml so far today.`, url: './?go=water' });
      }
    }
  }

  for (const slot of cfg.medSlots || []) {
    const t = hm(slot.times && slot.times[di]);
    if (t == null) continue;
    const taken = new Set((day.taken && day.taken[slot.id]) || []);
    const pending = (slot.meds || []).filter(x => !taken.has(x.id));
    const pendingReq = pending.filter(x => !x.optional);
    const list = items => (hide ? `${items.length} item${items.length === 1 ? '' : 's'} to take` : items.map(x => `${x.name}${x.dose ? ' ' + x.dose : ''}`).join(', '));
    if (m === t && pending.length) out.push({ tag: 'med-' + slot.id, title: slot.name, body: list(pending), url: './?go=meds' });
    const fu = Number(cfg.medFollowUp) || 0;
    if (fu && m === t + fu && pendingReq.length) out.push({ tag: 'med-' + slot.id, title: `${slot.name} — not logged yet`, body: list(pendingReq), url: './?go=meds' });
  }

  for (const r of cfg.recurring || []) {
    if (hm(r.times && r.times[di]) === m) out.push({ tag: r.id, title: r.title, body: r.body || '', url: r.url || './' });
  }
  for (const r of cfg.timed || []) {
    if (r.at === `${local.date}T${local.hhmm}`) out.push({ tag: r.id, title: r.title, body: r.body || '', url: r.url || './?go=planner' });
  }
  if (cfg.refill && cfg.refill.items && cfg.refill.items.length && hm(cfg.refill.time) === m) {
    out.push({ tag: 'refill', title: 'Refill needed', body: hide ? `${cfg.refill.items.length} item(s) running low` : cfg.refill.items.join(', '), url: './?go=meds' });
  }
  return out;
}

function splitOneoffs(list, nowMs) {
  const due = [];
  const rest = [];
  for (const o of list || []) (o.at <= nowMs + 30000 ? due : rest).push(o);
  return { due, rest };
}

async function runSchedule(env, scheduledTime) {
  const cfg = await env.KV.get('config', 'json');
  const now = scheduledTime || Date.now();
  const payloads = [];
  // Heartbeat (≈1 write per 10 min, well inside the free KV limit) so the app can
  // tell you whether the cron trigger is actually running.
  const hb = await env.KV.get('cron', 'json');
  if (!hb || now - hb.at >= 9 * 60000) await env.KV.put('cron', JSON.stringify({ at: now }));
  if (cfg) {
    const local = localParts(now, cfg.tz || 'Australia/Melbourne');
    const day = (await env.KV.get('day:' + local.date, 'json')) || {};
    payloads.push(...dueReminders(cfg, local, day));
  }
  const oneoffs = (await env.KV.get('oneoffs', 'json')) || [];
  if (oneoffs.length) {
    const { due, rest } = splitOneoffs(oneoffs, now);
    if (due.length) {
      payloads.push(...due.map(o => ({ tag: o.tag || 'snooze', title: o.title, body: o.body || '', url: o.url || './' })));
      await env.KV.put('oneoffs', JSON.stringify(rest));
    }
  }
  if (payloads.length) await pushToAll(env, payloads);
  return payloads;
}

/** Minutes of a local day at which anything could fire (keeps upcoming() cheap). */
function candidateMinutes(cfg, date, weekday) {
  const di = cfg.holidayUntil && date <= cfg.holidayUntil ? 6 : weekday;
  const out = new Set();
  const w = cfg.water;
  const s = w && w.enabled && w.days && w.days[di];
  if (s && s.on !== false) {
    const st = hm(s.start);
    const en = hm(s.end);
    const iv = Math.max(15, Number(s.interval) || 90);
    if (st != null && en != null) for (let m = st; m <= en; m += iv) out.add(m);
  }
  for (const slot of cfg.medSlots || []) {
    const t = hm(slot.times && slot.times[di]);
    if (t != null) {
      out.add(t);
      if (Number(cfg.medFollowUp)) out.add(t + Number(cfg.medFollowUp));
    }
  }
  for (const r of cfg.recurring || []) {
    const t = hm(r.times && r.times[di]);
    if (t != null) out.add(t);
  }
  for (const r of cfg.timed || []) if (String(r.at).slice(0, 10) === date) out.add(hm(String(r.at).slice(11)));
  if (cfg.refill && hm(cfg.refill.time) != null) out.add(hm(cfg.refill.time));
  return [...out].filter(m => m != null && m >= 0 && m < 1440).sort((x, y) => x - y);
}

/** Next reminders over the coming 24 h, as the Worker sees them. */
function upcoming(cfg, nowMs, day = {}, limit = 8) {
  if (!cfg) return [];
  const tz = cfg.tz || 'Australia/Melbourne';
  const first = localParts(nowMs, tz);
  const second = localParts(nowMs + (1440 - first.minutes) * 60000 + 30000, tz);
  const hhmm = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  const out = [];
  const scan = (base, mins, d, label, offset) => {
    for (const m of mins) {
      if (out.length >= limit) return;
      for (const r of dueReminders(cfg, { date: base.date, weekday: base.weekday, minutes: m, hhmm: hhmm(m) }, d)) {
        out.push({ at: nowMs + (offset + m - first.minutes) * 60000, time: hhmm(m), day: label, title: r.title, body: r.body });
      }
    }
  };
  scan(first, candidateMinutes(cfg, first.date, first.weekday).filter(m => m > first.minutes), day, 'today', 0);
  scan(second, candidateMinutes(cfg, second.date, second.weekday).filter(m => m <= first.minutes), {}, 'tomorrow', 1440);
  return out.slice(0, limit);
}

// ---------------- Apple Health ----------------
// Accepts either the simple Shortcut payload { date, steps, ... } or a Health Auto Export
// "REST API" JSON payload { data: { metrics: [...] } } and folds it into one record per day.
const HAE = {
  step_count: ['steps', 'sum'],
  active_energy: ['active_kcal', 'sum'],
  apple_exercise_time: ['exercise_min', 'sum'],
  walking_running_distance: ['distance_km', 'sum'],
  resting_heart_rate: ['resting_hr', 'avg'],
  heart_rate: ['avg_hr', 'avg'],
  heart_rate_variability: ['hrv_ms', 'avg'],
  weight_body_mass: ['weight_kg', 'last'],
  body_mass: ['weight_kg', 'last'],
  sleep_analysis: ['sleep_hours', 'sum'],
  dietary_water: ['water_ml', 'sum'],
};
function haeToDays(payload) {
  const days = {};
  for (const m of (payload.data && payload.data.metrics) || []) {
    const map = HAE[m.name];
    if (!map) continue;
    const [key, how] = map;
    const unit = String(m.units || '').toLowerCase();
    for (const d of m.data || []) {
      const date = String(d.date || d.sleepEnd || '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      let v = m.name === 'sleep_analysis' ? d.totalSleep ?? d.asleep ?? d.qty : m.name === 'heart_rate' ? d.Avg ?? d.avg ?? d.qty : d.qty;
      v = Number(v);
      if (!Number.isFinite(v)) continue;
      if (key === 'active_kcal' && unit === 'kj') v /= 4.184;
      if (key === 'weight_kg' && /lb/.test(unit)) v *= 0.453592;
      if (key === 'distance_km' && /mi/.test(unit)) v *= 1.60934;
      if (key === 'distance_km' && unit === 'm') v /= 1000;
      if (key === 'sleep_hours' && /min/.test(unit)) v /= 60;
      if (key === 'water_ml' && unit === 'l') v *= 1000;
      const rec = (days[date] = days[date] || { date, _n: {} });
      if (how === 'sum') rec[key] = (rec[key] || 0) + v;
      else if (how === 'last') rec[key] = v;
      else {
        const n = (rec._n[key] = (rec._n[key] || 0) + 1);
        rec[key] = rec[key] == null ? v : rec[key] + (v - rec[key]) / n;
      }
    }
  }
  return Object.values(days).map(({ _n, ...r }) => r);
}

// ---------------- AI (Gemini) ----------------
// Cost control: every task uses the cheapest model that does the job, with thinking
// switched to "minimal", a hard output-token cap, and medium image resolution.
// Text tasks never touch a full Flash model. Photos use Flash-Lite unless the app asks
// for "accurate" mode.
const LITE = ['gemini-3.1-flash-lite', 'gemini-3.5-flash-lite', 'gemini-flash-lite-latest'];
const FLASH = ['gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-flash-latest'];
// task → [model list, thinking level, max output tokens, image resolution]
const TASKS = {
  text: [LITE, 'minimal', 900],
  photo: [LITE, 'minimal', 900, 'MEDIA_RESOLUTION_MEDIUM'],
  label: [LITE, 'minimal', 400, 'MEDIA_RESOLUTION_MEDIUM'],
  recipe: [LITE, 'minimal', 2600, 'MEDIA_RESOLUTION_MEDIUM'],
  generate: [LITE, 'minimal', 2600],
  improve: [LITE, 'minimal', 2600],
  estimate: [LITE, 'minimal', 200],
  // Watching a cooking video and judging amounts is hard: always tries Flash first (via
  // accurate mode), with low thinking. A recipe import costs well under one cent.
  video: [LITE, 'low', 3000, 'MEDIA_RESOLUTION_MEDIUM'],
};

function parseJsonLoose(text) {
  let t = String(text || '').trim();
  t = t.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try {
    return JSON.parse(t);
  } catch {
    const a = t.indexOf('{');
    const b = t.lastIndexOf('}');
    if (a >= 0 && b > a) {
      try {
        return JSON.parse(t.slice(a, b + 1));
      } catch {}
    }
    throw new HttpError(502, 'AI returned something that is not JSON');
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function geminiOnce(env, model, parts, cfg) {
  const generationConfig = { responseMimeType: 'application/json', maxOutputTokens: cfg.max };
  if (cfg.thinking) generationConfig.thinkingConfig = { thinkingLevel: cfg.thinking };
  if (cfg.media) generationConfig.mediaResolution = cfg.media;
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
    body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig }),
  });
  const j = await r.json().catch(() => null);
  return { status: r.status, ok: r.ok, j, msg: (j && j.error && j.error.message) || `Gemini error ${r.status}` };
}

/**
 * Runs one AI task. Falls through the model list on "model not found", overload (503)
 * and per-model quota (429), retrying once after a short wait. If a model rejects an
 * optional setting (thinking level / media resolution) it retries without it.
 */
async function gemini(env, task, parts, { accurate = false, max: maxOverride = 0 } = {}) {
  if (!env.GEMINI_API_KEY) throw new HttpError(500, 'GEMINI_API_KEY secret is not set on the Worker');
  const [list, thinking, baseMax, media] = TASKS[task];
  const max = Math.max(baseMax, maxOverride);
  const override = task === 'photo' || task === 'label' ? env.GEMINI_VISION_MODEL : env.GEMINI_TEXT_MODEL;
  const models = [...new Set([override, ...(accurate ? FLASH : []), ...list].filter(Boolean))];
  const cfgFor = model => ({ thinking: accurate && FLASH.includes(model) ? 'low' : thinking, max: accurate && FLASH.includes(model) ? max + 1500 : max, media });
  let last = 'No model available';
  let busy = false;
  for (const model of models) {
    let cfg = cfgFor(model);
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await geminiOnce(env, model, parts, cfg);
      if (res.status === 404) {
        last = `Model ${model} not found`;
        break;
      }
      if (res.status === 400 && (cfg.thinking || cfg.media) && /thinking|media|resolution|unknown name|invalid json payload/i.test(res.msg)) {
        cfg = { ...cfg, thinking: null, media: null };
        continue;
      }
      if (res.status === 503 || res.status === 500 || res.status === 429) {
        busy = true;
        last = res.msg;
        if (attempt === 0 && res.status !== 429) {
          await sleep(1200);
          continue;
        }
        break;
      }
      if (!res.ok) throw new HttpError(502, res.msg);
      const cand = res.j && res.j.candidates && res.j.candidates[0];
      const text = ((cand && cand.content && cand.content.parts) || []).filter(p => !p.thought).map(p => p.text || '').join('');
      if (cand && cand.finishReason === 'MAX_TOKENS' && attempt === 0) {
        cfg = { ...cfg, max: cfg.max * 2 };
        continue;
      }
      if (!text) throw new HttpError(502, 'Gemini returned no content (possibly blocked)');
      const u = res.j.usageMetadata || {};
      return { data: parseJsonLoose(text), model, usage: { in: u.promptTokenCount || 0, out: u.candidatesTokenCount || 0, think: u.thoughtsTokenCount || 0 } };
    }
  }
  throw new HttpError(busy ? 503 : 502, busy ? 'Gemini is busy right now (Google-side). Try again in a minute.' : last);
}

const imagePart = img => ({ inline_data: { mime_type: img.mime || 'image/jpeg', data: img.data } });

const GEMINI = 'https://generativelanguage.googleapis.com';
/**
 * Puts a video or image into Gemini's file store (the Files API) and waits until it is
 * ready. The bytes are passed straight through, never base64-encoded, so this stays
 * inside a free Worker's CPU limit even for a 50 MB video. Files expire after 48 h.
 */
async function geminiUpload(env, bytes, mime) {
  if (!env.GEMINI_API_KEY) throw new HttpError(500, 'GEMINI_API_KEY secret is not set on the Worker');
  const key = { 'x-goog-api-key': env.GEMINI_API_KEY };
  const start = await fetch(`${GEMINI}/upload/v1beta/files`, {
    method: 'POST',
    headers: { ...key, 'x-goog-upload-protocol': 'resumable', 'x-goog-upload-command': 'start', 'x-goog-upload-header-content-length': String(bytes.byteLength), 'x-goog-upload-header-content-type': mime, 'content-type': 'application/json' },
    body: JSON.stringify({ file: { display_name: 'healthos-' + Date.now() } }),
  });
  const upUrl = start.headers.get('x-goog-upload-url');
  if (!upUrl) throw new HttpError(502, `Gemini would not accept the upload (${start.status})`);
  const up = await fetch(upUrl, { method: 'POST', headers: { 'x-goog-upload-offset': '0', 'x-goog-upload-command': 'upload, finalize' }, body: bytes });
  const j = await up.json().catch(() => null);
  let file = j && j.file;
  if (!file || !file.uri) throw new HttpError(502, (j && j.error && j.error.message) || 'Upload to Gemini failed');
  for (let i = 0; i < 40 && file.state === 'PROCESSING'; i++) {
    await sleep(1500);
    file = await (await fetch(`${GEMINI}/v1beta/${file.name}`, { headers: key })).json();
  }
  if (file.state && file.state !== 'ACTIVE') throw new HttpError(502, 'Gemini could not process that video. Try a shorter one.');
  return { file_data: { mime_type: file.mimeType || mime, file_uri: file.uri } };
}

/** Recipe from a cooking video, slideshow photos and/or a caption. Estimates unstated amounts. */
function recipeFromMedia(env, mediaParts, caption = '') {
  const what = mediaParts.length ? 'Watch this cooking post (video with sound, or photos)' : 'Read this cooking post caption';
  const prompt = `${what} and write down the recipe exactly as it is made.${caption ? `\nCaption: \"\"\"${String(caption).slice(0, 4000)}\"\"\"` : ''}
- Include every ingredient that is shown, said or written (on-screen text, voice-over, caption). NEVER add ingredients that are not in the post.
- quantity_text: the amount as said or shown. If none is given, estimate it from what you see (spoon or cup size, packet size, how full the pan or bowl is) and write it like "~2 tbsp (estimated)"; set grams_is_estimate true.
- grams: always a number, using ${MEASURES}.
- servings: as stated, otherwise estimate from how much food is made.
- steps: short, in the order they are done.
- missing: the names of ingredients whose amounts you estimated.
JSON: ${RECIPE_SCHEMA}`;
  // Media first, then the instructions: Gemini follows this order best.
  return gemini(env, 'video', [...mediaParts, { text: prompt }], { accurate: true });
}

const DESKTOP_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';
/** Pulls the post data TikTok embeds in its page: caption, video address, slideshow photos. */
function tiktokItem(html) {
  const grab = id => {
    const m = html.match(new RegExp(`<script[^>]+id="${id}"[^>]*>([\\s\\S]*?)</script>`));
    if (!m) return null;
    try {
      return JSON.parse(m[1]);
    } catch {
      return null;
    }
  };
  const u = grab('__UNIVERSAL_DATA_FOR_REHYDRATION__');
  const scope = (u && u.__DEFAULT_SCOPE__) || {};
  for (const k of ['webapp.video-detail', 'webapp.reflow.video.detail']) {
    const it = scope[k] && scope[k].itemInfo && scope[k].itemInfo.itemStruct;
    if (it) return it;
  }
  const sigi = grab('SIGI_STATE');
  const mod = sigi && sigi.ItemModule;
  const first = mod && Object.values(mod)[0];
  return first || null;
}
function tiktokMedia(item) {
  if (!item) return { videoUrl: null, images: [], caption: '' };
  const v = item.video || {};
  // Prefer the smallest stream: the AI samples about 1 frame a second, so quality barely matters.
  const streams = (v.bitrateInfo || [])
    .map(b => ({ bitrate: b.Bitrate || 0, url: b.PlayAddr && b.PlayAddr.UrlList && b.PlayAddr.UrlList[0] }))
    .filter(b => b.url)
    .sort((a, b) => a.bitrate - b.bitrate);
  const videoUrl = (streams[0] && streams[0].url) || (typeof v.playAddr === 'string' && v.playAddr) || (typeof v.downloadAddr === 'string' && v.downloadAddr) || null;
  const images = ((item.imagePost && item.imagePost.images) || []).map(i => i.imageURL && i.imageURL.urlList && i.imageURL.urlList[0]).filter(Boolean);
  return { videoUrl: images.length ? null : videoUrl, images, caption: item.desc || '' };
}

async function importTikTok(env, url) {
  let target = url;
  const host = new URL(url).hostname;
  if (/^(vm|vt)\./.test(host) || new URL(url).pathname.startsWith('/t/')) {
    const r = await fetch(url, { redirect: 'follow', headers: { 'user-agent': DESKTOP_UA } });
    target = r.url;
  }
  const notes = [];
  let item = null;
  let cookie = '';
  try {
    const page = await fetch(target, { redirect: 'follow', headers: { 'user-agent': DESKTOP_UA, accept: 'text/html', 'accept-language': 'en-AU,en;q=0.9' } });
    cookie = (page.headers.getSetCookie ? page.headers.getSetCookie() : []).map(c => c.split(';')[0]).join('; ');
    item = tiktokItem(await page.text());
  } catch (e) {
    notes.push('page: ' + e.message);
  }
  const media = tiktokMedia(item);
  let caption = media.caption;
  let thumbnail = (item && item.video && item.video.cover) || null;
  if (!item) {
    const o = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(target)}`).catch(() => null);
    if (o && o.ok) {
      const j = await o.json();
      caption = j.title || '';
      thumbnail = j.thumbnail_url || null;
    }
  }
  const headers = { 'user-agent': DESKTOP_UA, referer: 'https://www.tiktok.com/', ...(cookie ? { cookie } : {}) };
  const parts = [];
  try {
    if (media.images.length) {
      for (const src of media.images.slice(0, 10)) {
        const r = await fetch(src, { headers });
        if (r.ok) parts.push(await geminiUpload(env, await r.arrayBuffer(), r.headers.get('content-type') || 'image/jpeg'));
      }
    } else if (media.videoUrl) {
      const r = await fetch(media.videoUrl, { headers });
      const size = Number(r.headers.get('content-length') || 0);
      if (!r.ok) notes.push('video ' + r.status);
      else if (size > 80e6) notes.push('video too large');
      else parts.push(await geminiUpload(env, await r.arrayBuffer(), 'video/mp4'));
    }
  } catch (e) {
    notes.push(e.message);
  }
  if (!parts.length && (!caption || caption.length < 20)) {
    throw new HttpError(422, 'TikTok would not let the Worker download this video. In TikTok tap Share → Save video, then here choose “Video” and pick it from your photos.');
  }
  const out = await recipeFromMedia(env, parts, caption);
  out.source = parts.length ? (media.images.length ? 'tiktok-photos' : 'tiktok-video') : 'tiktok-caption';
  out.data.image_url = thumbnail;
  if (notes.length) out.notes = notes;
  return out;
}

// Compact on purpose: every word here is paid for on every call.
const P100 = `{"kcal":n,"protein":n,"fat":n,"satfat":n,"carbs":n,"sugars":n,"fibre":n,"sodium":n(mg)}`;
const ITEM_SCHEMA = `"items":[{"kind":"dish|food","name":s,"search_terms":["1-3 AFCD-style alternates"],"state":"raw|cooked|boiled|grilled|fried|baked|roasted|steamed|toasted|canned|dried|other","grams":n,"grams_low":n,"grams_high":n,"confidence":0-1,"per100":${P100}|null,"notes":s|null}]`;
const DISH_RULES = `- NEVER add foods, proteins or ingredients the user did not name or that are not clearly visible. "Chicken pad see ew" means chicken only — no egg, pork, beef or mince unless stated.
- A combined dish (stir-fry, noodles, curry, pasta, burger, wrap, sandwich, soup, salad, pizza, takeaway meal) = ONE item: kind "dish", name = the dish exactly as the user called it, grams = the whole serve, per100 = typical nutrition per 100 g of that dish as made with only what was named. Typical restaurant dishes are 120–250 kcal per 100 g; be realistic.
- Separate foods (e.g. "2 eggs and toast", a plate of chicken, rice and broccoli) = one item each, kind "food", per100 null, Australian AFCD-style search terms.
- Use quantities the user gave exactly (1 cup=250 mL, 1 tbsp=20 mL, 1 tsp=5 mL).
- JSON only.`;

const RECIPE_SCHEMA = `{"name":s,"servings":n|null,"prep_minutes":n|null,"cook_minutes":n|null,"meals":["breakfast|lunch|dinner|snack"],"ingredients":[{"name":s,"quantity_text":"as written","grams":n|null,"grams_is_estimate":bool,"state":s,"search_terms":[s]}],"steps":[s],"missing":[s],"substitutions":[{"ingredient":s,"swap":s,"why":s}]}`;
const MEASURES = '1 cup=250 mL, 1 tbsp=20 mL, 1 tsp=5 mL';

async function aiTask(env, body) {
  const pr = body.priorities ? `Priorities: ${String(JSON.stringify(body.priorities)).slice(0, 600)}` : '';
  const accurate = !!body.accurate;
  switch (body.task) {
    case 'photo': {
      if (!body.image) throw new HttpError(400, 'image required');
      const prompt = `Meal photo → what it is and how much.${body.text ? ` The user says: "${String(body.text).slice(0, 300)}" — treat their words as correct and use their dish name exactly.` : ''}
JSON: {"meal_name":s,${ITEM_SCHEMA},"scale_reference":s|null,"overall_confidence":0-1,"caveats":[s]}
Rules:
${DISH_RULES}
- Grams as eaten. Wide low/high when unsure.`;
      return gemini(env, 'photo', [{ text: prompt }, imagePart(body.image)], { accurate });
    }
    case 'text': {
      const prompt = `What the user ate: """${String(body.text || '').slice(0, 1500)}"""
JSON: {"meal_name":"the user's words, tidied",${ITEM_SCHEMA},"caveats":[s]}
Rules:
${DISH_RULES}
- If no amount is given, use one typical Australian serve.`;
      return gemini(env, 'text', [{ text: prompt }]);
    }
    case 'label': {
      if (!body.image) throw new HttpError(400, 'image required');
      const prompt = `Australian Nutrition Information Panel. Use the per 100 g/mL column. Only printed numbers; null if absent or illegible.
JSON: {"product_name":s|null,"brand":s|null,"basis":"g"|"mL","serving_size":n|null,"per100":{"energy_kj":n,"protein":n,"fat_total":n,"fat_saturated":n,"carbohydrate":n,"sugars":n,"dietary_fibre":n,"sodium_mg":n},"unreadable":[s],"confidence":0-1}`;
      return gemini(env, 'label', [{ text: prompt }, imagePart(body.image)]);
    }
    case 'recipe': {
      const parts = [{ text: `Extract the recipe. JSON: ${RECIPE_SCHEMA}
Keep quantity_text as written; grams via ${MEASURES} (grams_is_estimate true for volume/count). Unstated servings/quantities → null and list in "missing". No nutrition numbers.
${body.text ? `Source:\n"""${String(body.text).slice(0, 12000)}"""` : ''}` }];
      for (const img of (body.images || (body.image ? [body.image] : [])).slice(0, 4)) parts.push(imagePart(img));
      return gemini(env, 'recipe', parts);
    }
    case 'url': {
      let link;
      try {
        link = new URL(String(body.url || '').trim());
      } catch {
        throw new HttpError(400, 'That is not a valid link');
      }
      if (/(^|\.)tiktok\.com$/.test(link.hostname)) return importTikTok(env, link.toString());
      const got = await fetchRecipeSource(link.toString());
      if (got.kind === 'jsonld') {
        const r = got.recipe;
        const text = `Title: ${r.name}\nServes: ${r.yield || 'not stated'}\nIngredients:\n${r.ingredients.map(i => '- ' + i).join('\n')}`;
        // Steps come straight from the page, so the AI only converts ingredients (far fewer tokens).
        const out = await aiTask(env, { task: 'recipe', text });
        out.data.name = r.name || out.data.name;
        if (r.steps.length) out.data.steps = r.steps;
        out.data.image_url = r.image || null;
        out.source = 'jsonld';
        return out;
      }
      if (!got.text || got.text.length < 20) throw new HttpError(422, got.kind === 'tiktok' ? 'This TikTok has no recipe in its caption. Screenshot the recipe from the video and import the screenshots instead.' : 'Could not read a recipe from that page.');
      const out = await aiTask(env, { task: 'recipe', text: (got.kind === 'tiktok' ? 'TikTok caption: ' : '') + got.text });
      out.source = got.kind;
      out.data.image_url = got.thumbnail || null;
      return out;
    }
    case 'generate': {
      const n = Math.min(3, Number(body.count) || 1);
      const prompt = `Create ${n} original recipe(s): """${String(body.text || '').slice(0, 600)}"""
${pr}
${body.pantry ? `Available: ${String(body.pantry).slice(0, 400)}` : ''}
Exact grams for every ingredient (grams_is_estimate false), Australian supermarket ingredients, concise steps, servings, 2-3 substitutions. No nutrition numbers.
JSON: {"recipes":[${RECIPE_SCHEMA}]}`;
      return gemini(env, 'generate', [{ text: prompt }], { max: 1300 * n });
    }
    case 'improve': {
      const prompt = `Make this recipe more nutritious but recognisably the same dish. ${pr}
Recipe: ${JSON.stringify(body.recipe).slice(0, 6000)}
JSON: {"recipe":${RECIPE_SCHEMA},"changes":[s]} with exact grams. No nutrition numbers.`;
      return gemini(env, 'improve', [{ text: prompt }]);
    }
    case 'estimate': {
      const prompt = `Typical nutrition per 100 g as eaten (Australian product if relevant): "${String(body.text || '').slice(0, 120)}"
JSON: {"per100":{"kcal":n,"protein":n,"fat":n,"satfat":n,"carbs":n,"sugars":n,"fibre":n,"sodium":n},"confidence":0-1,"basis":s}  (sodium in mg)`;
      return gemini(env, 'estimate', [{ text: prompt }]);
    }
    default:
      throw new HttpError(400, 'Unknown AI task');
  }
}
// ---------------- Recipe link fetching ----------------
function decodeEntities(s) {
  return String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function htmlToText(html) {
  return decodeEntities(
    String(html)
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<(br|\/p|\/li|\/h\d|\/div)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s+/g, '\n')
    .trim();
}

function extractJsonLdRecipe(html) {
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  const isRecipe = t => t === 'Recipe' || (Array.isArray(t) && t.includes('Recipe'));
  const find = node => {
    if (!node || typeof node !== 'object') return null;
    if (Array.isArray(node)) {
      for (const n of node) {
        const f = find(n);
        if (f) return f;
      }
      return null;
    }
    if (isRecipe(node['@type'])) return node;
    if (node['@graph']) return find(node['@graph']);
    return null;
  };
  const stepsOf = ins => {
    if (!ins) return [];
    if (typeof ins === 'string') return htmlToText(ins).split(/\n+/).map(s => s.trim()).filter(Boolean);
    if (Array.isArray(ins)) return ins.flatMap(stepsOf);
    if (ins['@type'] === 'HowToSection') return stepsOf(ins.itemListElement);
    if (ins.text) return [htmlToText(ins.text)];
    if (ins.name) return [htmlToText(ins.name)];
    return [];
  };
  while ((m = re.exec(html))) {
    let data;
    try {
      data = JSON.parse(m[1].trim());
    } catch {
      continue;
    }
    const r = find(data);
    if (!r) continue;
    const img = Array.isArray(r.image) ? r.image[0] : r.image;
    return {
      name: decodeEntities(r.name || ''),
      yield: Array.isArray(r.recipeYield) ? r.recipeYield[0] : r.recipeYield || null,
      prepTime: r.prepTime || null,
      cookTime: r.cookTime || null,
      ingredients: (r.recipeIngredient || r.ingredients || []).map(x => decodeEntities(htmlToText(x))),
      steps: stepsOf(r.recipeInstructions),
      image: typeof img === 'string' ? img : (img && img.url) || null,
    };
  }
  return null;
}

async function fetchRecipeSource(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    throw new HttpError(400, 'That is not a valid link');
  }
  if (!/^https?:$/.test(u.protocol)) throw new HttpError(400, 'Only http(s) links');
  const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
  if (/(^|\.)tiktok\.com$/.test(u.hostname)) {
    let target = u.toString();
    if (/^(vm|vt)\./.test(u.hostname) || u.pathname.startsWith('/t/')) {
      const r = await fetch(target, { redirect: 'follow', headers: { 'user-agent': ua } });
      target = r.url;
    }
    const r = await fetch('https://www.tiktok.com/oembed?url=' + encodeURIComponent(target));
    if (!r.ok) throw new HttpError(422, 'TikTok did not return this video (private or removed?)');
    const j = await r.json();
    return { kind: 'tiktok', text: j.title || '', thumbnail: j.thumbnail_url || null };
  }
  const r = await fetch(u.toString(), { redirect: 'follow', headers: { 'user-agent': ua, accept: 'text/html' } });
  if (!r.ok) throw new HttpError(422, `The site returned ${r.status}`);
  const html = await r.text();
  const ld = extractJsonLdRecipe(html);
  if (ld && ld.ingredients.length) return { kind: 'jsonld', recipe: ld };
  return { kind: 'html', text: htmlToText(html).slice(0, 30000) };
}

// ---------------- HTTP ----------------
function cors(env) {
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Max-Age': '86400',
  };
}
// ---------------- Google Health (Fitbit) ----------------
// Flow: the app asks for a sign-in link (authorised), opens it in Safari, Google sends the
// browser back to /api/google/callback (public; checked with a one-time state value), and
// the refresh token is kept in KV. The cron then pulls steps, sleep and workouts hourly
// into the same per-day records the Apple Health import uses.
const G_SCOPES = ['https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly', 'https://www.googleapis.com/auth/googlehealth.sleep.readonly'];
const G_DATA = 'https://health.googleapis.com/v4/users/me/dataTypes';
const G_TOKEN = 'https://oauth2.googleapis.com/token';

function googleRedirect(origin) {
  return origin.replace(/\/+$/, '') + '/api/google/callback';
}
function needGoogleSecrets(env) {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) throw new HttpError(500, 'Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to the Worker (Settings → Variables and Secrets), then Deploy.');
}
async function googleToken(env, params) {
  const r = await fetch(G_TOKEN, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: String(env.GOOGLE_CLIENT_ID).trim(), client_secret: String(env.GOOGLE_CLIENT_SECRET).trim(), ...params }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new HttpError(r.status === 400 || r.status === 401 ? 401 : 502, `Google sign-in error: ${j.error_description || j.error || r.status}`);
    e.google = j.error || '';
    throw e;
  }
  return j;
}
async function googleAccess(env) {
  const g = await env.KV.get('google', 'json');
  if (!g || !g.refresh) throw new HttpError(409, 'Google Health is not connected');
  if (g.access && g.accessExp > Date.now() + 60000) return { g, token: g.access };
  try {
    const t = await googleToken(env, { grant_type: 'refresh_token', refresh_token: g.refresh });
    const next = { ...g, access: t.access_token, accessExp: Date.now() + (t.expires_in || 3600) * 1000, needsReconnect: false };
    if (t.refresh_token) next.refresh = t.refresh_token;
    await env.KV.put('google', JSON.stringify(next));
    return { g: next, token: next.access };
  } catch (e) {
    if (e.google === 'invalid_grant') {
      await env.KV.put('google', JSON.stringify({ ...g, needsReconnect: true, access: null, lastError: 'Google sign-in expired. Connect again.' }));
      throw new HttpError(401, 'Google sign-in expired. Tap Connect again.');
    }
    throw e;
  }
}
/** Lists every data point of one type since a civil date, following page tokens. */
async function googleList(token, type, field, since) {
  const out = [];
  let page = '';
  for (let i = 0; i < 40; i++) {
    const q = new URLSearchParams({ filter: `${field} >= "${since}"`, pageSize: '1000' });
    if (page) q.set('pageToken', page);
    const r = await fetch(`${G_DATA}/${type}/dataPoints?${q}`, { headers: { authorization: 'Bearer ' + token, accept: 'application/json' } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new HttpError(r.status === 401 || r.status === 403 ? 401 : 502, `Google Health ${type}: ${(j.error && j.error.message) || r.status}`);
    out.push(...(j.dataPoints || []));
    page = j.nextPageToken;
    if (!page) break;
  }
  return out;
}
const gNum = v => (v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const gSecs = v => gNum(String(v || '').replace(/s$/, '')) || 0;
/** The local calendar date of a time, using the offset Google gives, else the app's time zone. */
function gDate(time, offset, tz) {
  const ms = Date.parse(time);
  if (!Number.isFinite(ms)) return null;
  if (offset != null && offset !== '') return new Date(ms + gSecs(offset) * 1000).toISOString().slice(0, 10);
  return localParts(ms, tz).date;
}
/** The payload object inside a data point (e.g. dp.steps, dp.sleep), whatever its key. */
function gBody(dp) {
  const k = Object.keys(dp || {}).find(x => x !== 'name' && x !== 'dataSource' && dp[x] && typeof dp[x] === 'object');
  return k ? dp[k] : {};
}
// The Fitbit band is the trusted source. Phone or third-party copies of the same thing are
// used only on days the band has nothing, so steps and sleep never count twice.
const gIsBand = dp => (dp.dataSource && dp.dataSource.platform) === 'FITBIT' && (dp.dataSource.recordingMethod || '') !== 'MANUAL';
function preferBand(points) {
  const band = points.filter(p => gIsBand(p.dp));
  return band.length ? band : points;
}

function googleToDays(raw, tz) {
  const days = {};
  const day = d => (days[d] = days[d] || { date: d, source: 'Google Health' });
  // Steps: sum per local day.
  const steps = {};
  for (const dp of raw.steps || []) {
    const b = gBody(dp);
    const iv = b.interval || {};
    const count = gNum(b.count ?? b.steps ?? b.value ?? b.stepCount);
    const d = gDate(iv.startTime || (b.sampleTime && b.sampleTime.physicalTime), iv.startUtcOffset ?? (b.sampleTime && b.sampleTime.utcOffset), tz);
    if (d && count != null) (steps[d] = steps[d] || []).push({ dp, count });
  }
  for (const [d, list] of Object.entries(steps)) day(d).steps = Math.round(preferBand(list).reduce((a, x) => a + x.count, 0));
  // Sleep: minutes asleep, counted on the morning you woke up.
  const sleep = {};
  for (const dp of raw.sleep || []) {
    const b = gBody(dp);
    const iv = b.interval || {};
    const s = b.summary || {};
    let mins = gNum(s.minutesAsleep);
    if (mins == null) mins = (Date.parse(iv.endTime) - Date.parse(iv.startTime)) / 60000 - (gNum(s.minutesAwake) || 0);
    const d = gDate(iv.endTime, iv.endUtcOffset, tz);
    const hm = (t, off) => {
      const ms = Date.parse(t);
      if (!Number.isFinite(ms)) return null;
      return off != null && off !== '' ? new Date(ms + gSecs(off) * 1000).toISOString().slice(11, 16) : localParts(ms, tz).hhmm;
    };
    if (d && mins > 0) (sleep[d] = sleep[d] || []).push({ dp, mins, bed: hm(iv.startTime, iv.startUtcOffset), wake: hm(iv.endTime, iv.endUtcOffset) });
  }
  for (const [d, list] of Object.entries(sleep)) {
    const use = preferBand(list);
    const r = day(d);
    r.sleep_hours = Math.round((use.reduce((a, x) => a + x.mins, 0) / 60) * 100) / 100;
    const main = use.reduce((a, x) => (x.mins > a.mins ? x : a));
    r.sleep_bed = main.bed;
    r.sleep_wake = main.wake;
  }
  // Workouts: every session, with minutes and calories.
  for (const dp of raw.exercise || []) {
    const b = gBody(dp);
    const iv = b.interval || {};
    const d = gDate(iv.startTime, iv.startUtcOffset, tz);
    if (!d) continue;
    const mins = Math.round(gSecs(b.activeDuration) / 60) || Math.round((Date.parse(iv.endTime) - Date.parse(iv.startTime)) / 60000) || 0;
    const r = day(d);
    r.workouts = r.workouts || [];
    r.workouts.push({ id: String(dp.name || '').split('/').pop(), name: b.displayName || 'Workout', type: b.exerciseType || '', start: iv.startTime, minutes: mins, kcal: gNum(b.metricsSummary && b.metricsSummary.caloriesKcal), from: (dp.dataSource && dp.dataSource.application && dp.dataSource.application.packageName) || (dp.dataSource && dp.dataSource.platform) || '' });
    r.exercise_min = (r.exercise_min || 0) + mins;
  }
  return Object.values(days).sort((a, b) => a.date.localeCompare(b.date));
}

/** Merges one day into the per-day health record ("hk:" keys). Returns true if it changed. */
async function putHealthDay(env, rec) {
  const prev = (await env.KV.get('hk:' + rec.date, 'json')) || {};
  const merged = { ...prev, ...rec };
  const { receivedAt: _a, ...cmpPrev } = prev;
  const { receivedAt: _b, ...cmpNew } = merged;
  if (JSON.stringify(cmpPrev) === JSON.stringify(cmpNew)) return false;
  await env.KV.put('hk:' + rec.date, JSON.stringify({ ...merged, receivedAt: Date.now() }), { expirationTtl: 45 * 86400 });
  return true;
}

async function googleSync(env, { days = 3 } = {}) {
  const cfg = (await env.KV.get('config', 'json')) || {};
  const tz = cfg.tz || 'Australia/Melbourne';
  const { g, token } = await googleAccess(env);
  const since = localParts(Date.now() - (days - 1) * 86400000, tz).date;
  const [steps, sleep, exercise] = await Promise.all([
    googleList(token, 'steps', 'steps.interval.civil_start_time', since),
    googleList(token, 'sleep', 'sleep.interval.civil_end_time', since),
    googleList(token, 'exercise', 'exercise.interval.civil_start_time', since),
  ]);
  const recs = googleToDays({ steps, sleep, exercise }, tz).filter(r => r.date >= since);
  let written = 0;
  for (const r of recs) if (await putHealthDay(env, r)) written++;
  const summary = { at: Date.now(), days: recs.length, written, counts: { steps: steps.length, sleep: sleep.length, exercise: exercise.length } };
  // Keep one raw sample of each type so field names can be checked from the app if a number looks wrong.
  const sample = { steps: steps[0] || null, sleep: sleep[0] ? { ...sleep[0], sleep: { ...gBody(sleep[0]), stages: undefined, shortAwakenings: undefined } } : null, exercise: exercise[0] || null };
  await env.KV.put('google', JSON.stringify({ ...g, lastSync: summary, lastError: null, sample }));
  return { ...summary, records: recs };
}

/** Called from the cron every minute; actually syncs at most once an hour. */
async function googleSyncIfDue(env, now) {
  if (!env.GOOGLE_CLIENT_ID) return;
  const g = await env.KV.get('google', 'json');
  if (!g || !g.refresh || g.needsReconnect) return;
  const last = Math.max((g.lastSync && g.lastSync.at) || 0, g.lastTry || 0);
  if (now - last < 55 * 60000) return;
  await env.KV.put('google', JSON.stringify({ ...g, lastTry: now }));
  try {
    await googleSync(env);
  } catch (e) {
    const cur = (await env.KV.get('google', 'json')) || g;
    await env.KV.put('google', JSON.stringify({ ...cur, lastError: e.message }));
  }
}

function htmlPage(title, msg, ok) {
  return new Response(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><body style="font:17px -apple-system,system-ui,sans-serif;margin:0;display:grid;place-items:center;min-height:100vh;background:#f4f4f7;color:#111"><div style="max-width:340px;padding:28px;text-align:center"><div style="font-size:52px">${ok ? '✅' : '⚠️'}</div><h2 style="margin:10px 0">${title}</h2><p style="color:#555;line-height:1.45">${msg}</p></div></body>`, { status: ok ? 200 : 400, headers: { 'content-type': 'text/html; charset=utf-8' } });
}

/** Public (no app token): Google sends the browser here after sign-in. */
async function googleCallback(env, url) {
  const esc = s => String(s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);
  if (url.searchParams.get('error')) return htmlPage('Not connected', `Google said: ${esc(url.searchParams.get('error'))}. Go back to HealthOS and try again.`, false);
  const state = url.searchParams.get('state') || '';
  const code = url.searchParams.get('code') || '';
  if (!env.KV || !state || !(await env.KV.get('gstate:' + state))) return htmlPage('Link expired', 'This sign-in link was already used or is over 10 minutes old. Go back to HealthOS and tap Connect again.', false);
  await env.KV.delete('gstate:' + state);
  try {
    needGoogleSecrets(env);
    const t = await googleToken(env, { grant_type: 'authorization_code', code, redirect_uri: googleRedirect(url.origin) });
    if (!t.refresh_token) return htmlPage('Almost', 'Google did not send a long-term key. Go to myaccount.google.com/permissions, remove HealthOS, then tap Connect again.', false);
    const granted = String(t.scope || '');
    await env.KV.put('google', JSON.stringify({ refresh: t.refresh_token, access: t.access_token, accessExp: Date.now() + (t.expires_in || 3600) * 1000, refreshExp: t.refresh_token_expires_in ? Date.now() + t.refresh_token_expires_in * 1000 : null, scope: granted, connectedAt: Date.now() }));
    let note = '';
    try {
      const s = await googleSync(env, { days: 14 });
      note = ` Pulled ${s.days} day(s).`;
    } catch (e) {
      note = ` First sync failed (${esc(e.message)}); it will retry within the hour.`;
    }
    const missing = G_SCOPES.map(s => s.split('/').pop()).filter(s => !granted.includes(s)).map(s => s.split('.')[1]);
    return htmlPage('Google Health connected', `HealthOS will now sync your Fitbit steps, sleep and workouts every hour.${note}${missing.length ? ` Not allowed: ${missing.join(', ')}.` : ''} You can close this tab and go back to the app.`, true);
  } catch (e) {
    return htmlPage('Not connected', esc(e.message), false);
  }
}

function json(env, data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...cors(env) } });
}
function safeEqual(a, b) {
  a = String(a || '');
  b = String(b || '');
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

async function handle(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '');
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(env) });
  if (path === '' || path === '/') return json(env, { app: 'HealthOS worker', ok: true });
  if (request.method === 'GET' && path === '/api/google/callback') return googleCallback(env, url);
  if (!env.APP_TOKEN) throw new HttpError(500, 'APP_TOKEN secret is not set on the Worker');
  if (!env.KV) throw new HttpError(500, 'KV binding named "KV" is missing');
  const auth = request.headers.get('authorization') || '';
  if (!safeEqual(auth.replace(/^Bearer\s+/i, ''), env.APP_TOKEN)) throw new HttpError(401, 'Wrong app token');
  const body = ['POST', 'PUT'].includes(request.method) && path !== '/api/backup' && path !== '/api/video' ? await request.json().catch(() => ({})) : null;

  switch (`${request.method} ${path}`) {
    case 'GET /api/ping':
      return json(env, { ok: true, version: WORKER_VERSION, ai: !!env.GEMINI_API_KEY, subject: !!env.VAPID_SUBJECT, subs: ((await env.KV.get('subs', 'json')) || []).length, config: !!(await env.KV.get('config')) });
    case 'GET /api/status': {
      const cfg = await env.KV.get('config', 'json');
      const now = Date.now();
      const local = cfg ? localParts(now, cfg.tz || 'Australia/Melbourne') : null;
      const day = local ? (await env.KV.get('day:' + local.date, 'json')) || {} : {};
      const hist = (await env.KV.get('history', 'json')) || [];
      const cron = await env.KV.get('cron', 'json');
      return json(env, {
        version: WORKER_VERSION,
        now,
        cronAt: cron ? cron.at : null,
        cronOk: !!(cron && now - cron.at < 15 * 60000),
        subs: ((await env.KV.get('subs', 'json')) || []).length,
        configAt: cfg ? cfg.updatedAt : null,
        tz: cfg ? cfg.tz : null,
        upcoming: upcoming(cfg, now, day),
        last: hist.filter(h => h.tag !== 'test').slice(0, 5),
        oneoffs: ((await env.KV.get('oneoffs', 'json')) || []).length,
      });
    }
    case 'GET /api/vapid':
      return json(env, { publicKey: (await getVapid(env)).publicKey });
    case 'POST /api/subscribe': {
      const sub = body && body.subscription;
      if (!sub || !sub.endpoint || !sub.keys) throw new HttpError(400, 'subscription required');
      const subs = ((await env.KV.get('subs', 'json')) || []).filter(s => s.endpoint !== sub.endpoint);
      subs.push({ endpoint: sub.endpoint, keys: sub.keys, added: Date.now(), label: body.label || '' });
      await env.KV.put('subs', JSON.stringify(subs.slice(-5)));
      return json(env, { ok: true, subs: subs.length });
    }
    case 'POST /api/unsubscribe': {
      const subs = ((await env.KV.get('subs', 'json')) || []).filter(s => s.endpoint !== (body && body.endpoint));
      await env.KV.put('subs', JSON.stringify(subs));
      return json(env, { ok: true });
    }
    case 'POST /api/config':
      await env.KV.put('config', JSON.stringify(body || {}));
      return json(env, { ok: true });
    case 'POST /api/day': {
      if (!body || !/^\d{4}-\d{2}-\d{2}$/.test(body.date || '')) throw new HttpError(400, 'date required');
      await env.KV.put('day:' + body.date, JSON.stringify({ taken: body.taken || {}, waterMl: Number(body.waterMl) || 0 }), { expirationTtl: 3 * 86400 });
      return json(env, { ok: true });
    }
    case 'POST /api/snooze': {
      const list = (await env.KV.get('oneoffs', 'json')) || [];
      const at = Number(body.at) || Date.now() + (Number(body.minutes) || 15) * 60000;
      list.push({ id: crypto.randomUUID(), at, title: String(body.title || 'Reminder'), body: String(body.body || ''), url: body.url || './', tag: body.tag || 'snooze' });
      await env.KV.put('oneoffs', JSON.stringify(list.slice(-50)));
      return json(env, { ok: true, at });
    }
    case 'GET /api/oneoffs':
      return json(env, (await env.KV.get('oneoffs', 'json')) || []);
    case 'POST /api/test': {
      const r = await pushToAll(env, [{ tag: 'test', title: 'HealthOS', body: 'Test notification — reminders are working.', url: './' }]);
      return json(env, r);
    }
    case 'POST /api/run':
      return json(env, { due: await runSchedule(env, Date.now()) });
    case 'GET /api/history':
      return json(env, (await env.KV.get('history', 'json')) || []);
    case 'PUT /api/backup': {
      const text = await request.text();
      if (text.length > 24 * 1024 * 1024) throw new HttpError(413, 'Backup too large');
      const prev = await env.KV.get('backup');
      if (prev) await env.KV.put('backup:prev', prev);
      await env.KV.put('backup', text);
      await env.KV.put('backup:meta', JSON.stringify({ at: Date.now(), bytes: text.length }));
      return json(env, { ok: true, bytes: text.length });
    }
    case 'GET /api/backup': {
      const which = url.searchParams.get('prev') ? 'backup:prev' : 'backup';
      const text = await env.KV.get(which);
      if (!text) throw new HttpError(404, 'No backup stored yet');
      return new Response(text, { headers: { 'content-type': 'application/json', ...cors(env) } });
    }
    case 'GET /api/backup-meta':
      return json(env, (await env.KV.get('backup:meta', 'json')) || null);
    case 'POST /api/healthkit': {
      const cfg = (await env.KV.get('config', 'json')) || {};
      const records = body && body.data && (body.data.metrics || body.data.workouts) ? haeToDays(body) : [{ ...body, date: /^\d{4}-\d{2}-\d{2}$/.test((body && body.date) || '') ? body.date : localParts(Date.now(), cfg.tz || 'Australia/Melbourne').date }];
      let written = 0;
      for (const rec of records.slice(-31)) if (await putHealthDay(env, rec)) written++;
      return json(env, { ok: true, days: records.length, written });
    }
    case 'GET /api/healthkit': {
      const list = await env.KV.list({ prefix: 'hk:' });
      const out = [];
      for (const k of list.keys) {
        const v = await env.KV.get(k.name, 'json');
        if (v) out.push(v);
      }
      return json(env, out);
    }
    case 'POST /api/google/link': {
      needGoogleSecrets(env);
      const state = crypto.randomUUID();
      await env.KV.put('gstate:' + state, '1', { expirationTtl: 600 });
      const q = new URLSearchParams({ client_id: String(env.GOOGLE_CLIENT_ID).trim(), redirect_uri: googleRedirect(url.origin), response_type: 'code', scope: G_SCOPES.join(' '), access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state });
      return json(env, { ok: true, url: 'https://accounts.google.com/o/oauth2/v2/auth?' + q, redirect: googleRedirect(url.origin) });
    }
    case 'GET /api/google/status': {
      const g = await env.KV.get('google', 'json');
      return json(env, { ok: true, configured: !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET), redirect: googleRedirect(url.origin), connected: !!(g && g.refresh), needsReconnect: !!(g && g.needsReconnect), connectedAt: (g && g.connectedAt) || null, refreshExp: (g && g.refreshExp) || null, lastSync: (g && g.lastSync) || null, lastError: (g && g.lastError) || null, scope: (g && g.scope) || '', sample: url.searchParams.get('sample') ? (g && g.sample) || null : undefined });
    }
    case 'POST /api/google/sync': {
      try {
        const r = await googleSync(env, { days: Math.min(31, Number((body && body.days) || 3)) });
        return json(env, { ok: true, ...r });
      } catch (e) {
        const g = await env.KV.get('google', 'json');
        if (g) await env.KV.put('google', JSON.stringify({ ...g, lastError: e.message }));
        throw e;
      }
    }
    case 'POST /api/google/disconnect': {
      const g = await env.KV.get('google', 'json');
      if (g && g.refresh) await fetch('https://oauth2.googleapis.com/revoke', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: g.refresh }) }).catch(() => {});
      await env.KV.delete('google');
      return json(env, { ok: true });
    }
    case 'POST /api/video': {
      // A cooking video (or photo) sent from the phone, raw bytes. Gemini watches it.
      let mime = (request.headers.get('content-type') || 'video/mp4').split(';')[0].trim().toLowerCase();
      if (mime === 'video/quicktime') mime = 'video/mov'; // iPhone .mov: Gemini's name for it
      if (!/^(video|image)\//.test(mime)) throw new HttpError(400, 'Send a video or image');
      const bytes = await request.arrayBuffer();
      if (!bytes.byteLength) throw new HttpError(400, 'The file was empty');
      if (bytes.byteLength > 95e6) throw new HttpError(413, 'That video is over 95 MB. Trim it first.');
      const part = await geminiUpload(env, bytes, mime);
      const r = await recipeFromMedia(env, [part], url.searchParams.get('caption') || '');
      return json(env, { ok: true, model: r.model, source: 'video', data: r.data, usage: r.usage || null });
    }
    case 'POST /api/ai': {
      const r = await aiTask(env, body || {});
      return json(env, { ok: true, model: r.model, source: r.source || null, data: r.data, usage: r.usage || null });
    }
    default:
      throw new HttpError(404, 'Not found');
  }
}

export default {
  async fetch(request, env) {
    try {
      return await handle(request, env);
    } catch (e) {
      return json(env, { ok: false, error: e.message || String(e) }, e.status || 500);
    }
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runSchedule(env, event.scheduledTime));
    ctx.waitUntil(googleSyncIfDue(env, event.scheduledTime));
  },
  // Exposed for the test-suite only.
  _test: { googleToDays, googleSync, googleSyncIfDue, googleCallback, aiTask, tiktokItem, tiktokMedia, recipeFromMedia, geminiUpload, upcoming, haeToDays, TASKS, dueReminders, encryptPayload, vapidJwt, createVapidKeys, localParts, extractJsonLdRecipe, splitOneoffs, parseJsonLoose, b64urlDecode, b64urlEncode, handle },
};
