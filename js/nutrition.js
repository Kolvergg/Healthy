// Deterministic nutrition engine. AI never produces the numbers used here:
// every figure comes from a food's per-100 g values (AFCD, a label you confirmed,
// or a custom entry) multiplied by grams.

export const NUTRIENTS = [
  { key: 'kcal', label: 'Calories', unit: 'kcal', dp: 0, main: true },
  { key: 'protein', label: 'Protein', unit: 'g', dp: 1, main: true },
  { key: 'carbs', label: 'Carbohydrates', unit: 'g', dp: 1, main: true },
  { key: 'fat', label: 'Total fat', unit: 'g', dp: 1, main: true },
  { key: 'satfat', label: 'Saturated fat', unit: 'g', dp: 1, main: true },
  { key: 'fibre', label: 'Fibre', unit: 'g', dp: 1, main: true },
  { key: 'sugars', label: 'Total sugars', unit: 'g', dp: 1, main: true },
  { key: 'addedSugars', label: 'Added sugars', unit: 'g', dp: 1, main: true },
  { key: 'sodium', label: 'Sodium', unit: 'mg', dp: 0, main: true },
  { key: 'potassium', label: 'Potassium', unit: 'mg', dp: 0 },
  { key: 'calcium', label: 'Calcium', unit: 'mg', dp: 0 },
  { key: 'iron', label: 'Iron', unit: 'mg', dp: 1 },
  { key: 'magnesium', label: 'Magnesium', unit: 'mg', dp: 0 },
  { key: 'zinc', label: 'Zinc', unit: 'mg', dp: 1 },
  { key: 'vitC', label: 'Vitamin C', unit: 'mg', dp: 0 },
  { key: 'folate', label: 'Folate (DFE)', unit: 'µg', dp: 0 },
  { key: 'vitB12', label: 'Vitamin B12', unit: 'µg', dp: 1 },
  { key: 'vitD', label: 'Vitamin D', unit: 'µg', dp: 1 },
  { key: 'vitA', label: 'Vitamin A (RE)', unit: 'µg', dp: 0 },
  { key: 'omega3', label: 'Omega-3 (long chain)', unit: 'mg', dp: 0 },
];
export const NUTRIENT_KEYS = NUTRIENTS.map(n => n.key);
export const NUTRIENT = Object.fromEntries(NUTRIENTS.map(n => [n.key, n]));
export const KJ_PER_KCAL = 4.184;

export function num(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v).trim().toLowerCase();
  if (s === 'tr' || s === 'trace') return 0;
  const cleaned = s.replace(/[^0-9.\-e]/g, '');
  if (!cleaned || cleaned === '-' || cleaned === '.') return null;
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

export function emptyNutrients() {
  const o = {};
  for (const k of NUTRIENT_KEYS) o[k] = null;
  return o;
}

/** Normalise a per-100 g object; derives kcal from kJ when only kJ is present. */
export function normalisePer100(p = {}) {
  const out = emptyNutrients();
  for (const k of NUTRIENT_KEYS) out[k] = num(p[k]);
  if (out.kcal == null && num(p.kj) != null) out.kcal = num(p.kj) / KJ_PER_KCAL;
  return out;
}

export function scale(per100, grams) {
  const g = num(grams);
  const out = emptyNutrients();
  for (const k of NUTRIENT_KEYS) {
    const v = per100 ? per100[k] : null;
    out[k] = v == null || g == null ? null : (v * g) / 100;
  }
  return out;
}

/**
 * A diary item is one of:
 *  - food:   { per100, grams }
 *  - recipe: { perServing, servings }
 *  - quick:  { absolute }  (manual nutrient totals)
 */
export function itemNutrients(item) {
  if (!item) return emptyNutrients();
  if (item.perServing) {
    const s = num(item.servings) ?? 1;
    const o = emptyNutrients();
    for (const k of NUTRIENT_KEYS) {
      const v = item.perServing[k];
      o[k] = v == null ? null : v * s;
    }
    return o;
  }
  if (item.absolute) return normalisePer100(item.absolute);
  return scale(item.per100, item.grams);
}

