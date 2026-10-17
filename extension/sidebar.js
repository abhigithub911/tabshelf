/* Tabshelf sidebar: the live tabs of this window, Chrome tab groups, and the window menu. */
'use strict';

const sidebar = $('#sidebar');
const openTabGroups = new Set(); // Chrome tab groups expanded in the sidebar
let selfTabId = null;
let selfWindowId = null;

async function renderSidebar() {
  const list = $('#sbList');
  if (!IN_EXT) {
    list.replaceChildren(el('div', { class: 'sb-row', style: 'cursor:default' }, el('span', { class: 'tile', html: ICON.globe }), el('span', { class: 'sb-title muted', text: 'Install as an extension to see tabs' })));
    $('#tabCount').textContent = '0';
    return;
  }
  if (selfTabId === null) {
    const self = await chrome.tabs.getCurrent();
    selfTabId = self ? self.id : -1;
    selfWindowId = self ? self.windowId : (await chrome.windows.getCurrent()).id;
  }
  const tabs = (await chrome.tabs.query({ windowId: selfWindowId })).filter(t => t.id !== selfTabId);
  let groupsInfo = {};
  try {
    const tgs = await chrome.tabGroups.query({ windowId: selfWindowId });
    tgs.forEach(g => { groupsInfo[g.id] = g; });
  } catch (e) { groupsInfo = {}; }

  $('#tabCount').textContent = String(tabs.length);
  const wins = await chrome.windows.getAll({ windowTypes: ['normal'] });
  $('#sbWindowLabel').textContent = wins.length > 1 ? `${tabs.length} tabs · ${wins.length} windows` : `${tabs.length} tab${tabs.length === 1 ? '' : 's'} in this window`;

  const rows = [];
  const seenGroups = new Set();
  tabs.forEach(t => {
    const gid = t.groupId;
    if (gid != null && gid !== -1 && groupsInfo[gid]) {
      if (!seenGroups.has(gid)) {
        seenGroups.add(gid);
        const members = tabs.filter(x => x.groupId === gid);
        rows.push(renderTabGroupRow(groupsInfo[gid], members));
      }
      if (!openTabGroups.has(gid)) return;
      rows.push(renderTabRow(t, true));
      return;
    }
    rows.push(renderTabRow(t, false));
  });
  if (!tabs.length) rows.push(el('div', { class: 'sb-row', style: 'cursor:default;opacity:.6' }, el('span', { class: 'tile blank' }), el('span', { class: 'sb-title', text: 'No other tabs open' })));
  list.replaceChildren(...rows);
}

function renderTabRow(t, inGroup) {
  const isImg = t.favIconUrl && /^(https?|data):/.test(t.favIconUrl);
  const tile = isImg ? el('span', { class: 'tile' }, el('img', { src: t.favIconUrl, alt: '', draggable: 'false' })) : favTile(t.url);
  if (isImg) tile.querySelector('img').addEventListener('error', () => tile.replaceWith(favTile(t.url)), { once: true });
  const row = el('div', {
    class: 'sb-row' + (t.active ? ' active-tab' : '') + (inGroup ? ' in-group' : ''), draggable: 'true', dataset: { tab: t.id },
    title: `${t.title}\n${t.url}\n\nDrag into a group to save it${state.settings.closeOnSave ? ' (Shift keeps the tab open)' : ''}`,
    onclick: () => { chrome.tabs.update(t.id, { active: true }); chrome.windows.update(t.windowId, { focused: true }); },
    onauxclick: e => { if (e.button === 1) chrome.tabs.remove(t.id); },
    oncontextmenu: e => { e.preventDefault(); tabMenu(e, t); },
    ondragstart: e => {
      drag = { kind: 'tab', tab: { id: t.id, url: t.url, title: t.title, index: t.index } };
      e.dataTransfer.setData('text/x-tabnest', 'tab');
      e.dataTransfer.setData('text/uri-list', t.url);
      e.dataTransfer.effectAllowed = 'copyMove';
      setTimeout(() => row.classList.add('dragging'));
      if (!state.settings.sidebarPinned) setTimeout(() => sidebar.classList.remove('open'), 60);
      showTrash(true);
    },
    ondragend: () => { drag = null; row.classList.remove('dragging'); clearDropMarks(); showTrash(false); }
  },
    tile,
    el('span', { class: 'sb-title', text: t.title || t.url }),
    el('button', { class: 'sb-x', html: ICON.x, title: 'Close tab', onclick: e => { e.stopPropagation(); chrome.tabs.remove(t.id); } }));
  return row;
}

