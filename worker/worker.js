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
//   Variable GEMINI_MODEL       optional override, e.g. gemini-3.7-flash
//   Cron trigger                * * * * *   (every minute)

const MODEL_FALLBACKS = ['gemini-flash-latest', 'gemini-3.7-flash', 'gemini-2.5-flash'];
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

// ---------------- AI (Gemini) ----------------
function parseJsonLoose(text) {
  let t = String(text || '').trim();
  t = t.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try {
    return JSON.parse(t);
  } catch {
    const a = t.indexOf('{');
    const b = t.lastIndexOf('}');
    if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
    throw new HttpError(502, 'AI returned something that is not JSON');
  }
}

async function gemini(env, parts, temperature = 0.2) {
  if (!env.GEMINI_API_KEY) throw new HttpError(500, 'GEMINI_API_KEY secret is not set on the Worker');
  const models = [...new Set([env.GEMINI_MODEL, ...MODEL_FALLBACKS].filter(Boolean))];
  let last = 'No model available';
  for (const model of models) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
      body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { temperature, responseMimeType: 'application/json' } }),
    });
    const j = await r.json().catch(() => null);
    if (r.status === 404) {
      last = `Model ${model} not found`;
      continue;
    }
    if (!r.ok) throw new HttpError(502, (j && j.error && j.error.message) || `Gemini error ${r.status}`);
    const text = (j && j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts || []).map(p => p.text || '').join('');
    if (!text) throw new HttpError(502, 'Gemini returned no content (possibly blocked)');
    return { data: parseJsonLoose(text), model };
  }
  throw new HttpError(502, last);
}

const imagePart = img => ({ inline_data: { mime_type: img.mime || 'image/jpeg', data: img.data } });

const ITEM_SCHEMA = `"items": [{
  "name": "plain food name in Australian Food Composition Database style, e.g. 'Chicken, breast, lean flesh, grilled'",
  "search_terms": ["2-4 alternative names a database might use"],
  "state": "raw|cooked|boiled|grilled|fried|baked|roasted|steamed|toasted|canned|dried|other",
  "method": "cooking method in words or null",
  "grams": number (edible weight as eaten; cooked weight for cooked foods),
  "grams_low": number, "grams_high": number,
  "confidence": number 0-1 (identity AND portion),
  "notes": "short reason or null"
}]`;

const RULES = `Rules:
- Never output calories or nutrient values. The app calculates nutrition from a verified database.
- List cooking oils, butter, dressings and sauces as separate items when visible or very likely, with low confidence when not directly visible.
- Use Australian food names (capsicum, zucchini, mince, rockmelon).
- Be honest about uncertainty: wide grams_low/grams_high when unsure.
Return only JSON.`;

const RECIPE_SCHEMA = `{
  "name": string, "servings": number|null, "prep_minutes": number|null, "cook_minutes": number|null,
  "meals": ["breakfast"|"lunch"|"dinner"|"snack"],
  "ingredients": [{ "name": string, "quantity_text": "as written", "grams": number|null, "grams_is_estimate": boolean, "state": "raw|cooked|...", "search_terms": [string] }],
  "steps": [string],
  "missing": ["fields the source did not state, e.g. servings, quantities"],
  "substitutions": [{ "ingredient": string, "swap": string, "why": string }]
}`;