/** Sum nutrient objects. A total is null only when every input is unknown. */
export function sumNutrients(list) {
  const totals = emptyNutrients();
  const missing = {};
  for (const k of NUTRIENT_KEYS) missing[k] = 0;
  for (const n of list) {
    for (const k of NUTRIENT_KEYS) {
      const v = n ? n[k] : null;
      if (v == null) missing[k]++;
      else totals[k] = (totals[k] ?? 0) + v;
    }
  }
  return { totals, missing, count: list.length };
}

export function entryTotals(entry) {
  return sumNutrients((entry?.items || []).map(itemNutrients));
}

export function dayTotals(entries) {
  return sumNutrients(entries.flatMap(e => (e.items || []).map(itemNutrients)));
}

export function recipeNutrition(recipe) {
  const ings = recipe?.ingredients || [];
  const s = sumNutrients(ings.map(i => (i.per100 ? scale(i.per100, i.grams) : emptyNutrients())));
  const servings = num(recipe?.servings) || 1;
  const perServing = emptyNutrients();
  for (const k of NUTRIENT_KEYS) perServing[k] = s.totals[k] == null ? null : s.totals[k] / servings;
  const totalGrams = ings.reduce((a, i) => a + (num(i.grams) || 0), 0);
  return {
    totals: s.totals,
    perServing,
    missing: s.missing,
    unmatched: ings.filter(i => !i.per100).length,
    servings,
    totalGrams,
    gramsPerServing: totalGrams / servings,
  };
}

export function round(v, dp = 0) {
  if (v == null) return null;
  const f = 10 ** dp;
  return Math.round(v * f) / f;
}

export function fmt(key, v) {
  const n = NUTRIENT[key];
  if (v == null) return '—';
  const r = round(v, n ? n.dp : 1);
  return r.toLocaleString('en-AU');
}

// ---------- Targets and priorities ----------

export const DEFAULT_TARGETS = [
  { key: 'protein', kind: 'min', value: 120, weight: 5, show: true },
  { key: 'fibre', kind: 'min', value: 30, weight: 5, show: true },
  { key: 'sodium', kind: 'max', value: 2000, weight: 3, show: true },
  { key: 'satfat', kind: 'max', value: 20, weight: 3, show: true },
  { key: 'addedSugars', kind: 'max', value: 25, weight: 3, show: true },
];

export function progress(totals, targets) {
  return targets.map(t => {
    const v = totals ? totals[t.key] : null;
    const pct = v == null || !t.value ? 0 : v / t.value;
    let status;
    if (t.kind === 'min') status = pct >= 1 ? 'met' : pct >= 0.6 ? 'close' : 'low';
    else status = v == null ? 'unknown' : pct <= 0.8 ? 'good' : pct <= 1 ? 'near' : 'over';
    return { ...t, current: v, pct, status };
  });
}

/** 0–100 score of how well a set of totals matches weighted priorities. */
export function priorityScore(totals, targets, fraction = 1) {
  let w = 0;
  let s = 0;
  for (const t of targets) {
    if (!t.weight || !t.value) continue;
    const v = totals ? totals[t.key] : null;
    if (v == null) continue;
    const goal = t.value * fraction;
    const sc = t.kind === 'min' ? Math.min(1, v / goal) : v <= goal ? 1 : Math.max(0, 1 - (v - goal) / goal);
    s += sc * t.weight;
    w += t.weight;
  }
  return w ? Math.round((100 * s) / w) : null;
}

// ---------- Food matching (deterministic, used to map AI food names to database rows) ----------

const STOP = new Set(['a', 'an', 'the', 'of', 'with', 'and', 'in', 'on', 'or', 'no', 'added', 'fat', 'nfs', 'ns', 'as', 'to', 'for', 'from']);
export const STATE_WORDS = ['raw', 'cooked', 'boiled', 'grilled', 'fried', 'baked', 'roasted', 'steamed', 'dried', 'canned', 'poached', 'microwaved', 'toasted', 'uncooked', 'stewed', 'barbecued', 'pan'];

function stem(t) {
  if (t.length <= 3) return t;
  if (t.endsWith('ies')) return t.slice(0, -3) + 'y';
  if (t.endsWith('oes')) return t.slice(0, -2);
  if (t.endsWith('ss')) return t;
  if (t.endsWith('s')) return t.slice(0, -1);
  return t;
}

export function tokens(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9%\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t && !STOP.has(t))
    .map(stem);
}

