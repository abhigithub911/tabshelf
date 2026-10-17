/* Tabshelf board: state, rendering, groups, items, drag & drop. */
'use strict';

let state = null;
let lastRev = null;
let drag = null;              // what is being dragged (dataTransfer can't be read during dragover)
let editingNote = null;       // id of the note being edited inline
const selection = new Set();  // selected item ids (Shift+click)

/* ---------------- persistence ---------------- */

async function commit() {
  lastRev = await saveState(state);
  render();
}

if (IN_EXT) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[STORE_KEY]) return;
    const nv = changes[STORE_KEY].newValue;
    if (!nv || nv.rev === lastRev) return;
    // Another tab, the popup or the context menu changed something. Keep this tab's view.
    const ws = state && state.activeWorkspace;
    const cats = state && Object.fromEntries(state.workspaces.map(w => [w.id, w.activeCategory]));
    state = normalize(nv);
    if (ws && state.workspaces.find(w => w.id === ws)) state.activeWorkspace = ws;
    if (cats) state.workspaces.forEach(w => { if (cats[w.id] && w.categories.find(c => c.id === cats[w.id])) w.activeCategory = cats[w.id]; });
    if (editingNote) return; // don't yank the editor away; the next commit re-renders
    render();
  });
}

/* ---------------- lookups ---------------- */

const curWs = () => activeWorkspace(state);
const curCat = () => activeCategory(state);

// Locate an item anywhere, including inside stacks.
function findItem(id) {
  for (const g of Object.values(state.groups)) {
    for (let i = 0; i < g.items.length; i++) {
      const it = g.items[i];
      if (it.id === id) return { group: g, list: g.items, idx: i, item: it, stack: null };
      if (it.type === 'stack') {
        const j = it.items.findIndex(x => x.id === id);
        if (j >= 0) return { group: g, list: it.items, idx: j, item: it.items[j], stack: it };
      }
    }
  }
  return null;
}

// Remove an item and unwrap a stack that drops to a single site.
function detachItem(id) {
  const f = findItem(id);
  if (!f) return null;
  f.list.splice(f.idx, 1);
  if (f.stack && f.stack.items.length < 2) {
    const si = f.group.items.indexOf(f.stack);
    f.group.items.splice(si, 1, ...f.stack.items);
  }
  return f;
}

function insertItems(g, items, beforeId) {
  const idx = beforeId ? g.items.findIndex(i => i.id === beforeId) : -1;
  if (idx < 0) g.items.push(...items); else g.items.splice(idx, 0, ...items);
}

function locked(g) {
  if (g && g.locked) { toast(`“${g.title}” is locked`); return true; }
  return false;
}

/* ---------------- opening sites ---------------- */

