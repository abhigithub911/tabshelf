// Shared data layer for the new tab page, the popup and the background worker.
// Everything lives in chrome.storage.local under one key.
//
// Model: workspaces > categories (top tabs) > groups (cards) > items.
// Items are sites (links), notes (optionally colored or a to-do), stacks of sites, and images.

const STORE_KEY = 'tabnest';
const HAS_CHROME = typeof chrome !== 'undefined' && !!(chrome.storage && chrome.storage.local);
const BIN_LIMIT = 50;

const NOTE_COLORS = ['none', 'red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink', 'gray'];

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function makeGroup(title, icon, items) {
  return { id: uid(), title: title || 'Untitled', icon: icon || '📦', items: items || [], created: Date.now() };
}
function makeLink(url, title) {
  return { type: 'link', id: uid(), url, title: title || prettyUrl(url), added: Date.now() };
}
function makeNote(text, color, todo) {
  return { type: 'note', id: uid(), text: text || '', color: color || 'none', todo: !!todo, done: false, added: Date.now() };
}
function makeStack(links) {
  return { type: 'stack', id: uid(), items: links, open: false, added: Date.now() };
}
function makeImage(src, url) {
  return { type: 'image', id: uid(), src, url: url || src, added: Date.now() };
}
function makeCategory(name, groups) {
  return { id: uid(), name: name || 'New category', groups: groups || [] };
}
function makeWorkspace(name, icon, categories) {
  const cats = categories && categories.length ? categories : [makeCategory('Quicklinks')];
  return { id: uid(), name: name || 'Workspace', icon: icon || '🏠', categories: cats, activeCategory: cats[0].id };
}

function prettyUrl(url) {
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return url;
    return (u.hostname.replace(/^www\./, '') + u.pathname + u.search).replace(/\/$/, '');
  } catch (e) {
    return url;
  }
}

function defaultState() {
  const quick = makeGroup('Favorites', '⭐', [
    makeNote('Daily', 'blue'),
    makeLink('https://mail.google.com/', 'Gmail'),
    makeLink('https://calendar.google.com/', 'Google Calendar'),
    makeLink('https://github.com/', 'GitHub'),
    makeNote('Watch', 'green'),
    makeLink('https://www.youtube.com/', 'YouTube')
  ]);
  const mostVisited = makeGroup('Most visited', '🌎', []);
  const inbox = makeGroup('Inbox', '📥', [
    makeNote('Right-click any page and choose “Save to Tabshelf”, or drag a tab from the left sidebar into a group.', 'yellow')
  ]);
  const tools = makeGroup('Quick Lookup', '📚', [
    makeNote('Getting started', 'red'),
    makeNote('Drag tabs from the sidebar into a group', 'none', true),
    makeNote('Type /todo, /red, /green… inside a note', 'none', true),
    makeNote('Press ⌘K or Ctrl+K to search everything', 'none', true)
  ]);
  const groups = {};
  [quick, mostVisited, inbox, tools].forEach(g => { groups[g.id] = g; });
  const ws = makeWorkspace('My workspace', '🏠', [
    makeCategory('Quicklinks', [quick.id, mostVisited.id]),
    makeCategory('Read later', [inbox.id]),
    makeCategory('Tools', [tools.id])
  ]);
  return {
    version: 2,
    workspaces: [ws],
    activeWorkspace: ws.id,
    groups,
    bin: [],
    settings: defaultSettings(),
    needsTopSites: mostVisited.id
  };
}

function defaultSettings() {
  return {
    theme: 'auto',           // auto | light | dark
    newTab: false,           // open saved sites in a new tab
    jumpToOpen: true,        // focus a tab that already has the site open
    size: 'm',               // s | m | l  item size
    showUrls: true,
    trashZone: true,         // drop zone for deleting while dragging
    sidebarPinned: false,
    closeOnSave: true,       // dragging an open tab into a group closes it (hold Shift to keep it)
    googleFavicons: true,
    showWorkspaceIcon: true
  };
}

async function loadState() {
  let raw = null;
  if (HAS_CHROME) {
    const res = await chrome.storage.local.get(STORE_KEY);
    raw = res[STORE_KEY] || null;
  } else {
    try { raw = JSON.parse(localStorage.getItem(STORE_KEY)); } catch (e) { raw = null; }
  }
  return normalize(raw || defaultState());
}

async function saveState(state) {
  state.rev = uid();
  if (HAS_CHROME) {
    await chrome.storage.local.set({ [STORE_KEY]: state });
  } else {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  }
  return state.rev;
}

