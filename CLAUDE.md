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
server.js            → Express API: CRUD, randomizer, habit resets, done cleanup, oracle
public/index.html    → Single HTML page with 4 views (main, Olympus, Treats, Hard Things) + 2 overlays (randomizer, oracle)
public/app.js        → All frontend logic: rendering, event delegation, view switching
public/style.css     → Full stylesheet (no inline styles allowed)
tasks.json           → All persistent data (auto-created on first run)
```

**Data flow:** `app.js` fetches from Express API → `server.js` reads/writes `tasks.json` → responses drive re-render via `loadTasks()` → `render()`.

**View switching:** `<main>` elements toggled via `.hidden` class. `hideAllViews()` hides all, then the target view is shown.

**Event handling:** Single `document.addEventListener('click', ...)` with delegation based on CSS classes. A separate `dblclick` handles inline editing for one-offs and treats. Drag-to-reorder uses SortableJS — initialized via `initSortable(listId, category)` after each list render; admin-only. Touch: 300ms hold to drag.

**Auth:** Two profiles — VC and FG — each with its own data file (`tasks.json` / `tasks-fg.json`) and password (`ADMIN_PASSWORD` / `FG_ADMIN_PASSWORD`). Every request includes `X-Profile: vc|fg` header. `body.admin-mode` CSS class gates all write UI. Key functions: `isAdmin()`, `authHeaders()`, `apiFetch()`, `unlock(pw)`, `lock()`, `applyAuthUI()`. Profile stored in `localStorage` as `currentProfile`; password stored as `adminPassword-vc` / `adminPassword-fg`.

**Dev mode:** If a profile's password env var is not set, that profile is auto-unlocked (`requireAdmin` calls `next()` immediately; frontend auto-unlocks with `'dev'`).

**Profile selector:** Shown on first visit (`#profile-selector` main element). Clicking VC or FG sets `currentProfile` in localStorage and loads that profile's data. A switcher button in the header returns to the selector.

## Task Categories & Logic

- **One-offs:** Boolean done. Completing moves to "Done"; clears every Sunday 23:59 PT.
- **Habits:** Daily recurring. `doneToday` resets at 5 AM PT (checked on every `readTasks()`).
- **Projects:** Progress 0–100 via +/− buttons. Sub-steps (`steps[]`) are a pure checklist — don't affect progress. Auto-ascends to Olympus at 100% with a random Pynchon quote. Route ordering in `server.js` matters: step routes must be registered before `/:category/:id`. Step text is edited inline by tapping it (admin only) — `startEditStep()` replaces the span with an input, same pattern as `addStep()`, reuses `.step-text-input` CSS.
- **Treats / Hard Things:** Stateless. 20% chance each in randomizer.
- **Done:** Completed one-offs; cleared every Sunday 23:59 PT.
- **Olympus:** Ascended projects. Restoring resets progress to 0; steps not restored.
- **Surprise Me:** `currentSurpriseTask` tracks the last spin. "I'll do it" marks oneOff/habit done; Treats/Hard Things close without checking off.

**Quote style — non-negotiable:** Both the one-off celebration quote (`GET /api/quote/celebration`, shown when all one-offs are cleared) and the project ascension quote (`reflection` field, shown when a project hits 100%) must be Pynchon-style: sardonic, paranoid, literary, darkly funny — hints of entropy, hidden systems, "They". No plain/minimalist/dry register for either.

## Oracle

Single block of text (quote, I Ching, etc.) at the top of the main view. Stored as `oracle: { text, source, preview }` in `tasks.json`. Collapsed view shows source + preview (up to 3 lines, CSS line-clamp). Clicking opens `#oracle-overlay` with full text as clickable sentence spans. Admin can select up to 2 sentences as preview (tap to select; tapping a 3rd resets). Key functions: `renderOracle()`, `openOracleOverlay()`, `buildSentenceSpans()`, `updateOracleActionBtn()`. API: `PUT /api/oracle`.

## tasks.json Schema

```js
oneOff:     { id, text, done }
habits:     { id, text, doneToday, lastDoneDate }   // lastDoneDate: "YYYY-MM-DD" or null
projects:   { id, text, progress, steps }            // steps: [{ id, text, done }]
treats:     { id, text }
hardThings: { id, text }
done:       { id, text, completedAt }                // ISO string
olympus:    { id, text, completedAt, reflection }    // Pynchon quote
oracle:     { text, source, preview }                // single object, not an array
nextId:     number                                   // shared counter for tasks and steps
```

## Render Scope

`render()` updates the main view and re-initializes SortableJS. Olympus, Treats, and Hard Things have their own render functions (`renderOlympus()`, `renderTreats()`, `renderHardThings()`) — call these explicitly when modifying that data.

## Mobile

Single breakpoint at `max-width: 480px` in `style.css`. When editing overlay or button styles, always audit the mobile block too — it reduces card padding but does not automatically scale button padding or font sizes.

## Visual Identity — Non-Negotiable

