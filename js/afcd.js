// Parser for the FSANZ Australian Food Composition Database (AFCD) Excel downloads.
// Handles both layouts FSANZ has published:
//  - wide:  one row per food, one column per nutrient ("Protein (g)", "Sodium (Na) (mg)" ...)
//  - long:  one row per food+nutrient (Key, Description/Nutrient, Scale/Unit, Value) plus a
//           separate Food Details file that maps Key -> Food Name.
// Input is a list of sheets as arrays of rows (what SheetJS sheet_to_json({header:1}) returns).

import { KJ_PER_KCAL, NUTRIENT, num } from './nutrition.js';

const MAP = [
  ['energyKj', [/^energy,? with dietary fibre.*kj/, /^energy.*with dietary fibre.*kj/, /^energy.*\(kj\)/, /^energy.*kj/, /^energy,? with dietary fibre/, /^energy\b/]],
  ['kcal', [/^energy.*kcal/]],
  ['protein', [/^protein\b/]],
  ['fat', [/^fat,? total/, /^total fat/, /^fat\b/]],
  ['satfat', [/^total saturated fatty acids/, /(^|[^a-z])saturated fat/]],
  ['carbs', [/^available carbohydrate,? with sugar alcohols/, /^available carbohydrate/, /^carbohydrate/]],
  ['fibre', [/^total dietary fibre/, /dietary fibre/]],
  ['sugars', [/^total sugars/, /^sugars?,? total/]],
  ['addedSugars', [/^added sugars?/]],
  ['sodium', [/^sodium/]],
  ['potassium', [/^potassium/]],
  ['calcium', [/^calcium/]],
  ['iron', [/^iron\b/]],
  ['magnesium', [/^magnesium/]],
  ['zinc', [/^zinc/]],
  ['vitC', [/^vitamin c\b/]],
  ['folate', [/dietary folate equivalents/, /^total folates?/]],
  ['vitB12', [/^vitamin b12/, /cobalamin/]],
  ['vitD', [/^vitamin d3 equivalents/, /^vitamin d\b/]],
  ['vitA', [/^vitamin a retinol equivalents/, /retinol equivalents/]],
  ['omega3', [/total long chain omega ?3/, /long chain omega.?3/]],
];

const clean = s => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

export function unitOf(text) {
  const m = String(text || '').match(/\((mg|µg|μg|ug|mcg|g|kj|kcal)\)\s*$/i);
  if (m) return normUnit(m[1]);
  return null;
}
function normUnit(u) {
  const x = String(u || '').trim().toLowerCase();
  if (x === 'μg' || x === 'ug' || x === 'mcg' || x === 'µg') return 'µg';
  if (['mg', 'g', 'kj', 'kcal'].includes(x)) return x;
  return null;
}

export function convertUnit(v, from, to) {
  if (v == null || !from || !to || from === to) return v;
  const toMg = { g: 1000, mg: 1, 'µg': 0.001 };
  if (toMg[from] && toMg[to]) return (v * toMg[from]) / toMg[to];
  return v;
}

/** Which internal key (if any) a header/description refers to. Earlier patterns win. */
export function classify(text) {
  const t = clean(text);
  for (const [key, pats] of MAP) {
    for (let i = 0; i < pats.length; i++) if (pats[i].test(t)) return { key, rank: i };
  }
  return null;
}

function findHeaderRow(rows, test) {
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const r = rows[i] || [];
    if (r.some(c => test(clean(c)))) return i;
  }
  return -1;
}

const isKeyHeader = c => /^(public food key|food key|key|food id|food code)$/.test(c);
const isNameHeader = c => /^(food name|name|food description)$/.test(c);

function finish(key, name, vals, units) {
  const per100 = {};
  for (const [k, v] of Object.entries(vals)) {
    if (k === 'energyKj' || k === 'kcal') continue;
    const target = NUTRIENT[k] ? NUTRIENT[k].unit : null;
    per100[k] = convertUnit(v, units[k], target);
  }
  if (vals.energyKj != null) per100.kcal = vals.energyKj / KJ_PER_KCAL;
  else if (vals.kcal != null) per100.kcal = vals.kcal;
  return { id: 'afcd:' + key, afcdKey: String(key), name: String(name || key).trim(), source: 'afcd', per100 };
}

