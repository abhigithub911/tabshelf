# Tabshelf: Chrome Web Store listing text

Copy each block into the matching field of the developer dashboard.

## Name (from the manifest)
Tabshelf - Tab Manager & New Tab Board

## Summary (from the manifest, 132 characters max)
Save tabs, quick links, notes and to-dos into colorful groups on your new tab page. Free, private, no account.

## Detailed description

Tabshelf turns your new tab page into a calm, organised board for everything you keep open "for later".

Drag tabs from the sidebar into groups, add colored notes as section headers, keep to-dos next to the links they belong to, and open a whole group of sites in one click. It's free, works offline, and keeps everything on your own device.

WHAT YOU CAN DO
• Save tabs with drag and drop from the live tabs sidebar, or save every tab in a window at once
• Organise with workspaces, categories and groups, each with its own emoji or image
• Use colored notes as section headers, with optional bright, darker, vintage or bordered styles, and write to-dos with checkboxes
• Open all sites in a group as a Chrome tab group, or in a new window
• Stack related sites side by side to keep groups tidy
• Search everything with ⌘K / Ctrl+K: saved sites, notes, groups, workspaces and open tabs
• Set one-time or repeating reminders on any site or note
• Save from any page with the toolbar popover or the right-click menu, including links, images and selected text
• Restore anything you delete from the bin
• Light and dark themes, three item sizes, compact groups and resizable columns

YOUR DATA STAYS YOURS
• No account, no sign-up, no tracking
• Everything is stored locally in your browser
• Export a backup any time, import your bookmarks, or export to bookmarks HTML or CSV

KEYBOARD FRIENDLY
⌘K / Ctrl+K search · Ctrl+G new group · Ctrl+Z bin · 1–9 switch category · Alt+Shift+U save popover · Alt+Shift+S save to Read later

## Category
Productivity → Tools (or Workflow & Planning)

## Single purpose description
Tabshelf replaces the new tab page with a personal board where the user saves and organises their browser tabs and links into groups, together with notes, to-dos and reminders.

## Permission justifications

**storage** — Stores the user's saved groups, links, notes and settings locally on their device.

**unlimitedStorage** — Users can save thousands of links, notes and images; this prevents their board from hitting the default local storage quota.

**tabs** — Lists the tabs in the current window in the sidebar so the user can save them into groups, switch to them, or close them; reads the current tab's title and URL when the user saves it from the toolbar popover or right-click menu; opens saved sites.

**tabGroups** — Shows the user's Chrome tab groups in the sidebar so they can save a whole group, and opens a saved group's sites as a named tab group.

**favicon** — Shows site icons for saved links and open tabs from Chrome's local favicon cache.

**contextMenus** — Adds "Save page / link / image / selected text to Tabshelf" options to the right-click menu.

**topSites** — Creates an optional "Most visited" group from Chrome's most visited sites when the user asks for it (and once on first install).

**search** — When the user chooses "Search the web" in Tabshelf's search, sends the query to their default search engine.

**alarms** — Schedules the reminders the user sets on saved sites and notes.

**notifications** — Shows a desktop notification when one of the user's reminders is due.

**bookmarks (optional)** — Requested only when the user clicks "Import Chrome bookmarks", to import a bookmarks folder they choose.

**Host permissions** — None requested.

## Remote code
No, I am not using remote code. All JavaScript is included in the package.

## Data usage (what to tick)
- Web history: yes. The extension reads the titles and addresses of tabs the user chooses to save, and stores them locally.
- Website content: yes. Selected text and images the user saves from a page are stored locally.
- Everything else: no.

Certifications (tick all three):
- I do not sell or transfer user data to third parties, outside of the approved use cases
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- I do not use or transfer user data to determine creditworthiness or for lending purposes
