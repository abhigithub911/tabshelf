/* Tabshelf UI toolkit: DOM helpers, icons, menus, popovers, modals, toasts. */
'use strict';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const IN_EXT = typeof chrome !== 'undefined' && !!(chrome.runtime && chrome.runtime.id);
const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = IS_MAC ? '⌘' : 'Ctrl';

const EMOJIS = ('💼 🌎 📚 📦 ⭐ 📥 🗂️ 🛠️ 🧰 💡 📝 ✅ 📌 🔖 🎯 🚀 💻 🖥️ 📱 🧪 🧠 📊 📈 💰 🏦 🏠 🏢 🎵 🎬 🎮 🍔 ☕ ✈️ 🛒 📰 ' +
  '🎨 📷 🔒 🔑 ⚙️ 📅 ⏰ 🔥 ❤️ 🌱 🐙 🐍 🦊 🧾 📁 🗃️ 🧭 🏷️ 💬 📣 🎓 🏋️ 🌙 ☀️ 🌈 🦄 🍀 🎁 🧩 🛰️ 🔬 📖 🗺️ 🏝️ 🎧').split(' ');

function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(n.style, v);
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(n.dataset, v);
    else if (k in n && typeof v !== 'string') n[k] = v;
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) n.append(kid);
  return n;
}

const svg = d => `<svg viewBox="0 0 24 24">${d}</svg>`;
const ICON = {
  edit: svg('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>'),
  trash: svg('<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>'),
  dots: '<svg viewBox="0 0 24 24" class="fill"><circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/></svg>',
  chevR: svg('<path d="M9 6l6 6-6 6"/>'),
  chevD: svg('<path d="M6 9l6 6 6-6"/>'),
  chevU: svg('<path d="M6 15l6-6 6 6"/>'),
  x: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  ext: svg('<path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6"/>'),
  win: svg('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 9h18"/>'),
  copy: svg('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>'),
  sort: svg('<path d="M7 4v16M3 16l4 4 4-4M17 20V4M13 8l4-4 4 4"/>'),
  compact: svg('<path d="M4 6h16M4 12h16M4 18h16"/>'),
  lock: svg('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>'),
  unlock: svg('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.5-2"/>'),
  dup: svg('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M4 16V4h12"/>'),
  move: svg('<path d="M5 12h14M13 6l6 6-6 6"/>'),
  bell: svg('<path d="M18 16v-5a6 6 0 0 0-12 0v5l-2 2h16zM10 21h4"/>'),
  note: svg('<path d="M5 4h14v12l-4 4H5z"/><path d="M15 20v-4h4"/>'),
  todo: svg('<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M8.5 12l2.5 2.5 4.5-5"/>'),
  link: svg('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'),
  save: svg('<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>'),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  combine: svg('<rect x="3" y="7" width="8" height="10" rx="2"/><rect x="13" y="7" width="8" height="10" rx="2"/>'),
  unstack: svg('<path d="M4 7h16M4 12h10M4 17h6"/>'),
  collapse: svg('<path d="M7 14l5-5 5 5"/>'),
  expand: svg('<path d="M7 10l5 5 5-5"/>'),
  emoji: svg('<circle cx="12" cy="12" r="9"/><path d="M8.5 14.5a4 4 0 0 0 7 0M9 9.5h.01M15 9.5h.01"/>'),
  wand: svg('<path d="M4 20l9-9"/><path d="M16 3l1 3 3 1-3 1-1 3-1-3-3-1 3-1z"/>'),
  image: svg('<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 8"/>'),
  folder: '<svg viewBox="0 0 24 24" class="fill"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  incognito: svg('<path d="M3 11h18M6 11l2-6h8l2 6"/><circle cx="7.5" cy="16" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/><path d="M10 16h4"/>'),
  sidebar: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>'),
  restore: svg('<path d="M4 12a8 8 0 1 0 2.3-5.7L4 8.6"/><path d="M4 4v4.6h4.6"/>'),
  gear: svg('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>'),
  grid: svg('<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>'),
  download: svg('<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>'),
  upload: svg('<path d="M12 20V9M7 14l5-5 5 5M5 4h14"/>'),
  star: svg('<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>'),
  search: svg('<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>'),
  globe: svg('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>')
};
const icon = name => el('span', { class: 'mi-icon', html: ICON[name] || '' });