async function openUrl(url, e) {
  const wantsNew = e && (e.metaKey || e.ctrlKey || e.button === 1);
  if (IN_EXT && state.settings.jumpToOpen) {
    const tabs = await chrome.tabs.query({});
    const norm = u => (u || '').replace(/#.*$/, '').replace(/\/$/, '');
    const open = tabs.find(t => norm(t.url) === norm(url));
    const self = await chrome.tabs.getCurrent();
    if (open && (!self || open.id !== self.id)) {
      chrome.tabs.update(open.id, { active: true });
      chrome.windows.update(open.windowId, { focused: true });
      return;
    }
  }
  if (wantsNew || state.settings.newTab) {
    if (IN_EXT) chrome.tabs.create({ url, active: !(e && (e.metaKey || e.ctrlKey || e.button === 1)) });
    else window.open(url, '_blank');
  } else if (IN_EXT && !/^https?:|^file:/i.test(url)) {
    const self = await chrome.tabs.getCurrent();
    chrome.tabs.update(self.id, { url });
  } else {
    location.href = url;
  }
}

// Open a group's sites in this window as a Chrome tab group, or in a new window.
async function openAll(links, title, newWindow) {
  const urls = links.map(l => l.url);
  if (!urls.length) return toast('No sites to open');
  if (!IN_EXT) { urls.forEach(u => window.open(u, '_blank')); return; }
  if (newWindow) { chrome.windows.create({ url: urls, focused: true }); return; }
  const tabs = [];
  for (const url of urls) tabs.push(await chrome.tabs.create({ url, active: false }));
  try {
    const gid = await chrome.tabs.group({ tabIds: tabs.map(t => t.id) });
    if (title) await chrome.tabGroups.update(gid, { title: title.slice(0, 40) });
  } catch (e) { /* tab groups unavailable */ }
  toast(`Opened ${urls.length} site${urls.length === 1 ? '' : 's'}`);
}

/* ---------------- theme & body classes ---------------- */

function applySettings() {
  const t = state.settings.theme;
  const dark = t === 'dark' || (t === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.body.classList.remove('size-s', 'size-m', 'size-l');
  document.body.classList.add('size-' + (state.settings.size || 'm'));
  document.body.classList.toggle('no-urls', !state.settings.showUrls);
  document.body.classList.toggle('sb-pinned', !!state.settings.sidebarPinned);
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => state && applySettings());

/* ---------------- render ---------------- */

function render() {
  applySettings();
  renderTopbar();
  renderBoard();
  renderSelbar();
  if (typeof renderBell === 'function') renderBell();
}

function renderTopbar() {
  const ws = curWs();
  $('#wsEmoji').textContent = state.settings.showWorkspaceIcon && state.workspaces.length > 1 ? ws.icon : '';
  $('#wsBtn').title = `Workspace: ${ws.name} (${MOD}K to switch)`;
  document.title = state.workspaces.length > 1 ? `${ws.name} · New Tab` : 'New Tab';
  const nav = $('#cats');
  nav.replaceChildren();
  ws.categories.forEach((c, i) => {
    let pressTimer = null;
    const b = el('button', {
      class: 'cat' + (c.id === ws.activeCategory ? ' active' : ''), text: c.name, draggable: 'true',
      title: `${c.name} · ${c.groups.length} group${c.groups.length === 1 ? '' : 's'}${i < 9 ? ` · press ${i + 1}` : ''}`,
      onclick: () => switchCategory(c.id),
      ondblclick: () => renameCategoryInline(c, b),
      oncontextmenu: e => { e.preventDefault(); categoryMenu(e, c, b); },
      onmousedown: e => {
        if (e.button !== 0) return;
        pressTimer = setTimeout(() => { pressTimer = null; b.dataset.longpress = '1'; openCategoriesModal(); }, 450);
      },
      onmouseup: () => clearTimeout(pressTimer),
      onmouseleave: () => clearTimeout(pressTimer),
      ondragstart: e => { clearTimeout(pressTimer); drag = { kind: 'cat', id: c.id }; e.dataTransfer.setData('text/x-tabnest', 'cat'); e.dataTransfer.effectAllowed = 'move'; },
      ondragend: () => { drag = null; clearDropMarks(); },
      ondragover: e => {
        if (!drag || (drag.kind === 'card' && c.groups.includes(drag.id))) return;
        if (['card', 'items', 'tab', 'tabgroup', 'cat'].includes(drag.kind)) {
          e.preventDefault(); b.classList.add('drop-target');
          // Hovering a category while dragging an item switches to it, like flipping pages.
          if (drag.kind !== 'cat' && drag.kind !== 'card' && c.id !== ws.activeCategory && !b._hoverTimer) {
            b._hoverTimer = setTimeout(() => { b._hoverTimer = null; switchCategory(c.id); }, 700);
          }
        }
      },
      ondragleave: () => { b.classList.remove('drop-target'); clearTimeout(b._hoverTimer); b._hoverTimer = null; },
      ondrop: e => { e.preventDefault(); clearTimeout(b._hoverTimer); b._hoverTimer = null; b.classList.remove('drop-target'); dropOnCategory(c, e); }
    });
    b.addEventListener('click', e => { if (b.dataset.longpress) { delete b.dataset.longpress; e.stopImmediatePropagation(); } }, true);
    nav.append(b);
  });
}

function switchCategory(id) {
  const ws = curWs();
  if (ws.activeCategory === id) return;
  ws.activeCategory = id;
  selection.clear();
  animateBoard();
  commit();
}
function animateBoard() {
  const b = $('#board');
  b.classList.add('anim');
  b.scrollLeft = 0;
  clearTimeout(b._animT);
  b._animT = setTimeout(() => b.classList.remove('anim'), 500);
}

function renderBoard() {
  const board = $('#board');
  const scrollX = board.scrollLeft;
  const bodyScroll = {};
  $$('.card', board).forEach(c => { bodyScroll[c.dataset.id] = $('.card-body', c)?.scrollTop || 0; });
  const focusAdd = document.activeElement?.classList.contains('add-note') ? document.activeElement.closest('.card')?.dataset.id : null;

  board.replaceChildren();
  const cat = curCat();
  cat.groups.forEach(gid => board.append(renderCard(state.groups[gid])));
  board.append(renderAddCard());

  board.scrollLeft = scrollX;
  $$('.card', board).forEach(c => { const b = $('.card-body', c); if (b) b.scrollTop = bodyScroll[c.dataset.id] || 0; });
  if (focusAdd) $(`.card[data-id="${focusAdd}"] .add-note`)?.focus();
  if (editingNote) {
    const ta = $(`.item[data-id="${editingNote}"] .note-edit`);
    if (ta) { autosize(ta); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); } else stopEditing();
  }
}

function renderAddCard() {
  const card = el('button', { class: 'add-card', title: 'New group (Ctrl+G)', onclick: () => addGroup() },
    el('div', { class: 'ghost-row' }, el('span', { class: 'ghost-icon', text: '📦' }),
      el('div', {}, el('div', { class: 'ghost-title', text: 'Untitled' }), el('span', { class: 'ghost-chip', text: '0 sites ›' }))),
    el('div', { class: 'ghost-bar' }),
    el('div', { class: 'ghost-hint', text: 'Click to add a group, or drop tabs here' }));
  card.addEventListener('dragover', e => { if (acceptsDrop(e)) { e.preventDefault(); card.classList.add('drag-over'); } });
  card.addEventListener('dragleave', () => card.classList.remove('drag-over'));
  card.addEventListener('drop', e => {
    e.preventDefault(); card.classList.remove('drag-over');
    const g = makeGroup(drag && drag.kind === 'tabgroup' ? drag.title || 'Tab group' : 'Untitled', '📦');
    state.groups[g.id] = g;
    curCat().groups.push(g.id);
    handleDrop(e, g, null, null);
  });
  return card;
}

function renderCard(g) {
  const links = allLinks(g);
  const n = links.length;
  const card = el('div', { class: 'card' + (g.collapsed ? ' collapsed' : '') + (g.compact ? ' compact' : '') + (g.items.length ? '' : ' empty'), dataset: { id: g.id } });
  if (g.width) card.style.setProperty('--w', g.width + 'px');

  const title = el('div', {
    class: 'card-title' + (g.title && g.title !== 'Untitled' ? '' : ' placeholder'), text: g.title || 'Untitled', spellcheck: 'false',
    title: 'Click to rename',
    onclick: e => { e.stopPropagation(); startTitleEdit(e.currentTarget); },
    onkeydown: e => {
      if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
      if (e.key === 'Escape') { e.target.textContent = g.title; e.target.blur(); }
      e.stopPropagation();
    },
    onblur: e => {
      if (!e.target.isContentEditable) return;
      e.target.contentEditable = 'false'; head.draggable = true;
      const v = e.target.textContent.trim();
      if (v !== g.title) { g.title = v || 'Untitled'; commit(); }
    }
  });
  const symbol = el('button', {
    class: 'card-icon', title: 'Change symbol',
    onclick: e => { e.stopPropagation(); emojiPicker(e.currentTarget, (em, img) => { if (img) { g.iconImg = img; } else { g.icon = em; delete g.iconImg; } commit(); }, { allowImage: true }); }
  }, g.iconImg ? el('img', { src: g.iconImg, alt: '' }) : (g.icon || '📦'));

  const chip = el('button', {
    class: 'sites-chip' + (n ? '' : ' empty'), title: n ? 'Open all sites (Shift: in a new window)' : 'No sites yet',
    onclick: e => { e.stopPropagation(); if (n) openAll(links, g.title, e.shiftKey); }
  }, `${n} site${n === 1 ? '' : 's'}`, el('span', { html: ICON.chevR, style: 'display:flex' }));

  const head = el('div', { class: 'card-head', draggable: 'true' },
    symbol,
    el('div', { class: 'card-meta' }, title,
      el('div', { class: 'chip-row' }, chip, g.locked ? el('span', { class: 'lock-badge', html: ICON.lock, title: 'Locked' }) : null)),
    el('div', { class: 'card-tools' },
      el('button', { class: 'icon-btn small', html: g.collapsed ? ICON.expand : ICON.collapse, title: g.collapsed ? 'Expand' : 'Collapse', onclick: e => { e.stopPropagation(); g.collapsed = !g.collapsed; commit(); } }),
      el('button', { class: 'icon-btn small', html: ICON.dots, title: 'Group options', onclick: e => { e.stopPropagation(); groupMenu(e.currentTarget, g); } })));
  head.addEventListener('dblclick', e => { if (e.target === head) { g.collapsed = !g.collapsed; commit(); } });
  head.addEventListener('dragstart', e => {
    if (e.target !== head) return;
    drag = { kind: 'card', id: g.id };
    e.dataTransfer.setData('text/x-tabnest', 'card');
    e.dataTransfer.effectAllowed = 'move';
    setTimeout(() => card.classList.add('dragging'));
    showTrash(true);
  });
  head.addEventListener('dragend', () => { drag = null; card.classList.remove('dragging'); clearDropMarks(); showTrash(false); });

  const body = el('div', { class: 'card-body' });
  if (!g.locked) {
    body.append(el('input', {
      class: 'add-note', placeholder: 'Write a note, paste a link, or /todo …',
      onkeydown: e => {
        e.stopPropagation();
        if (e.key === 'Enter' && e.target.value.trim()) { quickAdd(g, e.target.value); e.target.value = ''; }
        if (e.key === 'Escape') e.target.blur();
      },
      oninput: e => liveTransform(e.target)
    }));
  }
  g.items.forEach(it => body.append(renderItem(g, it)));
  if (!g.items.length) body.append(el('div', { class: 'empty-hint', html: 'Drag tabs here from the sidebar,<br>or type a note above.' }));
  wireDropZone(body, card, g);

  const handle = el('div', { class: 'resize-handle', title: 'Drag to resize · double-click to reset all' });
  wireResize(handle, card, g);

  card.append(head, body, handle);
  card.addEventListener('dragover', e => {
    if (!drag || drag.kind !== 'card' || drag.id === g.id) return;
    e.preventDefault();
    const r = card.getBoundingClientRect();
    const left = e.clientX < r.left + r.width / 2;
    card.classList.toggle('drop-left', left);
    card.classList.toggle('drop-right', !left);
  });
  card.addEventListener('dragleave', e => { if (!card.contains(e.relatedTarget)) card.classList.remove('drop-left', 'drop-right'); });
  card.addEventListener('drop', e => {
    if (!drag || drag.kind !== 'card') return;
    e.preventDefault();
    moveGroup(drag.id, curCat(), g.id, card.classList.contains('drop-right'));
  });
  return card;
}

function startTitleEdit(t) {
  if (t.isContentEditable) return;
  t.closest('.card-head').draggable = false;
  t.contentEditable = 'true';
  t.classList.remove('placeholder');
  t.focus();
  document.getSelection().selectAllChildren(t);
}

function wireResize(handle, card, g) {
  handle.addEventListener('mousedown', e => {
    e.preventDefault(); e.stopPropagation();
    const startX = e.clientX, startW = card.offsetWidth;
    handle.classList.add('active');
    const move = ev => card.style.setProperty('--w', Math.max(260, Math.min(720, startW + ev.clientX - startX)) + 'px');
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      handle.classList.remove('active');
      g.width = card.offsetWidth;
      commit();
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  });
  handle.addEventListener('dblclick', () => {
    curCat().groups.forEach(id => delete state.groups[id].width);
    commit();
    toast('Group widths reset');
  });
}

/* ---------------- items ---------------- */

function itemActions(g, it) {
  return el('div', { class: 'item-actions' },
    el('button', { html: ICON.edit, title: 'Edit', onclick: e => { e.preventDefault(); e.stopPropagation(); editItem(g, it); } }),
    el('button', { html: ICON.dots, title: 'More', onclick: e => { e.preventDefault(); e.stopPropagation(); itemMenu(e.currentTarget, g, it); } }),
    el('button', { html: ICON.trash, title: 'Delete', onclick: e => { e.preventDefault(); e.stopPropagation(); deleteItems([it.id]); } }));
}

const remindBadge = it => it.remind ? el('span', { class: 'remind-dot', html: ICON.bell, title: 'Reminder: ' + fmtWhen(it.remind.at) }) : null;

function renderLink(g, it) {
  return el('a', {
    class: 'link', href: it.url, title: `${it.title}\n${it.url}`, draggable: 'false',
    onclick: e => {
      e.preventDefault();
      if (e.shiftKey) { toggleSelect(it.id); return; }
      openUrl(it.url, e);
    },
    onauxclick: e => { if (e.button === 1) { e.preventDefault(); openUrl(it.url, e); } },
    oncontextmenu: e => { e.preventDefault(); e.stopPropagation(); itemMenu(e, g, it); }
  },
    favTile(it.url),
    el('span', { class: 'link-text' },
      el('div', { class: 'link-title' }, it.title || prettyUrl(it.url), remindBadge(it)),
      el('div', { class: 'link-url', text: prettyUrl(it.url) })));
}

function renderItem(g, it, parentStack) {
  const wrap = el('div', { class: 'item' + (selection.has(it.id) ? ' selected' : ''), draggable: 'true', dataset: { id: it.id, type: it.type } });
  wrap.addEventListener('dragstart', e => {
    e.stopPropagation();
    if (editingNote === it.id) { e.preventDefault(); return; }
    const ids = selection.has(it.id) && selection.size > 1 ? [...selection] : [it.id];
    drag = { kind: 'items', ids, primary: it.id };
    e.dataTransfer.effectAllowed = 'copyMove';
    e.dataTransfer.setData('text/x-tabnest', 'items');
    if (it.type === 'link') { e.dataTransfer.setData('text/uri-list', it.url); e.dataTransfer.setData('text/plain', it.url); }
    else if (it.type === 'note') e.dataTransfer.setData('text/plain', it.text);
    setTimeout(() => ids.forEach(id => $(`.item[data-id="${id}"]`)?.classList.add('dragging')));
    showTrash(true);
  });
  wrap.addEventListener('dragend', () => { drag = null; $$('.item.dragging').forEach(n => n.classList.remove('dragging')); clearDropMarks(); showTrash(false); });

  if (it.type === 'link') {
    wrap.append(renderLink(g, it), itemActions(g, it));
  } else if (it.type === 'note') {
    wrap.append(renderNote(g, it));
    if (editingNote !== it.id) wrap.append(itemActions(g, it));
  } else if (it.type === 'stack') {
    wrap.classList.add('stack');
    if (it.open) wrap.classList.add('open');
    const tiles = el('div', { class: 'stack-tiles' }, it.items.map(l => el('a', {
      href: l.url, title: `${l.title}\n${l.url}`, draggable: 'false',
      onclick: e => { e.preventDefault(); openUrl(l.url, e); },
      oncontextmenu: e => { e.preventDefault(); e.stopPropagation(); itemMenu(e, g, l); }
    }, favTile(l.url), el('span', { text: l.title }))));
    wrap.append(el('div', { class: 'stack-row' }, tiles,
      el('button', {
        class: 'stack-toggle', title: it.open ? 'Collapse stack' : 'Show the sites in this stack',
        onclick: e => { e.stopPropagation(); it.open = !it.open; commit(); }
      }, String(it.items.length), el('span', { html: ICON.chevD, style: 'display:flex' }))));
    if (it.open) wrap.append(el('div', { class: 'stack-children' }, it.items.map(l => renderItem(g, l, it))));
    wrap.addEventListener('contextmenu', e => { e.preventDefault(); stackMenu(e, g, it); });
  } else if (it.type === 'image') {
    wrap.classList.add('image-item');
    wrap.append(el('img', {
      src: it.src, alt: '', loading: 'lazy', draggable: 'false', title: it.url,
      onclick: e => openUrl(it.url || it.src, e),
      oncontextmenu: e => { e.preventDefault(); e.stopPropagation(); itemMenu(e, g, it); }
    }), itemActions(g, it));
  }
  if (parentStack) wrap.dataset.stack = parentStack.id;
  return wrap;
}

// Optional looks for colored notes, picked from the note bar or the right-click menu.
const NOTE_STYLES = [
  { key: 'bright', label: 'Bright', hint: 'Vivid gradient with white text' },
  { key: 'deep', label: 'Darker', hint: 'A deeper shade of the color' },
  { key: 'vintage', label: 'Vintage', hint: 'Warm tone, faded dark corners' },
  { key: 'border', label: 'Border', hint: 'A fine edge in a darker shade' }
];
function noteClass(it) {
  return `note c-${it.color || 'none'}${it.todo ? ' todo' : ''}${it.todo && it.done ? ' done' : ''}` +
    NOTE_STYLES.filter(s => it[s.key]).map(s => ' ns-' + s.key).join('');
}
function setNoteStyle(it, key, on) { if (on) it[key] = true; else delete it[key]; }

function renderNote(g, it) {
  const isEditing = editingNote === it.id;
  const box = el('div', { class: noteClass(it) });
  if (it.todo) {
    box.append(el('input', {
      type: 'checkbox', class: 'check', checked: !!it.done,
      onclick: e => e.stopPropagation(),
      onchange: e => { it.done = e.target.checked; commit(); }
    }));
  }
  if (isEditing) {
    const ta = el('textarea', { class: 'note-edit', rows: 1, spellcheck: 'true' });
    ta.value = it.text;
    ta.addEventListener('input', () => { liveTransform(ta); autosize(ta); });
    ta.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); finishNote(g, it, ta.value); }
      if (e.key === 'Escape') { e.preventDefault(); finishNote(g, it, ta.value); }
      if (e.key === 'Delete' && e.shiftKey) { e.preventDefault(); stopEditing(); deleteItems([it.id]); }
    });
    ta.addEventListener('blur', () => setTimeout(() => {
      if (editingNote === it.id && document.activeElement !== ta && !$('#noteBar').contains(document.activeElement) && $('#popover').hidden && $('#modalBack').hidden) finishNote(g, it, ta.value);
    }, 150));
    box.append(ta);
    showNoteBar(g, it, ta);
  } else {
    box.append(el('div', { class: 'note-text' }, linkify(it.text), remindBadge(it)));
    box.addEventListener('click', e => {
      if (e.target.closest('a')) return;
      if (e.shiftKey) { toggleSelect(it.id); return; }
      if (g.locked) return;
      startEditing(it.id);
    });
    box.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); itemMenu(e, g, it); });
  }
  return box;
}

