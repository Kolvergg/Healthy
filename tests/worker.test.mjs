import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import worker from '../worker/worker.js';

const require = createRequire(import.meta.url);
const ece = require('http_ece');
const jose = require('jose');
const T = worker._test;

function fakeKV() {
  const m = new Map();
  return {
    m,
    async get(k, type) {
      const v = m.has(k) ? m.get(k) : null;
      return v == null ? null : type === 'json' ? JSON.parse(v) : v;
    },
    async put(k, v) { m.set(k, String(v)); },
    async list({ prefix }) { return { keys: [...m.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })) }; },
  };
}

function browserSubscription() {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = crypto.randomBytes(16);
  return {
    ecdh,
    auth,
    sub: { endpoint: 'https://web.push.apple.com/QGhlbGxv', keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: auth.toString('base64url') } },
  };
}

test('web push payload decrypts with an independent RFC 8291 implementation', async () => {
  const { ecdh, auth, sub } = browserSubscription();
  const msg = JSON.stringify({ title: 'Water', body: '750 of 2500 ml' });
  const body = await T.encryptPayload(sub, new TextEncoder().encode(msg));
  const out = ece.decrypt(Buffer.from(body), { version: 'aes128gcm', privateKey: ecdh, authSecret: auth });
  assert.equal(out.toString(), msg);
});

test('VAPID JWT verifies with the published public key', async () => {
  const v = await T.createVapidKeys();
  assert.equal(T.b64urlDecode(v.publicKey).length, 65);
  const jwt = await T.vapidJwt('https://web.push.apple.com', v, 'mailto:a@b.co', 1_800_000_000);
  const raw = T.b64urlDecode(v.publicKey);
  const pub = await jose.importJWK({ kty: 'EC', crv: 'P-256', x: Buffer.from(raw.slice(1, 33)).toString('base64url'), y: Buffer.from(raw.slice(33)).toString('base64url') }, 'ES256');
  const { payload, protectedHeader } = await jose.jwtVerify(jwt, pub, { currentDate: new Date(1_800_000_000_000) });
  assert.equal(protectedHeader.alg, 'ES256');
  assert.equal(payload.aud, 'https://web.push.apple.com');
  assert.equal(payload.sub, 'mailto:a@b.co');
});

test('Melbourne local time handles daylight saving', () => {
  const summer = T.localParts(Date.UTC(2026, 0, 15, 21, 0), 'Australia/Melbourne'); // AEDT +11
  assert.equal(summer.date, '2026-01-16');
  assert.equal(summer.hhmm, '08:00');
  assert.equal(summer.weekday, 5);
  const winter = T.localParts(Date.UTC(2026, 6, 15, 22, 0), 'Australia/Melbourne'); // AEST +10
  assert.equal(winter.hhmm, '08:00');
});

const week = v => Array(7).fill(v);
const cfg = {
  tz: 'Australia/Melbourne',
  water: { enabled: true, target: 2500, days: [...week({ start: '08:00', end: '21:00', interval: 90 })] },
  medSlots: [{ id: 'bed', name: 'Before bed', times: week('21:30'), meds: [{ id: 'm1', name: 'Med A', dose: '16 mg' }, { id: 'm2', name: 'Supp B', dose: '', optional: true }] }],
  medFollowUp: 30,
  recurring: [{ id: 'wind', title: 'Wind down', times: [null, '21:30', null, null, null, null, null] }],
  timed: [{ id: 't1', at: '2026-11-12T15:00', title: 'Dentist' }],
  refill: { time: '10:00', items: ['Fish oil (4 left)'] },
};
const at = (date, hhmm, weekday) => ({ date, hhmm, weekday, minutes: Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3)) });

test('water reminders every 90 min within the window, stop once target reached', () => {
  const fire = t => T.dueReminders(cfg, at('2026-11-12', t, 4), { waterMl: 500 }).some(r => r.tag === 'water');
  assert.ok(fire('08:00'));
  assert.ok(fire('09:30'));
  assert.ok(!fire('09:00'));
  assert.ok(fire('20:00'));
  assert.ok(!fire('21:30'));
  assert.ok(!fire('07:30'));
  assert.ok(!T.dueReminders(cfg, at('2026-11-12', '09:30', 4), { waterMl: 2600 }).some(r => r.tag === 'water'));
});

