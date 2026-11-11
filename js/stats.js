// Statistics: trends and comparisons across every module.
import * as db from './db.js';
import * as core from './core.js';
import * as N from './nutrition.js';
import { chart, esc } from './ui.js';
import { state, register, rerender } from './state.js';
import { nutColor } from './food.js';

function dates(n, end) {
  return Array.from({ length: n }, (_, i) => core.addDays(end, i - n + 1));
}
const lbl = (d, n) => (n <= 14 ? String(core.parseYmd(d).getDate()) : core.parseYmd(d).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }));
const pctTxt = v => (v == null ? '—' : Math.round(v * 100) + '%');
const delta = (a, b, dp = 0, unit = '') => {
  if (a == null || b == null) return '';
  const d = a - b;
  if (Math.abs(d) < 10 ** -dp / 2) return '<span class="muted">no change</span>';
  return `${d > 0 ? '▲' : '▼'} ${Math.abs(d).toFixed(dp)}${unit} vs previous`;
};

async function collect(from, to) {
  const [entries, water, medlog, sleep, workouts, weight, checks, journal] = await Promise.all(['entries', 'water', 'medlog', 'sleep', 'workouts', 'weight', 'checks', 'journal'].map(s => db.range(s, from, to)));
  return { entries, water, medlog, sleep, workouts, weight, checks, journal };
}

async function summarise(ds, data, s) {
  const meds = await db.all('meds');
  const routines = await db.all('routines');
  const perDay = ds.map(d => {
    const e = data.entries.filter(x => x.date === d);
    const tot = e.length ? N.dayTotals(e).totals : null;
    const water = data.water.filter(x => x.date === d).reduce((a, w) => a + w.ml, 0);
    const sl = data.sleep.filter(x => x.date === d).sort((a, b) => (a.source === 'manual' ? 0 : 1) - (b.source === 'manual' ? 0 : 1))[0];
    const hours = sl ? sl.hours ?? (sl.bed && sl.wake ? N.sleepMinutes(sl.bed, sl.wake) / 60 : null) : null;
    const req = meds.filter(m => !m.optional && core.medActiveOn(m, d));
    const taken = req.filter(m => data.medlog.some(l => l.date === d && l.medId === m.id && l.status === 'taken')).length;
    const habitsTotal = routines.filter(r => core.routineOn(r, d)).reduce((a, r) => a + (r.items || []).length, 0);
    const habitsDone = data.checks.filter(c => c.date === d).length;
    const j = data.journal.filter(x => x.date === d);
    return { d, tot, water, hours, bed: sl && sl.bed ? N.bedtimeOffset(sl.bed) : null, req: req.length, taken, habitsTotal, habitsDone, score: tot ? N.priorityScore(tot, s.targets) : null, energy: N.mean(j.map(x => x.energy)), mood: N.mean(j.map(x => x.mood)), migraine: j.some(x => x.migraine && x.migraine.yes) };
  });
  const logged = perDay.filter(p => p.tot);
  const avgNut = k => N.mean(logged.map(p => p.tot[k]));
  const reqSum = perDay.reduce((a, p) => a + p.req, 0);
  const habitSum = perDay.reduce((a, p) => a + p.habitsTotal, 0);
  return {
    perDay,
    loggedDays: logged.length,
    avgNut,
    score: N.mean(perDay.map(p => p.score)),
    water: N.mean(perDay.map(p => p.water)),
    waterHit: perDay.filter(p => p.water >= s.water.target).length / perDay.length,
    sleep: N.mean(perDay.map(p => p.hours)),
    bedSd: N.stdev(perDay.map(p => p.bed)),
    adherence: reqSum ? perDay.reduce((a, p) => a + p.taken, 0) / reqSum : null,
    habits: habitSum ? perDay.reduce((a, p) => a + Math.min(p.habitsDone, p.habitsTotal), 0) / habitSum : null,
    workouts: data.workouts.length,
    migraines: perDay.filter(p => p.migraine).length,
  };
}