// Render URLs inside notes as clickable links.
function linkify(text) {
  const frag = document.createDocumentFragment();
  const re = /\bhttps?:\/\/[^\s<]+/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    frag.append(text.slice(last, m.index));
    const url = m[0];
    frag.append(el('a', { href: url, text: url.length > 48 ? url.slice(0, 46) + '…' : url, style: 'color:inherit;text-decoration:underline', onclick: e => { e.preventDefault(); e.stopPropagation(); openUrl(url, e); } }));
    last = m.index + url.length;
  }
  frag.append(text.slice(last));
  return frag;
}

function autosize(ta) { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; }

// Typing shortcuts: "- " at a line start → "• ", "-> " → "→ ", "<- " → "← ".
function liveTransform(input) {
  const v = input.value, pos = input.selectionStart;
  const before = v.slice(0, pos), after = v.slice(pos);
  const nb = before.replace(/(^|\n)- $/, '$1• ').replace(/->\s$/, '→ ').replace(/<-\s$/, '← ');
  if (nb !== before) { input.value = nb + after; input.setSelectionRange(nb.length, nb.length); }
}

// "/todo", "/done", "/red" … anywhere in the text change the note and are removed.
function applySlash(note, text) {
  const cmds = [];
  const clean = text.replace(/(^|\s)\/([a-z]+)\b/gi, (m0, sp, cmd) => {
    const c = cmd.toLowerCase();
    if (['todo', 'note', 'done', 'undone', 'clear'].includes(c) || NOTE_COLORS.includes(c)) { cmds.push(c); return sp; }
    return m0;
  }).replace(/[ \t]+$/gm, '').trim();
  cmds.forEach(c => {
    if (c === 'todo') note.todo = true;
    else if (c === 'note') { note.todo = false; note.done = false; }
    else if (c === 'done') { note.todo = true; note.done = true; }
    else if (c === 'undone') note.done = false;
    else if (c === 'clear') note.color = 'none';
    else note.color = c;
  });
  return clean;
}