const tokenCache = new WeakMap();
function foodTokens(f) {
  let t = tokenCache.get(f);
  if (!t) {
    t = tokens(`${f.name} ${f.brand || ''}`);
    tokenCache.set(f, t);
  }
  return t;
}

// Main protein words: a query for one must never match a food that is a different one
// ("chicken stir-fry" must not become "Beef, steak, stir-fried").
const PROTEINS = new Set(['chicken', 'beef', 'pork', 'lamb', 'fish', 'salmon', 'tuna', 'prawn', 'shrimp', 'turkey', 'duck', 'veal', 'tofu', 'bacon', 'ham', 'sausage', 'kangaroo', 'mince', 'squid', 'barramundi', 'snapper', 'cod']);
// Words that describe preparation, not the food itself.
const GENERIC = new Set(['stir', 'style', 'dish', 'homemade', 'plain', 'mixed', 'fresh', 'prepared', 'with', 'sauce', 'takeaway', 'commercial']);

export function scoreFood(query, food, state) {
  const q = tokens(query);
  if (!q.length) return 0;
  const ft = foodTokens(food);
  const set = new Set(ft);
  const qp = q.filter(t => PROTEINS.has(t));
  const fp = ft.filter(t => PROTEINS.has(t));
  if (qp.length && fp.length && !qp.some(t => set.has(t))) return 0;
  const core = q.filter(t => !STATE_WORDS.includes(t) && !GENERIC.has(t));
  if (core.length && !core.some(t => set.has(t) || (t.length >= 3 && ft.some(x => x.startsWith(t))))) return 0;
  let hit = 0;
  for (const t of q) {
    if (set.has(t)) hit += 1;
    else if (t.length >= 3 && ft.some(x => x.startsWith(t))) hit += 0.6;
  }
  if (!hit) return 0;
  let score = hit / q.length;
  score -= 0.015 * Math.max(0, ft.length - q.length);
  if (ft[0] === q[0]) score += 0.1;
  if (state) {
    const st = tokens(state).filter(x => STATE_WORDS.includes(x));
    if (st.length && st.some(x => set.has(x))) score += 0.2;
    else if (st.length && ft.some(x => STATE_WORDS.includes(x))) score -= 0.1;
  }
  if (food.source && food.source !== 'afcd') score += 0.05;
  if (food.uses) score += Math.min(0.1, food.uses * 0.01);
  return score;
}

export function matchFoods(query, foods, { limit = 8, state } = {}) {
  const out = [];
  for (const f of foods) {
    const s = scoreFood(query, f, state);
    if (s > 0) out.push({ food: f, score: s });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit);
}

/** Best database candidates for an AI-identified item, trying all of its search terms. */
export function matchAiItem(item, foods, limit = 6) {
  const terms = [item.name, ...(item.search_terms || [])].filter(Boolean);
  const best = new Map();
  for (const term of terms) {
    for (const r of matchFoods(term, foods, { limit: limit * 2, state: item.state || item.method })) {
      const prev = best.get(r.food.id);
      if (!prev || prev.score < r.score) best.set(r.food.id, r);
    }
  }
  return [...best.values()].sort((a, b) => b.score - a.score).slice(0, limit);
}

/**
 * Sanity limits for an AI-estimated dish (per 100 g). Clamps impossible values and makes
 * calories agree with the macros, so one bad guess can't produce "100 g of fat".
 */
export function sanePer100(p) {
  const o = normalisePer100(p);
  const lim = { protein: 35, fat: 30, satfat: 15, carbs: 80, sugars: 80, fibre: 25, sodium: 2500 };
  for (const [k, max] of Object.entries(lim)) if (o[k] != null) o[k] = Math.max(0, Math.min(max, o[k]));
  if (o.satfat != null && o.fat != null) o.satfat = Math.min(o.satfat, o.fat);
  if (o.sugars != null && o.carbs != null) o.sugars = Math.min(o.sugars, o.carbs);
  if (o.protein != null && o.fat != null && o.carbs != null) {
    const derived = 4 * o.protein + 4 * o.carbs + 9 * o.fat + 2 * (o.fibre || 0);
    if (o.kcal == null || Math.abs(o.kcal - derived) > 0.25 * derived) o.kcal = Math.round(derived);
  }
  if (o.kcal != null) o.kcal = Math.max(0, Math.min(600, o.kcal));
  return o;
}

