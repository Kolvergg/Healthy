import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as N from '../js/nutrition.js';
import { parseAfcd, classify, convertUnit } from '../js/afcd.js';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

const chicken = { id: 'c', name: 'Chicken, breast, lean flesh, grilled', source: 'afcd', per100: N.normalisePer100({ kcal: 160, protein: 30, fat: 4, satfat: 1.2, sodium: 70, fibre: 0, carbs: 0 }) };
const rice = { id: 'r', name: 'Rice, white, boiled', source: 'afcd', per100: N.normalisePer100({ kcal: 130, protein: 2.5, fat: 0.3, carbs: 28, fibre: 0.4, sodium: 2 }) };
const riceRaw = { id: 'rr', name: 'Rice, white, uncooked', source: 'afcd', per100: N.normalisePer100({ kcal: 350, protein: 7, carbs: 78 }) };

test('scale is linear in grams and keeps unknowns unknown', () => {
  const s = N.scale(chicken.per100, 150);
  close(s.protein, 45);
  close(s.kcal, 240);
  assert.equal(s.vitC, null);
  assert.equal(N.scale(chicken.per100, null).protein, null);
});

test('kJ converts to kcal at 4.184', () => {
  const p = N.normalisePer100({ kj: 418.4 });
  close(p.kcal, 100);
});

test('num handles labels, trace and junk', () => {
  assert.equal(N.num('12.5 g'), 12.5);
  assert.equal(N.num('<0.1'), 0.1);
  assert.equal(N.num('tr'), 0);
  assert.equal(N.num('N/A'), null);
  assert.equal(N.num(''), null);
});

test('day totals sum items across entries; missing counted, not zeroed', () => {
  const entries = [
    { items: [{ per100: chicken.per100, grams: 200 }, { per100: rice.per100, grams: 180 }] },
    { items: [{ absolute: { kcal: 100, protein: 5 } }] },
  ];
  const d = N.dayTotals(entries);
  close(d.totals.protein, 60 + 4.5 + 5);
  close(d.totals.kcal, 320 + 234 + 100);
  assert.equal(d.missing.fibre, 1);
  close(d.totals.fibre, 0.72);
  assert.equal(d.totals.vitC, null);
});

test('recipe per-serving divides totals by servings', () => {
  const r = N.recipeNutrition({ servings: 2, ingredients: [{ per100: chicken.per100, grams: 400 }, { per100: rice.per100, grams: 300 }, { name: 'mystery sauce', grams: 30 }] });
  close(r.totals.protein, 120 + 7.5);
  close(r.perServing.protein, 63.75);
  assert.equal(r.unmatched, 1);
  close(r.gramsPerServing, 365);
  const item = N.itemNutrients({ perServing: r.perServing, servings: 1.5 });
  close(item.protein, 63.75 * 1.5);
});

test('progress and priority score', () => {
  const t = N.DEFAULT_TARGETS;
  const p = N.progress({ protein: 120, fibre: 15, sodium: 2500, satfat: 10, addedSugars: null }, t);
  assert.equal(p.find(x => x.key === 'protein').status, 'met');
  assert.equal(p.find(x => x.key === 'fibre').status, 'low');
  assert.equal(p.find(x => x.key === 'sodium').status, 'over');
  assert.equal(p.find(x => x.key === 'addedSugars').status, 'unknown');
  const perfect = N.priorityScore({ protein: 130, fibre: 35, sodium: 1500, satfat: 15, addedSugars: 10 }, t);
  assert.equal(perfect, 100);
  const worse = N.priorityScore({ protein: 60, fibre: 35, sodium: 1500, satfat: 15, addedSugars: 10 }, t);
  assert.ok(worse < 100 && worse > 50);
  assert.equal(N.priorityScore({}, t), null);
});

test('matching prefers the cooked variant when AI says cooked', () => {
  const foods = [riceRaw, rice, chicken];
  const m = N.matchFoods('white rice', foods, { state: 'boiled' });
  assert.equal(m[0].food.id, 'r');
  const m2 = N.matchFoods('white rice', foods, { state: 'uncooked' });
  assert.equal(m2[0].food.id, 'rr');
  const a = N.matchAiItem({ name: 'grilled chicken', search_terms: ['chicken breast grilled'], state: 'grilled' }, foods);
  assert.equal(a[0].food.id, 'c');
  assert.deepEqual(N.matchFoods('xyz', foods), []);
});

