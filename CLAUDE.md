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

**Event handling:** Single `document.addEventListener('click', ...)` with delegation based on CSS classes (`task-checkbox`, `edit`, `delete`, `restore`, `add-btn`, `progress-btn`). A separate `dblclick` listener on `document` handles inline editing for one-offs and treats — finds the closest `.task-item`, calls `e.preventDefault()` on any double-click within a `.task-item` (prevents browser text selection), then calls `startEdit()` only if the target is `.task-text`. `.task-text` also has `user-select: none` as a belt-and-suspenders measure. The dblclick listener early-returns if `!isAdmin()`.

**Auth:** App is read-only by default. All mutating API routes require `X-Admin-Password` header matching `process.env.ADMIN_PASSWORD` (set in Railway). Frontend stores password in `localStorage` under `adminPassword`. `body.admin-mode` CSS class gates all write UI (add buttons, checkboxes, edit/delete/restore, progress buttons). `Surprise me` stays visible in both modes. Key functions: `isAdmin()`, `authHeaders()`, `apiFetch()` (wraps all mutating fetches, auto-locks on 401), `unlock(pw)`, `lock()`, `applyAuthUI()`. Lock button (`#lock-btn`) in header — 🔒 locked / 🔓 unlocked (sage green).

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

## Deployment

- **Live app:** https://life-day-by-day-production.up.railway.app (Railway, Hobby plan)
- **GitHub:** https://github.com/imperfectsunset29/life-day-by-day
- **Persistence:** `tasks.json` saved to Railway volume mounted at `/app/data`. `server.js` checks `fs.existsSync('/app/data')` and falls back to `__dirname` for local dev.
- **Deploy workflow:** push to `main` → Railway auto-redeploys.

## Current State — April 4, 2026

**Data snapshot:**
- 8 one-off tasks active; 4 in done (Send mom eye prescription, Go to eye exam, Put on overgrip, Send Patrick response)
- 12 habits tracked; `foam roll` and `hang from bar` last done 2026-04-03; Gym added (id 501)
- 5 projects active: Job search (70%), Interaction design foundation courses (20%), Voice app practice (0%), Read for RS (20%), AI Lab project on portfolio (0%)
- 8 treats defined (all analog: tea, walks, cooking, music)
- `olympus: 1` — Personal website re-do ascended 2026-04-03
- `nextId: 503`

**Auth:** Password-based write protection live. `ADMIN_PASSWORD` set in Railway env vars. Enter password once per device via lock button — stored in `localStorage`.

**Notion integration:**
- MCP configured at project level (`~/.claude.json` → `mcpServers.notion`)
- Portfolio page: `LIFE — Personal productivity app, built from scratch with Claude Code` → https://www.notion.so/3374ee47dcf581d0bba8fb5ca73f4a70
- Page lives inside `My latest (and bestest :) projects` database on `iamvalentina.notion.site`
- Update workflow: FETCH → DIFF → UPDATE (surgical `update_content` patches, never full rewrites)
- THE CHRONICLE: 3 entries max, newest first. Full log in memory: `project_chronicle_log.md`
- Chronicle V&T: plain English, proof of output, no literary flourishes. See `feedback_chronicle_vt.md`

## Next Steps

- [ ] **Habit streak integrity.** Several habits have `lastDoneDate: null` — never completed. Stretching, gua sha, dry brushing, plank are untouched.
- [ ] **Progress projects.** Job search at 70% — push to ascension. AI Lab project on portfolio is meta and worth showing.
- [ ] **Update Live Status on Notion page** each session. Format: `X projects active. Y ascensions. Olympus holds N.`
- [ ] **Append to THE CHRONICLE** when a meaningful decision is made. Prune Notion to 3, append full log to `project_chronicle_log.md`.