export function parseWide(rows) {
  const h = findHeaderRow(rows, isNameHeader);
  if (h < 0) return null;
  const header = rows[h].map(clean);
  const nameCol = header.findIndex(isNameHeader);
  const keyCol = header.findIndex(isKeyHeader);
  const cols = {};
  header.forEach((text, i) => {
    const c = classify(text);
    if (!c) return;
    const unit = unitOf(rows[h][i]);
    const key = c.key === 'energyKj' && unit === 'kcal' ? 'kcal' : c.key;
    if (!cols[key] || cols[key].rank > c.rank) cols[key] = { i, rank: c.rank, unit };
  });
  const mapped = Object.keys(cols);
  if (mapped.length < 3) return null;
  const foods = [];
  for (let r = h + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const name = row[nameCol];
    if (name == null || String(name).trim() === '') continue;
    const key = keyCol >= 0 && row[keyCol] != null ? row[keyCol] : `row${r}`;
    const vals = {};
    const units = {};
    for (const [k, c] of Object.entries(cols)) {
      vals[k] = num(row[c.i]);
      units[k] = c.unit || (NUTRIENT[k] && NUTRIENT[k].unit);
    }
    foods.push(finish(key, name, vals, units));
  }
  return { foods, mapped };
}

export function parseLong(rows, names) {
  const h = findHeaderRow(rows, c => c === 'value');
  if (h < 0) return null;
  const header = rows[h].map(clean);
  const keyCol = header.findIndex(isKeyHeader);
  const descCol = header.findIndex(c => /^(description|nutrient|nutrient name|component)$/.test(c));
  const valCol = header.indexOf('value');
  const unitCol = header.findIndex(c => /^(scale|unit|units)$/.test(c));
  const nameCol = header.findIndex(isNameHeader);
  if (keyCol < 0 || descCol < 0 || valCol < 0) return null;
  const byKey = new Map();
  const mapped = new Set();
  for (let r = h + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const key = row[keyCol];
    if (key == null) continue;
    const c0 = classify(row[descCol]);
    if (!c0) continue;
    const u0 = (unitCol >= 0 && normUnit(row[unitCol])) || unitOf(row[descCol]);
    const c = c0.key === 'energyKj' && u0 === 'kcal' ? { ...c0, key: 'kcal' } : c0;
    let rec = byKey.get(key);
    if (!rec) {
      rec = { vals: {}, units: {}, ranks: {}, name: nameCol >= 0 ? row[nameCol] : null };
      byKey.set(key, rec);
    }
    if (rec.ranks[c.key] != null && rec.ranks[c.key] <= c.rank) continue;
    rec.ranks[c.key] = c.rank;
    rec.vals[c.key] = num(row[valCol]);
    rec.units[c.key] = u0 || (NUTRIENT[c.key] && NUTRIENT[c.key].unit);
    mapped.add(c.key);
  }
  if (!byKey.size) return null;
  const foods = [];
  for (const [key, rec] of byKey) foods.push(finish(key, rec.name || names.get(String(key)) || key, rec.vals, rec.units));
  return { foods, mapped: [...mapped] };
}

export function parseNames(rows) {
  const h = findHeaderRow(rows, isNameHeader);
  if (h < 0) return null;
  const header = rows[h].map(clean);
  const keyCol = header.findIndex(isKeyHeader);
  const nameCol = header.findIndex(isNameHeader);
  if (keyCol < 0) return null;
  const m = new Map();
  for (let r = h + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    if (row[keyCol] != null && row[nameCol] != null) m.set(String(row[keyCol]), String(row[nameCol]).trim());
  }
  return m;
}

/** sheets: [{ name, rows }]. Returns { foods, report }. */
export function parseAfcd(sheets) {
  const names = new Map();
  for (const s of sheets) {
    const n = parseNames(s.rows);
    if (n) for (const [k, v] of n) names.set(k, v);
  }
  let best = null;
  for (const s of sheets) {
    const w = parseWide(s.rows);
    if (w && (!best || w.mapped.length > best.mapped.length)) best = { ...w, sheet: s.name, layout: 'wide' };
  }
  if (!best) {
    for (const s of sheets) {
      const l = parseLong(s.rows, names);
      if (l && (!best || l.foods.length > best.foods.length)) best = { ...l, sheet: s.name, layout: 'long' };
    }
  }
  if (!best) return { foods: [], report: { ok: false, message: 'Could not find a nutrient table. Import the AFCD "Nutrient profiles" (or "Nutrient file") workbook, plus "Food details" if names are missing.' } };
  const foods = best.foods.filter(f => Object.values(f.per100).some(v => v != null));
  const essentials = ['protein', 'fat', 'carbs', 'sodium'];
  const missingEssential = essentials.filter(k => !best.mapped.includes(k));
  const unnamed = foods.filter(f => f.name === f.afcdKey).length;
  return {
    foods,
    report: {
      ok: foods.length > 0 && missingEssential.length === 0,
      layout: best.layout,
      sheet: best.sheet,
      foods: foods.length,
      mapped: best.mapped,
      missingEssential,
      unnamed,
      message: missingEssential.length ? `Imported, but these columns weren't recognised: ${missingEssential.join(', ')}` : unnamed ? `${unnamed} foods have no name — also import the "Food details" workbook.` : 'Imported successfully.',
    },
  };
}