test('meal planner never repeats within the gap and boosts favourites', () => {
  const recipes = Array.from({ length: 6 }, (_, i) => ({ id: 'r' + i, meals: ['dinner'], perServing: { protein: 40, fibre: 8, sodium: 600, satfat: 5, addedSugars: 2 }, favourite: i === 0 }));
  const days = Array.from({ length: 14 }, (_, i) => new Date(Date.UTC(2026, 10, 1 + i)).toISOString().slice(0, 10));
  const plan = N.planMeals({ recipes, days, slots: ['dinner'], rng: N.mulberry32(42), gap: 3 });
  assert.equal(plan.length, 14);
  for (let i = 0; i < plan.length; i++) for (let j = i + 1; j <= i + 3 && j < plan.length; j++) assert.notEqual(plan[i].recipeId, plan[j].recipeId);
  let fav = 0;
  let other = 0;
  for (let s = 0; s < 200; s++) {
    const p = N.planMeals({ recipes, days: days.slice(0, 1), slots: ['dinner'], rng: N.mulberry32(s) });
    if (p[0].recipeId === 'r0') fav++;
    else if (p[0].recipeId === 'r1') other++;
  }
  assert.ok(fav > other * 1.6, `fav ${fav} other ${other}`);
  const kept = N.planMeals({ recipes, days: days.slice(0, 2), slots: ['dinner'], keep: [{ date: days[0], slot: 'dinner', recipeId: 'r5' }], rng: N.mulberry32(1) });
  assert.equal(kept[0].recipeId, 'r5');
  assert.notEqual(kept[1].recipeId, 'r5');
});

test('planner relaxes the gap rather than leaving a slot empty', () => {
  const recipes = [{ id: 'a', meals: ['lunch'] }, { id: 'b', meals: ['lunch'] }];
  const days = ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04'];
  const plan = N.planMeals({ recipes, days, slots: ['lunch'], rng: N.mulberry32(3) });
  assert.equal(plan.length, 4);
});

test('sleep maths', () => {
  assert.equal(N.sleepMinutes('22:00', '07:45'), 585);
  assert.equal(N.sleepMinutes('00:30', '08:00'), 450);
  assert.equal(N.bedtimeOffset('22:30'), -90);
  assert.equal(N.bedtimeOffset('00:15'), 15);
  close(N.stdev([1, 2, 3, 4]), 1.2909944487358056);
});

test('AFCD classify avoids monounsaturated/saturated confusion', () => {
  assert.equal(classify('Total monounsaturated fatty acids, equated (g)'), null);
  assert.equal(classify('Total saturated fatty acids, equated (g)').key, 'satfat');
  assert.equal(classify('Energy with dietary fibre, equated (kJ)').key, 'energyKj');
  assert.equal(classify('Sodium (Na) (mg)').key, 'sodium');
  assert.equal(classify('Iron (Fe) (mg)').key, 'iron');
  assert.equal(classify('Protein (g)').key, 'protein');
  close(convertUnit(1, 'g', 'mg'), 1000);
  close(convertUnit(500, 'µg', 'mg'), 0.5);
});

test('AFCD wide layout parses with a title row above headers', () => {
  const rows = [
    ['Australian Food Composition Database - Release 3 - Nutrient profiles per 100 g'],
    [],
    ['Public Food Key', 'Classification', 'Food Name', 'Energy with dietary fibre, equated (kJ)', 'Energy, without dietary fibre, equated (kJ)', 'Protein (g)', 'Fat, total (g)', 'Total saturated fatty acids, equated (g)', 'Total monounsaturated fatty acids, equated (g)', 'Available carbohydrate, with sugar alcohols (g)', 'Total dietary fibre (g)', 'Total sugars (g)', 'Added sugars (g)', 'Sodium (Na) (mg)', 'Vitamin B12 (µg)'],
    ['F002258', 13, 'Chicken, breast, lean flesh, grilled, no added fat', 669.4, 669.4, 31.2, 3.3, 0.9, 1.4, 0, 0, 0, 0, 62, 0.3],
    ['F007500', 12, 'Rice, white, boiled, no added salt', 544, 530, 2.6, 0.3, 0.1, 0.1, 28.5, 0.8, 0.1, 0, 2, null],
    [null, null, null],
  ];
  const { foods, report } = parseAfcd([{ name: 'Nutrient profiles', rows }]);
  assert.equal(report.layout, 'wide');
  assert.equal(foods.length, 2);
  const c = foods[0];
  assert.equal(c.id, 'afcd:F002258');
  close(c.per100.kcal, 669.4 / 4.184);
  assert.equal(c.per100.protein, 31.2);
  assert.equal(c.per100.satfat, 0.9);
  assert.equal(c.per100.sodium, 62);
  assert.equal(c.per100.vitB12, 0.3);
  assert.ok(report.ok);
});

