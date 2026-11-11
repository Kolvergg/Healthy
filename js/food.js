// Nutrition: diary, food logging (photo / describe / search / recipe / quick), foods database, recipes.
import * as db from './db.js';
import * as core from './core.js';
import * as N from './nutrition.js';
import * as api from './api.js';
import { parseAfcd } from './afcd.js';
import { esc, icon, sheet, toast, confirmSheet, promptSheet, compressImage, thumbFromDataUrl, bar, debounce, initials } from './ui.js';
import { state, register, rerender } from './state.js';

// ---------------- caches ----------------
let foodsCache = null;
export async function foods() {
  if (!foodsCache) foodsCache = await db.all('foods');
  return foodsCache;
}
db.bus.addEventListener('change', e => {
  if (e.detail.store === 'foods') foodsCache = null;
});

const SOURCE_LABEL = { afcd: 'AFCD', custom: 'Custom', label: 'Label', 'ai-estimate': 'Unverified', recipe: 'Recipe', quick: 'Manual' };
const SOURCE_CLASS = { afcd: 'afcd', custom: 'custom', label: 'label', 'ai-estimate': 'unverified', recipe: 'custom', quick: 'custom' };
export const srcBadge = s => `<span class="badge ${SOURCE_CLASS[s] || ''}">${SOURCE_LABEL[s] || esc(s || '')}</span>`;
export const confBadge = c => (c == null ? '' : `<span class="badge ${N.confidenceLabel(c).toLowerCase()}">${N.confidenceLabel(c)}</span>`);
const f0 = v => (v == null ? '—' : Math.round(v).toLocaleString('en-AU'));
const f1 = v => (v == null ? '—' : (Math.round(v * 10) / 10).toLocaleString('en-AU'));
export function nutLine(n) {
  return `${f0(n.kcal)} kcal · P ${f1(n.protein)} g · C ${f1(n.carbs)} g · F ${f1(n.fat)} g`;
}
const NUT_COLOR = { protein: 'var(--protein)', fibre: 'var(--fibre)', sodium: 'var(--sodium)', satfat: 'var(--satfat)', addedSugars: 'var(--sugar)', sugars: 'var(--sugar)', kcal: 'var(--accent)' };
export const nutColor = k => NUT_COLOR[k] || 'var(--accent)';

export async function prioritiesText() {
  const s = await core.getSettings();
  const hi = s.targets.filter(t => t.kind === 'min').map(t => `${N.NUTRIENT[t.key].label} (at least ${t.value} ${N.NUTRIENT[t.key].unit}/day, weight ${t.weight})`);
  const lo = s.targets.filter(t => t.kind === 'max').map(t => `${N.NUTRIENT[t.key].label} (at most ${t.value} ${N.NUTRIENT[t.key].unit}/day, weight ${t.weight})`);
  return `Higher priority: ${hi.join(', ')}. Keep lower: ${lo.join(', ')}. Also: adequate healthy fats, variety, micronutrient coverage. No calorie ceiling and do not optimise for weight loss.`;
}

// ---------------- target bars (used on Today too) ----------------
export function targetBars(totals, targets, missing = {}) {
  const shown = targets.filter(t => t.show);
  if (!shown.length) return '';
  return N.progress(totals, shown)
    .map(p => {
      const n = N.NUTRIENT[p.key];
      const v = p.current;
      const statusTxt = p.kind === 'min' ? (p.status === 'met' ? 'met' : `${f0(Math.max(0, p.value - (v || 0)))} ${n.unit} to go`) : p.status === 'over' ? 'over limit' : `limit ${p.value.toLocaleString('en-AU')}`;
      const color = p.kind === 'max' && p.status === 'over' ? 'var(--bad)' : nutColor(p.key);
      return `<div class="nut-row"><div class="row" style="gap:7px"><span class="dot" style="background:${nutColor(p.key)}"></span><b style="font-size:14.5px">${n.label}</b>${missing[p.key] ? `<span class="tiny muted">(${missing[p.key]} item${missing[p.key] > 1 ? 's' : ''} unknown)</span>` : ''}</div><div class="v num">${v == null ? '—' : N.fmt(p.key, v)} <span class="muted">/ ${p.value.toLocaleString('en-AU')} ${n.unit}</span></div>${bar(p.pct, color, { limit: p.kind === 'max' })}<div class="tiny muted" style="grid-column:1/-1">${statusTxt}</div></div>`;
    })
    .join('');
}

// ---------------- Nutrition tab ----------------
export async function render() {
  const sub = state.sub.nutrition;
  const seg = `<div class="seg-wrap"><div class="seg">${['diary', 'recipes', 'foods'].map(k => `<button class="${sub === k ? 'on' : ''}" data-act="nut-sub" data-v="${k}">${{ diary: 'Diary', recipes: 'Recipes', foods: 'Foods' }[k]}</button>`).join('')}</div></div>`;
  const head = `<div class="page-head"><div class="eyebrow">Nutrition</div><h1 class="title">${{ diary: 'Food diary', recipes: 'Recipes', foods: 'Food database' }[sub]}</h1></div>`;
  let body = '';
  if (sub === 'diary') body = await renderDiary();
  else if (sub === 'recipes') body = await renderRecipes();
  else body = await renderFoods();
  return head + seg + body;
}

async function renderDiary() {
  const s = await core.getSettings();
  const date = state.date;
  const entries = await db.byDate('entries', date);
  const d = N.dayTotals(entries);
  const score = N.priorityScore(d.totals, s.targets);
  const afcdCount = (await foods()).filter(f => f.source === 'afcd').length;
  let html = `<div class="date-nav"><button class="icon-btn" data-act="date-shift" data-v="-1" aria-label="Previous day">${icon('chevL')}</button><label class="lbl" style="position:relative">${core.relDay(date)}<input type="date" value="${date}" data-chg="date-set" style="position:absolute;inset:0;opacity:0"></label><button class="icon-btn" data-act="date-shift" data-v="1" aria-label="Next day">${icon('chevR')}</button></div>`;
  if (!afcdCount) html += `<div class="notice warn" style="margin-bottom:12px"><b>Food database is empty.</b> Import the free AFCD data once so calculations use verified Australian values. <button class="link" data-act="afcd-import">Import AFCD →</button></div>`;
  html += `<div class="card"><div class="row between"><div><div class="eyebrow">Energy</div><div class="big-num num">${f0(d.totals.kcal)}<span class="muted" style="font-size:16px;font-weight:600"> kcal</span></div></div>${score != null ? `<div class="center"><div class="eyebrow">Priority score</div><div class="num bold" style="font-size:26px">${score}</div></div>` : ''}</div>
  <div class="macro-strip" style="margin:14px 0 16px">${['protein', 'carbs', 'fat', 'fibre'].map(k => `<div class="stat"><div class="k">${N.NUTRIENT[k].label.replace('Carbohydrates', 'Carbs').replace('Total fat', 'Fat')}</div><div class="v num">${f1(d.totals[k])}<span class="muted" style="font-size:12px"> g</span></div></div>`).join('')}</div>
  ${targetBars(d.totals, s.targets, d.missing)}
  <details style="margin-top:14px"><summary class="link" style="list-style:none;cursor:pointer">All nutrients</summary><div class="kv" style="margin-top:10px">${N.NUTRIENTS.map(n => `<span>${n.label}</span><span>${N.fmt(n.key, d.totals[n.key])} ${d.totals[n.key] == null ? '' : n.unit}${d.missing[n.key] && d.totals[n.key] != null ? ' +?' : ''}</span>`).join('')}</div><p class="tiny muted">“+?” means some items had no value for that nutrient in the database, so the real total is higher.</p></details></div>`;
  for (const slot of core.DIARY_SLOTS) {
    const list = entries.filter(e => e.slot === slot.id).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    const st = N.dayTotals(list).totals;
    html += `<div class="section-label row between"><span>${slot.name}${list.length ? ` · <span class="num">${f0(st.kcal)}</span> kcal` : ''}</span><button class="icon-btn" data-act="log-open" data-slot="${slot.id}" aria-label="Add to ${slot.name}">${icon('plus')}</button></div>`;
    if (list.length) html += `<div class="card" style="padding:4px 14px"><div class="list">${list.map(entryRow).join('')}</div></div>`;
  }
  return html;
}

export function entryRow(e) {
  const t = N.entryTotals(e).totals;
  return `<div class="li tap" data-act="entry-open" data-id="${e.id}">${e.photo ? `<img class="thumb" src="${e.photo}" alt="">` : `<div class="thumb">${initials(e.name)}</div>`}<div class="main"><div class="t ellipsis">${esc(e.name)}</div><div class="s">${f0(t.kcal)} kcal · ${f1(t.protein)} g protein · ${f1(t.fibre)} g fibre</div></div>${e.confidence != null ? confBadge(e.confidence) : ''}</div>`;
}