/* ---- favicons ----
   Google's favicon service knows most public sites; Chrome's own cache (the "favicon"
   permission) covers intranet sites you've visited. Fall back to a blank tile. */
function localFavicon(url, size) {
  return IN_EXT ? chrome.runtime.getURL('/_favicon/?pageUrl=' + encodeURIComponent(url) + '&size=' + size) : '';
}
function remoteFavicon(url, size) {
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return '';
    return 'https://www.google.com/s2/favicons?sz=' + size + '&domain=' + u.hostname;
  } catch (e) { return ''; }
}
function favTile(url, size = 64) {
  const tile = el('span', { class: 'tile' });
  const useRemote = !(typeof state !== 'undefined' && state && state.settings.googleFavicons === false);
  const srcs = [useRemote ? remoteFavicon(url, size) : '', localFavicon(url, size)].filter(Boolean);
  if (!srcs.length) { tile.classList.add('blank'); return tile; }
  const img = el('img', { alt: '', loading: 'lazy', draggable: 'false' });
  let i = 0;
  img.src = srcs[0];
  img.addEventListener('error', () => {
    i++;
    if (i < srcs.length) img.src = srcs[i];
    else { img.remove(); tile.classList.add('blank'); }
  });
  tile.append(img);
  return tile;
}
function emojiTile(text) { return el('span', { class: 'tile', text }); }

/* ---- popover & menus ---- */
let popoverAnchor = null;
function showPopover(anchor, content, opts = {}) {
  const pop = $('#popover');
  pop.replaceChildren(...[content].flat());
  pop.hidden = false;
  pop.style.minWidth = opts.width ? opts.width + 'px' : '';
  let x, y;
  if (anchor instanceof Element) {
    const r = anchor.getBoundingClientRect();
    x = opts.alignRight ? r.right - pop.offsetWidth : r.left;
    y = opts.above ? r.top - pop.offsetHeight - 8 : r.bottom + 6;
  } else { x = anchor.clientX; y = anchor.clientY + 4; }
  const pr = pop.getBoundingClientRect();
  pop.style.left = Math.max(8, Math.min(x, innerWidth - pr.width - 8)) + 'px';
  pop.style.top = Math.max(8, Math.min(y, innerHeight - pr.height - 8)) + 'px';
  popoverAnchor = anchor;
  const first = pop.querySelector('input');
  if (first && opts.focus !== false) first.focus();
}
function hidePopover() { $('#popover').hidden = true; popoverAnchor = null; }
document.addEventListener('mousedown', e => {
  if (!$('#popover').hidden && !$('#popover').contains(e.target)) hidePopover();
}, true);

// entries: { text, icon, hint, danger, checked, run, sub: () => entries } | '-' | { label }
function menu(anchor, entries, opts) {
  if (anchor && anchor.stopPropagation) anchor.stopPropagation();
  const build = list => list.filter(Boolean).map(en => {
    if (en === '-') return el('div', { class: 'menu-sep' });
    if (en.label) return el('div', { class: 'menu-label', text: en.label });
    const b = el('button', { class: 'menu-item' + (en.danger ? ' danger' : '') + (en.checked ? ' checked' : '') },
      en.icon ? (ICON[en.icon] ? icon(en.icon) : el('span', { class: 'mi-icon', text: en.icon })) : el('span', { class: 'mi-icon' }),
      el('span', { class: 'mi-text', text: en.text }),
      el('span', { class: 'mi-hint', html: en.sub ? ICON.chevR : '', text: en.sub ? undefined : (en.hint || '') }));
    b.addEventListener('click', ev => {
      ev.stopPropagation();
      if (en.sub) {
        const pop = $('#popover');
        const back = el('button', { class: 'menu-item' }, icon('chevR'), el('span', { class: 'mi-text', text: 'Back' }));
        back.querySelector('svg').style.transform = 'rotate(180deg)';
        back.addEventListener('click', e2 => { e2.stopPropagation(); pop.replaceChildren(...build(entries)); });
        pop.replaceChildren(back, el('div', { class: 'menu-sep' }), ...build(en.sub()));
        return;
      }
      hidePopover();
      en.run && en.run(ev);
    });
    return b;
  });
  showPopover(anchor, build(entries), opts);
}

