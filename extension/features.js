/* Tabshelf: search, workspaces, categories, settings, bin, reminders, import/export, shortcuts, startup. */
'use strict';

/* ================= Search (⌘K) ================= */

let searchSel = 0;
let searchActions = [];
let openTabsCache = [];

async function openSearch(prefill) {
  $('#searchBack').hidden = false;
  const input = $('#search');
  input.value = prefill || '';
  input.focus();
  openTabsCache = IN_EXT ? (await chrome.tabs.query({})).filter(t => t.id !== selfTabId) : [];
  searchSel = 0;
  runSearch();
}
function closeSearch() { $('#searchBack').hidden = true; }

function runSearch() {
  const raw = $('#search').value.trim();
  const q = raw.toLowerCase();
  const box = $('#searchResults');
  const sections = [];
  searchActions = [];
  const add = (title, rows) => { if (rows.length) sections.push([title, rows]); };
  const row = (tileNode, titleNode, sub, where, action) => {
    const i = searchActions.length;
    searchActions.push(action);
    return el('div', { class: 'sr-item', dataset: { i } }, tileNode,
      el('div', { class: 'sr-text' }, el('div', { class: 'sr-title' }, titleNode), sub ? el('div', { class: 'sr-sub' }, sub) : null),
      where ? el('span', { class: 'sr-where', text: where }) : null);
  };

  // Workspaces are always listed first, so ⌘K doubles as the workspace switcher.
  const wsRows = state.workspaces.filter(w => !q || w.name.toLowerCase().includes(q)).map(w =>
    row(emojiTile(w.icon), highlight(w.name, q), `${w.categories.length} categor${w.categories.length === 1 ? 'y' : 'ies'}`, w.id === state.activeWorkspace ? 'Current' : 'Workspace',
      () => switchWorkspace(w.id)));
  if (state.workspaces.length > 1 || q) add('Workspaces', wsRows);

  if (q) {
    const cats = [], groups = [], items = [];
    state.workspaces.forEach(ws => ws.categories.forEach(c => {
      if (c.name.toLowerCase().includes(q)) cats.push(row(emojiTile('🗂️'), highlight(c.name, q), `${c.groups.length} groups`, ws.name, () => jumpTo(ws, c)));
      c.groups.forEach(gid => {
        const g = state.groups[gid];
        if (g.title.toLowerCase().includes(q)) groups.push(row(emojiTile(g.icon), highlight(g.title, q), `${allLinks(g).length} sites`, `${ws.name} › ${c.name}`, () => jumpTo(ws, c, g)));
        const visit = it => {
          if (it.type === 'stack') return it.items.forEach(visit);
          const hay = [it.title, it.url, it.text].filter(Boolean).join(' ').toLowerCase();
          if (!hay.includes(q)) return;
          const where = `${c.name} › ${g.title}`;
          if (it.type === 'link') items.push(row(favTile(it.url), highlight(it.title, q), highlight(prettyUrl(it.url), q), where, e => { closeSearch(); openUrl(it.url, e); }));
          else if (it.type === 'image') items.push(row(emojiTile('🖼️'), highlight(it.url || 'Image', q), null, where, () => jumpTo(ws, c, g, it)));
          else items.push(row(emojiTile(it.todo ? (it.done ? '✅' : '☑️') : '📝'), highlight(it.text.split('\n')[0], q), null, where, () => jumpTo(ws, c, g, it)));
        };
        g.items.forEach(visit);
      });
    }));
    add('Saved', items.slice(0, 60));
    add('Groups', groups.slice(0, 20));
    add('Categories', cats.slice(0, 10));
    add('Open tabs', openTabsCache.filter(t => (t.title + ' ' + t.url).toLowerCase().includes(q)).slice(0, 10).map(t =>
      row(favTile(t.url), highlight(t.title, q), prettyUrl(t.url), 'Switch to tab', () => { closeSearch(); chrome.tabs.update(t.id, { active: true }); chrome.windows.update(t.windowId, { focused: true }); })));
    const web = [];
    if (looksLikeUrl(raw)) web.push(row(emojiTile('↗️'), `Go to ${raw}`, null, '', e => { closeSearch(); openUrl(normalizeUrl(raw), e); }));
    web.push(row(emojiTile('🔎'), `Search the web for “${raw}”`, null, '', () => { closeSearch(); webSearch(raw); }));
    add('Web', web);
  } else {
    const recent = [];
    Object.values(state.groups).forEach(g => allLinks(g).forEach(l => recent.push({ l, g })));
    recent.sort((a, b) => (b.l.added || 0) - (a.l.added || 0));
    add('Recently saved', recent.slice(0, 8).map(({ l, g }) => row(favTile(l.url), l.title, prettyUrl(l.url), g.title, e => { closeSearch(); openUrl(l.url, e); })));
  }

  const nodes = [];
  sections.forEach(([title, rows]) => nodes.push(el('div', { class: 'sr-head', text: title }), ...rows));
  if (!nodes.length) nodes.push(el('div', { class: 'sr-empty', text: 'Nothing saved yet' }));
  box.replaceChildren(...nodes);
  searchSel = Math.max(0, Math.min(searchSel, searchActions.length - 1));
  markSearchSel();
  $$('.sr-item', box).forEach(r => {
    r.addEventListener('mousemove', () => { if (searchSel !== +r.dataset.i) { searchSel = +r.dataset.i; markSearchSel(); } });
    r.addEventListener('click', e => searchActions[+r.dataset.i](e));
  });
}
function markSearchSel() {
  $$('#searchResults .sr-item').forEach(r => r.classList.toggle('sel', +r.dataset.i === searchSel));
  $(`#searchResults .sr-item[data-i="${searchSel}"]`)?.scrollIntoView({ block: 'nearest' });
}
function webSearch(text) {
  if (IN_EXT && chrome.search) chrome.search.query({ text, disposition: 'CURRENT_TAB' });
  else location.href = 'https://www.google.com/search?q=' + encodeURIComponent(text);
}
function jumpTo(ws, c, g, it) {
  closeSearch();
  state.activeWorkspace = ws.id;
  ws.activeCategory = c.id;
  if (g && g.collapsed && it) g.collapsed = false;
  if (it) { const f = findItem(it.id); if (f && f.stack) f.stack.open = true; }
  commit().then(() => {
    if (!g) return;
    const card = $(`.card[data-id="${g.id}"]`);
    card?.scrollIntoView({ inline: 'center', behavior: 'smooth', block: 'nearest' });
    const target = it ? $(`.item[data-id="${it.id}"]`) : card;
    if (target) {
      target.scrollIntoView({ block: 'center', behavior: 'smooth' });
      target.classList.remove('flash'); void target.offsetWidth; target.classList.add('flash');
    }
  });
}
$('#search').addEventListener('input', () => { searchSel = 0; runSearch(); });
$('#search').addEventListener('keydown', e => {
  e.stopPropagation();
  if (e.key === 'Escape') { closeSearch(); return; }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const n = searchActions.length;
    if (n) { searchSel = (searchSel + (e.key === 'ArrowDown' ? 1 : -1) + n) % n; markSearchSel(); }
  }
  if (e.key === 'Enter' && searchActions[searchSel]) { e.preventDefault(); searchActions[searchSel](e); }
});
$('#searchBack').addEventListener('mousedown', e => { if (e.target.id === 'searchBack') closeSearch(); });
$('#searchBtn').addEventListener('click', () => openSearch());