// ---------------- logging flows ----------------
export function openLog(date = state.date, slot = core.defaultSlotForNow()) {
  const s = sheet({
    title: `Log food`,
    body: `<label class="field" style="margin-bottom:14px"><span>Meal</span><select class="input" id="log-slot">${core.DIARY_SLOTS.map(x => `<option value="${x.id}" ${x.id === slot ? 'selected' : ''}>${x.name}</option>`).join('')}</select></label>
    <div class="big-actions">
      <label class="big-action">${icon('camera')}<b>Photo</b><small>Take or choose a photo; AI identifies foods and portions</small><input type="file" accept="image/*" id="log-photo"></label>
      <button class="big-action" data-x="describe">${icon('pen')}<b>Describe</b><small>“2 eggs on sourdough with avocado”</small></button>
      <button class="big-action" data-x="search">${icon('search')}<b>Search</b><small>Pick from the food database</small></button>
      <button class="big-action" data-x="recipe">${icon('book')}<b>Recipe</b><small>From your library</small></button>
      <button class="big-action" data-x="quick">${icon('bolt')}<b>Quick add</b><small>Type nutrition totals</small></button>
      <label class="big-action">${icon('label')}<b>Scan label</b><small>Add a branded product from its nutrition panel</small><input type="file" accept="image/*" id="log-label"></label>
    </div>`,
  });
  const slotOf = () => s.body.querySelector('#log-slot').value;
  s.body.querySelector('#log-photo').onchange = e => {
    const f = e.target.files[0];
    if (f) {
      s.close();
      photoFlow(f, date, slotOf());
    }
  };
  s.body.querySelector('#log-label').onchange = e => {
    const f = e.target.files[0];
    if (f) {
      s.close();
      labelFlow(f, food => reviewSheet(draftFromFood(food, date, slotOf())));
    }
  };
  s.body.querySelectorAll('[data-x]').forEach(b => (b.onclick = () => {
    const x = b.dataset.x;
    const sl = slotOf();
    s.close();
    if (x === 'describe') describeFlow(date, sl);
    if (x === 'search') searchSheet(food => reviewSheet(draftFromFood(food, date, sl)));
    if (x === 'recipe') recipePicker(r => reviewSheet(draftFromRecipe(r, date, sl, 1)));
    if (x === 'quick') quickAdd(date, sl);
  }));
}

function loadingHtml(msg) {
  return `<div class="loading-block"><span class="spinner"></span><span>${esc(msg)}</span></div>`;
}

async function photoFlow(file, date, slot) {
  let img;
  try {
    img = await compressImage(file, 1280, 0.82);
  } catch (e) {
    return toast(e.message);
  }
  const s = sheet({
    title: 'Analyse photo',
    body: `<img class="photo-preview" src="${img.dataUrl}" alt=""><label class="field" style="margin-top:14px"><span>Anything the photo can't show? (optional)</span><textarea class="input" id="ph-note" placeholder="e.g. cooked in 1 tbsp olive oil, 200 g chicken"></textarea></label><p class="tiny muted">AI identifies foods and estimates portions. Nutrition is then calculated from your database — never from the AI.</p>`,
    foot: `<button class="btn primary" id="ph-go">${icon('sparkle')} Analyse</button>`,
  });
  s.foot.querySelector('#ph-go').onclick = async () => {
    const note = s.body.querySelector('#ph-note').value.trim();
    s.setBody(loadingHtml('Identifying foods and portions…'));
    s.setFoot('');
    try {
      const r = await api.ai('photo', { image: { mime: img.mime, data: img.base64 }, text: note });
      const thumb = await thumbFromDataUrl(img.dataUrl, 420);
      s.close();
      reviewSheet(await draftFromAi(r.data, { date, slot, photo: thumb, source: 'photo', note }));
    } catch (e) {
      s.setBody(`<div class="notice bad">${esc(e.message)}</div><img class="photo-preview" style="margin-top:12px" src="${img.dataUrl}" alt="">`);
      s.setFoot(`<button class="btn" id="ph-manual">Log manually instead</button>`);
      s.foot.querySelector('#ph-manual').onclick = async () => {
        const thumb = await thumbFromDataUrl(img.dataUrl, 420);
        s.close();
        reviewSheet({ date, slot, name: 'Meal', photo: thumb, source: 'photo', items: [] });
      };
    }
  };
}

function describeFlow(date, slot) {
  const s = sheet({
    title: 'Describe your meal',
    body: `<textarea class="input" id="ds-text" style="min-height:130px" placeholder="e.g. Chicken burrito bowl: 150 g grilled chicken, 1 cup rice, black beans, salsa, a little cheese"></textarea><p class="tiny muted">Quantities you type are used exactly. Anything vague is estimated and marked.</p>`,
    foot: `<button class="btn primary" id="ds-go">${icon('sparkle')} Analyse</button>`,
  });
  setTimeout(() => s.body.querySelector('#ds-text').focus(), 300);
  s.foot.querySelector('#ds-go').onclick = async () => {
    const text = s.body.querySelector('#ds-text').value.trim();
    if (!text) return;
    s.setBody(loadingHtml('Breaking it into foods…'));
    s.setFoot('');
    try {
      const r = await api.ai('text', { text });
      s.close();
      reviewSheet(await draftFromAi(r.data, { date, slot, source: 'text', note: text }));
    } catch (e) {
      s.setBody(`<div class="notice bad">${esc(e.message)}</div>`);
    }
  };
}

async function draftFromAi(data, { date, slot, photo, source, note }) {
  const all = await foods();
  const items = (data.items || []).map((it, i) => {
    const cands = N.matchAiItem(it, all, 6);
    const best = cands[0];
    const item = {
      key: 'i' + i + Date.now(),
      kind: 'food',
      aiName: it.name,
      name: it.name,
      grams: Math.max(1, Math.round(N.num(it.grams) || 100)),
      low: N.num(it.grams_low),
      high: N.num(it.grams_high),
      confidence: N.num(it.confidence),
      state: it.state,
      method: it.method,
      notes: it.notes,
      candidates: cands.map(c => ({ id: c.food.id, score: c.score })),
    };
    if (best && best.score >= 0.45) setFood(item, best.food, best.score);
    return item;
  });
  const confs = items.map(i => i.confidence).filter(c => c != null);
  return {
    date,
    slot,
    photo,
    source,
    note,
    name: data.meal_name || 'Meal',
    confidence: N.num(data.overall_confidence) ?? (confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length : null),
    caveats: [...(data.caveats || []), data.scale_reference ? `Scale reference: ${data.scale_reference}` : null].filter(Boolean),
    items,
  };
}

function setFood(item, food, score = null) {
  item.foodId = food.id;
  item.foodName = food.name;
  item.per100 = food.per100;
  item.source = food.source;
  item.matchScore = score;
  if (!item.aiName) item.name = food.name;
  if (item.candidates && !item.candidates.some(c => c.id === food.id)) item.candidates.unshift({ id: food.id, score: score ?? 1 });
}

export function draftFromFood(food, date, slot) {
  const item = { key: 'f' + Date.now(), kind: 'food', name: food.name, grams: food.servingG || 100, candidates: [{ id: food.id, score: 1 }] };
  setFood(item, food, 1);
  return { date, slot, name: food.brand ? `${food.brand} ${food.name}` : food.name, source: 'manual', items: [item] };
}
function draftFromRecipe(r, date, slot, servings = 1) {
  return { date, slot, name: r.name, source: 'recipe', photo: r.photo || null, items: [recipeItem(r, servings)] };
}
function recipeItem(r, servings) {
  return { key: 'r' + Date.now(), kind: 'recipe', name: r.name, recipeId: r.id, servings, perServing: r.perServing || N.recipeNutrition(r).perServing, source: 'recipe' };
}

function itemTotals(items) {
  return N.sumNutrients(items.filter(i => !i.excluded).map(N.itemNutrients));
}

