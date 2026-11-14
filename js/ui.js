// UI primitives: escaping, icons, sheets, toasts, rings, bars, charts, image handling.

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const attr = esc;

const P = {
  today: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v9.5h13V10"/><path d="M10 19.5v-5h4v5"/>',
  planner: '<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  nutrition: '<path d="M12 21c-4.4 0-7.5-3.4-7.5-8 0-3.6 2.4-6 5-6 1.2 0 1.9.5 2.5.5s1.3-.5 2.5-.5c2.6 0 5 2.4 5 6 0 4.6-3.1 8-7.5 8Z"/><path d="M12 7.5c0-2 1-3.5 3-4.5"/>',
  health: '<path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7a4.3 4.3 0 0 1 7.5 2.8C19.5 15.4 12 20 12 20Z"/><path d="M3 12h4l1.5-2.5 2.5 5 2-3.5h8"/>',
  stats: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  camera: '<path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.8l1.4-2h4.6l1.4 2h1.8A2.5 2.5 0 0 1 20 8.5v9a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17.5Z"/><circle cx="12" cy="13" r="3.5"/>',
  pen: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16Z"/><path d="m13.5 6.5 4 4"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
  book: '<path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5Z"/><path d="M5 19.5A1.5 1.5 0 0 0 6.5 21H19v-3"/>',
  bolt: '<path d="M13 3 5 13.5h6L10 21l8-10.5h-6Z"/>',
  drop: '<path d="M12 3.5s6.5 7 6.5 11.2a6.5 6.5 0 0 1-13 0C5.5 10.5 12 3.5 12 3.5Z"/>',
  pill: '<rect x="3" y="8.5" width="18" height="7" rx="3.5" transform="rotate(-35 12 12)"/><path d="m9.2 8 5.6 8"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z"/>',
  dumbbell: '<path d="M6.5 6.5v11M17.5 6.5v11M3.5 9v6M20.5 9v6M6.5 12h11"/>',
  chevL: '<path d="m15 5-7 7 7 7"/>',
  chevR: '<path d="m9 5 7 7-7 7"/>',
  link: '<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"/>',
  image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="9" cy="10" r="1.8"/><path d="m20.5 16-5-5-9 8.5"/>',
  sparkle: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18"/>',
  heart: '<path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7a4.3 4.3 0 0 1 7.5 2.8C19.5 15.4 12 20 12 20Z"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8"/>',
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15Z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  label: '<rect x="4" y="3.5" width="16" height="17" rx="2.5"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  scale: '<path d="M5 20h14l-1.5-12h-11Z"/><circle cx="12" cy="5" r="2"/>',
  note: '<path d="M6 3.5h9l4 4V20a.5.5 0 0 1-.5.5h-12A.5.5 0 0 1 6 20Z"/><path d="M9 11h6M9 15h6"/>',
  more: '<circle cx="5.5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="18.5" cy="12" r="1.3" fill="currentColor"/>',
  steps: '<path d="M8.5 3.5c1.8 0 2.7 1.9 2.4 4.4l-.4 3.3c-.1.9-.9 1.6-1.8 1.5l-1.5-.2c-.9-.1-1.5-.9-1.4-1.8l.4-3.4C6.4 5.4 7 3.5 8.5 3.5Z"/><path d="M7.2 15.4l2.6.3-.3 2.3a1.3 1.3 0 0 1-2.6-.3Z"/><path d="M15.5 6.5c1.5 0 2.1 1.7 1.9 3.9l-.3 2.6c-.1.8-.8 1.3-1.6 1.2l-1.3-.1c-.8-.1-1.3-.8-1.2-1.6l.3-2.6c.2-1.8.8-3.4 2.2-3.4Z"/><path d="M13.6 16.4l2.3.2-.2 2a1.15 1.15 0 0 1-2.3-.2Z"/>',
  trend: '<path d="M3 17 9 11l4 4 8-8"/><path d="M15 7h6v6"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1" fill="currentColor"/><circle cx="4.5" cy="12" r="1" fill="currentColor"/><circle cx="4.5" cy="18" r="1" fill="currentColor"/>',
  repeat: '<path d="M17 2.5 20.5 6 17 9.5"/><path d="M3.5 11V9.5A3.5 3.5 0 0 1 7 6h13.5M7 21.5 3.5 18 7 14.5"/><path d="M20.5 13v1.5A3.5 3.5 0 0 1 17 18H3.5"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="2"/><rect x="13" y="4" width="7" height="7" rx="2"/><rect x="4" y="13" width="7" height="7" rx="2"/><rect x="13" y="13" width="7" height="7" rx="2"/>',
  fork: '<path d="M7 3v8a2 2 0 0 0 2 2v8M5 3v5M9 3v5M17 21V3c-2.2 0-3.5 2.5-3.5 6v4H17"/>',
  user: '<circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20.5c1.2-3.6 4-5.2 7.5-5.2s6.3 1.6 7.5 5.2"/>',
  smile: '<circle cx="12" cy="12" r="8.5"/><path d="M8.5 14.5c.9 1.2 2.1 1.8 3.5 1.8s2.6-.6 3.5-1.8M9 9.5h.01M15 9.5h.01"/>',
  checklist: '<path d="m4 7 1.5 1.5L8.5 5.5M4 15l1.5 1.5 3-3M11.5 7H20M11.5 15H20"/>',
};
export function icon(name, cls = '') {
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`;
}

// ---------------- toast ----------------
let toastTimer;
export function toast(msg, { action, onAction, ms = 2600 } = {}) {
  let el = document.querySelector('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  el.innerHTML = `<span>${esc(msg)}</span>${action ? `<button>${esc(action)}</button>` : ''}`;
  if (action) el.querySelector('button').onclick = () => {
    el.classList.remove('on');
    onAction && onAction();
  };
  requestAnimationFrame(() => el.classList.add('on'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('on'), action ? ms + 2400 : ms);
}

// ---------------- sheets ----------------
const stack = [];
export function sheet({ title = '', body = '', foot = null, onMount, onClose, wide = false } = {}) {
  const back = document.createElement('div');
  back.className = 'backdrop';
  const el = document.createElement('section');
  el.className = 'sheet';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  if (wide) el.style.maxWidth = '820px';
  el.innerHTML = `<div class="grab"></div><header class="sheet-head"><div class="h2">${title}</div><button class="icon-btn" data-close aria-label="Close">${icon('x')}</button></header><div class="sheet-body"></div>${foot !== null ? `<footer class="sheet-foot"></footer>` : ''}`;
  let closed = false;
  const api = {
    el,
    body: el.querySelector('.sheet-body'),
    foot: el.querySelector('.sheet-foot'),
    setTitle(t) {
      el.querySelector('.sheet-head .h2').innerHTML = t;
    },
    setBody(h) {
      api.body.innerHTML = h;
    },
    setFoot(h) {
      if (!api.foot) return;
      api.foot.innerHTML = h;
      api.foot.style.display = h ? '' : 'none';
    },
    close() {
      if (closed) return;
      closed = true;
      el.classList.remove('on', 'drag');
      el.style.transform = '';
      back.classList.remove('on');
      const i = stack.indexOf(api);
      if (i >= 0) stack.splice(i, 1);
      setTimeout(() => {
        el.remove();
        back.remove();
      }, 420);
      onClose && onClose();
    },
  };
  api.body.innerHTML = body;
  if (api.foot) api.foot.innerHTML = foot;
  if (api.foot && !foot) api.foot.style.display = 'none';
  back.onclick = () => api.close();
  el.querySelector('[data-close]').onclick = () => api.close();
  // Drag down to dismiss: from the handle/header, or from the content when it's scrolled to the top.
  let y0 = null;
  let t0 = 0;
  let dy = 0;
  el.addEventListener('touchstart', e => {
    const inBody = api.body.contains(e.target);
    if (inBody && api.body.scrollTop > 0) return;
    if (e.target.closest('input, textarea, select, .chart')) return;
    y0 = e.touches[0].clientY;
    t0 = Date.now();
    dy = 0;
  }, { passive: true });
  el.addEventListener('touchmove', e => {
    if (y0 == null) return;
    dy = e.touches[0].clientY - y0;
    if (dy <= 0) {
      if (dy < -6) y0 = null;
      el.classList.remove('drag');
      el.style.transform = '';
      return;
    }
    if (api.body.scrollTop > 0) return;
    el.classList.add('drag');
    el.style.transform = `translateY(${dy}px)`;
    back.style.opacity = String(Math.max(0.2, 1 - dy / 500));
  }, { passive: true });
  el.addEventListener('touchend', () => {
    if (y0 == null) return;
    const v = dy / Math.max(1, Date.now() - t0);
    el.classList.remove('drag');
    back.style.opacity = '';
    y0 = null;
    if (dy > 120 || (dy > 40 && v > 0.6)) api.close();
    else el.style.transform = '';
  });
  document.body.append(back, el);
  stack.push(api);
  requestAnimationFrame(() => {
    back.classList.add('on');
    el.classList.add('on');
  });
  onMount && onMount(api);
  return api;
}
/** A sheet whose body re-renders (smoothly, via morph) whenever data changes. */
const live = new Set();
export function liveSheet({ title, render, foot = null, onClose } = {}) {
  const s = sheet({ title, body: `<div class="loading-block"><span class="spinner"></span></div>`, foot, onClose: () => {
    live.delete(s);
    onClose && onClose();
  } });
  s.refresh = async () => morph(s.body, await render(s));
  live.add(s);
  render(s).then(h => (s.body.innerHTML = h));
  return s;
}
export function refreshLiveSheets() {
  for (const s of live) s.refresh().catch(() => {});
}

// ---------------- DOM morphing: update the page in place so nothing flickers ----------------
function sameNode(a, b) {
  if (a.nodeType !== b.nodeType) return false;
  if (a.nodeType !== 1) return true;
  if (a.tagName !== b.tagName) return false;
  const ka = a.getAttribute('data-key');
  const kb = b.getAttribute('data-key');
  if (ka || kb) return ka === kb;
  if (a.tagName === 'INPUT' && (a.getAttribute('type') || 'text') !== (b.getAttribute('type') || 'text')) return false;
  return true;
}
function patchAttrs(a, b) {
  for (const { name } of [...a.attributes]) if (!b.hasAttribute(name) && !(name === 'open' && a.tagName === 'DETAILS')) a.removeAttribute(name);
  for (const { name, value } of [...b.attributes]) {
    const old = a.getAttribute(name);
    if (old === value) continue;
    a.setAttribute(name, value);
    if (name === 'value' && (a.tagName === 'INPUT' || a.tagName === 'SELECT') && a.type !== 'file' && a !== document.activeElement) a.value = value;
    if (name === 'checked' && a.tagName === 'INPUT') a.checked = true;
  }
  if (a.tagName === 'INPUT' && a.hasAttribute('checked') !== b.hasAttribute('checked')) a.checked = b.hasAttribute('checked');
}
function patchNode(a, b) {
  if (a.nodeType !== 1) {
    if (a.nodeValue !== b.nodeValue) a.nodeValue = b.nodeValue;
    return;
  }
  const hadChecked = a.tagName === 'INPUT' && a.hasAttribute('checked');
  patchAttrs(a, b);
  if (a.tagName === 'INPUT' && hadChecked !== b.hasAttribute('checked')) a.checked = b.hasAttribute('checked');
  if (a.tagName === 'TEXTAREA') {
    if (a.defaultValue !== b.defaultValue && a !== document.activeElement) {
      a.defaultValue = b.defaultValue;
      a.value = b.defaultValue;
    }
    return;
  }
  patchChildren(a, b);
  if (a.tagName === 'SELECT' && a !== document.activeElement) {
    const sel = b.querySelector('option[selected]');
    if (sel) a.value = sel.value;
  }
}
function patchChildren(parent, next) {
  let a = parent.firstChild;
  let b = next.firstChild;
  while (b) {
    const nb = b.nextSibling;
    if (!a) {
      parent.appendChild(b);
    } else if (sameNode(a, b)) {
      patchNode(a, b);
      a = a.nextSibling;
    } else {
      const na = a.nextSibling;
      parent.replaceChild(b, a);
      a = na;
    }
    b = nb;
  }
  while (a) {
    const na = a.nextSibling;
    parent.removeChild(a);
    a = na;
  }
}
export function morph(el, html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  patchChildren(el, tpl.content);
}

// ---------------- page header & week strip ----------------
/** Large-title header with glass buttons. `back` shows a back chevron. */
export function pageHead({ title, sub = '', back = false, actions = '', center = false }) {
  return `<header class="ph ${center ? 'center' : ''}"><div class="ph-bar">${back ? `<button class="glass-btn" data-act="back" aria-label="Back">${icon('chevL')}</button>` : ''}<div class="ph-actions">${actions}</div></div><h1 class="ph-title" data-title="${esc(title)}">${esc(title)}</h1>${sub ? `<div class="ph-sub">${sub}</div>` : ''}</header>`;
}
export const glassBtn = (act, ic, label, extra = '') => `<button class="glass-btn" data-act="${act}" aria-label="${esc(label)}" ${extra}>${icon(ic)}</button>`;

/**
 * Mon–Sun strip for the week containing `date`. marks: { 'YYYY-MM-DD': 'full'|'part'|'' }.
 * Tapping a day fires `act` with data-date.
 */
export function weekStrip(date, { act = 'date-pick', marks = null, todayYmd, addDays, parseYmd } = {}) {
  const d0 = parseYmd(date);
  const wd = d0.getDay();
  const start = addDays(date, wd === 0 ? -6 : 1 - wd);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const L = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  const label = parseYmd(start).toLocaleDateString('en-AU', { month: 'long', year: 'numeric' });
  return `<div class="wk-head"><button class="icon-btn" data-act="${act}" data-date="${addDays(date, -7)}" aria-label="Previous week">${icon('chevL')}</button><span class="lbl">${label}</span><button class="icon-btn" data-act="${act}" data-date="${addDays(date, 7)}" aria-label="Next week">${icon('chevR')}</button></div><div class="wk">${days
    .map(d => {
      const p = parseYmd(d);
      const cls = [d === date ? 'sel' : '', d === todayYmd ? 'today' : '', d > todayYmd ? 'future' : ''].join(' ');
      return `<button class="${cls}" data-act="${act}" data-date="${d}"><span class="l">${L[p.getDay()]}</span><span class="n">${p.getDate()}</span>${marks ? `<span class="m ${marks[d] || ''}"></span>` : ''}</button>`;
    })
    .join('')}</div>`;
}

export function topSheet() {
  return stack[stack.length - 1];
}
export function closeAllSheets() {
  [...stack].forEach(s => s.close());
}

export function confirmSheet(message, { ok = 'Confirm', danger = false } = {}) {
  return new Promise(resolve => {
    let answered = false;
    const s = sheet({
      title: 'Are you sure?',
      body: `<p class="ink2" style="margin:4px 2px 8px">${esc(message)}</p>`,
      foot: `<button class="btn" data-no>Cancel</button><button class="btn ${danger ? 'danger' : 'primary'}" data-yes>${esc(ok)}</button>`,
      onClose: () => !answered && resolve(false),
    });
    s.foot.querySelector('[data-no]').onclick = () => s.close();
    s.foot.querySelector('[data-yes]').onclick = () => {
      answered = true;
      resolve(true);
      s.close();
    };
  });
}

export function promptSheet(title, { label = '', value = '', type = 'text', placeholder = '', ok = 'Save' } = {}) {
  return new Promise(resolve => {
    let answered = false;
    const s = sheet({
      title: esc(title),
      body: `<label class="field"><span>${esc(label)}</span><input class="input" type="${type}" value="${esc(value)}" placeholder="${esc(placeholder)}" ${type === 'number' ? 'inputmode="decimal"' : ''}></label>`,
      foot: `<button class="btn" data-no>Cancel</button><button class="btn primary" data-yes>${esc(ok)}</button>`,
      onClose: () => !answered && resolve(null),
    });
    const inp = s.body.querySelector('input');
    setTimeout(() => inp.focus(), 250);
    const yes = () => {
      answered = true;
      resolve(inp.value);
      s.close();
    };
    // Must not return false from an on* handler: that cancels every keystroke.
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        yes();
      }
    });
    s.foot.querySelector('[data-no]').onclick = () => s.close();
    s.foot.querySelector('[data-yes]').onclick = yes;
  });
}

// ---------------- rings & bars ----------------
export function ring(pct, { size = 120, stroke = 11, color = 'var(--accent)', inner = '' } = {}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(1, pct || 0));
  return `<div class="ring" style="width:${size}px;height:${size}px"><svg width="${size}" height="${size}"><circle class="ring-bg" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke-width="${stroke}"/><circle class="ring-fg" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-dasharray="${c.toFixed(2)}" style="--c:${c.toFixed(2)};stroke-dashoffset:${(c * (1 - p)).toFixed(2)};stroke-opacity:${p === 0 ? 0 : 1}"/></svg><div class="ring-in">${inner}</div></div>`;
}
export function bar(pct, color, { limit = false } = {}) {
  const w = Math.max(0, Math.min(1, pct || 0)) * (limit ? 100 / 1.25 : 100);
  return `<div class="bar ${limit ? 'limit' : ''}"><i style="width:${w}%;background:${color}"></i>${limit ? `<b style="left:${100 / 1.25}%"></b>` : ''}</div>`;
}

// ---------------- charts (single-series, one axis, tap/hover tooltips) ----------------
/**
 * points: [{ label, value, tip }] in order. kind: 'line' | 'bar'.
 * target: optional dashed reference line.
 */
export function chart(points, { kind = 'bar', color = 'var(--accent)', height = 150, target = null, unit = '', fmt = v => Math.round(v).toLocaleString('en-AU'), yMin = 0, domain = null } = {}) {
  const vals = points.map(p => p.value).filter(v => v != null && Number.isFinite(v));
  if (!vals.length) return `<div class="empty small">No data in this period yet.</div>`;
  const W = 340;
  const H = height;
  const L = 34;
  const R = 6;
  const T = 10;
  const B = 22;
  let max = Math.max(...vals, target || 0);
  let min = kind === 'line' ? Math.min(...vals, target ?? Infinity) : yMin;
  if (domain) {
    [min, max] = domain;
  } else if (kind === 'line') {
    const pad = Math.max((max - min) * 0.15, Math.abs(max) * 0.04, 1);
    max += pad;
    min = Math.max(yMin === 0 && min >= 0 ? 0 : -Infinity, min - pad);
  } else max = max * 1.08 || 1;
  const x = i => L + (points.length === 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (points.length - 1 || 1));
  const bw = Math.max(3, Math.min(22, ((W - L - R) / points.length) * 0.62));
  const xb = i => L + ((i + 0.5) * (W - L - R)) / points.length;
  const y = v => T + (H - T - B) * (1 - (v - min) / (max - min || 1));
  const ticks = [min, (min + max) / 2, max];
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img">`;
  for (const t of ticks) svg += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/><text class="axis" x="${L - 6}" y="${y(t) + 3.5}" text-anchor="end">${esc(fmt(t))}</text>`;
  const step = Math.ceil(points.length / 7);
  points.forEach((p, i) => {
    if (i % step === 0 || i === points.length - 1) svg += `<text class="axis" x="${kind === 'bar' ? xb(i) : x(i)}" y="${H - 6}" text-anchor="middle">${esc(p.label)}</text>`;
  });
  if (kind === 'bar') {
    points.forEach((p, i) => {
      if (p.value == null) return;
      const top = y(p.value);
      const h = Math.max(0, y(min) - top);
      const r = Math.min(4, bw / 2, h);
      svg += `<path d="M${xb(i) - bw / 2},${y(min)} V${top + r} Q${xb(i) - bw / 2},${top} ${xb(i) - bw / 2 + r},${top} H${xb(i) + bw / 2 - r} Q${xb(i) + bw / 2},${top} ${xb(i) + bw / 2},${top + r} V${y(min)} Z" fill="${p.color || color}" opacity="${p.dim ? 0.35 : 1}"/>`;
    });
  } else {
    let d = '';
    let pen = false;
    points.forEach((p, i) => {
      if (p.value == null) {
        pen = false;
        return;
      }
      d += `${pen ? 'L' : 'M'}${x(i)},${y(p.value)} `;
      pen = true;
    });
    svg += `<path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    points.forEach((p, i) => {
      if (p.value != null && (points.length <= 31 || i === points.length - 1)) svg += `<circle cx="${x(i)}" cy="${y(p.value)}" r="${points.length <= 14 ? 3.5 : 2.2}" fill="${color}" stroke="var(--card)" stroke-width="1.5"/>`;
    });
  }
  if (target != null) svg += `<line class="target" x1="${L}" x2="${W - R}" y1="${y(target)}" y2="${y(target)}"/>`;
  points.forEach((p, i) => {
    const cx = kind === 'bar' ? xb(i) : x(i);
    const w = (W - L - R) / points.length;
    const tip = p.value == null ? `${p.label}: no data` : p.tip || `${p.label}: ${fmt(p.value)}${unit ? ' ' + unit : ''}`;
    svg += `<rect class="hit" data-tip="${esc(tip)}" data-x="${cx.toFixed(1)}" data-y="${(p.value == null ? 20 : y(p.value)).toFixed(1)}" x="${cx - w / 2}" y="0" width="${w}" height="${H}"/>`;
  });
  svg += '</svg>';
  return `<div class="chart" data-w="${W}">${svg}<div class="tip"></div></div>`;
}
function showTip(hit) {
  const el = hit.closest('.chart');
  const svg = el.querySelector('svg');
  const tip = el.querySelector('.tip');
  const sx = svg.clientWidth / Number(el.dataset.w);
  tip.textContent = hit.dataset.tip;
  tip.style.left = Math.max(50, Math.min(svg.clientWidth - 50, Number(hit.dataset.x) * sx)) + 'px';
  tip.style.top = Number(hit.dataset.y) * sx + 'px';
  tip.classList.add('on');
}
document.addEventListener('pointerover', e => e.target.classList && e.target.classList.contains('hit') && showTip(e.target));
document.addEventListener('pointerdown', e => {
  if (e.target.classList && e.target.classList.contains('hit')) showTip(e.target);
  else document.querySelectorAll('.chart .tip.on').forEach(t => t.classList.remove('on'));
});
document.addEventListener('pointerout', e => {
  const c = e.target.closest && e.target.closest('.chart');
  if (c && !c.contains(e.relatedTarget)) c.querySelector('.tip').classList.remove('on');
});