/* ================= Workspaces ================= */

function switchWorkspace(id) {
  closeSearch();
  hidePopover();
  if (state.activeWorkspace === id) return;
  state.activeWorkspace = id;
  selection.clear();
  animateBoard();
  commit();
}

function workspaceMenu(anchor) {
  const rows = state.workspaces.map((w, i) => {
    const groups = w.categories.reduce((n, c) => n + c.groups.length, 0);
    const r = el('div', { class: 'ws-row' + (w.id === state.activeWorkspace ? ' active' : ''), onclick: () => switchWorkspace(w.id) },
      el('span', { class: 'ws-i', text: w.icon }),
      el('span', { class: 'ws-n', text: w.name }),
      el('span', { class: 'ws-c', text: `${groups} groups` }),
      el('button', { class: 'icon-btn small', html: ICON.edit, title: 'Edit workspace', onclick: e => { e.stopPropagation(); hidePopover(); editWorkspace(w); } }));
    return r;
  });
  showPopover(anchor, [
    el('div', { class: 'menu-label', text: 'Workspaces' }),
    ...rows,
    el('div', { class: 'menu-sep' }),
    el('button', { class: 'menu-item', onclick: () => { hidePopover(); editWorkspace(null); } }, icon('plus'), el('span', { class: 'mi-text', text: 'New workspace' })),
    el('button', { class: 'menu-item', onclick: () => { hidePopover(); openCategoriesModal(); } }, icon('grid'), el('span', { class: 'mi-text', text: 'Edit categories' }), el('span', { class: 'mi-hint', text: 'hold a tab' })),
    el('button', { class: 'menu-item', onclick: () => { hidePopover(); openSearch(); } }, icon('search'), el('span', { class: 'mi-text', text: 'Search everything' }), el('span', { class: 'mi-hint', text: MOD + 'K' }))
  ], { width: 290, focus: false });
}

