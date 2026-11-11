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
      el.classList.remove('on');
      back.classList.remove('on');
      const i = stack.indexOf(api);
      if (i >= 0) stack.splice(i, 1);
      setTimeout(() => {
        el.remove();
        back.remove();
      }, 300);
      onClose && onClose();
    },
  };
  api.body.innerHTML = body;
  if (api.foot) api.foot.innerHTML = foot;
  if (api.foot && !foot) api.foot.style.display = 'none';
  back.onclick = () => api.close();
  el.querySelector('[data-close]').onclick = () => api.close();
  // swipe down on the grab/header to close
  let y0 = null;
  const head = el.querySelector('.sheet-head');
  [el.querySelector('.grab'), head].forEach(h => {
    h.addEventListener('touchstart', e => (y0 = e.touches[0].clientY), { passive: true });
    h.addEventListener('touchmove', e => {
      if (y0 == null) return;
      const dy = e.touches[0].clientY - y0;
      if (dy > 0) el.style.transform = `translateY(${dy}px)`;
    }, { passive: true });
    h.addEventListener('touchend', e => {
      const dy = (e.changedTouches[0].clientY || 0) - (y0 || 0);
      el.style.transform = '';
      y0 = null;
      if (dy > 90) api.close();
    });
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
    inp.onkeydown = e => e.key === 'Enter' && yes();
    s.foot.querySelector('[data-no]').onclick = () => s.close();
    s.foot.querySelector('[data-yes]').onclick = yes;
  });
}

// ---------------- rings & bars ----------------
export function ring(pct, { size = 120, stroke = 11, color = 'var(--accent)', inner = '' } = {}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(1, pct || 0));
  return `<div class="ring" style="width:${size}px;height:${size}px"><svg width="${size}" height="${size}"><circle class="ring-bg" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke-width="${stroke}"/><circle class="ring-fg" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - p)}" ${p === 0 ? 'stroke-opacity="0"' : ''}/></svg><div class="ring-in">${inner}</div></div>`;
}
export function bar(pct, color, { limit = false } = {}) {
  const w = Math.max(0, Math.min(1, pct || 0)) * (limit ? 100 / 1.25 : 100);
  return `<div class="bar ${limit ? 'limit' : ''}"><i style="width:${w}%;background:${color}"></i>${limit ? `<b style="left:${100 / 1.25}%"></b>` : ''}</div>`;
}

// ---------------- charts (single-series, one axis, tap/hover tooltips) ----------------
let chartId = 0;
/**
 * points: [{ label, value, tip }] in order. kind: 'line' | 'bar'.
 * target: optional dashed reference line.
 */
export function chart(points, { kind = 'bar', color = 'var(--accent)', height = 150, target = null, unit = '', fmt = v => Math.round(v).toLocaleString('en-AU'), yMin = 0, domain = null } = {}) {
  const id = 'ch' + ++chartId;
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
    svg += `<rect class="hit" data-i="${i}" x="${cx - w / 2}" y="0" width="${w}" height="${H}"/>`;
  });
  svg += '</svg>';
  const tips = points.map(p => (p.value == null ? `${p.label}: no data` : p.tip || `${p.label}: ${fmt(p.value)}${unit ? ' ' + unit : ''}`));
  setTimeout(() => wireChart(id, tips, points, kind, x, xb, y, W), 0);
  return `<div class="chart" id="${id}">${svg}<div class="tip"></div></div>`;
}
function wireChart(id, tips, points, kind, x, xb, y, W) {
  const el = document.getElementById(id);
  if (!el) return;
  const tip = el.querySelector('.tip');
  const show = i => {
    const p = points[i];
    const svg = el.querySelector('svg');
    const sx = svg.clientWidth / W;
    const cx = (kind === 'bar' ? xb(i) : x(i)) * sx;
    const cy = (p.value == null ? 20 : y(p.value)) * sx;
    tip.textContent = tips[i];
    tip.style.left = Math.max(50, Math.min(svg.clientWidth - 50, cx)) + 'px';
    tip.style.top = cy + 'px';
    tip.classList.add('on');
  };
  el.querySelectorAll('.hit').forEach(r => {
    r.addEventListener('pointerenter', () => show(+r.dataset.i));
    r.addEventListener('pointerdown', () => show(+r.dataset.i));
  });
  el.addEventListener('pointerleave', () => tip.classList.remove('on'));
}

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