function emojiPicker(anchor, onPick, opts = {}) {
  const custom = el('input', { class: 'pop-input', placeholder: 'Type or paste any emoji, then Enter' });
  custom.addEventListener('keydown', ev => {
    if (ev.key === 'Enter' && custom.value.trim()) { onPick([...custom.value.trim()].slice(0, 2).join('')); hidePopover(); }
  });
  const kids = [
    el('div', { class: 'emoji-grid' }, EMOJIS.map(em => el('button', { text: em, onclick: () => { hidePopover(); onPick(em); } }))),
    el('div', { style: 'padding:4px 4px 6px' }, custom)
  ];
  if (opts.allowImage) {
    kids.push(el('div', { style: 'padding:0 4px 4px' }, el('button', {
      class: 'btn small', style: 'width:100%;justify-content:center', html: ICON.image + '<span>Upload an image</span>',
      onclick: () => { hidePopover(); pickImageFile(dataUrl => onPick(null, dataUrl)); }
    })));
  }
  showPopover(anchor, kids, { focus: false, width: 330, above: opts.above });
}

function pickImageFile(cb) {
  const input = $('#fileInput');
  input.accept = 'image/*';
  input.value = '';
  input.onchange = () => {
    const f = input.files[0];
    if (!f) return;
    const img = new Image();
    img.onload = () => {
      // Downscale so custom symbols stay small in storage.
      const c = document.createElement('canvas');
      c.width = c.height = 128;
      const s = Math.max(128 / img.width, 128 / img.height);
      c.getContext('2d').drawImage(img, (128 - img.width * s) / 2, (128 - img.height * s) / 2, img.width * s, img.height * s);
      cb(c.toDataURL('image/png'));
      URL.revokeObjectURL(img.src);
    };
    img.src = URL.createObjectURL(f);
  };
  input.click();
}

/* ---- modal ---- */
function openModal(content, opts = {}) {
  const back = $('#modalBack'), box = $('#modal');
  box.className = opts.wide ? 'wide' : '';
  box.replaceChildren(...[content].flat());
  back.hidden = false;
  const first = box.querySelector('[autofocus]') || box.querySelector('input[type=text],input[type=url],textarea');
  if (first) { first.focus(); if (first.select) first.select(); }
}
function closeModal() { $('#modalBack').hidden = true; $('#modal').replaceChildren(); }
$('#modalBack').addEventListener('mousedown', e => { if (e.target.id === 'modalBack') closeModal(); });