export async function render() {
  const s = await core.getSettings();
  const n = state.statsRange;
  const end = core.today();
  const ds = dates(n, end);
  const prevDs = dates(n, core.addDays(end, -n));
  const [cur, prev] = await Promise.all([collect(ds[0], end), collect(prevDs[0], prevDs[n - 1])]);
  const A = await summarise(ds, cur, s);
  const B = await summarise(prevDs, prev, s);
  const weeks = n / 7;
  const range = `<div class="seg-wrap"><div class="seg">${[7, 30, 90].map(v => `<button class="${n === v ? 'on' : ''}" data-act="stats-range" data-v="${v}">${v === 7 ? 'Week' : v === 30 ? 'Month' : '90 days'}</button>`).join('')}</div></div>`;
  const tile = (k, v, d, sub) => `<div class="stat"><div class="k">${k}</div><div class="v num">${v}</div><div class="d">${sub || ''}</div>${d ? `<div class="tiny muted" style="margin-top:2px">${d}</div>` : ''}</div>`;
  let html = `<div class="page-head"><div class="eyebrow">Statistics</div><h1 class="title">Trends</h1></div>${range}
  <div class="grid2">
    ${tile('Priority score', A.score == null ? '—' : Math.round(A.score), delta(A.score, B.score), `avg of ${A.loggedDays} logged days`)}
    ${tile('Medication', pctTxt(A.adherence), A.adherence != null && B.adherence != null ? delta(A.adherence * 100, B.adherence * 100, 0, ' pts') : '', 'doses taken')}
    ${tile('Water', A.water == null ? '—' : (A.water / 1000).toFixed(2) + ' L', delta(A.water / 1000, B.water / 1000, 2, ' L'), `target hit ${pctTxt(A.waterHit)} of days`)}
    ${tile('Sleep', A.sleep == null ? '—' : A.sleep.toFixed(1) + ' h', delta(A.sleep, B.sleep, 1, ' h'), A.bedSd == null ? 'bedtime spread —' : `bedtime ±${Math.round(A.bedSd)} min`)}
    ${tile('Workouts', (A.workouts / weeks).toFixed(1), delta(A.workouts / weeks, B.workouts / weeks, 1), 'per week')}
    ${tile('Habits', pctTxt(A.habits), A.habits != null && B.habits != null ? delta(A.habits * 100, B.habits * 100, 0, ' pts') : '', 'routine steps done')}
  </div>`;

  html += `<div class="section-label">Nutrition averages · ${A.loggedDays} logged day${A.loggedDays === 1 ? '' : 's'}</div><div class="card"><div class="table-wrap"><table class="t"><thead><tr><th>Nutrient</th><th class="n">Avg/day</th><th class="n">Target</th><th class="n">Days on target</th></tr></thead><tbody>${s.targets
    .map(t => {
      const nn = N.NUTRIENT[t.key];
      const ok = A.perDay.filter(p => p.tot && p.tot[t.key] != null && (t.kind === 'min' ? p.tot[t.key] >= t.value : p.tot[t.key] <= t.value)).length;
      return `<tr><td><span class="dot" style="background:${nutColor(t.key)}"></span> ${nn.label}</td><td class="n">${N.fmt(t.key, A.avgNut(t.key))} ${nn.unit}</td><td class="n">${t.kind === 'min' ? '≥' : '≤'} ${t.value.toLocaleString('en-AU')}</td><td class="n">${ok}/${A.loggedDays}</td></tr>`;
    })
    .join('')}<tr><td><span class="dot" style="background:var(--accent)"></span> Calories</td><td class="n">${N.fmt('kcal', A.avgNut('kcal'))}</td><td class="n muted">no limit</td><td></td></tr></tbody></table></div><p class="tiny muted" style="margin-bottom:0">Averages only include days with food logged, so a skipped day doesn't drag numbers down.</p></div>`;

  for (const t of s.targets.filter(t => t.show)) {
    const nn = N.NUTRIENT[t.key];
    html += `<div class="card"><div class="card-head"><div class="h3">${nn.label}</div><span class="small muted">${nn.unit}/day · dashed = ${t.kind === 'min' ? 'target' : 'limit'}</span></div>${chart(A.perDay.map(p => ({ label: lbl(p.d, n), value: p.tot ? p.tot[t.key] : null, tip: `${core.relDay(p.d)}: ${p.tot ? N.fmt(t.key, p.tot[t.key]) + ' ' + nn.unit : 'not logged'}` })), { kind: n > 31 ? 'line' : 'bar', color: nutColor(t.key), target: t.value, unit: nn.unit })}</div>`;
  }

  html += `<div class="section-label">Body & routine</div>`;
  html += `<div class="card"><div class="card-head"><div class="h3">Water</div><span class="small muted">ml/day</span></div>${chart(A.perDay.map(p => ({ label: lbl(p.d, n), value: p.water })), { kind: n > 31 ? 'line' : 'bar', color: 'var(--water)', target: s.water.target, unit: 'ml' })}</div>`;
  html += `<div class="card"><div class="card-head"><div class="h3">Sleep</div><span class="small muted">hours</span></div>${chart(A.perDay.map(p => ({ label: lbl(p.d, n), value: p.hours, tip: p.hours == null ? `${core.relDay(p.d)}: not logged` : `${core.relDay(p.d)}: ${p.hours.toFixed(1)} h` })), { kind: n > 31 ? 'line' : 'bar', color: 'var(--sleep)', fmt: v => v.toFixed(0) })}</div>`;
  html += `<div class="card"><div class="card-head"><div class="h3">Medication adherence</div><span class="small muted">% of required doses</span></div>${chart(A.perDay.map(p => ({ label: lbl(p.d, n), value: p.req ? (p.taken / p.req) * 100 : null })), { kind: n > 31 ? 'line' : 'bar', color: 'var(--good)', unit: '%', fmt: v => Math.round(v) + '', domain: [0, 100] })}</div>`;
  const w = cur.weight.sort((a, b) => a.date.localeCompare(b.date));
  html += `<div class="card"><div class="card-head"><div class="h3">Weight</div><span class="small muted">kg</span></div>${chart(w.map(x => ({ label: lbl(x.date, 30), value: x.kg })), { kind: 'line', fmt: v => v.toFixed(1), yMin: -1 })}</div>`;
  const moodPts = A.perDay.filter(p => p.energy != null || p.mood != null);
  html += `<div class="card"><div class="card-head"><div class="h3">Energy</div><span class="small muted">1–5 · ${A.migraines} migraine day${A.migraines === 1 ? '' : 's'}</span></div>${moodPts.length ? chart(A.perDay.map(p => ({ label: lbl(p.d, n), value: p.energy, tip: `${core.relDay(p.d)}: energy ${p.energy ?? '—'}, mood ${p.mood ?? '—'}${p.migraine ? ' · migraine' : ''}` })), { kind: 'line', color: 'var(--sugar)', fmt: v => v.toFixed(0), domain: [1, 5] }) : '<div class="empty small">Log energy and mood in Health → Journal.</div>'}</div>`;
  return html + `<p class="tiny muted center" style="margin-top:14px">${esc(`Comparing ${core.prettyDate(ds[0], { day: 'numeric', month: 'short' })} – today with the ${n} days before.`)}</p>`;
}

register({
  'stats-range': el => {
    state.statsRange = Number(el.dataset.v);
    rerender();
  },
});