function startEditing(id) {
  editingNote = id;
  render();
}
function stopEditing() {
  editingNote = null;
  $('#noteBar').hidden = true;
}
function finishNote(g, it, raw) {
  if (editingNote !== it.id) return;
  const text = applySlash(it, raw);
  stopEditing();
  const f = findItem(it.id);
  if (!text) {
    if (f) f.list.splice(f.idx, 1);
  } else if (looksLikeUrl(text) && !it.todo && f && !f.stack) {
    f.list.splice(f.idx, 1, makeLink(normalizeUrl(text))); // a note that is just a URL becomes a site
  } else {
    it.text = text;
  }
  commit();
}

function showNoteBar(g, it, ta) {
  const bar = $('#noteBar');
  const keep = e => e.preventDefault(); // keep focus in the textarea
  const btn = (html, title, run, cls) => el('button', { class: 'bar-btn' + (cls ? ' ' + cls : ''), html, title, onmousedown: keep, onclick: run });
  const noteBox = () => ta.closest('.note');
  const swatches = NOTE_COLORS.map(c => el('button', {
    class: `dot-swatch c-${c}${(it.color || 'none') === c ? ' sel' : ''}`, title: c === 'none' ? 'No color' : c[0].toUpperCase() + c.slice(1), onmousedown: keep,
    onclick: e => {
      it.color = c;
      $$('.dot-swatch', bar).forEach(s => s.classList.toggle('sel', s === e.currentTarget));
      noteBox().className = noteClass(it);
      syncStyleBtn();
      ta.focus();
    }
  }));
  const styleBtn = btn(ICON.wand + '<span>Style</span>', 'Darker, vintage or bordered', e => {
    if ((it.color || 'none') === 'none') return toast('Pick a color first, then style it');
    noteStylePopover(e.currentTarget, it, () => { noteBox().className = noteClass(it); syncStyleBtn(); ta.focus(); });
  });
  const syncStyleBtn = () => {
    styleBtn.classList.toggle('disabled', (it.color || 'none') === 'none');
    styleBtn.classList.toggle('active', NOTE_STYLES.some(s => it[s.key]));
    bar.classList.toggle('bright', !!it.bright);
  };
  syncStyleBtn();
  bar.replaceChildren(
    btn(ICON.todo + '<span>To-do</span>', 'Toggle to-do (/todo)', () => { it.todo = !it.todo; it.text = ta.value; render(); }, it.todo ? 'on' : ''),
    el('div', { class: 'bar-sep' }),
    ...swatches,
    styleBtn,
    el('div', { class: 'bar-sep' }),
    btn(ICON.emoji, 'Insert emoji', e => emojiPicker(e.currentTarget, em => { insertAtCursor(ta, em); ta.focus(); }, { above: true })),
    btn(ICON.bell, 'Remind me', () => { it.text = ta.value; reminderModal(it); }),
    btn(ICON.copy, 'Copy', () => { navigator.clipboard.writeText(ta.value); toast('Note copied'); }),
    btn(ICON.trash, 'Delete (Shift+Del)', () => { stopEditing(); deleteItems([it.id]); }, 'danger'),
    el('div', { class: 'bar-sep' }),
    btn('<span>Done</span>', 'Save (Enter)', () => finishNote(g, it, ta.value), 'on'));
  bar.hidden = false;
}
// Switches for the note styles; the popover keeps focus in the note being edited.
function noteStylePopover(anchor, it, onChange) {
  const rows = NOTE_STYLES.map(s => {
    const sw = el('input', { type: 'checkbox', class: 'switch', checked: !!it[s.key] });
    sw.addEventListener('change', () => { setNoteStyle(it, s.key, sw.checked); onChange(); });
    return el('label', { class: 'style-row' },
      el('span', { class: `style-sample c-${it.color} ns-${s.key}` }),
      el('span', { class: 'style-text' }, el('strong', { text: s.label }), el('span', { text: s.hint })),
      sw);
  });
  const box = el('div', { onmousedown: e => e.preventDefault() }, el('div', { class: 'menu-label', text: 'Note style' }), ...rows);
  showPopover(anchor, box, { focus: false, width: 320, above: true });
}