export function confidenceLabel(c) {
  const v = num(c);
  if (v == null) return 'Unknown';
  if (v >= 0.75) return 'High';
  if (v >= 0.45) return 'Medium';
  return 'Low';
}

// ---------- Meal planner (deterministic given an RNG) ----------

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MEAL_FRACTION = { breakfast: 0.25, lunch: 0.3, dinner: 0.35, snack: 0.1 };

export function recipeFitsSlot(recipe, slot) {
  const m = recipe.meals && recipe.meals.length ? recipe.meals : ['lunch', 'dinner'];
  return m.includes(slot);
}

/**
 * Plan meals for `days` (array of date strings) and `slots` (e.g. ['breakfast','lunch','dinner']).
 * history: [{ date, recipeId }] of recent meals so repeats are avoided across the boundary.
 * Returns [{ date, slot, recipeId }]. Never invents recipes; only uses the library.
 */
export function planMeals({ recipes, days, slots, targets = DEFAULT_TARGETS, history = [], rng = Math.random, gap = 3, favouriteBoost = 2.5, keep = [] }) {
  const dayIndex = d => Math.round((Date.parse(d + 'T00:00:00Z') - Date.parse(days[0] + 'T00:00:00Z')) / 86400000);
  const lastUsed = new Map();
  const note = (id, idx) => lastUsed.set(id, Math.max(lastUsed.has(id) ? lastUsed.get(id) : -Infinity, idx));
  for (const h of history) note(h.recipeId, dayIndex(h.date));
  const keepMap = new Map(keep.map(k => [`${k.date}|${k.slot}`, k.recipeId]));
  const scoreCache = new Map();
  const nutScore = (r, slot) => {
    const key = r.id + slot;
    if (!scoreCache.has(key)) {
      const ps = r.perServing || recipeNutrition(r).perServing;
      scoreCache.set(key, (priorityScore(ps, targets, MEAL_FRACTION[slot] || 0.3) ?? 50) / 100);
    }
    return scoreCache.get(key);
  };
  const plan = [];
  for (const date of days) {
    const idx = dayIndex(date);
    const usedToday = new Set();
    for (const slot of slots) {
      const kept = keepMap.get(`${date}|${slot}`);
      if (kept) {
        plan.push({ date, slot, recipeId: kept });
        usedToday.add(kept);
        note(kept, idx);
        continue;
      }
      const fits = recipes.filter(r => recipeFitsSlot(r, slot) && !usedToday.has(r.id));
      if (!fits.length) continue;
      let g = gap;
      let cands = [];
      while (g >= 0) {
        cands = fits.filter(r => !lastUsed.has(r.id) || idx - lastUsed.get(r.id) > g);
        if (cands.length) break;
        g--;
      }
      if (!cands.length) cands = fits;
      const weights = cands.map(r => (r.favourite ? favouriteBoost : 1) * (1 + (num(r.rating) || 0) / 5) * (0.4 + nutScore(r, slot)));
      const total = weights.reduce((a, b) => a + b, 0);
      let x = rng() * total;
      let pick = cands[cands.length - 1];
      for (let i = 0; i < cands.length; i++) {
        x -= weights[i];
        if (x <= 0) {
          pick = cands[i];
          break;
        }
      }
      plan.push({ date, slot, recipeId: pick.id });
      usedToday.add(pick.id);
      note(pick.id, idx);
    }
  }
  return plan;
}

// ---------- Small stats helpers ----------

export function mean(a) {
  const v = a.filter(x => x != null && Number.isFinite(x));
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
}

export function stdev(a) {
  const v = a.filter(x => x != null && Number.isFinite(x));
  if (v.length < 2) return null;
  const m = mean(v);
  return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length - 1));
}

/** Minutes between two HH:MM times, crossing midnight if needed. */
export function sleepMinutes(bed, wake) {
  const p = t => {
    const [h, m] = String(t).split(':').map(Number);
    return h * 60 + m;
  };
  let d = p(wake) - p(bed);
  if (d <= 0) d += 1440;
  return d;
}

/** Bedtime as minutes relative to midnight, with times after noon negative (22:30 → -90) so averaging works. */
export function bedtimeOffset(t) {
  const [h, m] = String(t).split(':').map(Number);
  const mins = h * 60 + m;
  return mins >= 720 ? mins - 1440 : mins;
}
