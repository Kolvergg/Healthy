// HealthOS — app shell: navigation, smooth rendering, quick add, reminder sync.
import * as db from './db.js';
import * as core from './core.js';
import * as api from './api.js';
import { icon, toast, topSheet, sheet, morph, refreshLiveSheets } from './ui.js';
import { state, actions, setRenderer, go, push, back, canGoBack, register } from './state.js';
import * as today from './today.js';
import * as planner from './planner.js';
import * as food from './food.js';
import * as health from './health.js';
import * as stats from './stats.js';
import * as settings from './settings.js';

const VIEWS = { today, planner, nutrition: food, health, stats, settings };
const TABS = [
  ['today', 'Home', 'today'],
  ['nutrition', 'Food', 'nutrition'],
  ['health', 'Health', 'health'],
  ['planner', 'Plan', 'planner'],
];

const view = document.getElementById('view');
const tabs = document.getElementById('tabs');
const topbar = document.getElementById('topbar');
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
tabs.innerHTML = `<i class="ind"></i>` + TABS.map(([k, l, i]) => `<button data-tab="${k}" aria-label="${l}">${icon(i)}<span>${l}</span></button>`).join('');
document.getElementById('fab').innerHTML = icon('plus');
topbar.querySelector('[data-act="back"]').innerHTML = icon('chevL');

tabs.addEventListener('click', e => {
  const b = e.target.closest('[data-tab]');
  if (!b) return;
  const t = b.dataset.tab;
  if (state.tab === t && !state.page) {
    if (t === 'health' && state.sub.health) return back();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }
  if (t === 'nutrition' && state.tab !== 'nutrition') state.date = core.today();
  go(t);
});

// ---------------- rendering ----------------
const screenKey = () => state.page || (state.tab === 'health' && state.sub.health ? 'health:' + state.sub.health : state.tab + ':' + (state.sub[state.tab] || ''));
const scrollMem = {};
let seq = 0;
let navMode = null;
let lastKey = null;

async function render(mode = 'update') {
  if (mode !== 'update') navMode = mode === 'boot' ? 'boot' : mode;
  const my = ++seq;
  const key = state.page || state.tab;
  let html;
  try {
    html = await VIEWS[key].render();
  } catch (e) {
    console.error(e);
    html = `<div class="card" style="margin-top:calc(var(--safe-t) + 60px)"><div class="h2">Something went wrong</div><p class="small ink2">${String(e.message || e).replace(/</g, '&lt;')}</p><button class="btn" onclick="location.reload()">Reload</button></div>`;
  }
  if (my !== seq) return; // a newer render superseded this one
  const nav = navMode;
  navMode = null;
  const sk = screenKey();
  const apply = () => {
    if (!nav || nav === 'update') morph(view, html);
    else {
      view.innerHTML = html;
      const y = nav === 'pop' || nav === 'tab' ? scrollMem[sk] || 0 : 0;
      window.scrollTo(0, y);
    }
    lastKey = sk;
    afterRender();
  };
  if (nav && nav !== 'boot' && document.startViewTransition && !reduceMotion) {
    document.documentElement.dataset.nav = nav;
    const t = document.startViewTransition(apply);
    await t.finished.catch(() => {});
    delete document.documentElement.dataset.nav;
  } else {
    apply();
    if (nav && nav !== 'boot' && !reduceMotion) {
      view.classList.remove('enter');
      void view.offsetWidth;
      view.classList.add('enter');
    }
  }
  refreshLiveSheets();
}
setRenderer(render);
window.addEventListener('scroll', () => lastKey && (scrollMem[lastKey] = window.scrollY), { passive: true });

function moveIndicator() {
  const on = state.page ? null : tabs.querySelector(`[data-tab="${state.tab}"]`);
  const ind = tabs.querySelector('.ind');
  tabs.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === state.tab && !state.page));
  if (!on) {
    ind.style.opacity = '0';
    return;
  }
  ind.style.opacity = '1';
  ind.style.width = on.offsetWidth + 'px';
  ind.style.transform = `translateX(${on.offsetLeft - 5}px)`;
}
function afterRender() {
  document.body.dataset.tab = state.page || state.tab;
  moveIndicator();
  const t = view.querySelector('.ph-title');
  topbar.querySelector('.tb-title').textContent = t ? t.dataset.title || t.textContent : '';
  topbar.querySelector('[data-act="back"]').classList.toggle('off', !canGoBack());
  onScroll();
}
window.addEventListener('resize', moveIndicator);

// Compact title bar appears once the large title scrolls away.
let ticking = false;
function onScroll() {
  ticking = false;
  topbar.classList.toggle('on', window.scrollY > 64);
}
window.addEventListener('scroll', () => {
  if (!ticking) {
    ticking = true;
    requestAnimationFrame(onScroll);
  }
}, { passive: true });

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

// ---------------- no zooming ----------------
// iOS ignores user-scalable=no in some cases, so block pinch and double-tap zoom directly.
['gesturestart', 'gesturechange', 'gestureend'].forEach(t => document.addEventListener(t, e => e.preventDefault(), { passive: false }));
document.addEventListener('touchmove', e => {
  if (e.touches.length > 1 || (e.scale && e.scale !== 1)) e.preventDefault();
}, { passive: false });
let lastTouchEnd = 0;
document.addEventListener('touchend', e => {
  const now = Date.now();
  if (now - lastTouchEnd < 300 && !e.target.closest('input, textarea, select')) e.preventDefault();
  lastTouchEnd = now;
}, { passive: false });