function editWorkspace(w) {
  const isNew = !w;
  let emoji = w ? w.icon : '💼';
  const emojiBtn = el('button', { type: 'button', class: 'btn', style: 'font-size:22px;height:44px;width:56px;justify-content:center', text: emoji });
  emojiBtn.onclick = () => emojiPicker(emojiBtn, em => { emoji = em; emojiBtn.textContent = em; });
  const i = w ? state.workspaces.indexOf(w) : -1;
  const extra = w ? el('div', { style: 'display:flex;gap:6px' },
    state.workspaces.length > 1 ? el('button', {
      type: 'button', class: 'btn danger', text: 'Delete', onclick: () => {
        closeModal();
        confirmModal(`Delete “${w.name}”?`, 'All its categories and groups go to the bin.', 'Delete workspace', () => {
          w.categories.forEach(c => c.groups.slice().forEach(gid => deleteGroup(state.groups[gid], true)));
          state.workspaces = state.workspaces.filter(x => x !== w);
          if (state.activeWorkspace === w.id) state.activeWorkspace = state.workspaces[0].id;
          commit();
          toast(`Deleted workspace “${w.name}”`);
        });
      }
    }) : null,
    i > 0 ? el('button', { type: 'button', class: 'btn', html: ICON.chevU, title: 'Move up', onclick: () => { state.workspaces.splice(i - 1, 0, state.workspaces.splice(i, 1)[0]); closeModal(); commit(); } }) : null,
    i >= 0 && i < state.workspaces.length - 1 ? el('button', { type: 'button', class: 'btn', html: ICON.chevD, title: 'Move down', onclick: () => { state.workspaces.splice(i + 1, 0, state.workspaces.splice(i, 1)[0]); closeModal(); commit(); } }) : null) : null;
  formModal(isNew ? 'New workspace' : 'Edit workspace', [
    { type: 'node', node: el('label', { class: 'f', text: 'Symbol and name' }) },
    { type: 'node', node: el('div', { style: 'display:flex;gap:8px;align-items:center' }, emojiBtn, el('input', { type: 'text', id: 'wsName', value: w ? w.name : '', placeholder: 'e.g. Work, Personal, Side project', style: 'flex:1;height:44px', autofocus: true })) }
  ], () => {
    const name = $('#wsName').value.trim() || 'Workspace';
    if (isNew) {
      const nw = makeWorkspace(name, emoji, [makeCategory('Quicklinks')]);
      state.workspaces.push(nw);
      state.activeWorkspace = nw.id;
      animateBoard();
    } else { w.name = name; w.icon = emoji; }
    commit();
  }, { extra, sub: isNew ? 'Workspaces hold their own categories and groups, e.g. one for work and one for personal.' : null });
}
$('#wsBtn').addEventListener('click', e => workspaceMenu(e.currentTarget));

/* ================= Categories modal ================= */

function openCategoriesModal() {
  const ws = curWs();
  const rows = el('div', { class: 'list-rows' });
  const draw = () => {
    rows.replaceChildren(...ws.categories.map((c, i) => {
      const input = el('input', { type: 'text', value: c.name });
      input.addEventListener('change', () => { c.name = input.value.trim() || c.name; commit(); });
      return el('div', { class: 'list-row' },
        input,
        el('span', { class: 'muted', style: 'font-size:12px;min-width:62px;text-align:right', text: `${c.groups.length} group${c.groups.length === 1 ? '' : 's'}` }),
        el('button', { class: 'icon-btn small', html: ICON.chevU, title: 'Move up', disabled: i === 0, onclick: () => { ws.categories.splice(i - 1, 0, ws.categories.splice(i, 1)[0]); commit(); draw(); } }),
        el('button', { class: 'icon-btn small', html: ICON.chevD, title: 'Move down', disabled: i === ws.categories.length - 1, onclick: () => { ws.categories.splice(i + 1, 0, ws.categories.splice(i, 1)[0]); commit(); draw(); } }),
        el('button', { class: 'icon-btn small', html: ICON.trash, title: 'Delete', onclick: () => { closeModal(); deleteCategory(c); } }));
    }));
  };
  draw();
  openModal([
    el('h3', { text: 'Categories' }),
    el('p', { class: 'sub', text: `${ws.icon} ${ws.name} · rename, reorder or delete. Tip: drag the tabs at the top to reorder them too.` }),
    rows,
    el('div', { class: 'modal-actions' },
      el('button', { class: 'btn', html: ICON.plus + '<span>Add category</span>', onclick: () => { ws.categories.push(makeCategory('New category')); commit(); draw(); $$('.list-row input', rows).pop().select(); } }),
      el('div', { class: 'spacer' }),
      el('button', { class: 'btn primary', text: 'Done', onclick: () => { $$('.list-row input', rows).forEach(i => i.dispatchEvent(new Event('change'))); closeModal(); } }))
  ]);
}
$('#addCat').addEventListener('click', addCategory);