test('AFCD long layout joins names from Food Details', () => {
  const details = [['Key', 'Name', 'Description'], ['F1', 'Apple, red skin, raw', 'x']];
  const nut = [
    ['Key', 'Nutrient ID', 'Description', 'Scale', 'Value', 'Category'],
    ['F1', 'ENERFJ', 'Energy, with dietary fibre', 'kJ', 230, 'PROX'],
    ['F1', 'PROT', 'Protein', 'g', 0.3, 'PROX'],
    ['F1', 'FAT', 'Fat, total', 'g', 0.2, 'PROX'],
    ['F1', 'CHOAVL', 'Available carbohydrate, with sugar alcohols', 'g', 12, 'PROX'],
    ['F1', 'NA', 'Sodium (Na)', 'mg', 1, 'MNS'],
    ['F1', 'FIBT', 'Total dietary fibre', 'g', 2.4, 'PROX'],
    ['F1', 'VITC', 'Vitamin C', 'mg', 5, 'VIT'],
  ];
  const { foods, report } = parseAfcd([{ name: 'details', rows: details }, { name: 'nutrients', rows: nut }]);
  assert.equal(report.layout, 'long');
  assert.equal(foods[0].name, 'Apple, red skin, raw');
  close(foods[0].per100.kcal, 230 / 4.184);
  assert.equal(foods[0].per100.fibre, 2.4);
  assert.ok(report.ok, JSON.stringify(report));
});

test('AFCD rejects unrelated sheets with a clear message', () => {
  const r = parseAfcd([{ name: 'x', rows: [['hello', 'world'], [1, 2]] }]);
  assert.equal(r.report.ok, false);
  assert.match(r.report.message, /Nutrient profiles/);
});

test('AFCD energy in kcal is not mistaken for kJ', () => {
  const rows = [['Food Name', 'Energy, with dietary fibre (kcal)', 'Protein (g)', 'Fat, total (g)', 'Sodium (mg)'], ['Egg, boiled', 140, 12, 10, 130]];
  const { foods } = parseAfcd([{ name: 's', rows }]);
  close(foods[0].per100.kcal, 140);
});

test('matching never swaps one protein for another, and needs the actual food word', async () => {
  const N = await import('../js/nutrition.js');
  const foods = [
    { id: 'b', name: 'Beef, steak, stir-fried', source: 'afcd', per100: {} },
    { id: 'c', name: 'Chicken, breast, stir-fried', source: 'afcd', per100: {} },
    { id: 'n', name: 'Noodles, rice, stir-fried', source: 'afcd', per100: {} },
  ];
  const r = N.matchFoods('Chicken stir-fried', foods);
  assert.equal(r[0].food.id, 'c');
  assert.ok(!r.some(x => x.food.id === 'b'), 'beef must not match chicken');
  assert.ok(!N.matchFoods('Pad see ew', foods).length, 'unrelated foods must not match on cooking words');
});

test('AI dish estimates are clamped and calories agree with macros', async () => {
  const N = await import('../js/nutrition.js');
  const p = N.sanePer100({ kcal: 900, protein: 8, fat: 100, satfat: 200, carbs: 20, sugars: 50, fibre: 1, sodium: 500 });
  assert.equal(p.fat, 30);
  assert.ok(p.satfat <= p.fat);
  assert.ok(p.sugars <= p.carbs);
  assert.equal(p.kcal, Math.round(4 * 8 + 4 * 20 + 9 * 30 + 2));
});