// ---------------- review / edit sheet ----------------
export async function reviewSheet(draft, { entry } = {}) {
  const all = await foods();
  const byId = new Map(all.map(f => [f.id, f]));
  const s = sheet({ title: entry ? 'Edit meal' : 'Review & save', body: '', foot: '' });
  const itemHtml = it => {
    let ctrl = '';
    if (it.kind === 'food') {
      const opts = (it.candidates || [])
        .map(c => byId.get(c.id))
        .filter(Boolean)
        .map(f => `<option value="${esc(f.id)}" ${f.id === it.foodId ? 'selected' : ''}>${esc(f.name)}${f.brand ? ' · ' + esc(f.brand) : ''} (${SOURCE_LABEL[f.source] || f.source})</option>`)
        .join('');
      const weak = it.foodId && it.matchScore != null && it.matchScore < 0.7;
      ctrl = `<select class="input sm" data-k="${it.key}" data-role="pick" style="margin-top:8px">${it.foodId ? '' : '<option value="" selected>— No database match (not counted) —</option>'}${opts}<option disabled>──────────</option><option value="__search">Search database…</option><option value="__estimate">Use AI estimate (unverified)…</option>${it.foodId ? '<option value="">Remove match (not counted)</option>' : ''}</select>
      ${weak ? `<div class="tiny" style="color:var(--warn);margin-top:4px">Weak match — check this is the right food and state (raw/cooked).</div>` : ''}
      <div class="row between" style="margin-top:10px"><span class="small ink2">Weight${it.low && it.high ? ` <span class="muted">· est. ${Math.round(it.low)}–${Math.round(it.high)} g</span>` : ''}</span><div class="stepper"><button class="icon-btn" data-k="${it.key}" data-role="dec">${icon('minus')}</button><input class="input sm num" type="number" inputmode="decimal" value="${it.grams}" data-k="${it.key}" data-role="grams"><span class="small muted">g</span><button class="icon-btn" data-k="${it.key}" data-role="inc">${icon('plus')}</button></div></div>`;
    } else if (it.kind === 'recipe') {
      ctrl = `<div class="row between" style="margin-top:10px"><span class="small ink2">Servings</span><div class="stepper"><button class="icon-btn" data-k="${it.key}" data-role="dec">${icon('minus')}</button><input class="input sm num" type="number" inputmode="decimal" step="0.25" value="${it.servings}" data-k="${it.key}" data-role="servings"><button class="icon-btn" data-k="${it.key}" data-role="inc">${icon('plus')}</button></div></div>`;
    } else {
      ctrl = `<div class="small muted" style="margin-top:6px">Manual values</div>`;
    }
    const flag = it.kind === 'food' && !it.foodId;
    return `<div class="item-card ${flag ? 'flag' : ''}" data-card="${it.key}"><div class="row between" style="align-items:flex-start"><div class="grow"><div class="h3">${esc(it.aiName || it.name)}</div>${it.method || it.notes ? `<div class="tiny muted">${esc([it.method, it.notes].filter(Boolean).join(' · '))}</div>` : ''}</div><div class="row" style="gap:6px">${it.confidence != null ? confBadge(it.confidence) : ''}${it.source ? srcBadge(it.source) : ''}<button class="icon-btn" data-k="${it.key}" data-role="rm" aria-label="Remove">${icon('x')}</button></div></div>${ctrl}<div class="tiny muted" style="margin-top:8px" data-nut="${it.key}">${nutLine(N.itemNutrients(it))}</div></div>`;
  };
  const totalsHtml = () => {
    const t = itemTotals(draft.items);
    const unmatched = draft.items.filter(i => i.kind === 'food' && !i.foodId).length;
    return `<div class="row between"><div><div class="eyebrow">Total</div><div class="num bold" style="font-size:22px">${f0(t.totals.kcal)} kcal</div></div><div class="small ink2 num" style="text-align:right">P ${f1(t.totals.protein)} g · Fibre ${f1(t.totals.fibre)} g<br>Na ${f0(t.totals.sodium)} mg · Sat ${f1(t.totals.satfat)} g</div></div>${unmatched ? `<div class="tiny" style="color:var(--warn);margin-top:6px">${unmatched} item${unmatched > 1 ? 's are' : ' is'} not matched and not counted.</div>` : ''}`;
  };
  const paint = () => {
    s.setBody(`${draft.photo ? `<img class="photo-preview" src="${draft.photo}" alt="" style="margin-bottom:12px">` : ''}
      ${draft.caveats && draft.caveats.length ? `<div class="notice warn small" style="margin-bottom:12px"><b>Estimates — check before saving.</b> ${draft.caveats.map(esc).join(' · ')}</div>` : draft.source === 'photo' || draft.source === 'text' ? `<div class="notice warn small" style="margin-bottom:12px"><b>Portions are AI estimates.</b> A photo can't give exact weights — adjust grams if you know better.</div>` : ''}
      <div class="fields"><label class="field"><span>Name</span><input class="input" id="rv-name" value="${esc(draft.name)}"></label>
      <div class="fields two"><label class="field"><span>Date</span><input class="input" type="date" id="rv-date" value="${draft.date}"></label><label class="field"><span>Meal</span><select class="input" id="rv-slot">${core.DIARY_SLOTS.map(x => `<option value="${x.id}" ${x.id === draft.slot ? 'selected' : ''}>${x.name}</option>`).join('')}</select></label></div></div>
      <div class="section-label row between" style="margin-left:2px"><span>Items</span><span class="row" style="gap:6px"><button class="btn sm" id="rv-add">${icon('search')} Food</button><button class="btn sm" id="rv-addq">${icon('bolt')} Manual</button></span></div>
      <div id="rv-items">${draft.items.length ? draft.items.map(itemHtml).join('') : '<div class="empty">No items yet. Add a food from the database.</div>'}</div>
      ${entry ? `<div class="row" style="margin-top:18px;gap:8px"><button class="btn sm" id="rv-dup">${icon('copy')} Duplicate</button><button class="btn sm" id="rv-move">Move</button><button class="btn sm danger" id="rv-del">${icon('trash')} Delete</button></div>` : ''}`);
    s.setFoot(`<div class="grow" id="rv-totals">${totalsHtml()}</div><button class="btn primary" style="flex:none" id="rv-save">Save</button>`);
    wire();
  };
  const refreshItem = it => {
    const el = s.body.querySelector(`[data-nut="${it.key}"]`);
    if (el) el.textContent = nutLine(N.itemNutrients(it));
    s.foot.querySelector('#rv-totals').innerHTML = totalsHtml();
  };
  const find = k => draft.items.find(i => i.key === k);
  const readHeader = () => {
    draft.name = s.body.querySelector('#rv-name').value.trim() || draft.name;
    draft.date = s.body.querySelector('#rv-date').value || draft.date;
    draft.slot = s.body.querySelector('#rv-slot').value;
  };
  const wire = () => {
    s.body.querySelectorAll('[data-role]').forEach(el => {
      const it = find(el.dataset.k);
      if (!it) return;
      const role = el.dataset.role;
      if (role === 'grams' || role === 'servings') {
        el.oninput = () => {
          const v = N.num(el.value);
          if (v != null && v >= 0) it[role] = v;
          refreshItem(it);
        };
      } else if (role === 'inc' || role === 'dec') {
        el.onclick = () => {
          const sign = role === 'inc' ? 1 : -1;
          if (it.kind === 'recipe') it.servings = Math.max(0.25, Math.round(((Number(it.servings) || 1) + sign * 0.25) * 100) / 100);
          else it.grams = Math.max(0, Math.round((Number(it.grams) || 0) + sign * (it.grams >= 200 ? 25 : 10)));
          const inp = s.body.querySelector(`[data-k="${it.key}"][data-role="${it.kind === 'recipe' ? 'servings' : 'grams'}"]`);
          inp.value = it.kind === 'recipe' ? it.servings : it.grams;
          refreshItem(it);
        };
      } else if (role === 'rm') {
        el.onclick = () => {
          readHeader();
          draft.items = draft.items.filter(x => x !== it);
          paint();
        };
      } else if (role === 'pick') {
        el.onchange = async () => {
          readHeader();
          const v = el.value;
          if (v === '__search') {
            searchSheet(food => {
              setFood(it, food, 1);
              paint();
            }, it.aiName || it.name);
            paint();
          } else if (v === '__estimate') {
            const food = await estimateFood(it.aiName || it.name);
            if (food) {
              setFood(it, food, null);
              byId.set(food.id, food);
            }
            paint();
          } else if (!v) {
            it.foodId = null;
            it.per100 = null;
            it.source = null;
            paint();
          } else {
            const f = byId.get(v);
            if (f) setFood(it, f, (it.candidates.find(c => c.id === v) || {}).score ?? 1);
            paint();
          }
        };
      }
    });
    s.body.querySelector('#rv-add').onclick = () => {
      readHeader();
      searchSheet(food => {
        const item = { key: 'f' + Date.now(), kind: 'food', name: food.name, grams: food.servingG || 100, candidates: [] };
        setFood(item, food, 1);
        draft.items.push(item);
        paint();
      });
    };
    s.body.querySelector('#rv-addq').onclick = () => {
      readHeader();
      quickValuesSheet(vals => {
        draft.items.push({ key: 'q' + Date.now(), kind: 'quick', name: vals.name || 'Manual item', absolute: vals, source: 'quick' });
        paint();
      });
    };
    s.foot.querySelector('#rv-save').onclick = async () => {
      readHeader();
      if (!draft.items.length) return toast('Add at least one item');
      const obj = {
        ...(entry || {}),
        date: draft.date,
        slot: draft.slot,
        name: draft.name,
        photo: draft.photo || null,
        source: draft.source || 'manual',
        confidence: draft.confidence ?? null,
        note: draft.note || null,
        items: draft.items.map(({ candidates, ...rest }) => rest),
        createdAt: entry ? entry.createdAt : Date.now(),
      };
      await db.put('entries', obj);
      for (const it of draft.items) {
        if (!it.foodId) continue;
        const f = byId.get(it.foodId);
        if (f && f.source !== 'afcd') {
          f.uses = (f.uses || 0) + 1;
          await db.put('foods', f, { silent: true });
        } else if (f) {
          const u = (await db.kvGet('cache:uses', {})) || {};
          u[f.id] = (u[f.id] || 0) + 1;
          f.uses = u[f.id];
          await db.kvSet('cache:uses', u, { silent: true });
        }
      }
      s.close();
      toast(`Saved to ${core.slotName(obj.slot)}${obj.date !== core.today() ? ' · ' + core.relDay(obj.date) : ''}`);
    };
    if (entry) {
      s.body.querySelector('#rv-del').onclick = async () => {
        if (await confirmSheet(`Delete “${entry.name}”?`, { ok: 'Delete', danger: true })) {
          await db.del('entries', entry.id);
          s.close();
          toast('Deleted', { action: 'Undo', onAction: () => db.put('entries', entry) });
        }
      };
      s.body.querySelector('#rv-dup').onclick = () => moveOrCopy(entry, true, s);
      s.body.querySelector('#rv-move').onclick = () => moveOrCopy(entry, false, s);
    }
  };
  paint();
}

function moveOrCopy(entry, copy, parent) {
  const s = sheet({
    title: copy ? 'Duplicate to…' : 'Move to…',
    body: `<div class="fields two"><label class="field"><span>Date</span><input class="input" type="date" id="mv-date" value="${copy ? core.today() : entry.date}"></label><label class="field"><span>Meal</span><select class="input" id="mv-slot">${core.DIARY_SLOTS.map(x => `<option value="${x.id}" ${x.id === entry.slot ? 'selected' : ''}>${x.name}</option>`).join('')}</select></label></div>`,
    foot: `<button class="btn primary" id="mv-go">${copy ? 'Duplicate' : 'Move'}</button>`,
  });
  s.foot.querySelector('#mv-go').onclick = async () => {
    const date = s.body.querySelector('#mv-date').value;
    const slot = s.body.querySelector('#mv-slot').value;
    if (copy) await db.put('entries', { ...structuredClone(entry), id: undefined, date, slot, createdAt: Date.now() });
    else await db.put('entries', { ...entry, date, slot });
    s.close();
    parent.close();
    toast(copy ? 'Duplicated' : 'Moved');
  };
}

async function estimateFood(name) {
  const ok = await confirmSheet(`No verified data for “${name}”. Ask AI for typical values per 100 g? It will be saved as an UNVERIFIED food and clearly labelled.`, { ok: 'Use AI estimate' });
  if (!ok) return null;
  try {
    toast('Estimating…');
    const r = await api.ai('estimate', { text: name });
    const p = r.data.per100 || {};
    const food = { name, source: 'ai-estimate', per100: N.normalisePer100(p), note: r.data.basis || '', confidence: N.num(r.data.confidence) };
    await db.put('foods', food);
    return food;
  } catch (e) {
    toast(e.message);
    return null;
  }
}

// ---------------- search ----------------
export async function searchSheet(onPick, initial = '') {
  const all = await foods();
  const uses = (await db.kvGet('cache:uses', {})) || {};
  for (const f of all) if (f.source === 'afcd' && uses[f.id]) f.uses = uses[f.id];
  const s = sheet({
    title: 'Find a food',
    body: `<input class="input" id="fs-q" type="search" placeholder="e.g. chicken breast grilled" value="${esc(initial)}" autocomplete="off">
    <div class="row" style="margin:10px 0 2px;gap:8px"><button class="btn sm" id="fs-new">${icon('plus')} Custom food</button><label class="btn sm" style="position:relative">${icon('label')} Scan label<input type="file" accept="image/*" id="fs-label" style="position:absolute;inset:0;opacity:0"></label></div>
    <div class="list" id="fs-res"></div>`,
  });
  const res = s.body.querySelector('#fs-res');
  const run = () => {
    const q = s.body.querySelector('#fs-q').value.trim();
    let list;
    if (!q) list = all.filter(f => f.uses || f.source !== 'afcd').sort((a, b) => (b.uses || 0) - (a.uses || 0)).slice(0, 25).map(food => ({ food }));
    else list = N.matchFoods(q, all, { limit: 40 });
    if (!all.length) res.innerHTML = `<div class="empty"><b>No foods yet</b>Import AFCD in Settings → Data, or create a custom food.</div>`;
    else if (!list.length) res.innerHTML = `<div class="empty">${q ? 'No matches. Try fewer words, or create a custom food.' : 'Start typing to search.'}</div>`;
    else res.innerHTML = list.map(({ food: f }) => `<div class="li tap" data-id="${esc(f.id)}"><div class="main"><div class="t">${esc(f.name)}${f.brand ? ` <span class="muted">· ${esc(f.brand)}</span>` : ''}</div><div class="s">${f0(f.per100.kcal)} kcal · P ${f1(f.per100.protein)} g per 100 g</div></div>${srcBadge(f.source)}</div>`).join('');
    res.querySelectorAll('[data-id]').forEach(el => (el.onclick = () => {
      const f = all.find(x => x.id === el.dataset.id);
      s.close();
      onPick(f);
    }));
  };
  s.body.querySelector('#fs-q').oninput = debounce(run, 120);
  s.body.querySelector('#fs-new').onclick = () => {
    s.close();
    foodEditor({ name: s.body.querySelector('#fs-q').value.trim() }, onPick);
  };
  s.body.querySelector('#fs-label').onchange = e => {
    const f = e.target.files[0];
    if (f) {
      s.close();
      labelFlow(f, onPick);
    }
  };
  run();
  setTimeout(() => s.body.querySelector('#fs-q').focus(), 300);
}

// ---------------- quick add ----------------
const QUICK_FIELDS = ['kcal', 'protein', 'carbs', 'fat', 'satfat', 'fibre', 'sugars', 'addedSugars', 'sodium'];
function quickValuesSheet(onDone, title = 'Manual nutrition') {
  const s = sheet({
    title,
    body: `<label class="field"><span>Name</span><input class="input" id="qa-name" placeholder="e.g. Café banana bread"></label><div class="fields two" style="margin-top:12px">${QUICK_FIELDS.map(k => `<label class="field"><span>${N.NUTRIENT[k].label} (${N.NUTRIENT[k].unit})</span><input class="input num" type="number" inputmode="decimal" data-q="${k}"></label>`).join('')}</div><p class="tiny muted">Leave blank if unknown — blanks are treated as unknown, not zero.</p>`,
    foot: `<button class="btn primary" id="qa-go">Add</button>`,
  });
  s.foot.querySelector('#qa-go').onclick = () => {
    const vals = { name: s.body.querySelector('#qa-name').value.trim() };
    s.body.querySelectorAll('[data-q]').forEach(i => (vals[i.dataset.q] = N.num(i.value)));
    if (vals.kcal == null && vals.protein == null) return toast('Enter at least calories or protein');
    s.close();
    onDone(vals);
  };
}
function quickAdd(date, slot) {
  quickValuesSheet(async vals => {
    await db.put('entries', { date, slot, name: vals.name || 'Quick add', source: 'quick', items: [{ key: 'q', kind: 'quick', name: vals.name || 'Quick add', absolute: vals, source: 'quick' }], createdAt: Date.now() });
    toast(`Saved to ${core.slotName(slot)}`);
  }, 'Quick add');
}

// ---------------- custom foods & labels ----------------
export function foodEditor(food = {}, onSaved, { notice = '' } = {}) {
  const p = food.per100 || {};
  const isNew = !food.id;
  const s = sheet({
    title: isNew ? 'New food' : 'Edit food',
    body: `${notice}<div class="fields"><label class="field"><span>Name</span><input class="input" id="fe-name" value="${esc(food.name || '')}" placeholder="e.g. Greek yoghurt, plain"></label><div class="fields two"><label class="field"><span>Brand</span><input class="input" id="fe-brand" value="${esc(food.brand || '')}"></label><label class="field"><span>Usual serving (g)</span><input class="input num" type="number" inputmode="decimal" id="fe-serv" value="${food.servingG ?? ''}"></label></div></div>
    <div class="section-label">Per 100 g</div><div class="fields two">${N.NUTRIENTS.filter(n => n.main).map(n => `<label class="field"><span>${n.label} (${n.unit})</span><input class="input num" type="number" inputmode="decimal" data-p="${n.key}" value="${p[n.key] != null ? N.round(p[n.key], 2) : ''}"></label>`).join('')}</div>
    <details style="margin-top:12px"><summary class="link">Vitamins & minerals</summary><div class="fields two" style="margin-top:10px">${N.NUTRIENTS.filter(n => !n.main).map(n => `<label class="field"><span>${n.label} (${n.unit})</span><input class="input num" type="number" inputmode="decimal" data-p="${n.key}" value="${p[n.key] != null ? N.round(p[n.key], 2) : ''}"></label>`).join('')}</div></details>`,
    foot: `${!isNew ? `<button class="btn danger" id="fe-del">Delete</button>` : ''}<button class="btn primary" id="fe-save">Save food</button>`,
  });
  s.foot.querySelector('#fe-save').onclick = async () => {
    const name = s.body.querySelector('#fe-name').value.trim();
    if (!name) return toast('Name required');
    const per100 = N.emptyNutrients();
    s.body.querySelectorAll('[data-p]').forEach(i => (per100[i.dataset.p] = N.num(i.value)));
    const obj = { ...food, name, brand: s.body.querySelector('#fe-brand').value.trim(), servingG: N.num(s.body.querySelector('#fe-serv').value), per100, source: food.source && food.source !== 'afcd' ? food.source : 'custom' };
    if (food.source === 'afcd') {
      delete obj.id;
      delete obj.afcdKey;
    }
    await db.put('foods', obj);
    s.close();
    toast('Food saved');
    onSaved && onSaved(obj);
  };
  if (!isNew)
    s.foot.querySelector('#fe-del').onclick = async () => {
      if (await confirmSheet(`Delete ${food.name}? Past diary entries keep their numbers.`, { ok: 'Delete', danger: true })) {
        await db.del('foods', food.id);
        s.close();
      }
    };
}

async function labelFlow(file, onSaved) {
  const img = await compressImage(file, 1600, 0.85);
  const s = sheet({ title: 'Reading label', body: `<img class="photo-preview" src="${img.dataUrl}" alt="">${loadingHtml('Reading the nutrition panel…')}` });
  try {
    const r = await api.ai('label', { image: { mime: img.mime, data: img.base64 } });
    const d = r.data || {};
    const p = d.per100 || {};
    const per100 = N.normalisePer100({ kj: p.energy_kj, protein: p.protein, fat: p.fat_total, satfat: p.fat_saturated, carbs: p.carbohydrate, sugars: p.sugars, fibre: p.dietary_fibre, sodium: p.sodium_mg });
    s.close();
    const unread = (d.unreadable || []).length ? ` Couldn't read: ${d.unreadable.map(esc).join(', ')}.` : '';
    foodEditor({ name: d.product_name || '', brand: d.brand || '', servingG: N.num(d.serving_size), per100, source: 'label' }, onSaved, { notice: `<div class="notice warn small" style="margin-bottom:12px"><b>Check every number against the label before saving.</b>${unread}${d.basis === 'mL' ? ' Values are per 100 mL.' : ''}</div>` });
  } catch (e) {
    s.setBody(`<div class="notice bad">${esc(e.message)}</div>`);
  }
}

// ---------------- Foods tab ----------------
async function renderFoods() {
  const all = await foods();
  const q = state.foodQuery;
  const counts = all.reduce((a, f) => ((a[f.source] = (a[f.source] || 0) + 1), a), {});
  const list = q ? N.matchFoods(q, all, { limit: 60 }).map(x => x.food) : all.filter(f => f.source !== 'afcd').sort((a, b) => a.name.localeCompare(b.name));
  return `<div class="card"><div class="row between"><div><div class="h3">${all.length.toLocaleString('en-AU')} foods</div><div class="small muted">${counts.afcd || 0} AFCD · ${(counts.custom || 0) + (counts.label || 0)} yours · ${counts['ai-estimate'] || 0} unverified</div></div><button class="btn sm" data-act="afcd-import">${counts.afcd ? 'Re-import' : 'Import'} AFCD</button></div>
  <div class="row" style="margin-top:12px;gap:8px"><button class="btn sm" data-act="food-new">${icon('plus')} Custom food</button><label class="btn sm" style="position:relative">${icon('label')} Scan label<input type="file" accept="image/*" data-chg="food-label" style="position:absolute;inset:0;opacity:0"></label></div></div>
  <div style="margin:14px 0 8px"><input class="input" type="search" placeholder="Search all foods" value="${esc(q)}" data-input="food-q"></div>
  <div class="card" style="padding:4px 14px"><div class="list">${list.length ? list.map(f => `<div class="li tap" data-act="food-open" data-id="${esc(f.id)}"><div class="main"><div class="t">${esc(f.name)}${f.brand ? ` <span class="muted">· ${esc(f.brand)}</span>` : ''}</div><div class="s">${f0(f.per100.kcal)} kcal · P ${f1(f.per100.protein)} · Fibre ${f1(f.per100.fibre)} · Na ${f0(f.per100.sodium)} mg</div></div>${srcBadge(f.source)}</div>`).join('') : `<div class="empty">${q ? 'No matches.' : 'Your custom and label-scanned foods appear here. Search to browse AFCD.'}</div>`}</div></div>`;
}

function foodDetail(f) {
  if (f.source !== 'afcd') return foodEditor(f);
  const s = sheet({
    title: esc(f.name),
    body: `<div class="row" style="gap:6px;margin-bottom:12px">${srcBadge('afcd')}<span class="small muted">FSANZ key ${esc(f.afcdKey || '')} · per 100 g</span></div><div class="card"><div class="kv">${N.NUTRIENTS.map(n => `<span>${n.label}</span><span>${N.fmt(n.key, f.per100[n.key])} ${f.per100[n.key] == null ? '' : n.unit}</span>`).join('')}</div></div><p class="tiny muted">Source: Food Standards Australia New Zealand, Australian Food Composition Database. Blank (—) means FSANZ has no value, not zero.</p>`,
    foot: `<button class="btn" id="fd-copy">Copy as custom</button><button class="btn primary" id="fd-log">Log this</button>`,
  });
  s.foot.querySelector('#fd-copy').onclick = () => {
    s.close();
    foodEditor({ ...f, name: f.name + ' (custom)' });
  };
  s.foot.querySelector('#fd-log').onclick = () => {
    s.close();
    reviewSheet(draftFromFood(f, state.date, core.defaultSlotForNow()));
  };
}

// ---------------- AFCD import ----------------
let xlsxLoading = null;
function loadXlsx() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  if (!xlsxLoading)
    xlsxLoading = new Promise((res, rej) => {
      const sc = document.createElement('script');
      sc.src = './vendor/xlsx.mini.min.js';
      sc.onload = () => res(window.XLSX);
      sc.onerror = () => rej(new Error('Could not load the spreadsheet reader'));
      document.head.appendChild(sc);
    });
  return xlsxLoading;
}
export function afcdImport() {
  const s = sheet({
    title: 'Import AFCD',
    body: `<ol class="small ink2" style="padding-left:18px;margin-top:0">
      <li>In Safari, open <b>foodstandards.gov.au → Science & data → Food nutrient databases → AFCD → Download</b>.</li>
      <li>Download the <b>Nutrient profiles</b> Excel file (and <b>Food details</b> if offered). They save to Files.</li>
      <li>Tap below and pick the file(s). Everything stays on this phone.</li></ol>
      <label class="btn primary block" style="position:relative">${icon('book')} Choose AFCD Excel file(s)<input type="file" multiple accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" id="afcd-file" style="position:absolute;inset:0;opacity:0"></label>
      <div id="afcd-out" style="margin-top:14px"></div>`,
  });
  s.body.querySelector('#afcd-file').onchange = async e => {
    const files = [...e.target.files];
    if (!files.length) return;
    const out = s.body.querySelector('#afcd-out');
    out.innerHTML = loadingHtml('Reading spreadsheet…');
    try {
      const XLSX = await loadXlsx();
      const sheets = [];
      for (const f of files) {
        const wb = XLSX.read(new Uint8Array(await f.arrayBuffer()), { type: 'array' });
        for (const name of wb.SheetNames) sheets.push({ name: `${f.name} › ${name}`, rows: XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: null }) });
      }
      const { foods: list, report } = parseAfcd(sheets);
      if (!list.length) {
        out.innerHTML = `<div class="notice bad">${esc(report.message)}</div>`;
        return;
      }
      const old = await db.bySource('afcd');
      await db.delMany('foods', old.map(f => f.id).filter(id => !list.some(n => n.id === id)));
      await db.putMany('foods', list);
      out.innerHTML = `<div class="notice ${report.ok ? '' : 'warn'}"><b>${list.length.toLocaleString('en-AU')} foods imported</b> (${report.layout} layout). ${esc(report.message)}<div class="tiny muted" style="margin-top:6px">Nutrients recognised: ${report.mapped.map(k => (N.NUTRIENT[k] ? N.NUTRIENT[k].label : k === 'energyKj' ? 'Energy (kJ)' : k)).join(', ')}</div></div>`;
    } catch (err) {
      out.innerHTML = `<div class="notice bad">${esc(err.message)}</div>`;
    }
  };
}