/* ================= Bin ================= */

function openBin() {
  const picked = new Set();
  const list = el('div', { class: 'list-rows' });
  const restoreBtn = el('button', { class: 'btn primary', text: 'Restore selected', disabled: true });
  const draw = () => {
    if (!state.bin.length) { list.replaceChildren(el('div', { class: 'list-empty', text: 'The bin is empty' })); return; }
    list.replaceChildren(...state.bin.map(b => {
      const it = b.item, g = b.group;
      const tileNode = b.kind === 'group' ? emojiTile(g.icon) : it.type === 'link' ? favTile(it.url) : emojiTile(it.type === 'stack' ? '🗂️' : it.type === 'image' ? '🖼️' : it.todo ? '☑️' : '📝');
      const title = b.kind === 'group' ? `${g.title} (group, ${g.items.length} items)` : it.type === 'link' ? it.title : it.type === 'stack' ? `Stack of ${it.items.length} sites` : (it.text || it.url || '').split('\n')[0];
      const from = b.kind === 'item' ? (state.groups[b.groupId] ? `from ${state.groups[b.groupId].title}` : 'group no longer exists') : (findCategory(b.catId)?.name || 'category deleted');
      const cb = el('input', { type: 'checkbox', class: 'check', checked: picked.has(b.id), onchange: e => { if (e.target.checked) picked.add(b.id); else picked.delete(b.id); restoreBtn.disabled = !picked.size; } });
      return el('label', { class: 'list-row', style: 'cursor:pointer' }, cb, tileNode,
        el('div', { class: 'lr-main' }, el('div', { class: 'lr-title', text: title }), el('div', { class: 'lr-sub', text: `${from} · ${timeAgo(b.deletedAt)}` })));
    }));
  };
  restoreBtn.onclick = () => { closeModal(); restoreFromBin([...picked]); };
  draw();
  openModal([
    el('h3', { text: 'Bin' }),
    el('p', { class: 'sub', text: `Your last ${BIN_LIMIT} deleted items. Restored sites go back to their group (or “Restored items” if it was deleted).` }),
    list,
    el('div', { class: 'modal-actions' },
      state.bin.length ? el('button', { class: 'btn danger', text: 'Empty bin', onclick: () => { state.bin = []; commit(); closeModal(); toast('Bin emptied'); } }) : null,
      el('div', { class: 'spacer' }),
      el('button', { class: 'btn', text: 'Close', onclick: closeModal }),
      restoreBtn)
  ], { wide: true });
}

/* ================= Reminders ================= */

function reminderModal(it) {
  const at = it.remind ? new Date(it.remind.at) : (() => { const d = new Date(); d.setHours(d.getHours() + 1, 0, 0, 0); return d; })();
  const toLocal = d => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const input = el('input', { type: 'datetime-local', value: toLocal(at) });
  const preset = (label, fn) => el('button', { type: 'button', class: 'chip-btn', text: label, onclick: () => { input.value = toLocal(fn()); } });
  const d = () => new Date();
  const repeat = el('select', {}, ['none', 'daily', 'weekly', 'monthly'].map(r => el('option', { value: r, text: r === 'none' ? 'Does not repeat' : r[0].toUpperCase() + r.slice(1), selected: (it.remind?.repeat || 'none') === r })));
  const save = () => {
    const when = new Date(input.value).getTime();
    if (!when || when < Date.now() - 60000) { toast('Pick a time in the future'); return; }
    it.remind = { at: when, repeat: repeat.value };
    closeModal();
    if (editingNote === it.id) { const f = findItem(it.id); finishNote(f.group, it, it.text); } else commit();
    toast('Reminder set for ' + fmtWhen(when));
  };
  openModal([
    el('h3', { text: it.remind ? 'Edit reminder' : 'Remind me' }),
    el('p', { class: 'sub', text: it.type === 'link' ? it.title : (it.text || '').split('\n')[0] }),
    el('div', { class: 'chips' },
      preset('In 1 hour', () => { const x = d(); x.setHours(x.getHours() + 1); return x; }),
      preset('This evening', () => { const x = d(); x.setHours(19, 0, 0, 0); if (x < d()) x.setDate(x.getDate() + 1); return x; }),
      preset('Tomorrow morning', () => { const x = d(); x.setDate(x.getDate() + 1); x.setHours(9, 0, 0, 0); return x; }),
      preset('Next week', () => { const x = d(); x.setDate(x.getDate() + ((8 - x.getDay()) % 7 || 7)); x.setHours(9, 0, 0, 0); return x; })),
    el('label', { class: 'f', text: 'Date and time' }), input,
    el('label', { class: 'f', text: 'Repeat' }), repeat,
    el('div', { class: 'modal-actions' },
      it.remind ? el('button', { class: 'btn danger', text: 'Remove', onclick: () => { delete it.remind; closeModal(); commit(); toast('Reminder removed'); } }) : null,
      el('div', { class: 'spacer' }),
      el('button', { class: 'btn', text: 'Cancel', onclick: closeModal }),
      el('button', { class: 'btn primary', text: 'Set reminder', onclick: save }))
  ]);
}