test('medication reminder, follow-up only for required meds, skip when taken', () => {
  const r = T.dueReminders(cfg, at('2026-11-12', '21:30', 4), {});
  const m = r.find(x => x.tag === 'med-bed');
  assert.match(m.body, /Med A 16 mg, Supp B/);
  const fu = T.dueReminders(cfg, at('2026-11-12', '22:00', 4), { taken: { bed: ['m1'] } });
  assert.ok(!fu.some(x => x.tag === 'med-bed'), 'no follow-up when required med taken');
  const fu2 = T.dueReminders(cfg, at('2026-11-12', '22:00', 4), { taken: { bed: ['m2'] } });
  assert.match(fu2.find(x => x.tag === 'med-bed').title, /not logged/);
  const none = T.dueReminders(cfg, at('2026-11-12', '21:30', 4), { taken: { bed: ['m1', 'm2'] } });
  assert.ok(!none.some(x => x.tag === 'med-bed'));
  const hidden = T.dueReminders({ ...cfg, privacy: { hideMedNames: true } }, at('2026-11-12', '21:30', 4), {});
  assert.equal(hidden.find(x => x.tag === 'med-bed').body, '2 items to take');
});

test('recurring, timed, refill and holiday mode', () => {
  assert.ok(T.dueReminders(cfg, at('2026-11-09', '21:30', 1), {}).some(r => r.tag === 'wind'));
  assert.ok(!T.dueReminders(cfg, at('2026-11-10', '21:30', 2), {}).some(r => r.tag === 'wind'));
  assert.ok(T.dueReminders(cfg, at('2026-11-12', '15:00', 4), {}).some(r => r.tag === 't1'));
  assert.ok(T.dueReminders(cfg, at('2026-11-12', '10:00', 4), {}).some(r => r.tag === 'refill'));
  const hol = { ...cfg, holidayUntil: '2026-11-20', recurring: [{ id: 'sat', title: 'x', times: [null, null, null, null, null, null, '09:00'] }] };
  assert.ok(T.dueReminders(hol, at('2026-11-12', '09:00', 4), {}).some(r => r.tag === 'sat'));
  assert.ok(!T.dueReminders(hol, at('2026-11-21', '09:00', 6 - 1), {}).some(r => r.tag === 'sat'));
});

test('one-off snoozes split by time', () => {
  const { due, rest } = T.splitOneoffs([{ at: 1000 }, { at: 999999 }], 5000);
  assert.equal(due.length, 1);
  assert.equal(rest.length, 1);
});

test('JSON-LD recipe extraction handles @graph and HowToSection', () => {
  const html = `<html><script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebPage"},{"@type":["Recipe"],"name":"Chicken &amp; Rice","recipeYield":["4","4 serves"],"recipeIngredient":["500 g chicken thigh","1 cup rice"],"recipeInstructions":[{"@type":"HowToSection","itemListElement":[{"@type":"HowToStep","text":"Cook rice."},{"@type":"HowToStep","text":"Grill chicken."}]}],"image":{"url":"https://x/y.jpg"}}]}</script></html>`;
  const r = T.extractJsonLdRecipe(html);
  assert.equal(r.name, 'Chicken & Rice');
  assert.equal(r.yield, '4');
  assert.deepEqual(r.ingredients, ['500 g chicken thigh', '1 cup rice']);
  assert.deepEqual(r.steps, ['Cook rice.', 'Grill chicken.']);
  assert.equal(r.image, 'https://x/y.jpg');
  assert.equal(T.extractJsonLdRecipe('<p>nothing</p>'), null);
});