// Upgrade older data and repair anything inconsistent (e.g. after an import).
function normalize(s) {
  if (!s || typeof s !== 'object') return defaultState();
  s.groups = s.groups || {};

  // v1 had "spaces" (top tabs) and a quick-launch dock, sections and to-dos as separate types.
  if (!s.workspaces && s.spaces) {
    const cats = s.spaces.map(sp => ({ id: sp.id || uid(), name: sp.name, groups: sp.columns || [] }));
    if (s.dock && s.dock.length) {
      const g = makeGroup('Quick launch', '🚀', s.dock.map(d => makeLink(d.url, d.title)));
      s.groups[g.id] = g;
      cats[0].groups.unshift(g.id);
    }
    const ws = makeWorkspace('My workspace', '🏠', cats);
    ws.activeCategory = s.activeSpace && cats.find(c => c.id === s.activeSpace) ? s.activeSpace : cats[0].id;
    s.workspaces = [ws];
    s.activeWorkspace = ws.id;
    delete s.spaces; delete s.dock; delete s.activeSpace;
  }
  if (!Array.isArray(s.workspaces) || !s.workspaces.length) {
    const d = defaultState();
    s.workspaces = d.workspaces;
    Object.assign(s.groups, d.groups);
  }
  s.version = 2;
  s.bin = Array.isArray(s.bin) ? s.bin.slice(0, BIN_LIMIT) : [];
  s.settings = Object.assign(defaultSettings(), s.settings || {});
  if (s.settings.theme === 'system') s.settings.theme = 'auto';

  const seen = new Set();
  s.workspaces.forEach(ws => {
    ws.id = ws.id || uid();
    ws.icon = ws.icon || '🏠';
    ws.categories = Array.isArray(ws.categories) && ws.categories.length ? ws.categories : [makeCategory('Quicklinks')];
    ws.categories.forEach(c => {
      c.id = c.id || uid();
      // A group lives in exactly one category.
      c.groups = (c.groups || []).filter(id => s.groups[id] && !seen.has(id) && seen.add(id));
    });
    if (!ws.categories.find(c => c.id === ws.activeCategory)) ws.activeCategory = ws.categories[0].id;
  });
  if (!s.workspaces.find(w => w.id === s.activeWorkspace)) s.activeWorkspace = s.workspaces[0].id;

  Object.keys(s.groups).forEach(id => { if (!seen.has(id)) delete s.groups[id]; });
  Object.values(s.groups).forEach(g => {
    g.items = (g.items || []).filter(Boolean).map(normalizeItem).filter(Boolean);
  });
  return s;
}

function normalizeItem(it) {
  it.id = it.id || uid();
  if (it.type === 'section') return Object.assign(makeNote(it.title, it.color || 'gray'), { id: it.id });
  if (it.type === 'todo') return Object.assign(makeNote(it.text, 'none', true), { id: it.id, done: !!it.done });
  if (it.type === 'note') { it.color = it.color || 'none'; return it; }
  if (it.type === 'stack') {
    it.items = (it.items || []).filter(x => x && x.url).map(x => { x.id = x.id || uid(); x.type = 'link'; return x; });
    if (it.items.length === 0) return null;
    if (it.items.length === 1) return it.items[0];
    return it;
  }
  if (it.type === 'link' && it.url) return it;
  if (it.type === 'image' && it.src) return it;
  return null;
}

/* ---- lookups shared by every page ---- */

function activeWorkspace(s) { return s.workspaces.find(w => w.id === s.activeWorkspace) || s.workspaces[0]; }
function activeCategory(s) { const ws = activeWorkspace(s); return ws.categories.find(c => c.id === ws.activeCategory) || ws.categories[0]; }
function categoryOfGroup(s, gid) {
  for (const ws of s.workspaces) for (const c of ws.categories) if (c.groups.includes(gid)) return { ws, cat: c };
  return null;
}
function allLinks(g) {
  const out = [];
  g.items.forEach(i => { if (i.type === 'link') out.push(i); else if (i.type === 'stack') out.push(...i.items); });
  return out;
}
// Find every place a URL is saved (used by the popup to show "already saved in…").
function findUrl(s, url) {
  const norm = u => (u || '').replace(/#.*$/, '').replace(/\/$/, '');
  const target = norm(url);
  const hits = [];
  s.workspaces.forEach(ws => ws.categories.forEach(c => c.groups.forEach(gid => {
    const g = s.groups[gid];
    allLinks(g).forEach(l => { if (norm(l.url) === target) hits.push({ ws, cat: c, group: g, item: l }); });
  })));
  return hits;
}

// Add an item to the "Inbox" group of the active workspace's "Read later" category.
function findOrCreateInbox(s) {
  const ws = activeWorkspace(s);
  let cat = ws.categories.find(c => c.name.toLowerCase() === 'read later');
  if (!cat) { cat = makeCategory('Read later'); ws.categories.push(cat); }
  let gid = cat.groups[0];
  if (!gid) {
    const g = makeGroup('Inbox', '📥');
    s.groups[g.id] = g;
    cat.groups.push(g.id);
    gid = g.id;
  }
  return s.groups[gid];
}

function newGroupInCategory(s, cat, title, icon, items) {
  const g = makeGroup(title, icon, items);
  s.groups[g.id] = g;
  cat.groups.unshift(g.id); // new groups go in the first slot
  return g;
}

function sessionTitle() {
  return new Date().toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function isSavableUrl(url) {
  return !!url && !/^(chrome|edge|brave|about|chrome-extension|devtools|view-source):/i.test(url);
}

function pushBin(s, entry) {
  s.bin.unshift(Object.assign({ id: uid(), deletedAt: Date.now() }, entry));
  if (s.bin.length > BIN_LIMIT) s.bin.length = BIN_LIMIT;
}

if (typeof self !== 'undefined') {
  Object.assign(self, {
    STORE_KEY, NOTE_COLORS, BIN_LIMIT, uid, makeGroup, makeLink, makeNote, makeStack, makeImage, makeCategory, makeWorkspace,
    prettyUrl, defaultState, defaultSettings, loadState, saveState, normalize, activeWorkspace, activeCategory,
    categoryOfGroup, allLinks, findUrl, findOrCreateInbox, newGroupInCategory, sessionTitle, isSavableUrl, pushBin
  });
}