function allReminders() {
  const out = [];
  state.workspaces.forEach(ws => ws.categories.forEach(c => c.groups.forEach(gid => {
    const g = state.groups[gid];
    const visit = it => { if (it.remind) out.push({ ws, c, g, it }); if (it.items) it.items.forEach(visit); };
    g.items.forEach(visit);
  })));
  return out.sort((a, b) => a.it.remind.at - b.it.remind.at);
}

function renderBell() {
  const soon = allReminders().filter(r => r.it.remind.at - Date.now() < 24 * 3600e3).length;
  const b = $('#bellBadge');
  b.hidden = !soon;
  b.textContent = soon;
}

function bellMenu(anchor) {
  const list = allReminders();
  const rows = list.length ? list.map(({ ws, c, g, it }) => el('div', { class: 'ws-row', style: 'height:auto;padding:8px 6px 8px 10px', onclick: () => { hidePopover(); jumpTo(ws, c, g, it); } },
    it.type === 'link' ? favTile(it.url) : emojiTile(it.todo ? '☑️' : '📝'),
    el('div', { style: 'flex:1;min-width:0' },
      el('div', { style: 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:13.5px', text: it.type === 'link' ? it.title : it.text.split('\n')[0] }),
      el('div', { class: 'muted', style: 'font-size:12px', text: fmtWhen(it.remind.at) + (it.remind.repeat !== 'none' ? ` · ${it.remind.repeat}` : '') })),
    el('button', { class: 'icon-btn small', html: ICON.x, title: 'Remove reminder', onclick: e => { e.stopPropagation(); delete it.remind; commit(); bellMenu(anchor); } })))
    : [el('div', { class: 'list-empty', style: 'padding:22px 12px', html: 'No reminders yet.<br>Right-click any site or note → Remind me.' })];
  rows.forEach(r => { const t = r.querySelector('.tile'); if (t) { t.style.width = t.style.height = '30px'; } });
  showPopover(anchor, [el('div', { class: 'menu-label', text: 'Upcoming reminders' }), ...rows], { alignRight: true, width: 320, focus: false });
}
$('#bellBtn').addEventListener('click', e => bellMenu(e.currentTarget));

/* ================= Settings ================= */

function settingsModal() {
  const s = state.settings;
  const sw = (key, title, sub, after) => {
    const input = el('input', { type: 'checkbox', class: 'switch', checked: !!s[key], onchange: e => { s[key] = e.target.checked; commit(); after && after(); } });
    return el('label', { class: 'set-row', style: 'cursor:pointer' }, el('div', { class: 'set-t' }, el('div', { text: title }), sub ? el('div', { text: sub }) : null), input);
  };
  const seg = (key, opts) => {
    const wrap = el('div', { class: 'seg' });
    const draw = () => wrap.replaceChildren(...opts.map(([v, label]) => el('button', { class: s[key] === v ? 'on' : '', text: label, onclick: () => { s[key] = v; commit(); draw(); } })));
    draw();
    return wrap;
  };
  const row = (title, sub, control) => el('div', { class: 'set-row' }, el('div', { class: 'set-t' }, el('div', { text: title }), sub ? el('div', { text: sub }) : null), control);
  const section = (title, ...kids) => el('div', { class: 'set-section' }, el('h4', { text: title }), ...kids);

  openModal([
    el('h3', { text: 'Settings' }),
    el('p', { class: 'sub', text: 'Everything is stored privately in this browser.' }),
    section('Appearance',
      row('Theme', null, seg('theme', [['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']])),
      row('Item size', null, seg('size', [['s', 'Small'], ['m', 'Medium'], ['l', 'Large']])),
      sw('showUrls', 'Show URLs under site titles'),
      sw('showWorkspaceIcon', 'Show workspace symbol next to categories'),
      sw('googleFavicons', 'Fetch missing site icons', 'Asks Google’s favicon service for icons of sites you haven’t visited')),
    section('Behaviour',
      sw('newTab', 'Open sites in a new tab', `Otherwise they open here. ${MOD}-click always opens a new tab.`),
      sw('jumpToOpen', 'Jump to a tab that’s already open', 'Instead of opening the same site twice'),
      sw('closeOnSave', 'Close tabs when dragged into a group', 'Hold Shift while dropping to keep the tab open'),
      sw('trashZone', 'Show a delete drop zone while dragging'),
      sw('sidebarPinned', 'Keep the tabs sidebar open')),
    section('Data',
      el('div', { class: 'chips', style: 'padding:6px 0' },
        el('button', { class: 'btn small', html: ICON.download + '<span>Export backup (.json)</span>', onclick: exportJson }),
        el('button', { class: 'btn small', html: ICON.upload + '<span>Restore backup</span>', onclick: importJson }),
        el('button', { class: 'btn small', html: ICON.download + '<span>Export bookmarks (.html)</span>', onclick: exportBookmarks }),
        el('button', { class: 'btn small', html: ICON.download + '<span>Export CSV</span>', onclick: exportCsv }),
        el('button', { class: 'btn small', html: ICON.upload + '<span>Import bookmarks file</span>', onclick: importBookmarksFile }),
        IN_EXT ? el('button', { class: 'btn small', html: ICON.star + '<span>Import Chrome bookmarks</span>', onclick: importChromeBookmarks }) : null,
        IN_EXT ? el('button', { class: 'btn small', html: ICON.globe + '<span>Add “Most visited” group</span>', onclick: addTopSites }) : null,
        el('button', { class: 'btn small', html: ICON.restore + '<span>Open bin</span>', onclick: () => { closeModal(); openBin(); } }))),
    section('Keyboard shortcuts',
      el('div', { class: 'kb-list', style: 'padding:6px 0' },
        ...[['Search everything / switch workspace', `${MOD} K`], ['Search (alternative)', '/'], ['New group', 'Ctrl G'], ['Open the bin', 'Ctrl Z'],
          ['Switch category', '1 – 9'], ['Select items', 'Shift click'], ['Open in new tab', `${MOD} click`], ['Keep tab open when saving', 'Shift drop'],
          ['New line in a note', 'Shift Enter'], ['Delete note while editing', 'Shift Del'], ['Note to to-do / color', '/todo  /red  /green …'],
          ['Save page popover (any site)', 'Alt Shift U'], ['Save page to Read later', 'Alt Shift S']]
          .flatMap(([a, b]) => [el('span', { text: a }), el('kbd', { text: b })])),
      IN_EXT ? el('button', { class: 'btn small', style: 'margin-top:8px', text: 'Change browser shortcuts…', onclick: () => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }) }) : null),
    section('Danger zone',
      el('div', { style: 'padding:6px 0' }, el('button', {
        class: 'btn small danger', text: 'Reset Tabshelf…', onclick: () => {
          closeModal();
          confirmModal('Reset everything?', 'This deletes all workspaces, groups and settings. Export a backup first if you might want them back.', 'Reset', () => {
            state = defaultState(); delete state.needsTopSites; commit(); toast('Tabshelf was reset');
          });
        }
      }))),
    el('div', { class: 'modal-actions' }, el('span', { class: 'muted', style: 'font-size:12px', text: 'Tabshelf ' + (IN_EXT ? chrome.runtime.getManifest().version : '') }), el('div', { class: 'spacer' }), el('button', { class: 'btn primary', text: 'Done', onclick: closeModal }))
  ], { wide: true });
}
$('#settingsBtn').addEventListener('click', settingsModal);
$('#themeBtn').addEventListener('click', () => {
  const dark = document.documentElement.dataset.theme === 'dark';
  state.settings.theme = dark ? 'light' : 'dark';
  commit();
});

