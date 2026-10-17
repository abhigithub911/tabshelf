'use strict';

const $ = id => document.getElementById(id);
let state, tab;

function fillTargets() {
  const sel = $('where');
  sel.replaceChildren();
  state.workspaces.forEach(ws => ws.categories.forEach(c => {
    const og = document.createElement('optgroup');
    og.label = (state.workspaces.length > 1 ? ws.icon + ' ' + ws.name + ' › ' : '') + c.name;
    c.groups.forEach(gid => {
      const g = state.groups[gid];
      if (!g.locked) og.append(new Option(`${g.icon} ${g.title}`, gid));
    });
    og.append(new Option('＋ New group…', 'new|' + c.id));
    sel.append(og);
  }));
  const last = state.settings.popupGroup;
  if (last && [...sel.options].some(o => o.value === last)) sel.value = last;
  else { const first = activeCategory(state).groups.find(id => !state.groups[id].locked); if (first) sel.value = first; }
  toggleNew();
}
function toggleNew() {
  const isNew = $('where').value.startsWith('new|');
  $('newName').style.display = isNew ? 'block' : 'none';
  if (isNew) { $('newName').value = (tab.title || '').slice(0, 40); $('newName').focus(); $('newName').select(); }
}

function showSaved() {
  const hits = findUrl(state, tab.url || '');
  const box = $('saved');
  if (!hits.length) { box.hidden = true; return; }
  box.hidden = false;
  box.replaceChildren(...hits.slice(0, 3).map(h => {
    const d = document.createElement('div');
    d.textContent = `✓ Saved in ${h.cat.name} › ${h.group.icon} ${h.group.title}`;
    return d;
  }));
}

function targetGroup() {
  const v = $('where').value;
  let g;
  if (v.startsWith('new|')) {
    const cid = v.slice(4);
    let cat = null;
    state.workspaces.forEach(ws => ws.categories.forEach(c => { if (c.id === cid) cat = c; }));
    g = newGroupInCategory(state, cat, $('newName').value.trim() || 'New group', '📦');
  } else g = state.groups[v];
  state.settings.popupGroup = g.id;
  state.settings.popupClose = $('close').checked;
  return g;
}

(async function init() {
  state = await loadState();
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  $('title').textContent = tab.title || 'Untitled';
  $('url').textContent = prettyUrl(tab.url || '');
  $('fav').src = tab.favIconUrl && /^(https?|data):/.test(tab.favIconUrl) ? tab.favIconUrl : chrome.runtime.getURL('/_favicon/?pageUrl=' + encodeURIComponent(tab.url || '') + '&size=32');
  $('close').checked = !!state.settings.popupClose;
  fillTargets();
  showSaved();
  if (!isSavableUrl(tab.url)) {
    ['saveTab', 'readLater'].forEach(id => { $(id).disabled = true; });
    $('saveTab').textContent = "This page can't be saved";
  } else $('note').focus();
})();

$('where').addEventListener('change', toggleNew);

async function save(toInbox) {
  state = await loadState(); // pick up anything changed since the popup opened
  const g = toInbox ? findOrCreateInbox(state) : targetGroup();
  g.items.unshift(makeLink(tab.url, tab.title));
  const note = $('note').value.trim();
  if (note) g.items.splice(1, 0, makeNote(note));
  if (!toInbox) state.settings.popupGroup = g.id;
  state.settings.popupClose = $('close').checked;
  await saveState(state);
  $('msg').textContent = `Saved to ${g.icon} ${g.title}`;
  if ($('close').checked) chrome.tabs.remove(tab.id);
  else setTimeout(() => window.close(), 750);
}
$('saveTab').addEventListener('click', () => save(false));
$('readLater').addEventListener('click', () => save(true));
$('note').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save(false); });

$('saveAll').addEventListener('click', async () => {
  state = await loadState();
  const tabs = (await chrome.tabs.query({ currentWindow: true })).filter(t => isSavableUrl(t.url));
  if (!tabs.length) { $('msg').textContent = 'No tabs to save'; return; }
  const v = $('where').value;
  let cat = activeCategory(state);
  if (v.startsWith('new|')) state.workspaces.forEach(ws => ws.categories.forEach(c => { if (c.id === v.slice(4)) cat = c; }));
  else { const loc = categoryOfGroup(state, v); if (loc) cat = loc.cat; }
  newGroupInCategory(state, cat, sessionTitle(), '🗂️', tabs.map(t => makeLink(t.url, t.title)));
  state.settings.popupClose = $('close').checked;
  await saveState(state);
  $('msg').textContent = `Saved ${tabs.length} tabs to ${cat.name}`;
  if ($('close').checked) {
    await chrome.tabs.create({});
    chrome.tabs.remove(tabs.map(t => t.id));
  }
});

$('openBoard').addEventListener('click', () => { chrome.tabs.create({}); window.close(); });