// ---------------- Recipes ----------------
async function renderRecipes() {
  const all = await db.all('recipes');
  const f = state.recipeFilter;
  const q = state.recipeQuery.trim().toLowerCase();
  let list = all.filter(r => (f === 'all' ? true : f === 'fav' ? r.favourite : (r.meals || []).includes(f)));
  if (q) list = list.filter(r => [r.name, ...(r.categories || []), ...(r.ingredients || []).map(i => i.name)].join(' ').toLowerCase().includes(q));
  list.sort((a, b) => (b.favourite ? 1 : 0) - (a.favourite ? 1 : 0) || (b.rating || 0) - (a.rating || 0) || a.name.localeCompare(b.name));
  const chips = [['all', 'All'], ['fav', '♥ Favourites'], ['breakfast', 'Breakfast'], ['lunch', 'Lunch'], ['dinner', 'Dinner'], ['snack', 'Snack']];
  return `<div class="row" style="gap:8px;margin-bottom:10px"><input class="input grow" type="search" placeholder="Search recipes or ingredients" value="${esc(state.recipeQuery)}" data-input="recipe-q"><button class="btn primary" data-act="recipe-new">${icon('plus')} New</button></div>
  <div class="chips" style="margin-bottom:14px">${chips.map(([k, l]) => `<button class="chip ${f === k ? 'on' : ''}" data-act="recipe-filter" data-v="${k}">${l}</button>`).join('')}</div>
  ${list.length ? `<div class="grid2">${list.map(recipeCard).join('')}</div>` : `<div class="card empty"><b>${all.length ? 'Nothing matches' : 'No recipes yet'}</b>${all.length ? '' : 'Import from a link, TikTok or screenshot, generate one with AI, or type your own.'}</div>`}`;
}
function recipeCard(r) {
  const ps = r.perServing || N.recipeNutrition(r).perServing;
  return `<button class="card" style="padding:0;overflow:hidden;text-align:left" data-act="recipe-open" data-id="${r.id}">${r.photo ? `<img src="${r.photo}" alt="" style="width:100%;aspect-ratio:4/3;object-fit:cover">` : `<div class="hero-photo" style="aspect-ratio:4/3;border-radius:0;font-size:30px">${initials(r.name)}</div>`}<div style="padding:10px 12px 12px"><div class="h3" style="line-height:1.25">${r.favourite ? '♥ ' : ''}${esc(r.name)}</div><div class="tiny muted" style="margin-top:3px">${f0(ps.kcal)} kcal · ${f1(ps.protein)} g protein · ${f1(ps.fibre)} g fibre</div>${r.rating ? `<div class="tiny" style="color:#e6a91a;margin-top:2px">${'★'.repeat(r.rating)}</div>` : ''}</div></button>`;
}

