# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install          # install dependencies
npm start            # start Express server on http://localhost:3000
```

No build step, no linting, no tests. The app is a single Express server serving static files.

## Architecture

Node.js/Express backend + vanilla JS frontend. No frameworks, no bundler.

```
server.js            → Express API: CRUD, randomizer, habit resets, done cleanup
public/index.html    → Single HTML page with 3 views (main, Olympus, Treats)
public/app.js        → All frontend logic: rendering, event delegation, view switching
public/style.css     → Full stylesheet (no inline styles allowed)
tasks.json           → All persistent data (auto-created on first run)
```

**Data flow:** `app.js` fetches from Express API → `server.js` reads/writes `tasks.json` → responses drive re-render via `loadTasks()` → `render()`.

**View switching:** Three `<main>` elements toggled via `.hidden` class. `hideAllViews()` hides all, then the target view is shown.

**Event handling:** Single `document.addEventListener('click', ...)` with delegation based on CSS classes (`task-checkbox`, `edit`, `delete`, `restore`, `add-btn`, `progress-btn`). A separate `dblclick` listener on `document` handles inline editing for one-offs and treats — finds the closest `.task-item`, looks up the edit button's `data-id`/`data-category`, and calls `startEdit()`. `.task-text` has `user-select: none` to prevent text selection highlight on double-click.

## Task Categories & Logic

- **One-offs:** Boolean done. Completing moves to "Done" section; auto-clears after 7 days.
- **Habits:** Daily recurring. `doneToday` resets when date changes (checked on every `readTasks()`).
- **Projects:** Progress 0–100 via +/- buttons. Auto-ascends to Mount Olympus at 100% with a Pynchon-voice reflection.
- **Treats:** Reward repository. 20% chance of appearing in "Surprise me" randomizer; guaranteed if all tasks are done.
- **Done:** Recently completed one-offs. 7-day retention.
- **Olympus:** Completed projects with date and reflection quote. Can be restored.

## tasks.json Schema

```js
oneOff:   { id, text, done }
habits:   { id, text, doneToday, lastDoneDate }   // lastDoneDate: "YYYY-MM-DD" or null
projects: { id, text, progress }                   // progress: 0–100
treats:   { id, text }
done:     { id, text, completedAt }                // completedAt: ISO string
olympus:  { id, text, completedAt, reflection }    // reflection: Pynchon quote string
nextId:   number                                   // auto-incrementing, starts at 500
```

ID ranges in defaults: oneOff 1–10, habits 101–205, projects 201–206, treats 401–410. New items use `nextId`.

## Render Scope

`render()` only updates the **main view** (oneOff, habits, projects, done). The Olympus and Treats views have their own functions — `renderOlympus()` and `renderTreats()` — called on view switch, not in `render()`. When modifying treats or olympus data, call the appropriate render function explicitly (see `deleteTask` and `restoreTask` in `app.js`).

## Visual Identity — Non-Negotiable

- **Palette:** Deep plum `#2d0a2e` background, warm ivory `#f0e8e0` text, sage green `#b5c99a` accents
- **Typography:** Instrument Serif for headings, Inter for body. All-caps with letter-spacing for labels/nav.
- **Geometry:** Strict square corners throughout — no `border-radius`
- **Feel:** High-end editorial (Prada FW21 reference). Minimalist borders, restrained animation.

## Instructions for Claude

- **Non-coder friendly:** Explain logic changes in plain English.
- **Modular:** Don't overwrite existing CSS patterns or the `tasks.json` structure. Add to them.
- **Resilient:** Handle empty categories gracefully — no "undefined" errors.
- **No inline styles.** All styling in `style.css`.
- **Keep server.js for API/logic, app.js for DOM/UI.** Don't mix concerns.

## Current State — April 4, 2026

**Data snapshot:**
- 11 one-off tasks active, none completed
- 11 habits tracked; `foam roll` last done 2026-04-03
- 6 projects active, all at 0% progress: Job search, Interaction design foundation courses, Personal webpage, Personal website re-do, Accent practice, Read for RS
- 8 treats defined (all analog: tea, walks, cooking, music)
- `done: []` — no one-offs completed yet
- `olympus: []` — no projects have ascended
- `nextId: 500` — IDs 300–304 added beyond defaults (Nails, Read for fun, Put on overgrip, Wrist exercises)

**Notion integration:**
- MCP configured at project level (`~/.claude.json` → `mcpServers.notion`)
- Portfolio page live: `LIFE: The Ascension Logic` → https://www.notion.so/3374ee47dcf581d0bba8fb5ca73f4a70
- Page lives inside `My latest (and bestest :) projects` database on `iamvalentina.notion.site`
- Update workflow: FETCH → DIFF → UPDATE (surgical `update_content` patches, never full rewrites)
- THE CHRONICLE section on the page is the canonical decision log — 3 entries max, newest first

## Next Steps

- [ ] **Start progressing projects.** Job search and Personal website re-do are the highest-stakes. Use `+` to log any forward movement, however small.
- [ ] **First ascension.** Get one project to 100% to trigger the Pynchon-voice reflection and populate Olympus for the first time.
- [ ] **Habit streak integrity.** Several habits have `lastDoneDate: null` — never completed. Stretching, gua sha, dry brushing, plank are untouched.
- [ ] **Update Live Status on Notion page** each session. Format: `X projects active. Y ascensions. Olympus [waits / holds N].`
- [ ] **Append to THE CHRONICLE** when a meaningful design or content decision is made. Keep it to 3 entries. Prune on every update.