// Simple form modal. fields: { name, label, type: text|url|textarea|select|colors|datetime, value, options, placeholder }
function formModal(title, fields, onSave, opts = {}) {
  const form = el('form', {});
  const getters = {};
  fields.forEach(f => {
    if (f.label) form.append(el('label', { class: 'f', text: f.label }));
    if (f.type === 'colors') {
      let val = f.value || 'none';
      const row = el('div', { class: 'color-row' });
      NOTE_COLORS.forEach(c => {
        const s = el('button', { type: 'button', class: `dot-swatch c-${c}${c === val ? ' sel' : ''}`, title: c, style: 'width:30px;height:30px;border-radius:9px' });
        s.onclick = () => { val = c; $$('.dot-swatch', row).forEach(n => n.classList.remove('sel')); s.classList.add('sel'); };
        row.append(s);
      });
      getters[f.name] = () => val;
      form.append(row);
      return;
    }
    if (f.type === 'node') { form.append(f.node); return; }
    let input;
    if (f.type === 'textarea') input = el('textarea', { name: f.name, placeholder: f.placeholder || '' });
    else if (f.type === 'select') input = el('select', { name: f.name }, f.options.map(o => el('option', { value: o.value, text: o.text, selected: String(o.value) === String(f.value) })));
    else input = el('input', { type: f.type === 'datetime' ? 'datetime-local' : 'text', name: f.name, placeholder: f.placeholder || '' });
    if (f.type !== 'select') input.value = f.value || '';
    getters[f.name] = () => input.value;
    form.append(input);
  });
  form.append(el('div', { class: 'modal-actions' },
    opts.extra || null,
    el('div', { class: 'spacer' }),
    el('button', { type: 'button', class: 'btn', text: 'Cancel', onclick: closeModal }),
    el('button', { type: 'submit', class: 'btn primary', text: opts.saveText || 'Save' })));
  form.addEventListener('submit', e => {
    e.preventDefault();
    const vals = {};
    for (const [k, g] of Object.entries(getters)) vals[k] = g();
    if (onSave(vals) !== false) closeModal();
  });
  form.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) form.requestSubmit(); });
  openModal([el('h3', { text: title }), opts.sub ? el('p', { class: 'sub', text: opts.sub }) : null, form], opts);
}

function confirmModal(title, text, okText, onOk) {
  openModal([
    el('h3', { text: title }), el('p', { class: 'sub', text }),
    el('div', { class: 'modal-actions' },
      el('button', { class: 'btn', text: 'Cancel', onclick: closeModal }),
      el('button', { class: 'btn primary', text: okText, autofocus: true, onclick: () => { closeModal(); onOk(); } }))
  ]);
}

/* ---- toast ---- */
let toastTimer = null;
function toast(msg, action) {
  const t = $('#toast');
  t.replaceChildren(el('span', { text: msg }));
  t.classList.toggle('solo', !action);
  if (action) t.append(el('button', { text: action.text, onclick: () => { t.hidden = true; action.run(); } }));
  t.hidden = false;
  t.style.animation = 'none'; void t.offsetWidth; t.style.animation = '';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, action ? 6500 : 2600);
}

/* ---- misc helpers ---- */
function looksLikeUrl(s) {
  s = (s || '').trim();
  if (!s || /\s/.test(s)) return false;
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(s) || /^(mailto|file|slack|notion|zoommtg|vscode):/i.test(s) ||
    /^[\w-]+(\.[\w-]+)+(:\d+)?(\/.*)?$/.test(s) || /^localhost(:\d+)?(\/.*)?$/.test(s);
}
function normalizeUrl(s) {
  s = s.trim();
  return /^[a-z][a-z0-9+.-]*:/i.test(s) ? s : 'https://' + s;
}
function timeAgo(t) {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}
function fmtWhen(t) {
  const d = new Date(t), now = new Date();
  const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return 'Today ' + time;
  if (d.toDateString() === tomorrow.toDateString()) return 'Tomorrow ' + time;
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }) + ' ' + time;
}
function download(name, text, type) {
  const a = el('a', { href: URL.createObjectURL(new Blob([text], { type })), download: name });
  document.body.append(a); a.click(); a.remove();
}
function escapeHtml(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function highlight(text, q) {
  const span = el('span');
  text = text || '';
  const i = q ? text.toLowerCase().indexOf(q) : -1;
  if (i < 0) { span.textContent = text; return span; }
  span.append(text.slice(0, i), el('mark', { text: text.slice(i, i + q.length) }), text.slice(i + q.length));
  return span;
}
function readFile(accept, cb) {
  const input = $('#fileInput');
  input.accept = accept;
  input.value = '';
  input.onchange = async () => { const f = input.files[0]; if (f) cb(await f.text(), f.name); };
  input.click();
}