function recipePicker(onPick) {
  db.all('recipes').then(all => {
    const s = sheet({ title: 'Choose a recipe', body: `<input class="input" type="search" id="rp-q" placeholder="Search"><div class="list" id="rp-list" style="margin-top:8px"></div>` });
    const paint = () => {
      const q = s.body.querySelector('#rp-q').value.toLowerCase();
      const list = all.filter(r => !q || r.name.toLowerCase().includes(q));
      s.body.querySelector('#rp-list').innerHTML = list.length ? list.map(r => `<div class="li tap" data-id="${r.id}">${r.photo ? `<img class="thumb" src="${r.photo}" alt="">` : `<div class="thumb">${initials(r.name)}</div>`}<div class="main"><div class="t">${esc(r.name)}</div><div class="s">${nutLine(r.perServing || N.recipeNutrition(r).perServing)} per serve</div></div></div>`).join('') : `<div class="empty">No recipes yet — add some in Nutrition → Recipes.</div>`;
      s.body.querySelectorAll('[data-id]').forEach(el => (el.onclick = () => {
        s.close();
        onPick(all.find(r => r.id === el.dataset.id));
      }));
    };
    s.body.querySelector('#rp-q').oninput = paint;
    paint();
  });
}

export async function recipeDraftFromAi(data, extra = {}) {
  const all = await foods();
  const ingredients = (data.ingredients || []).map((it, i) => {
    const cands = N.matchAiItem(it, all, 6);
    const ing = { key: 'g' + i + Date.now(), name: it.name, aiName: it.name, quantityText: it.quantity_text || '', grams: N.num(it.grams), gramsEstimate: !!it.grams_is_estimate, state: it.state, candidates: cands.map(c => ({ id: c.food.id, score: c.score })) };
    if (cands[0] && cands[0].score >= 0.45) setFood(ing, cands[0].food, cands[0].score);
    return ing;
  });
  return {
    name: data.name || 'Untitled recipe',
    servings: N.num(data.servings),
    prepMin: N.num(data.prep_minutes),
    cookMin: N.num(data.cook_minutes),
    meals: (data.meals || []).filter(m => ['breakfast', 'lunch', 'dinner', 'snack'].includes(m)),
    ingredients,
    steps: (data.steps || []).map(String),
    substitutions: data.substitutions || [],
    missing: data.missing || [],
    rating: 0,
    favourite: false,
    categories: [],
    ...extra,
  };
}