/* ================= Import / export ================= */

function exportJson() {
  download(`tabshelf-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(state, null, 2), 'application/json');
}
function importJson() {
  readFile('.json,application/json', text => {
    let data;
    try { data = normalize(JSON.parse(text)); } catch (e) { return toast('That file is not a Tabshelf backup'); }
    closeModal();
    confirmModal('Restore this backup?', 'It replaces everything currently on your board.', 'Restore', () => {
      exportJsonSilently();
      state = data;
      commit();
      toast('Backup restored');
    });
  });
}
// Keep the board we are about to replace in the bin-like safety net of a download.
function exportJsonSilently() {
  try { localStorage.setItem('tabnest-before-restore', JSON.stringify(state)); } catch (e) { /* quota */ }
}
function exportBookmarks() {
  let out = '<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">\n<TITLE>Bookmarks</TITLE>\n<H1>Tabshelf</H1>\n<DL><p>\n';
  state.workspaces.forEach(ws => {
    out += `  <DT><H3>${escapeHtml(ws.name)}</H3>\n  <DL><p>\n`;
    ws.categories.forEach(c => {
      out += `    <DT><H3>${escapeHtml(c.name)}</H3>\n    <DL><p>\n`;
      c.groups.forEach(id => {
        const g = state.groups[id];
        out += `      <DT><H3>${escapeHtml(g.title)}</H3>\n      <DL><p>\n`;
        allLinks(g).forEach(l => { out += `        <DT><A HREF="${escapeHtml(l.url)}" ADD_DATE="${Math.floor((l.added || Date.now()) / 1000)}">${escapeHtml(l.title)}</A>\n`; });
        out += '      </DL><p>\n';
      });
      out += '    </DL><p>\n';
    });
    out += '  </DL><p>\n';
  });
  download('tabshelf-bookmarks.html', out + '</DL><p>\n', 'text/html');
}
function exportCsv() {
  const q = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const lines = [['workspace', 'category', 'group', 'type', 'title', 'url', 'note', 'done', 'added'].join(',')];
  state.workspaces.forEach(ws => ws.categories.forEach(c => c.groups.forEach(id => {
    const g = state.groups[id];
    const visit = it => {
      if (it.type === 'stack') return it.items.forEach(visit);
      lines.push([ws.name, c.name, g.title, it.type === 'note' && it.todo ? 'todo' : it.type, it.title || '', it.url || it.src || '', it.text || '', it.done ? 'yes' : '', it.added ? new Date(it.added).toISOString() : ''].map(q).join(','));
    };
    g.items.forEach(visit);
  })));
  download('tabshelf-export.csv', lines.join('\n'), 'text/csv');
}

// A Chrome/Firefox/Safari bookmarks .html file: each folder with links becomes a group
// in a new category called "Imported".
function importBookmarksHtml(html, name) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const cat = makeCategory(name || 'Imported');
  const walk = (dl, title) => {
    const links = [];
    [...dl.children].forEach(dt => {
      const a = dt.querySelector(':scope > a');
      const h3 = dt.querySelector(':scope > h3');
      const sub = dt.querySelector(':scope > dl');
      if (a && a.getAttribute('href') && isSavableUrl(a.getAttribute('href'))) links.push(makeLink(a.getAttribute('href'), a.textContent.trim()));
      if (h3 && sub) walk(sub, h3.textContent.trim());
    });
    if (links.length) {
      const g = makeGroup(title, '🔖', links);
      state.groups[g.id] = g;
      cat.groups.push(g.id);
    }
  };
  const root = doc.querySelector('dl');
  if (!root) return 0;
  walk(root, 'Bookmarks');
  if (!cat.groups.length) return 0;
  curWs().categories.push(cat);
  curWs().activeCategory = cat.id;
  return cat.groups.length;
}
function importBookmarksFile() {
  readFile('.html,.htm,text/html', text => {
    const n = importBookmarksHtml(text, 'Imported');
    closeModal();
    if (n) { animateBoard(); commit(); toast(`Imported ${n} folder${n === 1 ? '' : 's'} into “Imported”`); } else toast('No bookmarks found in that file');
  });
}
async function importChromeBookmarks() {
  const ok = await chrome.permissions.request({ permissions: ['bookmarks'] });
  if (!ok) return toast('Tabshelf needs bookmarks access to import them');
  const tree = await chrome.bookmarks.getTree();
  const folders = [];
  const walk = (n, depth) => { if (!n.url && n.children) { if (depth > 0) folders.push({ n, depth }); n.children.forEach(c => walk(c, depth + 1)); } };
  walk(tree[0], 0);
  const sel = el('select', {}, folders.map(({ n, depth }, i) => el('option', { value: i, text: '  '.repeat(depth - 1) + (n.title || 'Untitled') + ` (${countLinks(n)})` })));
  openModal([
    el('h3', { text: 'Import Chrome bookmarks' }),
    el('p', { class: 'sub', text: 'Pick a folder. Each subfolder with links becomes a group in a new category.' }),
    sel,
    el('div', { class: 'modal-actions' }, el('button', { class: 'btn', text: 'Cancel', onclick: closeModal }), el('button', {
      class: 'btn primary', text: 'Import', onclick: () => {
        const root = folders[+sel.value].n;
        const cat = makeCategory(root.title || 'Bookmarks');
        const visit = (node, title) => {
          const links = node.children.filter(c => c.url && isSavableUrl(c.url)).map(c => makeLink(c.url, c.title));
          if (links.length) { const g = makeGroup(title, '🔖', links); state.groups[g.id] = g; cat.groups.push(g.id); }
          node.children.filter(c => !c.url && c.children).forEach(c => visit(c, c.title || 'Folder'));
        };
        visit(root, root.title || 'Bookmarks');
        closeModal();
        if (!cat.groups.length) return toast('That folder has no links');
        curWs().categories.push(cat); curWs().activeCategory = cat.id; animateBoard(); commit();
        toast(`Imported ${cat.groups.length} group${cat.groups.length === 1 ? '' : 's'}`);
      }
    }))
  ]);
}
function countLinks(n) { return (n.children || []).reduce((s, c) => s + (c.url ? 1 : countLinks(c)), 0); }
async function addTopSites(silent) {
  if (!IN_EXT || !chrome.topSites) return;
  const sites = await chrome.topSites.get();
  if (!sites.length) return silent ? null : toast('Chrome has no most-visited sites yet');
  newGroupInCategory(state, curCat(), 'Most visited', '🌎', sites.slice(0, 10).map(s => makeLink(s.url, s.title)));
  closeModal();
  await commit();
  if (silent !== true) toast('Added “Most visited”');
}

/* ================= Actions menu (⋮) ================= */

$('#menuBtn').addEventListener('click', e => menu(e.currentTarget, [
  { text: 'New group', icon: 'plus', hint: 'Ctrl G', run: () => addGroup() },
  { text: 'New category', icon: 'grid', run: addCategory },
  { text: 'New workspace', icon: 'star', run: () => editWorkspace(null) },
  '-',
  IN_EXT && { text: 'Save all tabs as a group', icon: 'save', run: () => saveWindowTabs(null) },
  IN_EXT && { text: 'Save and close all tabs', icon: 'close', run: () => saveWindowTabs(null, true) },
  '-',
  { text: 'Edit categories', icon: 'edit', run: openCategoriesModal },
  { text: 'Bin', icon: 'restore', hint: state.bin.length ? String(state.bin.length) : 'Ctrl Z', run: openBin },
  { text: 'Reminders', icon: 'bell', run: () => bellMenu($('#bellBtn')) },
  '-',
  { text: 'Export backup', icon: 'download', run: exportJson },
  { text: 'Import bookmarks', icon: 'upload', run: importBookmarksFile },
  { text: 'Settings', icon: 'gear', run: settingsModal }
], { alignRight: true }));

/* ================= Keyboard ================= */

document.addEventListener('keydown', e => {
  const a = document.activeElement;
  const typing = /INPUT|TEXTAREA|SELECT/.test(a.tagName) || a.isContentEditable;
  if (e.key === 'Escape') {
    if (!$('#popover').hidden) return hidePopover();
    if (!$('#modalBack').hidden) return closeModal();
    if (!$('#searchBack').hidden) return closeSearch();
    clearSelection();
    return;
  }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); $('#searchBack').hidden ? openSearch() : closeSearch(); return; }
  if (typing || !$('#modalBack').hidden || !$('#searchBack').hidden) return;
  if (e.key === '/') { e.preventDefault(); openSearch(); return; }
  if (e.ctrlKey && e.key.toLowerCase() === 'g') { e.preventDefault(); addGroup(); return; }
  if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'z') { e.preventDefault(); openBin(); return; }
  if (!e.metaKey && !e.ctrlKey && !e.altKey && /^[1-9]$/.test(e.key)) {
    const c = curWs().categories[+e.key - 1];
    if (c) switchCategory(c.id);
    return;
  }
  if ((e.key === 'Delete' || e.key === 'Backspace') && selection.size) { e.preventDefault(); deleteItems([...selection]); }
});

// Vertical wheel scrolls the board sideways when not over a card's list.
$('#board').addEventListener('wheel', e => {
  if (e.target.closest('.card-body') || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
  $('#board').style.scrollBehavior = 'auto';
  $('#board').scrollLeft += e.deltaY;
  $('#board').style.scrollBehavior = '';
}, { passive: true });

// Paste a link anywhere on the board to save it to the first group.
document.addEventListener('paste', e => {
  const a = document.activeElement;
  if (/INPUT|TEXTAREA/.test(a.tagName) || a.isContentEditable || !$('#modalBack').hidden || !$('#searchBack').hidden) return;
  const text = (e.clipboardData.getData('text/plain') || '').trim();
  if (!looksLikeUrl(text)) return;
  const gid = curCat().groups[0];
  const g = gid ? state.groups[gid] : addGroup();
  if (locked(g)) return;
  g.items.unshift(makeLink(normalizeUrl(text)));
  commit();
  toast(`Saved to ${g.title}`);
});

/* ================= Startup ================= */

(async function init() {
  state = await loadState();
  if (state.needsTopSites) {
    const gid = state.needsTopSites;
    delete state.needsTopSites;
    if (IN_EXT && chrome.topSites && state.groups[gid]) {
      try { (await chrome.topSites.get()).slice(0, 8).forEach(s => state.groups[gid].items.push(makeLink(s.url, s.title))); } catch (e) { /* ignore */ }
    }
    lastRev = await saveState(state);
  }
  $('#board').classList.add('anim');
  render();
  setTimeout(() => $('#board').classList.remove('anim'), 600);
  renderSidebar();
  setInterval(renderBell, 60000);
})();