async function aiTask(env, body, ctx = {}) {
  const pr = body.priorities ? `User priorities: ${JSON.stringify(body.priorities)}` : '';
  switch (body.task) {
    case 'photo': {
      if (!body.image) throw new HttpError(400, 'image required');
      const prompt = `Analyse this meal photo for food logging.${body.text ? ` The user adds: "${body.text}".` : ''}
Return JSON: { "meal_name": string, ${ITEM_SCHEMA}, "scale_reference": "what you used for scale, or null", "overall_confidence": number 0-1, "caveats": [string] }
${RULES}`;
      return gemini(env, [{ text: prompt }, imagePart(body.image)]);
    }
    case 'text': {
      const prompt = `The user describes what they ate: """${String(body.text || '').slice(0, 4000)}"""
Split it into individual foods. Use any quantities the user gave exactly (convert to grams; 1 cup = 250 mL, 1 tbsp = 20 mL, 1 tsp = 5 mL) and set confidence high for those portions.
Return JSON: { "meal_name": string, ${ITEM_SCHEMA}, "caveats": [string] }
${RULES}`;
      return gemini(env, [{ text: prompt }]);
    }
    case 'label': {
      if (!body.image) throw new HttpError(400, 'image required');
      const prompt = `Read this Australian Nutrition Information Panel. Use the per 100 g (or per 100 mL) column.
Return JSON: { "product_name": string|null, "brand": string|null, "basis": "g"|"mL", "serving_size": number|null,
 "per100": { "energy_kj": number|null, "protein": number|null, "fat_total": number|null, "fat_saturated": number|null, "carbohydrate": number|null, "sugars": number|null, "dietary_fibre": number|null, "sodium_mg": number|null },
 "unreadable": [string], "confidence": number 0-1 }
Only report numbers printed on the label. Use null for anything not printed or not legible. Never estimate.`;
      return gemini(env, [{ text: prompt }, imagePart(body.image)], 0);
    }
    case 'recipe': {
      const parts = [{ text: `Extract the recipe from the material below.
Return JSON: ${RECIPE_SCHEMA}
Rules: keep quantities exactly as written in quantity_text. Convert to grams using Australian measures (1 cup = 250 mL, 1 tbsp = 20 mL, 1 tsp = 5 mL); set grams_is_estimate true for volume or count conversions. If the source does not state servings or a quantity, use null and list it in "missing" — do not guess. substitutions may be empty. Never output nutrition numbers.
${body.text ? `Material:\n"""${String(body.text).slice(0, 30000)}"""` : ''}` }];
      for (const img of body.images || (body.image ? [body.image] : [])) parts.push(imagePart(img));
      return gemini(env, parts);
    }
    case 'url': {
      const got = await fetchRecipeSource(String(body.url || ''));
      if (got.kind === 'jsonld') {
        const r = got.recipe;
        const text = `Title: ${r.name}\nServes: ${r.yield || 'not stated'}\nPrep: ${r.prepTime || ''} Cook: ${r.cookTime || ''}\nIngredients:\n${r.ingredients.map(i => '- ' + i).join('\n')}\nMethod:\n${r.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}`;
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
      const prompt = `Create ${Math.min(5, Number(body.count) || 1)} original recipe(s) for this request: """${String(body.text || '').slice(0, 2000)}"""
${pr}
${body.pantry ? `Ingredients available: ${body.pantry}` : ''}
Use exact gram quantities for every ingredient (grams_is_estimate false), realistic Australian supermarket ingredients, clear steps, servings, and 2-4 useful substitutions.
Return JSON: { "recipes": [${RECIPE_SCHEMA}] }
Never output nutrition numbers; the app calculates them from a database.`;
      return gemini(env, [{ text: prompt }], 0.8);
    }
    case 'improve': {
      const prompt = `Improve the nutritional profile of this recipe while keeping it recognisably the same dish.
${pr}
Recipe: ${JSON.stringify(body.recipe).slice(0, 20000)}
Return JSON: { "recipe": ${RECIPE_SCHEMA}, "changes": [string] } with exact grams. Never output nutrition numbers.`;
      return gemini(env, [{ text: prompt }], 0.5);
    }
    case 'estimate': {
      const prompt = `Give typical nutrition per 100 g for: "${String(body.text || '').slice(0, 200)}" (as eaten, Australian product if relevant).
Return JSON: { "per100": { "kcal": number, "protein": number, "fat": number, "satfat": number, "carbs": number, "sugars": number, "fibre": number, "sodium": number (mg) }, "confidence": number 0-1, "basis": "what this estimate assumes" }
This is a fallback estimate and will be shown to the user as unverified.`;
      return gemini(env, [{ text: prompt }], 0);
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
  if (!env.APP_TOKEN) throw new HttpError(500, 'APP_TOKEN secret is not set on the Worker');
  if (!env.KV) throw new HttpError(500, 'KV binding named "KV" is missing');
  const auth = request.headers.get('authorization') || '';
  if (!safeEqual(auth.replace(/^Bearer\s+/i, ''), env.APP_TOKEN)) throw new HttpError(401, 'Wrong app token');
  const body = ['POST', 'PUT'].includes(request.method) && path !== '/api/backup' ? await request.json().catch(() => ({})) : null;

  switch (`${request.method} ${path}`) {
    case 'GET /api/ping':
      return json(env, { ok: true, ai: !!env.GEMINI_API_KEY, subject: !!env.VAPID_SUBJECT, subs: ((await env.KV.get('subs', 'json')) || []).length, config: !!(await env.KV.get('config')) });
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
      const date = /^\d{4}-\d{2}-\d{2}$/.test(body.date || '') ? body.date : localParts(Date.now(), cfg.tz || 'Australia/Melbourne').date;
      const prev = (await env.KV.get('hk:' + date, 'json')) || {};
      const merged = { ...prev, ...body, date, receivedAt: Date.now() };
      await env.KV.put('hk:' + date, JSON.stringify(merged), { expirationTtl: 45 * 86400 });
      return json(env, { ok: true, date });
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
    case 'POST /api/ai': {
      const r = await aiTask(env, body || {});
      return json(env, { ok: true, model: r.model, source: r.source || null, data: r.data });
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
  },
  // Exposed for the test-suite only.
  _test: { aiTask, dueReminders, encryptPayload, vapidJwt, createVapidKeys, localParts, extractJsonLdRecipe, splitOneoffs, parseJsonLoose, b64urlDecode, b64urlEncode, handle },
};
