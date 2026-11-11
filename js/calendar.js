// Server-free reminders: export the reminder schedule as an .ics calendar with alerts.
// iPhone Calendar fires these on-device, offline, with HealthOS closed.
import * as core from './core.js';
import { buildConfig } from './api.js';

const BYDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const pad = n => String(n).padStart(2, '0');
const esc = s => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');

function nextDateFor(wd) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  while (d.getDay() !== wd) d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

/** times: array of 7 'HH:MM'|null → one weekly event per distinct time. */
function weekly(id, title, body, times) {
  const byTime = {};
  times.forEach((t, wd) => t && (byTime[t] = byTime[t] || []).push(wd));
  return Object.entries(byTime).map(([t, days]) => ({ uid: `${id}-${t.replace(':', '')}`, title, body, start: `${days.map(nextDateFor).sort()[0]}T${t.replace(':', '')}00`, rrule: `FREQ=WEEKLY;BYDAY=${days.map(d => BYDAY[d]).join(',')}` }));
}

export async function buildIcs() {
  const cfg = await buildConfig();
  const ev = [];
  for (const s of cfg.medSlots) {
    const hide = cfg.privacy && cfg.privacy.hideMedNames;
    const body = hide ? `${s.meds.length} item(s) to take` : s.meds.map(m => `${m.name}${m.dose ? ' ' + m.dose : ''}`).join(', ');
    ev.push(...weekly('med-' + s.id, `💊 ${s.name}`, body, s.times));
  }
  if (cfg.water.enabled) {
    const times = Array.from({ length: 7 }, () => []);
    cfg.water.days.forEach((w, wd) => {
      const iv = Math.max(15, Number(w.interval) || 90);
      for (let m = core.toMin(w.start); m <= core.toMin(w.end); m += iv) times[wd].push(core.fromMin(m));
    });
    const all = [...new Set(times.flat())];
    for (const t of all) ev.push(...weekly('water', '💧 Water', `Target ${cfg.water.target} ml today`, times.map(list => (list.includes(t) ? t : null))));
  }
  for (const r of cfg.recurring) ev.push(...weekly(r.id, r.title, r.body, r.times));
  for (const t of cfg.timed) ev.push({ uid: t.id, title: t.title, body: t.body, start: t.at.replace(/[-:]/g, '') + '00' });
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//HealthOS//EN', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:HealthOS reminders'];
  for (const e of ev) {
    lines.push('BEGIN:VEVENT', `UID:${e.uid}@healthos`, `DTSTAMP:${stamp}`, `DTSTART:${e.start}`, 'DURATION:PT5M', `SUMMARY:${esc(e.title)}`, `DESCRIPTION:${esc(e.body)}`, 'TRANSP:TRANSPARENT');
    if (e.rrule) lines.push(`RRULE:${e.rrule}`);
    lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(e.title)}`, 'TRIGGER:PT0M', 'END:VALARM', 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return { text: lines.join('\r\n'), count: ev.length };
}

export async function exportCalendar() {
  const { text, count } = await buildIcs();
  const file = new File([text], 'healthos-reminders.ics', { type: 'text/calendar' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'HealthOS reminders' });
      return count;
    } catch (e) {
      if (e.name === 'AbortError') return 0;
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = 'healthos-reminders.ics';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => a.remove(), 1000);
  return count;
}
