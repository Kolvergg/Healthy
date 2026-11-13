import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/worker.js';

const store = new Map();
const KV = {
  get: async (k, t) => (store.has(k) ? (t === 'json' ? JSON.parse(store.get(k)) : store.get(k)) : null),
  put: async (k, v) => store.set(k, v),
  list: async () => ({ keys: [] }),
};
const env = { APP_TOKEN: 't', KV, GEMINI_API_KEY: 'k' };
const recipe = { name: 'Garlic butter chicken', servings: 2, ingredients: [{ name: 'chicken thigh', quantity_text: '500 g', grams: 500, grams_is_estimate: false }, { name: 'butter', quantity_text: '~2 tbsp (estimated)', grams: 40, grams_is_estimate: true }], steps: ['Sear', 'Baste'], missing: ['butter'] };

function fakeNet(log, { blockVideo = false, caption = 'Garlic butter chicken 🔥' } = {}) {
  const page = `<html><script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify({ __DEFAULT_SCOPE__: { 'webapp.video-detail': { itemInfo: { itemStruct: { desc: caption, video: { cover: 'https://img/c.jpg', playAddr: 'https://v/big.mp4', bitrateInfo: [{ Bitrate: 900000, PlayAddr: { UrlList: ['https://v/hi.mp4'] } }, { Bitrate: 300000, PlayAddr: { UrlList: ['https://v/lo.mp4'] } }] } } } } } })}</script></html>`;
  return async (url, init = {}) => {
    url = String(url);
    log.push(url);
    if (url.startsWith('https://www.tiktok.com/@')) return new Response(page, { headers: { 'set-cookie': 'tt_chain_token=abc; Path=/' } });
    if (url.startsWith('https://v/')) {
      if (blockVideo) return new Response('no', { status: 403 });
      assert.equal(init.headers.cookie, 'tt_chain_token=abc');
      assert.equal(init.headers.referer, 'https://www.tiktok.com/');
      return new Response(new Uint8Array(1000), { headers: { 'content-length': '1000', 'content-type': 'video/mp4' } });
    }
    if (url.includes('/upload/v1beta/files') && init.headers['x-goog-upload-command'] === 'start') return new Response('{}', { headers: { 'x-goog-upload-url': 'https://up/1' } });
    if (url === 'https://up/1') return Response.json({ file: { name: 'files/1', uri: 'https://g/files/1', mimeType: 'video/mp4', state: 'PROCESSING' } });
    if (url.endsWith('/v1beta/files/1')) return Response.json({ name: 'files/1', uri: 'https://g/files/1', mimeType: 'video/mp4', state: 'ACTIVE' });
    if (url.includes(':generateContent')) {
      const body = JSON.parse(init.body);
      log.push({ gen: body });
      return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(recipe) }] } }], usageMetadata: { promptTokenCount: 5000, candidatesTokenCount: 300 } });
    }
    return new Response('?', { status: 404 });
  };
}

test('TikTok link: downloads the smallest stream with cookies, Gemini watches it, amounts estimated', async () => {
  const real = globalThis.fetch;
  const log = [];
  globalThis.fetch = fakeNet(log);
  try {
    const r = await worker._test.aiTask(env, { task: 'url', url: 'https://www.tiktok.com/@chef/video/123' });
    assert.equal(r.source, 'tiktok-video');
    assert.ok(log.includes('https://v/lo.mp4'), 'used the low-bitrate stream');
    const gen = log.find(x => x.gen).gen;
    const parts = gen.contents[0].parts;
    assert.equal(parts[0].file_data.file_uri, 'https://g/files/1', 'video goes first');
    assert.match(parts[1].text, /estimate it from what you see/);
    assert.match(parts[1].text, /NEVER add ingredients/);
    assert.match(parts[1].text, /Garlic butter chicken/);
    assert.match(log.find(x => typeof x === 'string' && x.includes(':generateContent')), /flash/);
    assert.equal(r.data.ingredients[1].grams_is_estimate, true);
    assert.equal(r.data.image_url, 'https://img/c.jpg');
  } finally {
    globalThis.fetch = real;
  }
});

test('TikTok link: video blocked → falls back to the caption, or a clear message when there is none', async () => {
  const real = globalThis.fetch;
  try {
    globalThis.fetch = fakeNet([], { blockVideo: true, caption: 'Chicken: 500g thigh, 2 tbsp butter, 4 garlic cloves, parsley' });
    const r = await worker._test.aiTask(env, { task: 'url', url: 'https://www.tiktok.com/@chef/video/123' });
    assert.equal(r.source, 'tiktok-caption');
    globalThis.fetch = fakeNet([], { blockVideo: true, caption: '🔥🔥' });
    await assert.rejects(worker._test.aiTask(env, { task: 'url', url: 'https://www.tiktok.com/@chef/video/123' }), /Save video/);
  } finally {
    globalThis.fetch = real;
  }
});

test('POST /api/video: raw upload from the phone is watched by Gemini', async () => {
  const real = globalThis.fetch;
  const log = [];
  globalThis.fetch = fakeNet(log);
  try {
    const res = await worker._test.handle(new Request('https://w/api/video', { method: 'POST', headers: { authorization: 'Bearer t', 'content-type': 'video/quicktime' }, body: new Uint8Array(2048) }), env);
    const j = await res.json();
    assert.equal(j.ok, true);
    assert.equal(j.source, 'video');
    assert.equal(j.data.name, 'Garlic butter chicken');
    const bad = await worker._test.handle(new Request('https://w/api/video', { method: 'POST', headers: { authorization: 'Bearer t', 'content-type': 'text/plain' }, body: 'x' }), env).catch(e => e);
    assert.match(String(bad.message || ''), /video or image/);
  } finally {
    globalThis.fetch = real;
  }
});
