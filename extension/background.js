importScripts('store.js');

/* ---------------- context menus ----------------
   "Save page to ›", "Close page and save to ›", "Save link to ›" and "Save text to ›",
   each listing workspace › category › group, plus "New group". Rebuilt when data changes. */

const MENU_ROOTS = [
  { id: 'page', title: 'Save page to', contexts: ['page'] },
  { id: 'close', title: 'Close page and save to', contexts: ['page'] },
  { id: 'link', title: 'Save link to', contexts: ['link'] },
  { id: 'text', title: 'Save selected text to', contexts: ['selection'] },
  { id: 'image', title: 'Save image to', contexts: ['image'] }
];
const MAX_GROUPS_PER_CATEGORY = 25;

let rebuildTimer = null;
function scheduleMenus() {
  clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(buildMenus, 400);
}

async function buildMenus() {
  const state = await loadState();
  await chrome.contextMenus.removeAll();
  const create = props => new Promise(res => chrome.contextMenus.create(props, () => { void chrome.runtime.lastError; res(); }));
  await create({ id: 'root', title: 'Tabshelf', contexts: ['page', 'link', 'selection', 'image'] });
  await create({ id: 'quick|page', parentId: 'root', title: 'Save page to Read later', contexts: ['page'] });
  for (const r of MENU_ROOTS) {
    await create({ id: r.id, parentId: 'root', title: r.title, contexts: r.contexts });
    const multiWs = state.workspaces.length > 1;
    for (const ws of state.workspaces) {
      const wsParent = multiWs ? `${r.id}|ws|${ws.id}` : r.id;
      if (multiWs) await create({ id: wsParent, parentId: r.id, title: `${ws.icon} ${ws.name}`, contexts: r.contexts });
      for (const c of ws.categories) {
        const cp = `${r.id}|cat|${c.id}`;
        await create({ id: cp, parentId: wsParent, title: c.name, contexts: r.contexts });
        for (const gid of c.groups.slice(0, MAX_GROUPS_PER_CATEGORY)) {
          const g = state.groups[gid];
          await create({ id: `${r.id}|g|${gid}`, parentId: cp, title: `${g.icon} ${g.title}`, contexts: r.contexts });
        }
        await create({ id: `${r.id}|new|${c.id}`, parentId: cp, title: '＋ New group', contexts: r.contexts });
      }
    }
  }
  await create({ id: 'sep', parentId: 'root', type: 'separator', contexts: ['page'] });
  await create({ id: 'all|window', parentId: 'root', title: 'Save all tabs in this window as a group', contexts: ['page'] });
}

chrome.runtime.onInstalled.addListener(() => { buildMenus(); syncAlarms(); });
chrome.runtime.onStartup.addListener(() => { buildMenus(); syncAlarms(); });
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[STORE_KEY]) { scheduleMenus(); scheduleAlarms(); }
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const [kind, mode, id] = String(info.menuItemId).split('|');
  const state = await loadState();

  if (kind === 'all') {
    const tabs = (await chrome.tabs.query({ windowId: tab.windowId })).filter(t => isSavableUrl(t.url));
    if (!tabs.length) return;
    newGroupInCategory(state, activeCategory(state), sessionTitle(), '🗂️', tabs.map(t => makeLink(t.url, t.title)));
    await saveState(state);
    return flashBadge(String(tabs.length));
  }

  let item = null;
  if (kind === 'page' || kind === 'close' || (kind === 'quick' && mode === 'page')) {
    if (!tab || !isSavableUrl(tab.url)) return;
    item = makeLink(tab.url, tab.title);
  } else if (kind === 'link' && info.linkUrl) {
    item = makeLink(info.linkUrl, info.selectionText || prettyUrl(info.linkUrl));
  } else if (kind === 'text' && info.selectionText) {
    item = makeNote(info.selectionText.trim() + (tab && tab.url ? `\n— ${tab.title || prettyUrl(tab.url)}` : ''));
    item.source = tab && tab.url;
  } else if (kind === 'image' && info.srcUrl) {
    item = makeImage(info.srcUrl, info.pageUrl);
  }
  if (!item) return;

  let group = null;
  if (kind === 'quick') group = findOrCreateInbox(state);
  else if (mode === 'g') group = state.groups[id];
  else if (mode === 'new') {
    let cat = null;
    state.workspaces.forEach(ws => ws.categories.forEach(c => { if (c.id === id) cat = c; }));
    if (!cat) return;
    group = newGroupInCategory(state, cat, kind === 'page' || kind === 'close' ? (tab.title || 'New group').slice(0, 40) : 'New group', '📦');
  }
  if (!group) return;
  group.items.unshift(item);
  await saveState(state);
  flashBadge('✓');
  if (kind === 'close' && tab) chrome.tabs.remove(tab.id);
});