function renderTabGroupRow(tg, members) {
  const open = openTabGroups.has(tg.id);
  const row = el('div', {
    class: 'sb-row', draggable: 'true', title: `${tg.title || 'Tab group'} · ${members.length} tabs\nClick to ${open ? 'collapse' : 'expand'}, drag into a group to save them all`,
    onclick: () => { if (open) openTabGroups.delete(tg.id); else openTabGroups.add(tg.id); renderSidebar(); },
    oncontextmenu: e => {
      e.preventDefault();
      menu(e, [
        { text: 'Save as new group', icon: 'save', run: () => saveTabsAsGroup(members, tg.title || 'Tab group') },
        { text: 'Save and close', icon: 'close', run: () => saveTabsAsGroup(members, tg.title || 'Tab group', true) },
        { text: 'Ungroup tabs', icon: 'unstack', run: () => chrome.tabs.ungroup(members.map(m => m.id)) },
        '-',
        { text: 'Close all', icon: 'trash', danger: true, run: () => chrome.tabs.remove(members.map(m => m.id)) }
      ]);
    },
    ondragstart: e => {
      drag = { kind: 'tabgroup', title: tg.title, tabs: members.map(m => ({ id: m.id, url: m.url, title: m.title })) };
      e.dataTransfer.setData('text/x-tabnest', 'tabgroup');
      e.dataTransfer.effectAllowed = 'copy';
      if (!state.settings.sidebarPinned) setTimeout(() => sidebar.classList.remove('open'), 60);
    },
    ondragend: () => { drag = null; clearDropMarks(); }
  },
    el('span', { class: `tile tg-tile tg-${tg.color || 'grey'}`, html: ICON.folder }),
    el('span', { class: 'sb-title' }, el('strong', { text: tg.title || 'Tab group' }), el('span', { class: 'muted', text: `  ${members.length}` })),
    el('span', { class: 'sb-x', style: 'visibility:visible', html: open ? ICON.chevU : ICON.chevD }));
  return row;
}

function tabMenu(e, t) {
  menu(e, [
    { text: 'Save to Read later', icon: 'save', run: async () => { findOrCreateInbox(state).items.unshift(makeLink(t.url, t.title)); await commit(); toast('Saved to Read later'); } },
    { text: 'Save to…', icon: 'move', sub: () => saveTargetEntries(g => { g.items.unshift(makeLink(t.url, t.title)); commit(); toast(`Saved to ${g.title}`); }) },
    { text: 'Copy link', icon: 'copy', run: () => { navigator.clipboard.writeText(t.url); toast('Link copied'); } },
    { text: t.pinned ? 'Unpin tab' : 'Pin tab', icon: 'star', run: () => chrome.tabs.update(t.id, { pinned: !t.pinned }) },
    { text: 'Duplicate tab', icon: 'dup', run: () => chrome.tabs.duplicate(t.id) },
    '-',
    { text: 'Close tab', icon: 'close', danger: true, run: () => chrome.tabs.remove(t.id) }
  ]);
}

function saveTargetEntries(onPick) {
  const out = [];
  curWs().categories.forEach(c => {
    out.push({ label: c.name });
    c.groups.forEach(gid => { const g = state.groups[gid]; if (!g.locked) out.push({ text: g.title, icon: g.icon, run: () => onPick(g) }); });
  });
  return out;
}

async function saveTabsAsGroup(tabs, title, close) {
  const savable = tabs.filter(t => isSavableUrl(t.url));
  if (!savable.length) return toast('No tabs to save');
  newGroupInCategory(state, curCat(), title || sessionTitle(), '🗂️', savable.map(t => makeLink(t.url, t.title)));
  await commit();
  toast(`Saved ${savable.length} tab${savable.length === 1 ? '' : 's'}`);
  if (close) chrome.tabs.remove(savable.map(t => t.id));
}

