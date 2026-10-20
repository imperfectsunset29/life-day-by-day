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
- **Shopping:** One page, two lists (the nav has no room for a sixth item). **Errands** (`shoppingList`) is a quick checklist whose checked items clear daily. **Wishlist** holds longer-term wants that never clear; each can carry an optional one-line note the user writes in the edit overlay. Tapping a wish opens its card; "Bought it" moves it to **Acquired** (collapsed archive, newest first, showing how long it was wanted) and offers "Add to wardrobe", which prefills name, origin (the shop's domain), acquired date and memory (the note). Items move between Errands and Wishlist via the edit dropdown on phones or the "→ wishlist / → errands" action on desktop. API: `POST /api/wishlist/:id/acquire`, `POST /api/shopping/move`.
- **Surprise Me:** `currentSurpriseTask` tracks the last spin. "I'll do it" marks oneOff/habit done; Treats/Hard Things close without checking off.

**Quote style — non-negotiable:** Both the one-off celebration quote (`GET /api/quote/celebration`, shown when all one-offs are cleared) and the project ascension quote (`reflection` field, shown when a project hits 100%) must be Pynchon-style: sardonic, paranoid, literary, darkly funny. No plain/minimalist/dry register for either.

**Quote freshness — non-negotiable.** Finishing should feel rewarding, so every quote must feel new. Entropy, hidden systems and "They" are a palette to draw from occasionally, never a checklist. `generatePynchon()` in `server.js` builds each prompt from three parts. The project's name gives specificity. A random entry from `PYNCHON_ANGLES` sets the doorway. The recent quotes go in as a do-not-echo list: the last 12 Olympus reflections, or for one-offs an in-memory list of the last 12 celebration quotes per profile. Don't reintroduce a pre-generated queue: it can't know the project or what was just said. The frontend opens the celebration overlay immediately and fills the quote in when it arrives.

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
wardrobe:   { id, text, brand, color, material, pattern, occasion, season, wardrobeCategory, subcategory,
              origin, acquired, memory,                // optional, user-written: where it's from, when, a one-line memory
              createdAt }
wearLog:    { id, date, wornAt, itemIds, prompt, weather } // one entry per "Love it"; date is the PT habit-day
shoppingList: { id, text, done, createdAt }          // Errands; done items clear at the end of each PT day
wishlist:   { id, text, note, createdAt }            // longer-term wants; never auto-clear; note is the user's optional one-liner
acquired:   { id, text, note, createdAt, acquiredAt } // bought wishes; createdAt→acquiredAt = how long it was wanted
shoppingSplit: true                                  // one-time migration flag (linked items moved from shoppingList to wishlist)
nextId:     number                                   // shared counter for tasks, steps and wear entries
```

## Data Safety — Don't Remove

All data is plain JSON on the Railway volume (`/app/data`): `tasks*.json` per profile, `events*.json` activity logs. Safeguards in `server.js`:
- **All-or-nothing saves:** every write goes through `writeJsonAtomic()` (write `.tmp`, then rename), so a crash or deploy mid-save can't leave a half-written file. Never call `fs.writeFileSync` on a data file directly.
- **Daily snapshots:** `snapshotIfDue()` copies each profile's file into `/app/data/snapshots/` before the day's first save, keeping `SNAPSHOT_KEEP_DAYS` (14) days.
- **Self-repair:** if a data file can't be parsed, `readDataFile()` sets it aside as `*.damaged-<time>` and restores the newest valid snapshot (start of that day's state).
- **Volume check:** if `/app/data` is missing on Railway, the server logs a loud `STORAGE WARNING`; data would otherwise vanish on the next deploy. `GET /api/health` reports `persistent`, the latest snapshot, and counts (projects, olympus, garments, wears, wishlist).
- **Never hold data across an `await`:** read, change, write in one go. If a route must wait (e.g. the ascension quote), re-read with `readTasks()` after the wait and apply the change to the fresh copy, or edits made meanwhile are overwritten.
- **Dream photos are files, not data:** a dream's `image` is a URL like `/media/vc/dreams/<id>-<random>.jpg`, served read-only from `/app/data/media/`. `saveDreamImage()` turns an uploaded data URI into a file (a URL passed back is kept as-is, `''` removes the photo). Photos aren't deleted with their dream: the daily `sweepMedia()` removes a file only when it's over a day old and neither the current data nor any snapshot refers to it, so restoring a snapshot keeps its photos. Never store base64 images in a data file again.
- **Wardrobe audit trail:** garment edits log `garment_edited` with each changed field (`from`→`to`); deleting a garment logs the whole item, so it can be rebuilt from the activity log. Wears log `outfit_worn`.

## Render Scope

`render()` updates the main view and re-initializes SortableJS. Olympus, Treats, and Hard Things have their own render functions (`renderOlympus()`, `renderTreats()`, `renderHardThings()`) — call these explicitly when modifying that data.

## Mobile

Single breakpoint at `max-width: 480px` in `style.css`. When editing overlay or button styles, always audit the mobile block too — it reduces card padding but does not automatically scale button padding or font sizes.

**iOS auto-zoom guard — don't remove.** Inputs use text smaller than 16px, which makes iOS Safari zoom in on focus and stay zoomed, so overlays (e.g. Today's Outfit) spill off the right edge. Prevented by:
- `maximum-scale=1.0` in the viewport meta in `index.html` (iOS still allows pinch-zoom; Android loses it).
- `html { overflow-x: clip; text-size-adjust: 100% }`. Nothing can scroll the page sideways.
- `.overlay` uses `inset: 0` (not `100vw`/`100vh`); `.overlay-content` caps at `max-height: 90dvh` with `overflow-y: auto`.

New overlays should reuse `.overlay` / `.overlay-content` to inherit these guards.

**Status bar clearance — don't remove.** Installed to the home screen, the app draws under the iOS status bar (`black-translucent` + `viewport-fit=cover`), and iOS 26 blurs that strip. `body` top padding is therefore `calc(… + env(safe-area-inset-top))` so page titles start below the blur. Anything new pinned to the top must add `env(safe-area-inset-top)` too.

## Visual Identity — Non-Negotiable

- **Palette:** Near-black (`#130518`) radial gradient background with plum/indigo blooms, warm ivory `#f0e8e0` text, sage green `#b5c99a` accents, warm amber `#c8a87a` for highlights
- **Typography:** Instrument Serif for headings, Inter for body. All-caps with letter-spacing for labels/nav.
- **Geometry:** Dark-mode Liquid Glass (Apple iOS 26 / macOS Tahoe paradigm). Task cards and overlays are floating glass panels — `backdrop-filter: blur()`, `rgba(255,255,255,0.055–0.08)` fills, `1px solid rgba(255,255,255,0.09–0.14)` luminous borders, inner specular highlight via `box-shadow: inset 0 1px 0 rgba(255,255,255,0.10–0.18)`. Buttons are pill-shaped (`border-radius: 100px`). Cards use `border-radius: 16–28px`.
- **Feel:** Prada FW21 remains the colour and atmosphere reference — deep plum, warm ivory, sage green, editorial restraint. The geometry shifts from flat squares to Liquid Glass, but the palette and tone do not change.

**Button hierarchy — non-negotiable.** Emphasis follows how central an action is to the screen, not how often it's built. At most **one** primary per screen or overlay.
- **Primary — `.btn-primary`** (filled sage pill with glow): the action the screen exists for. Home → "Surprise me"; Wardrobe → "What should I wear?"; overlays → the confirming action ("Got it", "Love it", "Save").
- **Secondary — `.btn-secondary`** (glass pill): alternatives next to the primary ("Re-spin", "Cancel", "Add photo").
- **Tertiary — `.btn-tertiary`** (ghost pill: no fill, no glow, dim ivory text): maintenance/admin actions such as "+ Add garment". Never sage-filled.
- Icon-only adds (`.add-btn`, `.wardrobe-add-btn`), edit links and `.back-btn` sit below tertiary.
- Buttons hug their label — never `width: 100%`. Size signals nothing; fill and glow carry the hierarchy. To give a button its own line, change its alignment, not its width.
- No one-off button classes. Every button is one of the three tiers (plus icon-only/back).

**App header is Home-only.** The `#header` block (LIFE title, profile switcher, Surprise me, lock) shows only on the main view. Every `show*()` for a secondary view adds `body.secondary-view`, which hides `#header`; the view's own title (`.olympus-header`) is the page header. New views must add `secondary-view` too.

**Wardrobe IA.** Two sections, top to bottom: (1) outfit picker — prompt input + "What should I wear?" primary; (2) "My closet" — `.wardrobe-closet-header` with the serif subheader, then "+ Add garment" (tertiary, admin-only) on its own line beneath it, aligned right, then the categories. Categories start collapsed on every visit; saving a garment expands its category. Under the title, `#wardrobe-closet-line` shows a quiet summary (pieces · colors · most loyal).

**Wardrobe history.** "Love it" on a suggested outfit is the only way wears are recorded (`POST /api/wardrobe/wear`, admin-only). Re-spin and × record nothing. Everything else is derived on request by `computeWardrobeStats()` in `server.js` (`GET /api/wardrobe/stats`), never stored:
- **Rows:** show "worn 3 wks ago" in place of color, or a ghosted italic "never worn".
- **Garment card:** tapping a row opens `#garment-overlay`, showing wear count, "Usually seen with" (pieces worn together at least `FRIEND_MIN_TOGETHER` times), "Its story" (the last `WEAR_STORY_LENGTH` wears with prompt and weather), and origin/memory.
- **Rotation nudge:** the outfit stylist sees each piece's wear history and is told to favor neglected pieces when two fit equally well.

**Dossier — removed.** Garments once had an AI-written Pynchon "dossier" on their card. It was removed: it ran long and crowded the card. Don't reintroduce it without asking. Wardrobe rows have no dblclick-to-edit; edit from the card's Edit button or the row's edit link.

**Back buttons:** Secondary views (Olympus, Treats, Hard Things, Shopping, Wardrobe, Dreams) use `.back-btn` — a bare `‹` chevron via `::before`, no label, no border. Context makes navigation legible without naming it.

**Floating nav:** A glass pill fixed at the bottom of every screen (`#floating-nav-dock` → `#floating-nav`), holding Home, Olympus, Wardrobe, Shopping, Dreams in that order. It collapses to a single circle showing the current view's icon, and expands on tap. Auto-collapses after `NAV_IDLE_MS` of no interaction, on any scroll, on a tap outside, and `NAV_SETTLE_MS` after a jump. Key functions in `app.js`: `expandNav()`, `collapseNav()`, `setActiveNav(key)`. `setActiveNav(null)` (Treats, Hard Things) highlights nothing and falls the collapsed circle back to Home. Adding a destination = one `.floating-nav-item` in `index.html` + one entry in `NAV_DESTINATIONS` + a `setActiveNav()` call in its `show*()` function. Five items is the comfortable ceiling at 390px; Treats and Hard Things stay as `.tertiary-link` text at the bottom of the main view. Anything `position: fixed` near the bottom (e.g. `#dreams-fab`) must sit above the pill, and `body` bottom padding must clear it.

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

- [ ] **Update Live Status on Notion page** each session. Format: `X projects active. Y ascensions. Olympus holds N.`
- [ ] **Append to The Chronicle** when a meaningful decision is made. Prune Notion to 3, append full log to `project_chronicle_log.md`.