function flashBadge(text) {
  chrome.action.setBadgeBackgroundColor({ color: '#6ba6f8' });
  chrome.action.setBadgeText({ text });
  setTimeout(() => chrome.action.setBadgeText({ text: '' }), 1600);
}

/* ---------------- keyboard commands ---------------- */

chrome.commands.onCommand.addListener(async (cmd) => {
  if (cmd !== 'save-tab') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !isSavableUrl(tab.url)) return;
  const state = await loadState();
  findOrCreateInbox(state).items.unshift(makeLink(tab.url, tab.title));
  await saveState(state);
  flashBadge('✓');
});

/* ---------------- reminders ----------------
   An item carries `remind: { at, repeat }` (repeat: none | daily | weekly | monthly).
   Each one becomes a chrome.alarms entry named "rem|<itemId>". */

let alarmTimer = null;
function scheduleAlarms() {
  clearTimeout(alarmTimer);
  alarmTimer = setTimeout(syncAlarms, 300);
}

function eachItem(state, fn) {
  Object.values(state.groups).forEach(g => g.items.forEach(it => {
    fn(it, g);
    if (it.type === 'stack') it.items.forEach(x => fn(x, g));
  }));
}

async function syncAlarms() {
  const state = await loadState();
  const want = new Map();
  eachItem(state, it => { if (it.remind && it.remind.at) want.set('rem|' + it.id, it.remind.at); });
  const existing = await chrome.alarms.getAll();
  for (const a of existing) {
    if (!a.name.startsWith('rem|')) continue;
    if (!want.has(a.name) || Math.abs(a.scheduledTime - want.get(a.name)) > 1000) await chrome.alarms.clear(a.name);
  }
  const now = Date.now();
  for (const [name, at] of want) {
    const cur = await chrome.alarms.get(name);
    if (!cur) chrome.alarms.create(name, { when: Math.max(at, now + 1000) });
  }
}

function nextTime(at, repeat) {
  const d = new Date(at);
  const now = Date.now();
  do {
    if (repeat === 'daily') d.setDate(d.getDate() + 1);
    else if (repeat === 'weekly') d.setDate(d.getDate() + 7);
    else if (repeat === 'monthly') d.setMonth(d.getMonth() + 1);
    else return null;
  } while (d.getTime() <= now);
  return d.getTime();
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (!alarm.name.startsWith('rem|')) return;
  const itemId = alarm.name.slice(4);
  const state = await loadState();
  let found = null, group = null;
  eachItem(state, (it, g) => { if (it.id === itemId) { found = it; group = g; } });
  if (!found || !found.remind) return;
  const title = found.type === 'link' ? found.title : (found.text || 'Reminder').split('\n')[0].slice(0, 80);
  chrome.notifications.create('rem|' + itemId + '|' + Date.now(), {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: '⏰ ' + title,
    message: found.type === 'link' ? prettyUrl(found.url) : `${group.icon} ${group.title}`,
    priority: 2,
    requireInteraction: true
  });
  const next = nextTime(found.remind.at, found.remind.repeat);
  if (next) found.remind.at = next; else delete found.remind;
  await saveState(state);
});

chrome.notifications.onClicked.addListener(async (nid) => {
  const [, itemId] = nid.split('|');
  const state = await loadState();
  let url = null;
  eachItem(state, it => { if (it.id === itemId && it.url) url = it.url; });
  chrome.tabs.create({ url: url || 'chrome://newtab' });
  chrome.notifications.clear(nid);
});