test('loose JSON parsing strips code fences', () => {
  assert.deepEqual(T.parseJsonLoose('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(T.parseJsonLoose('Here: {"a":2} thanks'), { a: 2 });
});

test('HTTP API: auth, subscribe, config, test push end-to-end with mocked push service and Gemini', async () => {
  const env = { KV: fakeKV(), APP_TOKEN: 'secret-token', GEMINI_API_KEY: 'AQ.test', VAPID_SUBJECT: 'mailto:a@b.co' };
  const call = (method, path, body, token = 'secret-token') =>
    worker.fetch(new Request('https://w.example' + path, { method, headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }), env);

  assert.equal((await call('GET', '/api/ping', null, 'wrong')).status, 401);
  const ping = await (await call('GET', '/api/ping')).json();
  assert.equal(ping.ok, true);

  const { ecdh, auth, sub } = browserSubscription();
  assert.equal((await call('POST', '/api/subscribe', { subscription: sub })).status, 200);

  const realFetch = globalThis.fetch;
  const pushed = [];
  let geminiCalls = [];
  globalThis.fetch = async (url, init) => {
    url = String(url);
    if (url.startsWith('https://web.push.apple.com')) {
      pushed.push({ init, plain: ece.decrypt(Buffer.from(init.body), { version: 'aes128gcm', privateKey: ecdh, authSecret: auth }).toString() });
      return new Response('', { status: 201 });
    }
    if (url.includes('generativelanguage.googleapis.com')) {
      geminiCalls.push({ url, init });
      if (url.includes('gemini-3.1-flash-lite')) return new Response(JSON.stringify({ error: { message: 'This model is currently experiencing high demand.' } }), { status: 503 });
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"meal_name":"Toast","items":[{"name":"Bread, white, toasted","grams":60,"confidence":0.7}]}' }] } }] }), { status: 200 });
    }
    throw new Error('unexpected fetch ' + url);
  };
  try {
    const t = await (await call('POST', '/api/test')).json();
    assert.equal(t.sent, 1);
    assert.equal(JSON.parse(pushed[0].plain).title, 'HealthOS');
    assert.match(pushed[0].init.headers.Authorization, /^vapid t=.+, k=.+/);
    assert.equal(pushed[0].init.headers['Content-Encoding'], 'aes128gcm');
    const hist = await (await call('GET', '/api/history')).json();
    assert.equal(hist[0].ok, true);

    const ai = await (await call('POST', '/api/ai', { task: 'text', text: 'two slices of toast' })).json();
    assert.equal(ai.ok, true);
    // 3.1 Flash-Lite is "busy" twice (retry), so it falls through to 3.5 Flash-Lite — never a full Flash model.
    assert.equal(ai.model, 'gemini-3.5-flash-lite');
    assert.equal(geminiCalls.length, 3);
    assert.ok(geminiCalls.every(c => /flash-lite/.test(c.url)), 'text tasks only use Flash-Lite');
    assert.equal(ai.data.items[0].grams, 60);
    const sent = JSON.parse(geminiCalls[2].init.body);
    assert.equal(sent.generationConfig.thinkingConfig.thinkingLevel, 'minimal');
    assert.ok(sent.generationConfig.maxOutputTokens <= 1000);
    assert.equal(sent.generationConfig.temperature, undefined);
    assert.equal(geminiCalls[2].init.headers['x-goog-api-key'], 'AQ.test');
    assert.ok(!geminiCalls[2].url.includes('key='), 'key must not be in URL');

    // photos: Flash-Lite with medium image resolution; "accurate" mode tries Flash first
    geminiCalls = [];
    await call('POST', '/api/ai', { task: 'photo', image: { mime: 'image/jpeg', data: 'AAAA' } });
    const ph = JSON.parse(geminiCalls[geminiCalls.length - 1].init.body);
    assert.equal(ph.generationConfig.mediaResolution, 'MEDIA_RESOLUTION_MEDIUM');
    geminiCalls = [];
    await call('POST', '/api/ai', { task: 'photo', accurate: true, image: { mime: 'image/jpeg', data: 'AAAA' } });
    assert.match(geminiCalls[0].url, /gemini-3\.6-flash:/);

    // a gone subscription gets removed
    globalThis.fetch = async () => new Response('', { status: 410 });
    await call('POST', '/api/test');
    const ping2 = await (await call('GET', '/api/ping')).json();
    assert.equal(ping2.subs, 0);
  } finally {
    globalThis.fetch = realFetch;
  }

  // backup round trip
  await worker.fetch(new Request('https://w.example/api/backup', { method: 'PUT', headers: { authorization: 'Bearer secret-token' }, body: '{"v":1}' }), env);
  const b = await (await call('GET', '/api/backup')).text();
  assert.equal(b, '{"v":1}');

  // healthkit merge
  await call('POST', '/api/healthkit', { date: '2026-11-11', steps: '8432' });
  await call('POST', '/api/healthkit', { date: '2026-11-11', sleep_hours: 7.5 });
  const hk = await (await call('GET', '/api/healthkit')).json();
  assert.equal(hk[0].steps, '8432');
  assert.equal(hk[0].sleep_hours, 7.5);

  // Health Auto Export payload
  await call('POST', '/api/healthkit', { data: { metrics: [{ name: 'step_count', units: 'count', data: [{ date: '2026-11-12 00:00:00 +1100', qty: 4000 }, { date: '2026-11-12 09:00:00 +1100', qty: 1000 }] }, { name: 'weight_body_mass', units: 'kg', data: [{ date: '2026-11-12 07:00:00 +1100', qty: 71.4 }] }] } });
  const hk2 = await (await call('GET', '/api/healthkit')).json();
  const d12 = hk2.find(x => x.date === '2026-11-12');
  assert.equal(d12.steps, 5000);
  assert.equal(d12.weight_kg, 71.4);

  // status: no cron yet → cronOk false; after a scheduled run → true, with upcoming reminders
  await call('POST', '/api/config', { tz: 'Australia/Melbourne', water: { enabled: true, target: 2000, days: Array(7).fill({ start: '00:00', end: '23:59', interval: 60 }) }, medSlots: [], recurring: [], timed: [] });
  let st = await (await call('GET', '/api/status')).json();
  assert.equal(st.cronOk, false);
  assert.ok(st.upcoming.length > 0);
  await worker.scheduled({ scheduledTime: Date.now() }, env, { waitUntil: p => p });
  await new Promise(r => setTimeout(r, 20));
  st = await (await call('GET', '/api/status')).json();
  assert.equal(st.cronOk, true);
});