// ---------------- images ----------------
export function fileToImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read that image'));
    };
    img.src = url;
  });
}
export async function compressImage(file, max = 1280, quality = 0.82) {
  const { img, url } = await fileToImage(file);
  const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.round(img.naturalWidth * scale);
  const h = Math.round(img.naturalHeight * scale);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.getContext('2d').drawImage(img, 0, 0, w, h);
  URL.revokeObjectURL(url);
  const dataUrl = c.toDataURL('image/jpeg', quality);
  return { dataUrl, base64: dataUrl.split(',')[1], mime: 'image/jpeg', w, h };
}
export async function thumbFromDataUrl(dataUrl, max = 360) {
  const blob = await (await fetch(dataUrl)).blob();
  return (await compressImage(blob, max, 0.78)).dataUrl;
}

export function download(name, text, type = 'application/json') {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1000);
}

export const debounce = (fn, ms) => {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
};
export function initials(name) {
  return esc(
    String(name || '?')
      .split(/\s+/)
      .slice(0, 2)
      .map(w => w[0] || '')
      .join('')
      .toUpperCase()
  );
}
export function daychips(name, selected = [0, 1, 2, 3, 4, 5, 6]) {
  const L = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  return `<div class="daychips">${[1, 2, 3, 4, 5, 6, 0].map(d => `<label><input type="checkbox" name="${name}" value="${d}" ${selected.includes(d) ? 'checked' : ''}><span>${L[d]}</span></label>`).join('')}</div>`;
}
export function readDays(root, name) {
  return [...root.querySelectorAll(`input[name="${name}"]:checked`)].map(i => Number(i.value));
}
export function toggleHtml(name, on, extra = '') {
  return `<label class="toggle"><input type="checkbox" name="${name}" ${on ? 'checked' : ''} ${extra}><i></i></label>`;
}