// ---------------- swipe from the left edge to go back ----------------
let edge = null;
document.addEventListener('touchstart', e => {
  const t = e.touches[0];
  edge = t.clientX < 24 && canGoBack() && !topSheet() ? { x: t.clientX, y: t.clientY } : null;
}, { passive: true });
document.addEventListener('touchend', e => {
  if (!edge) return;
  const t = e.changedTouches[0];
  if (t.clientX - edge.x > 70 && Math.abs(t.clientY - edge.y) < 60) back();
  edge = null;
}, { passive: true });

// ---------------- live updates: any write anywhere refreshes the view and the reminders ----------------
let renderTimer = null;
db.bus.addEventListener('change', e => {
  const st = e.detail.store;
  if (st === 'kv') core.invalidateSettings();
  clearTimeout(renderTimer);
  renderTimer = setTimeout(() => render('update'), 40);
  if (['meds', 'routines', 'tasks', 'templates', 'kv'].includes(st)) api.syncConfig();
  if (['medlog', 'water'].includes(st)) api.syncDay();
});

// ---------------- quick add (+) ----------------
function quickAdd() {
  const tile = (act, ic, color, label, extra = '') => `<button data-qa="${act}" ${extra}><span class="ico" style="background:${color}">${icon(ic)}</span>${label}</button>`;
  const s = sheet({
    title: 'Add',
    body: `<div class="qa">
      <label><span class="ico" style="background:var(--sugar)">${icon('camera')}</span>Snap meal<input type="file" accept="image/*" id="qa-photo"></label>
      ${tile('describe', 'pen', 'var(--sugar)', 'Describe meal')}
      ${tile('food', 'search', 'var(--sugar)', 'Log food')}
      ${tile('water', 'drop', 'var(--water)', 'Water')}
      ${tile('meds', 'pill', 'var(--meds)', 'Medication')}
      ${tile('sleep', 'moon', 'var(--sleep)', 'Sleep')}
      ${tile('weight', 'scale', 'var(--body)', 'Weight')}
      ${tile('workout', 'dumbbell', 'var(--workout)', 'Workout')}
      ${tile('journal', 'note', 'var(--journal)', 'Journal')}
      ${tile('task', 'checklist', 'var(--protein)', 'Task')}
      ${tile('routine', 'repeat', 'var(--protein)', 'Routine')}
      ${tile('label', 'label', 'var(--ink-3)', 'Scan label')}
    </div>
    <div class="section-label" style="margin-top:20px">Quick water</div>
    <div class="chips" id="qa-water"></div>`,
  });
  core.getSettings().then(st => {
    s.body.querySelector('#qa-water').innerHTML = st.water.sizes.map(ml => `<button class="chip" data-ml="${ml}">${icon('drop')} ${ml} ml</button>`).join('');
    s.body.querySelectorAll('[data-ml]').forEach(b => (b.onclick = async () => {
      await core.addWater(Number(b.dataset.ml));
      s.close();
      const total = await core.waterTotal(core.today());
      toast(total >= st.water.target ? 'Water target reached' : `+${b.dataset.ml} ml · ${(total / 1000).toFixed(2)} L today`);
    }));
  });
  s.body.querySelector('#qa-photo').onchange = e => {
    const f = e.target.files[0];
    if (f) {
      s.close();
      food.photoFlow(f, core.today(), core.defaultSlotForNow());
    }
  };
  s.body.querySelectorAll('[data-qa]').forEach(b => (b.onclick = async () => {
    const k = b.dataset.qa;
    s.close();
    const run = n => actions[n] && actions[n]({ dataset: {} });
    if (k === 'describe') food.describeFlow(core.today(), core.defaultSlotForNow());
    if (k === 'food') food.openLog(core.today(), core.defaultSlotForNow());
    if (k === 'label') food.openLog(core.today(), core.defaultSlotForNow());
    if (k === 'water') run('water-custom');
    if (k === 'meds') go('health', 'meds');
    if (k === 'sleep') run('sleep-log');
    if (k === 'weight') run('weight-add');
    if (k === 'workout') run('workout-start');
    if (k === 'journal') run('journal-edit');
    if (k === 'task') planner.taskEditor(null, { date: core.today() });
    if (k === 'routine') run('routine-edit');
  }));
}
register({ fab: () => quickAdd(), back: () => back(), push: el => push(el.dataset.page) });

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
  state.date = core.today();
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
  await render('boot');

  if ('serviceWorker' in navigator) {
    const hadController = !!navigator.serviceWorker.controller; // first install isn't an "update"
    navigator.serviceWorker.register('./sw.js').catch(() => {});
    navigator.serviceWorker.addEventListener('message', e => {
      if (e.data && e.data.go) goFromUrl(e.data.go);
    });
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadController && !window.__reloading) {
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
    if (!topSheet()) render('update');
    api.syncConfig();
    api.syncDay();
    api.maybeAutoBackup();
    const pulled = await db.kvGet('cache:healthPulledAt', 0);
    if (Date.now() - (pulled || 0) > 3 * 3600 * 1000) api.pullHealth().catch(() => {});
  };
  document.addEventListener('visibilitychange', onVisible);
  setInterval(() => {
    if (document.visibilityState === 'visible' && state.tab === 'today' && !state.page && !topSheet()) render('update');
  }, 60 * 1000);
  onVisible();
}

boot();