function insertAtCursor(ta, text) {
  const s = ta.selectionStart, e = ta.selectionEnd;
  ta.value = ta.value.slice(0, s) + text + ta.value.slice(e);
  ta.setSelectionRange(s + text.length, s + text.length);
}

/* ---------------- quick add ---------------- */

function quickAdd(g, raw) {
  if (locked(g)) return;
  const v = raw.trim();
  let item;
  if (looksLikeUrl(v)) {
    item = makeLink(normalizeUrl(v));
    // Borrow the real title if that page is open in a tab.
    if (IN_EXT) chrome.tabs.query({}).then(tabs => {
      const t = tabs.find(t => t.url === item.url || t.url === item.url + '/');
      if (t && t.title) { item.title = t.title; commit(); }
    });
  } else {
    item = makeNote('');
    item.text = applySlash(item, v);
    if (!item.text) return;
  }
  g.items.unshift(item);
  commit();
}

/* ---------------- drag & drop ---------------- */

function clearDropMarks() {
  $$('.drop-line').forEach(n => n.remove());
  $$('.drag-over,.drop-left,.drop-right,.drop-target,.drop-before,.combine-target')
    .forEach(n => n.classList.remove('drag-over', 'drop-left', 'drop-right', 'drop-target', 'drop-before', 'combine-target'));
}

function acceptsDrop(e) {
  if (drag) return ['items', 'tab', 'tabgroup'].includes(drag.kind);
  const t = e.dataTransfer.types;
  return t.includes('text/uri-list') || t.includes('text/plain');
}

const isLinkish = () => drag && (drag.kind === 'tab' || (drag.kind === 'items' && drag.ids.length === 1 && findItem(drag.ids[0])?.item.type === 'link'));

// Where in a card body would a drop land? Returns { beforeId, combineId, row }.
function dropTarget(body, e) {
  const rows = $$(':scope > .item:not(.dragging)', body);
  for (const r of rows) {
    const b = r.getBoundingClientRect();
    if (e.clientY < b.top || e.clientY > b.bottom) continue;
    const rel = (e.clientY - b.top) / b.height;
    if (rel > .3 && rel < .7 && isLinkish() && (r.dataset.type === 'link' || r.dataset.type === 'stack') && !(drag.ids && drag.ids.includes(r.dataset.id))) {
      return { combineId: r.dataset.id, row: r };
    }
    if (rel <= .5) return { beforeId: r.dataset.id, row: r };
    const next = rows[rows.indexOf(r) + 1];
    return { beforeId: next ? next.dataset.id : null, row: next || null };
  }
  const before = rows.find(r => e.clientY < r.getBoundingClientRect().top + r.offsetHeight / 2);
  return { beforeId: before ? before.dataset.id : null, row: before || null };
}

