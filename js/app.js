// HealthOS — app shell: routing, event delegation, live updates, reminder sync.
import * as db from './db.js';
import * as core from './core.js';
import * as api from './api.js';
import { icon, toast, topSheet } from './ui.js';
import { state, actions, setRenderer, go } from './state.js';
import * as today from './today.js';
import * as planner from './planner.js';
import * as food from './food.js';
import * as health from './health.js';
import * as stats from './stats.js';
import * as settings from './settings.js';

const VIEWS = { today, planner, nutrition: food, health, stats, settings };
const TABS = [
  ['today', 'Today', 'today'],
  ['planner', 'Planner', 'planner'],
  ['nutrition', 'Nutrition', 'nutrition'],
  ['health', 'Health', 'health'],
  ['stats', 'Stats', 'stats'],
  ['settings', 'Settings', 'settings'],
];

const view = document.getElementById('view');
const tabs = document.getElementById('tabs');
tabs.innerHTML = TABS.map(([k, l, i]) => `<button data-tab="${k}" aria-label="${l}">${icon(i)}<span>${l}</span></button>`).join('');
tabs.addEventListener('click', e => {
  const b = e.target.closest('[data-tab]');
  if (!b) return;
  if (state.tab === b.dataset.tab) window.scrollTo({ top: 0, behavior: 'smooth' });
  else {
    if (b.dataset.tab === 'nutrition') state.date = core.today();
    go(b.dataset.tab);
  }
});

let rendering = false;
let pending = false;
let lastTab = null;
async function render(resetScroll = false) {
  if (rendering) {
    pending = true;
    return;
  }
  rendering = true;
  try {
    const sameTab = lastTab === state.tab;
    const openDetails = sameTab ? [...view.querySelectorAll('details')].map(d => d.open) : [];
    const y = window.scrollY;
    const html = await VIEWS[state.tab].render();
    view.style.animation = sameTab ? 'none' : '';
    view.innerHTML = html;
    if (sameTab) view.querySelectorAll('details').forEach((d, i) => {
      if (openDetails[i] != null) d.open = openDetails[i];
    });
    window.scrollTo(0, resetScroll ? 0 : y);
    lastTab = state.tab;
    tabs.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === state.tab));
  } catch (e) {
    console.error(e);
    view.innerHTML = `<div class="card" style="margin-top:20px"><div class="h2">Something went wrong</div><p class="small ink2">${String(e.message || e).replace(/</g, '&lt;')}</p><button class="btn" onclick="location.reload()">Reload</button></div>`;
  }
  rendering = false;
  if (pending) {
    pending = false;
    render();
  }
}
setRenderer(render);

// ---------------- event delegation ----------------
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const fn = actions[el.dataset.act];
  if (!fn) return;
  e.preventDefault();
  Promise.resolve(fn(el, e)).catch(err => toast(err.message || String(err)));
});
document.addEventListener('change', e => {
  const el = e.target.closest('[data-chg]');
  if (el && actions[el.dataset.chg]) Promise.resolve(actions[el.dataset.chg](el, e)).catch(err => toast(err.message));
});
document.addEventListener('input', e => {
  const el = e.target.closest('[data-input]');
  if (el && actions[el.dataset.input]) actions[el.dataset.input](el, e);
});
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  const el = e.target.closest('[data-act-enter]');
  if (el && actions[el.dataset.actEnter]) {
    e.preventDefault();
    actions[el.dataset.actEnter](el, e);
  }
});

// ---------------- live updates: any write anywhere refreshes the view and the reminders ----------------
let renderTimer = null;
db.bus.addEventListener('change', e => {
  const st = e.detail.store;
  if (st === 'kv') core.invalidateSettings();
  clearTimeout(renderTimer);
  renderTimer = setTimeout(() => render(), 60);
  if (['meds', 'routines', 'tasks', 'templates', 'kv'].includes(st)) api.syncConfig();
  if (['medlog', 'water'].includes(st)) api.syncDay();
});

// ---------------- deep links from notifications ----------------
const GO = {
  water: ['health', 'water'],
  meds: ['health', 'meds'],
  sleep: ['health', 'sleep'],
  workouts: ['health', 'workouts'],
  planner: ['planner', 'tasks'],
  today: ['today'],
  diary: ['nutrition', 'diary'],
};
function handleGo(target) {
  const g = GO[target];
  if (!g) return;
  if (g[0] === 'health') state.date = core.today();
  go(g[0], g[1]);
}
function goFromUrl(url) {
  try {
    const u = new URL(url, location.href);
    const t = u.searchParams.get('go');
    if (t) {
      handleGo(t);
      history.replaceState(null, '', location.pathname);
    }
  } catch {}
}

// ---------------- first run ----------------
async function seed() {
  if (await db.kvGet('seeded', false)) return;
  await db.putMany('routines', [
    { name: 'Morning', days: [0, 1, 2, 3, 4, 5, 6], time: null, remind: false, items: [{ id: 'a1', text: 'Glass of water' }, { id: 'a2', text: 'Morning medication' }, { id: 'a3', text: 'Skincare AM' }] },
    { name: 'Evening wind-down', days: [0, 1, 2, 3, 4, 5, 6], time: null, remind: false, items: [{ id: 'b1', text: 'Screens away' }, { id: 'b2', text: 'Skincare PM' }, { id: 'b3', text: 'Pack bag for tomorrow' }, { id: 'b4', text: 'Night medication' }] },
  ], { silent: true });
  await db.kvSet('seeded', true, { silent: true });
}

// ---------------- boot ----------------
async function boot() {
  const s = await core.getSettings();
  settings.applyTheme(s.theme);
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', async () => settings.applyTheme((await core.getSettings()).theme));
  await seed();
  db.persist();
  goFromUrl(location.href);
  await render(true);

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
    navigator.serviceWorker.addEventListener('message', e => {
      if (e.data && e.data.go) goFromUrl(e.data.go);
    });
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!window.__reloading) {
        window.__reloading = true;
        toast('App updated', { action: 'Reload', onAction: () => location.reload() });
      }
    });
  }

  let lastDay = core.today();
  const onVisible = async () => {
    if (document.visibilityState !== 'visible') return;
    const t = core.today();
    if (t !== lastDay) {
      if (state.date === lastDay) state.date = t;
      lastDay = t;
    }
    if (!topSheet()) render();
    api.syncDay();
    api.maybeAutoBackup();
    const pulled = await db.kvGet('cache:healthPulledAt', 0);
    if (Date.now() - (pulled || 0) > 3 * 3600 * 1000) api.pullHealth().catch(() => {});
  };
  document.addEventListener('visibilitychange', onVisible);
  setInterval(() => {
    if (document.visibilityState === 'visible' && state.tab === 'today' && !topSheet()) render();
  }, 5 * 60 * 1000);
  onVisible();
  api.syncConfig();
}

boot();