export async function recipeEditor(recipe, { title } = {}) {
  const all = await foods();
  const byId = new Map(all.map(f => [f.id, f]));
  const r = structuredClone(recipe);
  r.ingredients = (r.ingredients || []).map((g, i) => ({ key: g.key || 'g' + i + Math.random(), candidates: g.candidates || (g.foodId ? [{ id: g.foodId, score: 1 }] : []), ...g }));
  const s = sheet({ title: title || (r.id ? 'Edit recipe' : 'New recipe'), body: '', foot: '' });
  const missingServings = r.servings == null;
  const nut = () => {
    const n = N.recipeNutrition(r);
    return `<div class="row between"><div><div class="eyebrow">Per serving${r.servings ? ` (of ${r.servings})` : ''}</div><div class="num bold" style="font-size:20px">${f0(n.perServing.kcal)} kcal</div></div><div class="small ink2 num" style="text-align:right">P ${f1(n.perServing.protein)} g · Fibre ${f1(n.perServing.fibre)} g<br>Na ${f0(n.perServing.sodium)} mg · Sat ${f1(n.perServing.satfat)} g</div></div>${n.unmatched ? `<div class="tiny" style="color:var(--warn)">${n.unmatched} ingredient(s) not matched — not counted</div>` : ''}`;
  };
  const ingHtml = g => {
    const opts = (g.candidates || []).map(c => byId.get(c.id)).filter(Boolean).map(f => `<option value="${esc(f.id)}" ${f.id === g.foodId ? 'selected' : ''}>${esc(f.name)} (${SOURCE_LABEL[f.source] || f.source})</option>`).join('');
    return `<div class="item-card ${g.foodId && g.grams != null ? '' : 'flag'}"><div class="row between" style="align-items:flex-start"><div class="grow"><input class="input sm" value="${esc(g.name)}" data-g="${g.key}" data-r="name" aria-label="Ingredient name">${g.quantityText ? `<div class="tiny muted" style="margin:4px 2px 0">Source says: ${esc(g.quantityText)}</div>` : ''}</div><button class="icon-btn" data-g="${g.key}" data-r="rm" style="margin-left:8px">${icon('x')}</button></div>
    <select class="input sm" data-g="${g.key}" data-r="pick" style="margin-top:8px">${g.foodId ? '' : '<option value="" selected>— No database match —</option>'}${opts}<option disabled>──────────</option><option value="__search">Search database…</option><option value="__estimate">Use AI estimate (unverified)…</option></select>
    <div class="row between" style="margin-top:8px"><span class="small ink2">Grams ${g.gramsEstimate ? '<span class="badge medium">converted</span>' : ''}${g.grams == null ? '<span class="badge low">needed</span>' : ''}</span><div class="stepper"><input class="input sm num" type="number" inputmode="decimal" value="${g.grams ?? ''}" data-g="${g.key}" data-r="grams"><span class="small muted">g</span></div></div></div>`;
  };
  const paint = () => {
    s.setBody(`${r.missing && r.missing.length ? `<div class="notice warn small" style="margin-bottom:12px"><b>The source didn't state:</b> ${r.missing.map(esc).join(', ')}. Please confirm these.</div>` : ''}
    ${r.changes && r.changes.length ? `<div class="notice small" style="margin-bottom:12px"><b>Changes:</b><ul style="margin:6px 0 0;padding-left:18px">${r.changes.map(c => `<li>${esc(c)}</li>`).join('')}</ul></div>` : ''}
    <div class="row" style="gap:12px;align-items:flex-start;margin-bottom:12px"><label style="position:relative;flex:none">${r.photo ? `<img class="thumb" style="width:76px;height:76px" src="${r.photo}" alt="">` : `<div class="thumb" style="width:76px;height:76px">${icon('image')}</div>`}<input type="file" accept="image/*" id="re-photo" style="position:absolute;inset:0;opacity:0"></label><div class="grow fields"><label class="field"><span>Name</span><input class="input" id="re-name" value="${esc(r.name)}"></label></div></div>
    <div class="fields three"><label class="field"><span>Servings${missingServings ? ' ⚠' : ''}</span><input class="input num" type="number" inputmode="decimal" id="re-serv" value="${r.servings ?? ''}" ${missingServings ? 'style="border-color:var(--warn)"' : ''}></label><label class="field"><span>Prep min</span><input class="input num" type="number" id="re-prep" value="${r.prepMin ?? ''}"></label><label class="field"><span>Cook min</span><input class="input num" type="number" id="re-cook" value="${r.cookMin ?? ''}"></label></div>
    <div class="chips" style="margin-top:12px">${['breakfast', 'lunch', 'dinner', 'snack'].map(m => `<button class="chip ${(r.meals || []).includes(m) ? 'on' : ''}" data-meal="${m}">${m[0].toUpperCase() + m.slice(1)}</button>`).join('')}</div>
    <label class="field" style="margin-top:12px"><span>Categories (comma separated)</span><input class="input" id="re-cats" value="${esc((r.categories || []).join(', '))}" placeholder="e.g. chicken, meal prep, quick"></label>
    <div class="section-label row between" style="margin-left:2px"><span>Ingredients</span><button class="btn sm" id="re-add">${icon('plus')} Add</button></div>
    <div id="re-ings">${r.ingredients.map(ingHtml).join('') || '<div class="empty">No ingredients yet.</div>'}</div>
    <div class="section-label" style="margin-left:2px">Method (one step per line)</div><textarea class="input" id="re-steps" style="min-height:140px">${esc((r.steps || []).join('\n'))}</textarea>
    <div class="section-label" style="margin-left:2px">Substitutions (one per line)</div><textarea class="input" id="re-subs" placeholder="ingredient → swap — why">${esc((r.substitutions || []).map(x => (typeof x === 'string' ? x : `${x.ingredient} → ${x.swap}${x.why ? ' — ' + x.why : ''}`)).join('\n'))}</textarea>
    <label class="field" style="margin-top:12px"><span>Source link</span><input class="input" id="re-src" value="${esc(r.sourceUrl || '')}" placeholder="https://"></label>
    <label class="field" style="margin-top:12px"><span>Notes</span><textarea class="input" id="re-notes">${esc(r.notes || '')}</textarea></label>`);
    s.setFoot(`<div class="grow" id="re-nut">${nut()}</div><button class="btn primary" style="flex:none" id="re-save">Save</button>`);
    wire();
  };
  const read = () => {
    const b = s.body;
    r.name = b.querySelector('#re-name').value.trim() || r.name;
    r.servings = N.num(b.querySelector('#re-serv').value);
    r.prepMin = N.num(b.querySelector('#re-prep').value);
    r.cookMin = N.num(b.querySelector('#re-cook').value);
    r.categories = b.querySelector('#re-cats').value.split(',').map(x => x.trim()).filter(Boolean);
    r.steps = b.querySelector('#re-steps').value.split('\n').map(x => x.trim()).filter(Boolean);
    r.substitutions = b.querySelector('#re-subs').value.split('\n').map(x => x.trim()).filter(Boolean);
    r.sourceUrl = b.querySelector('#re-src').value.trim();
    r.notes = b.querySelector('#re-notes').value;
  };
  const refreshNut = () => (s.foot.querySelector('#re-nut').innerHTML = nut());
  const wire = () => {
    const b = s.body;
    b.querySelector('#re-photo').onchange = async e => {
      const f = e.target.files[0];
      if (!f) return;
      read();
      r.photo = (await compressImage(f, 640, 0.8)).dataUrl;
      paint();
    };
    b.querySelector('#re-serv').oninput = () => {
      r.servings = N.num(b.querySelector('#re-serv').value);
      refreshNut();
    };
    b.querySelectorAll('[data-meal]').forEach(el => (el.onclick = () => {
      const m = el.dataset.meal;
      r.meals = (r.meals || []).includes(m) ? r.meals.filter(x => x !== m) : [...(r.meals || []), m];
      el.classList.toggle('on');
    }));
    b.querySelectorAll('[data-g]').forEach(el => {
      const g = r.ingredients.find(x => x.key === el.dataset.g);
      const role = el.dataset.r;
      if (role === 'name') el.oninput = () => (g.name = el.value);
      if (role === 'grams')
        el.oninput = () => {
          g.grams = N.num(el.value);
          g.gramsEstimate = false;
          refreshNut();
        };
      if (role === 'rm')
        el.onclick = () => {
          read();
          r.ingredients = r.ingredients.filter(x => x !== g);
          paint();
        };
      if (role === 'pick')
        el.onchange = async () => {
          read();
          if (el.value === '__search') {
            searchSheet(food => {
              setFood(g, food, 1);
              paint();
            }, g.name);
            paint();
          } else if (el.value === '__estimate') {
            const food = await estimateFood(g.name);
            if (food) {
              byId.set(food.id, food);
              setFood(g, food, null);
            }
            paint();
          } else {
            const f = byId.get(el.value);
            if (f) setFood(g, f, 1);
            paint();
          }
        };
    });
    b.querySelector('#re-add').onclick = () => {
      read();
      searchSheet(food => {
        const g = { key: 'g' + Date.now(), name: food.name, grams: food.servingG || 100, candidates: [] };
        setFood(g, food, 1);
        r.ingredients.push(g);
        paint();
      });
    };
    s.foot.querySelector('#re-save').onclick = async () => {
      read();
      if (!r.servings) return toast('Please confirm the number of servings');
      if (!r.name) return toast('Name required');
      const n = N.recipeNutrition(r);
      const obj = { ...r, ingredients: r.ingredients.map(({ candidates, key, ...rest }) => rest), perServing: n.perServing, missing: [], changes: undefined };
      await db.put('recipes', obj);
      s.close();
      toast('Recipe saved');
      rerender();
    };
  };
  paint();
}

export async function recipeDetail(id) {
  const r = await db.get('recipes', id);
  if (!r) return;
  const n = N.recipeNutrition(r);
  const s = sheet({
    title: '',
    body: `${r.photo ? `<img src="${r.photo}" alt="" class="hero-photo" style="display:block">` : `<div class="hero-photo">${initials(r.name)}</div>`}
    <h2 class="title" style="font-size:26px;margin:14px 2px 4px">${esc(r.name)}</h2>
    <div class="row between" style="margin:0 2px 12px"><div class="small muted">${[r.servings && `Serves ${r.servings}`, r.prepMin && `Prep ${r.prepMin} min`, r.cookMin && `Cook ${r.cookMin} min`].filter(Boolean).join(' · ')}</div><div class="row" style="gap:10px"><div class="stars">${[1, 2, 3, 4, 5].map(i => `<button class="${(r.rating || 0) >= i ? 'on' : ''}" data-star="${i}" aria-label="${i} stars">★</button>`).join('')}</div><button class="icon-btn" id="rd-fav" style="color:${r.favourite ? 'var(--satfat)' : 'inherit'}">${icon('heart')}</button></div></div>
    <div class="card"><div class="eyebrow" style="margin-bottom:8px">Per serving${n.unmatched ? ` · ${n.unmatched} ingredient(s) not counted` : ''}</div><div class="macro-strip" style="margin-bottom:10px">${['kcal', 'protein', 'fibre', 'sodium'].map(k => `<div class="stat"><div class="k">${N.NUTRIENT[k].label}</div><div class="v num">${N.fmt(k, n.perServing[k])}</div><div class="d">${N.NUTRIENT[k].unit}</div></div>`).join('')}</div><details><summary class="link">All nutrients</summary><div class="kv" style="margin-top:10px">${N.NUTRIENTS.map(x => `<span>${x.label}</span><span>${N.fmt(x.key, n.perServing[x.key])} ${n.perServing[x.key] == null ? '' : x.unit}</span>`).join('')}</div></details></div>
    <div class="section-label">Ingredients</div><div class="card" style="padding:4px 14px"><div class="list">${(r.ingredients || []).map(g => `<div class="li"><div class="main"><div class="t">${esc(g.name)}</div><div class="s">${esc(g.quantityText || '')}${g.grams != null ? ` · ${Math.round(g.grams)} g` : ''}${g.foodName ? ` · ${esc(g.foodName)}` : ' · not matched'}</div></div>${g.source ? srcBadge(g.source) : ''}</div>`).join('')}</div></div>
    ${r.steps && r.steps.length ? `<div class="section-label">Method</div><div class="card"><ol style="margin:0;padding-left:20px">${r.steps.map(x => `<li style="margin-bottom:8px">${esc(x)}</li>`).join('')}</ol></div>` : ''}
    ${r.substitutions && r.substitutions.length ? `<div class="section-label">Substitutions</div><div class="card small">${r.substitutions.map(x => `<div style="margin-bottom:6px">${esc(typeof x === 'string' ? x : `${x.ingredient} → ${x.swap} — ${x.why}`)}</div>`).join('')}</div>` : ''}
    ${r.notes ? `<div class="section-label">Notes</div><div class="card small">${esc(r.notes)}</div>` : ''}
    ${r.sourceUrl ? `<p class="small" style="margin:14px 4px"><a href="${esc(r.sourceUrl)}" target="_blank" rel="noopener">Original source ↗</a></p>` : ''}
    <div class="grid2" style="margin-top:14px"><button class="btn" id="rd-plan">Add to plan</button><button class="btn" id="rd-improve">${icon('sparkle')} Improve</button><button class="btn" id="rd-edit">${icon('pen')} Edit</button><button class="btn" id="rd-dup">${icon('copy')} Duplicate</button></div>
    <button class="btn danger block" id="rd-del" style="margin-top:10px">${icon('trash')} Delete recipe</button>`,
    foot: `<button class="btn primary" id="rd-log">Log to diary</button>`,
  });
  const b = s.body;
  b.querySelectorAll('[data-star]').forEach(el => (el.onclick = async () => {
    r.rating = r.rating === Number(el.dataset.star) ? 0 : Number(el.dataset.star);
    await db.put('recipes', r);
    b.querySelectorAll('[data-star]').forEach(x => x.classList.toggle('on', Number(x.dataset.star) <= r.rating));
  }));
  b.querySelector('#rd-fav').onclick = async e => {
    const btn = e.currentTarget;
    r.favourite = !r.favourite;
    btn.style.color = r.favourite ? 'var(--satfat)' : 'inherit';
    await db.put('recipes', r);
    toast(r.favourite ? 'Added to favourites' : 'Removed from favourites');
  };
  b.querySelector('#rd-edit').onclick = () => {
    s.close();
    recipeEditor(r);
  };
  b.querySelector('#rd-dup').onclick = async () => {
    await db.put('recipes', { ...structuredClone(r), id: undefined, name: r.name + ' (copy)' });
    s.close();
    toast('Duplicated');
  };
  b.querySelector('#rd-del').onclick = async () => {
    if (await confirmSheet(`Delete ${r.name}?`, { ok: 'Delete', danger: true })) {
      await db.del('recipes', r.id);
      s.close();
    }
  };
  b.querySelector('#rd-improve').onclick = async () => {
    s.setBody(loadingHtml('Improving the nutritional profile…'));
    s.setFoot('');
    try {
      const simple = { name: r.name, servings: r.servings, ingredients: r.ingredients.map(g => ({ name: g.name, grams: g.grams })), steps: r.steps };
      const res = await api.ai('improve', { recipe: simple, priorities: await prioritiesText() });
      const draft = await recipeDraftFromAi(res.data.recipe || {}, { photo: r.photo, categories: r.categories, meals: r.meals });
      draft.name = (res.data.recipe && res.data.recipe.name) || r.name + ' (improved)';
      draft.changes = res.data.changes || [];
      s.close();
      recipeEditor(draft, { title: 'Improved version' });
    } catch (e) {
      s.setBody(`<div class="notice bad">${esc(e.message)}</div>`);
    }
  };
  b.querySelector('#rd-plan').onclick = () => {
    const p = sheet({
      title: 'Add to meal plan',
      body: `<div class="fields two"><label class="field"><span>Date</span><input class="input" type="date" id="pl-date" value="${core.today()}"></label><label class="field"><span>Meal</span><select class="input" id="pl-slot">${['breakfast', 'lunch', 'dinner', 'snack'].map(x => `<option ${(r.meals || [])[0] === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label></div>`,
      foot: `<button class="btn primary" id="pl-go">Add</button>`,
    });
    p.foot.querySelector('#pl-go').onclick = async () => {
      const date = p.body.querySelector('#pl-date').value;
      const slot = p.body.querySelector('#pl-slot').value;
      await db.put('plan', { id: `${date}|${slot}`, date, slot, recipeId: r.id });
      p.close();
      toast(`Planned for ${core.relDay(date)}`);
    };
  };
  s.foot.querySelector('#rd-log').onclick = () => {
    s.close();
    const slot = core.DIARY_SLOTS.find(x => (r.meals || []).includes(x.meal)) || { id: core.defaultSlotForNow() };
    reviewSheet(draftFromRecipe(r, core.today(), slot.id, 1));
  };
}

function newRecipeSheet() {
  const s = sheet({
    title: 'Add a recipe',
    body: `<div class="big-actions">
      <button class="big-action" data-x="link">${icon('link')}<b>Link</b><small>Website or TikTok</small></button>
      <label class="big-action">${icon('image')}<b>Screenshots</b><small>One or more images of a recipe</small><input type="file" accept="image/*" multiple id="nr-shots"></label>
      <button class="big-action" data-x="text">${icon('note')}<b>Paste text</b><small>Caption, notes, anything</small></button>
      <button class="big-action" data-x="gen">${icon('sparkle')}<b>Generate</b><small>“High-protein chicken dinner”</small></button>
      <button class="big-action" data-x="manual">${icon('pen')}<b>Manual</b><small>Type it yourself</small></button>
    </div>`,
  });
  s.body.querySelector('#nr-shots').onchange = async e => {
    const files = [...e.target.files].slice(0, 6);
    if (!files.length) return;
    s.setBody(loadingHtml('Reading screenshots…'));
    try {
      const images = [];
      for (const f of files) {
        const c = await compressImage(f, 1600, 0.85);
        images.push({ mime: c.mime, data: c.base64 });
      }
      const r = await api.ai('recipe', { images });
      s.close();
      recipeEditor(await recipeDraftFromAi(r.data));
    } catch (err) {
      s.setBody(`<div class="notice bad">${esc(err.message)}</div>`);
    }
  };
  s.body.querySelectorAll('[data-x]').forEach(b => (b.onclick = async () => {
    const x = b.dataset.x;
    if (x === 'manual') {
      s.close();
      return recipeEditor({ name: '', servings: 2, ingredients: [], steps: [], meals: [] });
    }
    if (x === 'link') {
      const url = await promptSheet('Recipe link', { label: 'Paste a website or TikTok link', type: 'url', placeholder: 'https://', ok: 'Import' });
      if (!url) return;
      s.setBody(loadingHtml('Fetching and extracting the recipe…'));
      try {
        const r = await api.ai('url', { url: url.trim() });
        let photo = null;
        s.close();
        const draft = await recipeDraftFromAi(r.data, { sourceUrl: url.trim(), photo });
        if (r.source === 'tiktok') draft.missing = [...new Set([...(draft.missing || []), 'check quantities against the video'])];
        recipeEditor(draft);
      } catch (err) {
        s.setBody(`<div class="notice bad">${esc(err.message)}</div><p class="small muted">Tip: for TikToks without the recipe in the caption, screenshot the recipe and use Screenshots.</p>`);
      }
    }
    if (x === 'text') {
      s.setBody(`<textarea class="input" id="nr-text" style="min-height:200px" placeholder="Paste the recipe text or caption"></textarea><button class="btn primary block" id="nr-go" style="margin-top:12px">${icon('sparkle')} Extract</button>`);
      s.body.querySelector('#nr-go').onclick = async () => {
        const text = s.body.querySelector('#nr-text').value.trim();
        if (!text) return;
        s.setBody(loadingHtml('Extracting…'));
        try {
          const r = await api.ai('recipe', { text });
          s.close();
          recipeEditor(await recipeDraftFromAi(r.data));
        } catch (err) {
          s.setBody(`<div class="notice bad">${esc(err.message)}</div>`);
        }
      };
    }
    if (x === 'gen') {
      s.close();
      generateSheet();
    }
  }));
}

export function generateSheet(prefill = '') {
  const s = sheet({
    title: 'Generate recipes',
    body: `<label class="field"><span>What do you want?</span><textarea class="input" id="gn-text" placeholder="e.g. Five new healthy chicken dinners, high fibre, under 30 minutes">${esc(prefill)}</textarea></label>
    <label class="field" style="margin-top:12px"><span>Ingredients you already have (optional)</span><input class="input" id="gn-pantry" placeholder="e.g. chicken thighs, chickpeas, spinach, feta"></label>
    <label class="field" style="margin-top:12px"><span>How many</span><select class="input" id="gn-n">${[1, 2, 3, 4, 5].map(n => `<option>${n}</option>`).join('')}</select></label>
    <p class="tiny muted">Your nutrition priorities are sent along. Nutrition is calculated from your database after generation, not by the AI.</p>`,
    foot: `<button class="btn primary" id="gn-go">${icon('sparkle')} Generate</button>`,
  });
  s.foot.querySelector('#gn-go').onclick = async () => {
    const text = s.body.querySelector('#gn-text').value.trim();
    if (!text) return toast('Describe what you want');
    const pantry = s.body.querySelector('#gn-pantry').value.trim();
    const count = Number(s.body.querySelector('#gn-n').value);
    s.setBody(loadingHtml('Creating recipes…'));
    s.setFoot('');
    try {
      const r = await api.ai('generate', { text, pantry, count, priorities: await prioritiesText() });
      const drafts = [];
      for (const d of r.data.recipes || []) drafts.push(await recipeDraftFromAi(d));
      if (!drafts.length) throw new Error('No recipes returned — try rephrasing.');
      const paint = () => {
        s.setTitle('Generated recipes');
        s.setBody(`<p class="small muted" style="margin-top:0">Review each one — check ingredient matches — then save.</p>${drafts
          .map((d, i) => {
            const n = N.recipeNutrition(d);
            return `<div class="item-card"><div class="h3">${esc(d.name)}</div><div class="tiny muted" style="margin:4px 0 10px">${nutLine(n.perServing)} per serving · ${d.ingredients.length} ingredients${n.unmatched ? ` · ${n.unmatched} unmatched` : ''}</div><button class="btn sm ${d.saved ? '' : 'primary'}" data-i="${i}" ${d.saved ? 'disabled' : ''}>${d.saved ? 'Saved' : 'Review & save'}</button></div>`;
          })
          .join('')}`);
        s.body.querySelectorAll('[data-i]').forEach(b => (b.onclick = () => {
          const d = drafts[Number(b.dataset.i)];
          d.saved = true;
          recipeEditor(d);
          paint();
        }));
      };
      paint();
    } catch (e) {
      s.setBody(`<div class="notice bad">${esc(e.message)}</div>`);
    }
  };
}

// ---------------- actions ----------------
register({
  'nut-sub': el => {
    state.sub.nutrition = el.dataset.v;
    rerender();
  },
  'date-shift': el => {
    state.date = core.addDays(state.date, Number(el.dataset.v));
    rerender();
  },
  'date-set': el => {
    if (el.value) {
      state.date = el.value;
      rerender();
    }
  },
  'log-open': el => openLog(state.tab === 'nutrition' ? state.date : core.today(), el.dataset.slot || core.defaultSlotForNow()),
  'entry-open': async el => {
    const e = await db.get('entries', el.dataset.id);
    if (e) reviewSheet({ ...structuredClone(e), items: e.items.map(i => ({ ...i, key: i.key || Math.random().toString(36).slice(2), candidates: i.foodId ? [{ id: i.foodId, score: i.matchScore ?? 1 }] : [] })) }, { entry: e });
  },
  'afcd-import': () => afcdImport(),
  'food-new': () => foodEditor({}),
  'food-label': el => {
    const f = el.files[0];
    if (f) labelFlow(f);
  },
  'food-open': async el => {
    const f = (await foods()).find(x => x.id === el.dataset.id);
    if (f) foodDetail(f);
  },
  'food-q': debounce(el => {
    state.foodQuery = el.value;
    rerender().then(() => {
      const i = document.querySelector('[data-input="food-q"]');
      if (i) {
        i.focus();
        i.setSelectionRange(i.value.length, i.value.length);
      }
    });
  }, 250),
  'recipe-new': () => newRecipeSheet(),
  'recipe-open': el => recipeDetail(el.dataset.id),
  'recipe-filter': el => {
    state.recipeFilter = el.dataset.v;
    rerender();
  },
  'recipe-q': debounce(el => {
    state.recipeQuery = el.value;
    rerender().then(() => {
      const i = document.querySelector('[data-input="recipe-q"]');
      if (i) {
        i.focus();
        i.setSelectionRange(i.value.length, i.value.length);
      }
    });
  }, 250),
});

export { recipeItem, draftFromRecipe };