function wireDropZone(body, card, g) {
  body.addEventListener('dragover', e => {
    if (!acceptsDrop(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = drag && drag.kind === 'items' ? (e.shiftKey ? 'copy' : 'move') : 'copy';
    card.classList.add('drag-over');
    $$('.drop-line', body).forEach(n => n.remove());
    $$('.combine-target', body).forEach(n => n.classList.remove('combine-target'));
    const t = dropTarget(body, e);
    if (t.combineId) { t.row.classList.add('combine-target'); return; }
    const line = el('div', { class: 'drop-line' });
    if (t.row) body.insertBefore(line, t.row); else body.append(line);
  });
  body.addEventListener('dragleave', e => {
    if (!body.contains(e.relatedTarget)) { card.classList.remove('drag-over'); $$('.drop-line', body).forEach(n => n.remove()); $$('.combine-target', body).forEach(n => n.classList.remove('combine-target')); }
  });
  body.addEventListener('drop', e => {
    if (!acceptsDrop(e)) return;
    e.preventDefault();
    e.stopPropagation();
    const t = dropTarget(body, e);
    clearDropMarks();
    handleDrop(e, g, t.beforeId, t.combineId);
  });
}

function handleDrop(e, g, beforeId, combineId) {
  if (locked(g)) return;
  const copy = e.shiftKey;
  let incoming = [];

  if (drag && drag.kind === 'items') {
    if (beforeId && drag.ids.includes(beforeId)) return;
    for (const id of drag.ids) {
      const f = findItem(id);
      if (!f) continue;
      if (f.group.locked && !copy) { locked(f.group); return; }
      if (copy) incoming.push(cloneItem(f.item));
      else { detachItem(id); incoming.push(f.item); }
    }
  } else if (drag && drag.kind === 'tab') {
    incoming = [makeLink(drag.tab.url, drag.tab.title)];
    if (state.settings.closeOnSave && !copy && IN_EXT) chrome.tabs.remove(drag.tab.id).catch(() => {});
  } else if (drag && drag.kind === 'tabgroup') {
    incoming = drag.tabs.map(t => makeLink(t.url, t.title));
    if (state.settings.closeOnSave && !copy && IN_EXT) chrome.tabs.remove(drag.tabs.map(t => t.id)).catch(() => {});
  } else {
    incoming = itemsFromExternal(e.dataTransfer);
  }
  if (!incoming.length) return;

  if (combineId && incoming.length === 1 && incoming[0].type === 'link') {
    const f = findItem(combineId);
    if (f && f.group === g && !f.stack) {
      if (f.item.type === 'stack') f.item.items.push(incoming[0]);
      else f.list.splice(f.idx, 1, makeStack([f.item, incoming[0]]));
      commit();
      toast('Combined into a stack');
      return;
    }
  }
  insertItems(g, incoming, beforeId);
  commit();
}

function cloneItem(it) {
  const c = JSON.parse(JSON.stringify(it));
  c.id = uid();
  if (c.items) c.items.forEach(x => { x.id = uid(); });
  delete c.remind;
  return c;
}

function itemsFromExternal(dt) {
  const uris = (dt.getData('text/uri-list') || '').split(/\r?\n/).filter(l => l && !l.startsWith('#'));
  const html = dt.getData('text/html');
  const text = dt.getData('text/plain');
  if (html) {
    const d = new DOMParser().parseFromString(html, 'text/html');
    const img = d.querySelector('img');
    const a = d.querySelector('a');
    if (img && img.getAttribute('src') && !(a && a.textContent.trim())) return [makeImage(img.getAttribute('src'), uris[0])];
    if (uris.length === 1) {
      const t = d.body.textContent.trim();
      return [makeLink(uris[0].trim(), t && !looksLikeUrl(t) ? t.slice(0, 200) : undefined)];
    }
  }
  if (uris.length) return uris.map(u => /\.(png|jpe?g|gif|webp|svg)(\?|$)/i.test(u) ? makeImage(u) : makeLink(u.trim()));
  if (text) {
    const lines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    if (lines.length && lines.every(looksLikeUrl)) return lines.map(l => makeLink(normalizeUrl(l)));
    return [makeNote(text.trim())];
  }
  return [];
}

function dropOnCategory(c, e) {
  if (!drag) return;
  if (drag.kind === 'cat') {
    const cats = curWs().categories;
    const from = cats.findIndex(x => x.id === drag.id), to = cats.indexOf(c);
    if (from < 0 || from === to) return;
    cats.splice(to, 0, cats.splice(from, 1)[0]);
    commit();
    return;
  }
  if (drag.kind === 'card') {
    moveGroup(drag.id, c, null, true);
    toast(`Moved group to ${c.name}`);
    return;
  }
  // Items and tabs go into the first group of that category.
  let g = c.groups[0] && state.groups[c.groups[0]];
  if (!g) { g = makeGroup('Untitled', '📦'); state.groups[g.id] = g; c.groups.push(g.id); }
  handleDrop(e, g, g.items[0] ? g.items[0].id : null, null);
  toast(`Saved to ${c.name} › ${g.title}`);
}

function moveGroup(id, toCat, targetId, after) {
  const from = categoryOfGroup(state, id);
  if (from) from.cat.groups = from.cat.groups.filter(x => x !== id);
  let idx = targetId ? toCat.groups.indexOf(targetId) : toCat.groups.length;
  if (targetId && after) idx++;
  if (idx < 0) idx = toCat.groups.length;
  toCat.groups.splice(idx, 0, id);
  commit();
}

/* ---------------- trash drop zone ---------------- */

function showTrash(on) {
  const t = $('#trash');
  if (on && !state.settings.trashZone) return;
  t.hidden = !on;
  t.classList.remove('hot');
}
(function wireTrash() {
  const t = $('#trash');
  t.addEventListener('dragover', e => { if (drag && ['items', 'card', 'tab'].includes(drag.kind)) { e.preventDefault(); t.classList.add('hot'); } });
  t.addEventListener('dragleave', () => t.classList.remove('hot'));
  t.addEventListener('drop', e => {
    e.preventDefault();
    const d = drag;
    showTrash(false);
    if (!d) return;
    if (d.kind === 'items') deleteItems(d.ids);
    else if (d.kind === 'card') deleteGroup(state.groups[d.id]);
    else if (d.kind === 'tab' && IN_EXT) chrome.tabs.remove(d.tab.id);
  });
})();

/* ---------------- delete, bin & undo ---------------- */

function deleteItems(ids) {
  const entries = [];
  for (const id of ids) {
    const f = findItem(id);
    if (!f) continue;
    if (locked(f.group)) return;
    entries.push({ kind: 'item', item: JSON.parse(JSON.stringify(f.item)), groupId: f.group.id, index: f.stack ? f.group.items.indexOf(f.stack) : f.idx });
    detachItem(id);
    selection.delete(id);
  }
  if (!entries.length) return;
  entries.slice().reverse().forEach(en => pushBin(state, en));
  commit();
  const n = entries.length;
  const binIds = state.bin.slice(0, n).map(b => b.id);
  toast(n === 1 ? `Deleted ${entries[0].item.type === 'link' ? 'site' : entries[0].item.type}` : `Deleted ${n} items`,
    { text: 'Undo', run: () => restoreFromBin(binIds) });
}

function deleteGroup(g, quiet) {
  if (!g) return;
  const loc = categoryOfGroup(state, g.id);
  pushBin(state, { kind: 'group', group: JSON.parse(JSON.stringify(g)), catId: loc && loc.cat.id, index: loc ? loc.cat.groups.indexOf(g.id) : 0 });
  if (loc) loc.cat.groups = loc.cat.groups.filter(id => id !== g.id);
  delete state.groups[g.id];
  commit();
  if (!quiet) {
    const binId = state.bin[0].id;
    toast(`Deleted “${g.title}”`, { text: 'Undo', run: () => restoreFromBin([binId]) });
  }
}

function findCategory(id) {
  for (const ws of state.workspaces) for (const c of ws.categories) if (c.id === id) return c;
  return null;
}

function restoreFromBin(binIds) {
  let restored = 0, fallback = null;
  const getFallback = () => {
    if (fallback) return fallback;
    const cat = curCat();
    fallback = cat.groups.map(id => state.groups[id]).find(g => g.title === 'Restored items') || newGroupInCategory(state, cat, 'Restored items', '♻️');
    return fallback;
  };
  // Restore oldest first so original positions line up again.
  binIds.slice().reverse().forEach(bid => {
    const i = state.bin.findIndex(b => b.id === bid);
    if (i < 0) return;
    const en = state.bin.splice(i, 1)[0];
    if (en.kind === 'item') {
      const g = state.groups[en.groupId] || getFallback();
      const item = en.item;
      if (findItem(item.id)) item.id = uid();
      g.items.splice(Math.min(en.index ?? g.items.length, g.items.length), 0, item);
    } else if (en.kind === 'group') {
      const g = en.group;
      if (state.groups[g.id]) g.id = uid();
      state.groups[g.id] = g;
      const cat = findCategory(en.catId) || curCat();
      cat.groups.splice(Math.min(en.index ?? 0, cat.groups.length), 0, g.id);
    }
    restored++;
  });
  if (restored) { commit(); toast(`Restored ${restored} item${restored === 1 ? '' : 's'}`); }
}

/* ---------------- selection ---------------- */

function toggleSelect(id) {
  if (selection.has(id)) selection.delete(id); else selection.add(id);
  render();
}
function clearSelection() { if (selection.size) { selection.clear(); render(); } }

function renderSelbar() {
  const bar = $('#selbar');
  [...selection].forEach(id => { if (!findItem(id)) selection.delete(id); });
  if (!selection.size || editingNote) { bar.hidden = true; return; }
  const items = [...selection].map(id => findItem(id).item);
  const links = items.flatMap(i => i.type === 'link' ? [i] : i.type === 'stack' ? i.items : []);
  const b = (html, title, run, cls) => el('button', { class: 'bar-btn' + (cls ? ' ' + cls : ''), html, title, onclick: run });
  bar.replaceChildren(
    el('span', { class: 'bar-label', text: `${selection.size} selected` }),
    el('div', { class: 'bar-sep' }),
    links.length ? b(ICON.ext + '<span>Open</span>', 'Open selected sites', () => openAll(links, 'Selection')) : null,
    links.length >= 2 ? b(ICON.combine + '<span>Combine</span>', 'Combine into a stack', combineSelection) : null,
    b(ICON.move + '<span>Move to</span>', 'Move to another group', e => moveSelectionMenu(e.currentTarget)),
    b(ICON.copy + '<span>Copy</span>', 'Copy as text', () => { navigator.clipboard.writeText(items.map(itemAsText).join('\n')); toast('Copied'); }),
    b(ICON.trash + '<span>Delete</span>', 'Delete selected', () => deleteItems([...selection]), 'danger'),
    el('div', { class: 'bar-sep' }),
    b(ICON.x, 'Clear selection (Esc)', clearSelection));
  bar.hidden = false;
}

function combineSelection() {
  const ids = [...selection];
  const first = findItem(ids[0]);
  const g = first.group;
  if (locked(g)) return;
  const at = first.stack ? g.items.indexOf(first.stack) : first.idx;
  const links = [];
  ids.forEach(id => {
    const f = findItem(id);
    if (!f || f.group !== g) return;
    if (f.item.type === 'link') { links.push(f.item); detachItem(id); }
    else if (f.item.type === 'stack') { links.push(...f.item.items); f.list.splice(f.idx, 1); }
  });
  if (links.length < 2) { g.items.splice(at, 0, ...links); commit(); return toast('Select sites in the same group to combine'); }
  g.items.splice(Math.min(at, g.items.length), 0, makeStack(links));
  selection.clear();
  commit();
}

function moveSelectionMenu(anchor) {
  const entries = [];
  curWs().categories.forEach(c => {
    entries.push({ label: c.name });
    c.groups.forEach(gid => {
      const g = state.groups[gid];
      entries.push({ text: g.title, icon: g.icon, run: () => moveItemsTo([...selection], g) });
    });
  });
  menu(anchor, entries);
}

function moveItemsTo(ids, g) {
  if (locked(g)) return;
  const moving = [];
  ids.forEach(id => { const f = findItem(id); if (f && !f.group.locked) { detachItem(id); moving.push(f.item); } });
  g.items.push(...moving);
  selection.clear();
  commit();
  toast(`Moved ${moving.length} to ${g.title}`);
}

function itemAsText(it) {
  if (it.type === 'link') return `${it.title} — ${it.url}`;
  if (it.type === 'stack') return it.items.map(itemAsText).join('\n');
  if (it.type === 'image') return it.url || it.src;
  return (it.todo ? (it.done ? '[x] ' : '[ ] ') : '') + it.text;
}

/* ---------------- group actions ---------------- */

function addGroup(cat) {
  cat = cat || curCat();
  const g = makeGroup('Untitled', '📦');
  state.groups[g.id] = g;
  cat.groups.unshift(g.id);
  commit().then(() => {
    const t = $(`.card[data-id="${g.id}"] .card-title`);
    if (t) { $('#board').scrollLeft = 0; startTitleEdit(t); }
  });
  return g;
}

function sortGroup(g, by) {
  const key = it => (it.title || it.text || (it.items && it.items[0].title) || '').toLowerCase();
  if (by === 'az') g.items.sort((a, b) => key(a).localeCompare(key(b)));
  if (by === 'newest') g.items.sort((a, b) => (b.added || 0) - (a.added || 0));
  if (by === 'oldest') g.items.sort((a, b) => (a.added || 0) - (b.added || 0));
  commit();
}

function duplicateGroup(g) {
  const c = JSON.parse(JSON.stringify(g));
  c.id = uid();
  c.title = g.title + ' copy';
  c.items.forEach(it => { it.id = uid(); delete it.remind; if (it.items) it.items.forEach(x => { x.id = uid(); }); });
  c.locked = false;
  state.groups[c.id] = c;
  const loc = categoryOfGroup(state, g.id);
  loc.cat.groups.splice(loc.cat.groups.indexOf(g.id) + 1, 0, c.id);
  commit();
}

function groupMenu(anchor, g) {
  const links = allLinks(g);
  menu(anchor, [
    !g.locked && { text: 'Add note', icon: 'note', run: () => focusAddNote(g) },
    !g.locked && { text: 'Add to-do', icon: 'todo', run: () => { const n = makeNote('', 'none', true); g.items.unshift(n); editingNote = n.id; commit(); } },
    !g.locked && { text: 'Add custom URL', icon: 'link', run: () => editItem(g, null, 'link') },
    !g.locked && IN_EXT && { text: 'Save all tabs in this window here', icon: 'save', run: () => saveWindowTabs(g) },
    '-',
    { text: 'Open all', icon: 'ext', hint: String(links.length), run: () => openAll(links, g.title) },
    { text: 'Open in new window', icon: 'win', run: () => openAll(links, g.title, true) },
    { text: 'Copy content', icon: 'copy', run: () => { navigator.clipboard.writeText(g.items.map(itemAsText).join('\n')); toast('Group copied to clipboard'); } },
    '-',
    { text: 'Sort by', icon: 'sort', sub: () => [
      { text: 'Name (A–Z)', run: () => sortGroup(g, 'az') },
      { text: 'Newest first', run: () => sortGroup(g, 'newest') },
      { text: 'Oldest first', run: () => sortGroup(g, 'oldest') }] },
    { text: 'Move to', icon: 'move', sub: () => moveGroupEntries(g) },
    { text: 'Compact view', icon: 'compact', checked: g.compact, run: () => { g.compact = !g.compact; commit(); } },
    { text: g.collapsed ? 'Expand' : 'Collapse', icon: g.collapsed ? 'expand' : 'collapse', run: () => { g.collapsed = !g.collapsed; commit(); } },
    { text: g.locked ? 'Unlock group' : 'Lock group', icon: g.locked ? 'unlock' : 'lock', run: () => { g.locked = !g.locked; commit(); } },
    { text: 'Duplicate', icon: 'dup', run: () => duplicateGroup(g) },
    { text: 'Change symbol', icon: 'emoji', run: () => emojiPicker(anchor, (em, img) => { if (img) g.iconImg = img; else { g.icon = em; delete g.iconImg; } commit(); }, { allowImage: true }) },
    '-',
    { text: 'Delete group', icon: 'trash', danger: true, run: () => deleteGroup(g) }
  ], { alignRight: true });
}

function moveGroupEntries(g) {
  const out = [];
  state.workspaces.forEach(ws => {
    out.push({ label: `${ws.icon} ${ws.name}` });
    ws.categories.forEach(c => {
      if (c.groups.includes(g.id)) return;
      out.push({ text: c.name, icon: 'move', run: () => { moveGroup(g.id, c, null, true); toast(`Moved to ${c.name}`); } });
    });
  });
  return out;
}

function focusAddNote(g) {
  const input = $(`.card[data-id="${g.id}"] .add-note`);
  if (input) { input.focus(); input.scrollIntoView({ block: 'nearest' }); }
}

async function saveWindowTabs(g, closeAfter, windowId) {
  if (!IN_EXT) return toast('Install Tabshelf as an extension to save tabs');
  const self = await chrome.tabs.getCurrent();
  const wid = windowId || (self ? self.windowId : chrome.windows.WINDOW_ID_CURRENT);
  const tabs = (await chrome.tabs.query({ windowId: wid })).filter(t => isSavableUrl(t.url) && (!self || t.id !== self.id));
  if (!tabs.length) return toast('No tabs to save');
  let target = g;
  if (!target) target = newGroupInCategory(state, curCat(), sessionTitle(), '🗂️');
  if (locked(target)) return;
  target.items.push(...tabs.map(t => makeLink(t.url, t.title)));
  await commit();
  toast(`Saved ${tabs.length} tab${tabs.length === 1 ? '' : 's'} to “${target.title}”`);
  if (closeAfter) chrome.tabs.remove(tabs.map(t => t.id));
}

/* ---------------- item actions ---------------- */

function itemMenu(anchor, g, it) {
  const e = [];
  if (it.type === 'link') {
    e.push(
      { text: 'Open in new tab', icon: 'ext', run: () => IN_EXT ? chrome.tabs.create({ url: it.url }) : window.open(it.url) },
      { text: 'Open in new window', icon: 'win', run: () => IN_EXT ? chrome.windows.create({ url: it.url }) : window.open(it.url) },
      IN_EXT && { text: 'Open in incognito', icon: 'incognito', run: () => chrome.windows.create({ url: it.url, incognito: true }) },
      { text: 'Copy link', icon: 'copy', run: () => { navigator.clipboard.writeText(it.url); toast('Link copied'); } },
      '-');
  }
  e.push({ text: 'Edit', icon: 'edit', run: () => editItem(g, it) });
  if (it.type === 'note') {
    e.push({ text: it.todo ? 'Turn into note' : 'Turn into to-do', icon: 'todo', run: () => { it.todo = !it.todo; commit(); } });
    e.push({ text: 'Color', icon: 'emoji', sub: () => NOTE_COLORS.map(c => ({ text: c === 'none' ? 'No color' : c[0].toUpperCase() + c.slice(1), checked: (it.color || 'none') === c, run: () => { it.color = c; commit(); } })) });
    if ((it.color || 'none') !== 'none') e.push({ text: 'Style', icon: 'wand', sub: () => NOTE_STYLES.map(s => ({ text: s.label, checked: !!it[s.key], run: () => { setNoteStyle(it, s.key, !it[s.key]); commit(); } })) });
  }
  e.push({ text: it.remind ? 'Edit reminder' : 'Remind me', icon: 'bell', hint: it.remind ? fmtWhen(it.remind.at) : '', run: () => reminderModal(it) });
  e.push({ text: selection.has(it.id) ? 'Deselect' : 'Select', icon: 'todo', hint: 'Shift+click', run: () => toggleSelect(it.id) });
  e.push({ text: 'Duplicate', icon: 'dup', run: () => { const f = findItem(it.id); f.list.splice(f.idx + 1, 0, cloneItem(it)); commit(); } });
  e.push({ text: 'Move to', icon: 'move', sub: () => {
    const out = [];
    curWs().categories.forEach(c => {
      out.push({ label: c.name });
      c.groups.filter(id => id !== g.id).forEach(id => out.push({ text: state.groups[id].title, icon: state.groups[id].icon, run: () => moveItemsTo([it.id], state.groups[id]) }));
    });
    return out;
  } });
  const f = findItem(it.id);
  if (f && f.stack) e.push({ text: 'Take out of stack', icon: 'unstack', run: () => { const st = f.stack; detachItem(it.id); const si = g.items.indexOf(st); g.items.splice(si < 0 ? g.items.length : si + 1, 0, it); commit(); } });
  e.push('-', { text: 'Delete', icon: 'trash', danger: true, hint: 'Shift+Del', run: () => deleteItems([it.id]) });
  menu(anchor, e);
}

function stackMenu(anchor, g, st) {
  menu(anchor, [
    { text: 'Open all in stack', icon: 'ext', run: () => openAll(st.items, g.title) },
    { text: st.open ? 'Collapse stack' : 'Expand stack', icon: st.open ? 'collapse' : 'expand', run: () => { st.open = !st.open; commit(); } },
    { text: 'Unstack all', icon: 'unstack', run: () => { const i = g.items.indexOf(st); g.items.splice(i, 1, ...st.items); commit(); } },
    '-',
    { text: 'Delete stack', icon: 'trash', danger: true, run: () => deleteItems([st.id]) }
  ]);
}

function editItem(g, it, newType) {
  const type = it ? it.type : newType;
  if (type === 'note') { startEditing(it.id); return; }
  if (type === 'stack') { it.open = true; commit(); return; }
  if (type === 'link' || type === 'image') {
    const isNew = !it;
    formModal(isNew ? 'Add custom URL' : (type === 'image' ? 'Edit image' : 'Edit site'), [
      { name: 'title', label: 'Title', value: it ? (it.title || '') : '', placeholder: 'Optional' },
      { name: 'url', label: type === 'image' ? 'Link' : 'URL', value: it ? it.url : '', placeholder: 'https://' }
    ], v => {
      if (!v.url.trim()) return false;
      const url = normalizeUrl(v.url);
      if (isNew) { if (locked(g)) return; g.items.unshift(makeLink(url, v.title.trim() || undefined)); }
      else Object.assign(it, { url, title: v.title.trim() || prettyUrl(url) });
      commit();
    });
  }
}

/* ---------------- categories ---------------- */

function renameCategoryInline(c, btn) {
  const input = el('input', { value: c.name });
  btn.replaceChildren(input);
  btn.draggable = false;
  input.focus(); input.select();
  let done = false;
  const finish = save => {
    if (done) return; done = true;
    const v = input.value.trim();
    if (save && v) c.name = v;
    commit();
  };
  input.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); });
  input.addEventListener('blur', () => finish(true));
  input.addEventListener('click', e => e.stopPropagation());
}