// The tab-count tile: save or close everything in this window, and a small window manager.
async function windowMenu(anchor) {
  if (!IN_EXT) return toast('Install Tabshelf as an extension to manage tabs');
  const tabs = (await chrome.tabs.query({ windowId: selfWindowId })).filter(t => t.id !== selfTabId);
  const n = tabs.length;
  const wins = await chrome.windows.getAll({ populate: true, windowTypes: ['normal'] });
  const entries = [
    { label: `This window · ${n} tab${n === 1 ? '' : 's'}` },
    { text: `Add ${n} tabs to new group`, icon: 'plus', run: () => saveTabsAsGroup(tabs, sessionTitle()) },
    { text: `Move ${n} tabs into group`, icon: 'move', sub: () => saveTargetEntries(async g => {
      g.items.push(...tabs.filter(t => isSavableUrl(t.url)).map(t => makeLink(t.url, t.title)));
      await commit();
      chrome.tabs.remove(tabs.filter(t => isSavableUrl(t.url)).map(t => t.id));
      toast(`Moved ${n} tabs into ${g.title}`);
    }) },
    { text: 'Save and close all tabs', icon: 'save', run: () => saveTabsAsGroup(tabs, sessionTitle(), true) },
    { text: 'Close all tabs', icon: 'close', danger: true, run: () => confirmModal('Close all tabs?', `This closes ${n} tab${n === 1 ? '' : 's'} in this window without saving them.`, 'Close tabs', () => chrome.tabs.remove(tabs.map(t => t.id))) }
  ];
  if (wins.length > 1) {
    entries.push('-', { label: 'Windows' });
    wins.forEach((w, i) => {
      const own = w.id === selfWindowId;
      const wt = w.tabs.filter(t => t.id !== selfTabId);
      entries.push({
        text: `${own ? 'This window' : 'Window ' + (i + 1)} · ${wt.length} tabs`, icon: 'win', sub: () => [
          !own && { text: 'Switch to window', icon: 'win', run: () => chrome.windows.update(w.id, { focused: true }) },
          { text: 'Save as new group', icon: 'save', run: () => saveTabsAsGroup(wt, sessionTitle()) },
          { text: 'Save and close window', icon: 'close', run: async () => { await saveTabsAsGroup(wt, sessionTitle()); if (!own) chrome.windows.remove(w.id); else chrome.tabs.remove(wt.map(t => t.id)); } },
          !own && { text: 'Close window', icon: 'trash', danger: true, run: () => chrome.windows.remove(w.id) }
        ]
      });
    });
  }
  entries.push('-', { text: 'New window', icon: 'win', run: () => chrome.windows.create({}) });
  menu(anchor, entries, { width: 270 });
}

/* hover-to-expand, pin, and drops onto the sidebar */
let sbTimer = null;
sidebar.addEventListener('mouseenter', () => { clearTimeout(sbTimer); sbTimer = setTimeout(() => sidebar.classList.add('open'), 140); });
sidebar.addEventListener('mouseleave', () => { clearTimeout(sbTimer); if (!$('#popover').hidden && sidebar.contains(popoverAnchor)) return; sidebar.classList.remove('open'); });
$('#pinBtn').addEventListener('click', () => {
  state.settings.sidebarPinned = !state.settings.sidebarPinned;
  commit();
});
$('#tabMenuBtn').addEventListener('click', e => windowMenu(e.currentTarget));
$('#sbSearch').addEventListener('click', () => openSearch());

// Dropping saved sites on the sidebar opens them as tabs; dragging tabs within it reorders them.
sidebar.addEventListener('dragover', e => {
  if (!drag || !(drag.kind === 'items' || drag.kind === 'tab')) return;
  e.preventDefault();
  sidebar.classList.add('drag-over');
  $$('.sb-row.drop-before').forEach(n => n.classList.remove('drop-before'));
  const rows = $$('#sbList .sb-row[data-tab]');
  const before = rows.find(r => e.clientY < r.getBoundingClientRect().top + r.offsetHeight / 2);
  if (before) before.classList.add('drop-before');
});
sidebar.addEventListener('dragleave', e => { if (!sidebar.contains(e.relatedTarget)) { sidebar.classList.remove('drag-over'); clearDropMarks(); } });
sidebar.addEventListener('drop', async e => {
  e.preventDefault();
  sidebar.classList.remove('drag-over');
  const before = $('#sbList .sb-row.drop-before');
  clearDropMarks();
  if (!IN_EXT || !drag) return;
  let index = -1;
  if (before) index = (await chrome.tabs.get(+before.dataset.tab)).index;
  if (drag.kind === 'tab') {
    if (index > drag.tab.index) index--;
    chrome.tabs.move(drag.tab.id, { index });
  } else if (drag.kind === 'items') {
    const urls = drag.ids.map(id => findItem(id)?.item).filter(Boolean).flatMap(it => it.type === 'link' ? [it.url] : it.type === 'stack' ? it.items.map(x => x.url) : []);
    for (const url of urls) { await chrome.tabs.create({ url, active: false, index: index < 0 ? undefined : index++ }); }
  }
});

if (IN_EXT) {
  let t = null;
  const refresh = () => { clearTimeout(t); t = setTimeout(renderSidebar, 120); };
  ['onCreated', 'onRemoved', 'onUpdated', 'onMoved', 'onActivated', 'onAttached', 'onDetached'].forEach(ev => chrome.tabs[ev].addListener(refresh));
  if (chrome.tabGroups) ['onCreated', 'onRemoved', 'onUpdated'].forEach(ev => chrome.tabGroups[ev].addListener(refresh));
  chrome.windows.onCreated.addListener(refresh);
  chrome.windows.onRemoved.addListener(refresh);
}
