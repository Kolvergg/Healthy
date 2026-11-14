import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import worker from '../worker/worker.js';

const T = worker._test;
const fx = n => JSON.parse(readFileSync(new URL(`./fixtures/google-${n}.json`, import.meta.url)));
const TZ = 'Australia/Melbourne';

function memKV() {
  const m = new Map();
  return {
    m,
    get: async (k, t) => (m.has(k) ? (t === 'json' ? JSON.parse(m.get(k)) : m.get(k)) : null),
    put: async (k, v) => m.set(k, v),
    delete: async k => m.delete(k),
    list: async ({ prefix }) => ({ keys: [...m.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })) }),
  };
}

test('real sleep response: minutes asleep → hours, dated the morning you woke (Melbourne)', () => {
  const days = T.googleToDays({ sleep: fx('sleep').dataPoints }, TZ);
  const by = Object.fromEntries(days.map(d => [d.date, d]));
  // Asleep 22:50 on 11 Oct (local), woke 07:33 on 12 Oct: 503 min.
  assert.equal(by['2026-10-12'].sleep_hours, 8.38);
  // Woke 07:32 on 13 Oct: 398 min.
  assert.equal(by['2026-10-13'].sleep_hours, 6.63);
  assert.equal(by['2026-10-13'].source, 'Google Health');
});

test('real exercise response: workouts per day with minutes, calories and app', () => {
  const days = T.googleToDays({ exercise: fx('exercise').dataPoints }, TZ);
  const by = Object.fromEntries(days.map(d => [d.date, d]));
  const walk = by['2026-11-13'].workouts[0];
  assert.equal(walk.name, 'Walk');
  assert.equal(walk.minutes, 15);
  assert.equal(walk.kcal, 65);
  const lift = by['2026-11-08'].workouts[0];
  assert.equal(lift.name, 'Strength training');
  assert.equal(lift.minutes, 44);
  assert.equal(lift.from, 'com.hevyapp.hevy');
  assert.equal(by['2026-11-08'].exercise_min, 44);
});

test('steps: summed per local day, band preferred over phone copies', () => {
  const pt = (start, count, platform = 'FITBIT') => ({ dataSource: { platform, recordingMethod: 'PASSIVELY_MEASURED' }, steps: { interval: { startTime: start, startUtcOffset: '39600s', endTime: start, endUtcOffset: '39600s' }, count: String(count) } });
  const days = T.googleToDays({ steps: [pt('2026-11-13T22:00:00Z', 500), pt('2026-11-14T01:00:00Z', 1200), pt('2026-11-14T01:00:00Z', 1100, 'HEALTH_KIT'), pt('2026-11-12T23:00:00Z', 300, 'HEALTH_KIT')] }, TZ);
  const by = Object.fromEntries(days.map(d => [d.date, d.steps]));
  assert.equal(by['2026-11-14'], 1700, '09:00 + 12:00 local on the 14th, phone copy ignored');
  assert.equal(by['2026-11-13'], 300, 'phone-only day still counts');
});

test('sign-in link → callback → refresh token stored → sync writes days; cron waits an hour', async () => {
  const KV = memKV();
  const env = { APP_TOKEN: 't', KV, GOOGLE_CLIENT_ID: ' cid ', GOOGLE_CLIENT_SECRET: 'sec ' };
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (u, init = {}) => {
    u = String(u);
    calls.push(u);
    if (u === 'https://oauth2.googleapis.com/token') {
      const p = new URLSearchParams(init.body);
      assert.equal(p.get('client_id'), 'cid');
      assert.equal(p.get('client_secret'), 'sec');
      if (p.get('grant_type') === 'authorization_code') {
        assert.equal(p.get('redirect_uri'), 'https://w.example.dev/api/google/callback');
        return Response.json({ access_token: 'A1', refresh_token: 'R1', expires_in: 3600, refresh_token_expires_in: 604799, scope: 'https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly https://www.googleapis.com/auth/googlehealth.sleep.readonly' });
      }
      return Response.json({ access_token: 'A2', expires_in: 3600 });
    }
    if (u.startsWith('https://health.googleapis.com/v4/users/me/dataTypes/')) {
      assert.match(init.headers.authorization, /^Bearer A[12]$/);
      const type = u.split('/dataTypes/')[1].split('/')[0];
      const q = new URL(u).searchParams;
      assert.match(q.get('filter'), new RegExp(`^${type}\\.interval\\.civil_(start|end)_time >= "\\d{4}-\\d{2}-\\d{2}"$`));
      return Response.json(type === 'sleep' ? fx('sleep') : type === 'exercise' ? fx('exercise') : { dataPoints: [] });
    }
    throw new Error('unexpected ' + u);
  };
  try {
    const link = await (await T.handle(new Request('https://w.example.dev/api/google/link', { method: 'POST', headers: { authorization: 'Bearer t' } }), env)).json();
    const auth = new URL(link.url);
    assert.equal(auth.searchParams.get('access_type'), 'offline');
    assert.equal(auth.searchParams.get('redirect_uri'), 'https://w.example.dev/api/google/callback');
    const state = auth.searchParams.get('state');
    // Callback is public (no app token) and works once.
    const page = await T.handle(new Request(`https://w.example.dev/api/google/callback?state=${state}&code=C`), env);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /connected/i);
    const again = await T.handle(new Request(`https://w.example.dev/api/google/callback?state=${state}&code=C`), env);
    assert.equal(again.status, 400);
    const g = JSON.parse(KV.m.get('google'));
    assert.equal(g.refresh, 'R1');
    assert.ok(g.lastSync.days > 0);
    assert.ok(JSON.parse(KV.m.get('hk:2026-11-13')).workouts.length);
    // Cron: nothing within the hour, then a sync with a refreshed token.
    calls.length = 0;
    await T.googleSyncIfDue(env, Date.now() + 10 * 60000);
    assert.equal(calls.length, 0);
    await T.googleSyncIfDue(env, Date.now() + 2 * 3600000);
    // The stored access token is still valid, so no refresh call is needed yet.
    assert.ok(calls.some(u => u.includes('/dataTypes/steps/')));
    // Status endpoint
    const st = await (await T.handle(new Request('https://w.example.dev/api/google/status', { headers: { authorization: 'Bearer t' } }), env)).json();
    assert.equal(st.connected, true);
    assert.equal(st.redirect, 'https://w.example.dev/api/google/callback');
  } finally {
    globalThis.fetch = real;
  }
});

test('expired Google sign-in is flagged instead of retried every hour', async () => {
  const KV = memKV();
  await KV.put('google', JSON.stringify({ refresh: 'R', access: null, accessExp: 0 }));
  const env = { APP_TOKEN: 't', KV, GOOGLE_CLIENT_ID: 'c', GOOGLE_CLIENT_SECRET: 's' };
  const real = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }, { status: 400 });
  try {
    await T.googleSyncIfDue(env, Date.now());
    const g = JSON.parse(KV.m.get('google'));
    assert.equal(g.needsReconnect, true);
    let n = 0;
    globalThis.fetch = async () => (n++, Response.json({}));
    await T.googleSyncIfDue(env, Date.now() + 3 * 3600000);
    assert.equal(n, 0);
  } finally {
    globalThis.fetch = real;
  }
});