function addCategory() {
  const ws = curWs();
  const c = makeCategory('New category');
  ws.categories.push(c);
  ws.activeCategory = c.id;
  animateBoard();
  commit().then(() => {
    const btn = $$('.cat').pop();
    if (btn) { btn.scrollIntoView({ inline: 'end' }); renameCategoryInline(c, btn); }
  });
}

function deleteCategory(c) {
  const ws = curWs();
  if (ws.categories.length === 1) return toast('A workspace needs at least one category');
  const go = () => {
    c.groups.slice().forEach(gid => deleteGroup(state.groups[gid], true));
    ws.categories = ws.categories.filter(x => x !== c);
    if (ws.activeCategory === c.id) ws.activeCategory = ws.categories[0].id;
    commit();
    toast(`Deleted “${c.name}”. Its groups are in the bin.`);
  };
  if (!c.groups.length) go();
  else confirmModal(`Delete “${c.name}”?`, `Its ${c.groups.length} group(s) move to the bin, where you can restore them.`, 'Delete', go);
}

function categoryMenu(anchor, c, btn) {
  const cats = curWs().categories, i = cats.indexOf(c);
  menu(anchor, [
    { text: 'Rename', icon: 'edit', run: () => renameCategoryInline(c, btn) },
    { text: 'New group here', icon: 'plus', run: () => { curWs().activeCategory = c.id; addGroup(c); } },
    { text: 'Open every site', icon: 'ext', run: () => openAll(c.groups.flatMap(id => allLinks(state.groups[id])), c.name, true) },
    i > 0 && { text: 'Move left', icon: 'chevU', run: () => { cats.splice(i - 1, 0, cats.splice(i, 1)[0]); commit(); } },
    i < cats.length - 1 && { text: 'Move right', icon: 'chevD', run: () => { cats.splice(i + 1, 0, cats.splice(i, 1)[0]); commit(); } },
    state.workspaces.length > 1 && { text: 'Move to workspace', icon: 'move', sub: () => state.workspaces.filter(w => w !== curWs()).map(w => ({
      text: w.name, icon: w.icon, run: () => {
        const ws = curWs();
        if (ws.categories.length === 1) return toast('A workspace needs at least one category');
        ws.categories = ws.categories.filter(x => x !== c);
        if (ws.activeCategory === c.id) ws.activeCategory = ws.categories[0].id;
        w.categories.push(c);
        commit(); toast(`Moved to ${w.name}`);
      }
    })) },
    { text: 'Edit categories…', icon: 'grid', run: openCategoriesModal },
    '-',
    { text: 'Delete category', icon: 'trash', danger: true, run: () => deleteCategory(c) }
  ]);
}