- **Palette:** Near-black (`#130518`) radial gradient background with plum/indigo blooms, warm ivory `#f0e8e0` text, sage green `#b5c99a` accents, warm amber `#c8a87a` for highlights
- **Typography:** Instrument Serif for headings, Inter for body. All-caps with letter-spacing for labels/nav.
- **Geometry:** Dark-mode Liquid Glass (Apple iOS 26 / macOS Tahoe paradigm). Task cards and overlays are floating glass panels — `backdrop-filter: blur()`, `rgba(255,255,255,0.055–0.08)` fills, `1px solid rgba(255,255,255,0.09–0.14)` luminous borders, inner specular highlight via `box-shadow: inset 0 1px 0 rgba(255,255,255,0.10–0.18)`. Buttons are pill-shaped (`border-radius: 100px`). Cards use `border-radius: 16–28px`.
- **Feel:** Prada FW21 remains the colour and atmosphere reference — deep plum, warm ivory, sage green, editorial restraint. The geometry shifts from flat squares to Liquid Glass, but the palette and tone do not change.

**Back buttons:** Secondary views (Olympus, Treats, Hard Things, Shopping List) use `.back-btn` — a bare `‹` chevron via `::before`, no label, no border. Context makes navigation legible without naming it.

**Profile selector logo:** `logo.jpg` displayed at 200px with `mix-blend-mode: screen`, radial `mask-image` fade, and amber `drop-shadow` — the brain emerges from the dark gradient rather than sitting as a distinct image.

## App Icon & Visual Reference — Non-Negotiable

`public/apple-touch-icon.png` (180×180) and `public/favicon.png` (32×32) are the canonical icons. **`public/logo.jpg` is the high-quality design reference** — consult it before making any visual decisions.

**Design (from logo.jpg):** Top-down anatomical brain on a near-black background (much darker than the UI's `#2d0a2e` — the brain floats in near-darkness). Golden amber continuous outline traces the full silhouette, with visible rounded gyral bumps along the edge.

- **Left hemisphere:** Bold, fluid sulci in sage green (`#b5c99a`) that bloom toward ivory/white at their peaks. Three prominent arcs — one large S-curve, one U near the top, one lower arc. A glossy specular highlight in the upper-left gives it a glassy, living quality. This side is defined, illuminated, present.
- **Right hemisphere:** Sulci present but ghosted — smaller, less defined, fading before they end. No specular highlight. Darker, more recessive. The dissolving quality is the point, not a defect.
- **Center fissure:** The warmest element. Amber-orange glow (`#d4902a` to near-white at peak) radiates from the base of the fissure upward, like an inner light source. This is the emotional center of the icon.

**Visual language to carry forward:** Any future illustration, loading state, overlay, or UI element should feel like it belongs in the same world as logo.jpg — near-black ground, amber inner light, the left-right split between the structured and the dissolving. The wabi-sabi asymmetry is a design principle, not a stylistic accident.

## Interaction Design Decisions

**Tap-to-edit vs. explicit edit buttons**
Project steps use tap-to-edit (click the text to edit inline) with no button. All other task categories (one-offs, habits, projects, treats, hard things) keep an explicit edit button. Rationale:

- Steps have no checkbox, so a tap on text is unambiguous. Edit buttons would clutter small rows.
- One-offs and habits sit next to a checkbox — a single tap on text to edit is too easy to confuse with completing the task. The existing `dblclick` handler is the right compromise there.
- Project titles and treats/hard things keep the button because discoverability matters; the button signals that editing is possible. It's low-opacity until hover so it doesn't clutter the UI.
- Removing edit buttons everywhere would look cleaner but risks accidental edits while scrolling on mobile, and new users would have no cue that text is editable.

Rule of thumb: **tap-to-edit is appropriate when there is no competing single-tap action on the same row.**

## Instructions for Claude

- **Non-coder friendly:** Explain logic changes in plain English.
- **Modular:** Don't overwrite existing CSS patterns or the `tasks.json` structure. Add to them.
- **No inline styles.** All styling in `style.css`.
- **Keep server.js for API/logic, app.js for DOM/UI.** Don't mix concerns.

## Deployment

- **Live app:** https://life-day-by-day-production.up.railway.app (Railway, Hobby plan)
- **GitHub:** https://github.com/imperfectsunset29/life-day-by-day
- **Persistence:** `tasks.json` / `tasks-fg.json` saved to Railway volume at `/app/data`. Falls back to `__dirname` for local dev.
- **Deploy workflow:** push to `main` → Railway auto-redeploys.
- **Env vars:** `ADMIN_PASSWORD` (VC), `FG_ADMIN_PASSWORD` (FG). Neither set = both profiles open in dev mode.

## Next Steps

- [ ] **Add a backup button** to the UI so `/api/backup` can be triggered with auth headers from within the app.
- [ ] **Update Live Status on Notion page** each session. Format: `X projects active. Y ascensions. Olympus holds N.`
- [ ] **Append to The Chronicle** when a meaningful decision is made. Prune Notion to 3, append full log to `project_chronicle_log.md`.
