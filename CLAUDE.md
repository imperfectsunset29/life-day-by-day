# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Name

The app is **Oedipa** (*life, day by day*), formerly LIFE. It's named for Oedipa Maas in Thomas Pynchon's *The Crying of Lot 49*, who sets out to sort someone's affairs and finds patterns everywhere: the same Pynchon voice the quotes use. Write it "Oedipa" (title case, never all caps), with "(life, day by day)" as the subtitle in the serif italic. The repo, Railway service, data files and `life-*` storage keys keep their old names; renaming them is optional and not needed for the brand.

## First Principles — Non-Negotiable

Every feature is checked against these. If it doesn't serve them, it doesn't ship, however clever. Each was distilled with the user, question by question; add new ones the same way.

**1. A kind mirror.** Oedipa only remembers what happened. It counts what you did, never what you didn't, and keeps it for when you want to look.
- **Only what you did.** Gaps, misses and time-since are never shown: no streaks, no "never worn", no "last done 5 days ago", no "worn 3 weeks ago".
- **Totals that only grow.** "Stretched 41 times", "worn 6 times". Nothing resets; nothing is lost. With nothing to count, show nothing (or the item's own details), never a zero.
- **Plain facts.** Reflections are numbers, not commentary. The Pynchon voice belongs to rewards (celebrations, ascensions), never to the mirror.
- **Waits to be looked at.** Small facts sit quietly on each item, plus one place for the bigger picture. Nothing is pushed at you.
- **Never judges.** It notices; the meaning is yours to make.
- **Absence may steer, never show.** Systems may use gaps privately (the outfit stylist favors pieces not worn lately), but a gap is never displayed.
- Already consistent: "Its story" (what happened, with dates), "Usually seen with", Acquired's "wanted for 4 months", habits without streaks.

**2. Off the hook.** Oedipa lets life decide. Hand it a choice from your lists and chance picks, playfully, so you don't have to. You can always spin again.
- **The gift is permission.** Life chose, so you're off the hook for choosing.
- **Only from what's yours.** Chance picks from your own lists (tasks, treats, hard things, clothes), never from outside them.
- **Only when asked.** Nothing is decided for you unprompted.
- **Honest chance.** Picks are truly random. Weighted odds are part of the game (treats and hard things at 20% each in Surprise me), but nothing is secretly chosen for you.
- **Playful, wordless.** The reveal is a little theater (a spin, a flourish). The Pynchon voice stays with rewards.
- **Saying no is free.** Re-spin anytime. Skips leave no visible trace (principle 1). After `SPIN_NUDGE_AFTER` (3) re-spins in a row, a plain line suggests going with it ("Life has picked 4 times. Maybe this one?"), in Surprise me and on the outfit card. A fresh spin resets the count; "Not my style" doesn't count as a re-spin.
- **Taste gets a wild card.** The outfit stylist chooses with taste, but with `WILD_CARD_ODDS` (0.25) chance picks one of your pieces at random and the stylist builds around it. It's unmarked, and the stylist is told not to mention it.

**3. Scaled ceremony.** Oedipa marks what you finish in proportion to what it took. Small things settle quietly; big things get a laugh, never the same twice. It never rewards what already rewards itself.
- **Scaled to the effort.** Size is the kind of thing (task < habit < cleared list < project) plus how long it was carried.
- **Small finishes settle.** Checking a one-off, habit, errand or project step, or doing a hard thing from Surprise me ("I'll do it"), plays `finish-beat`: a calm amber glow on the row, about 0.9s. No words, no overlay, no sparkle. Via `playBeat(selector, kind)` in `app.js`.
- **Big finishes get a laugh.** A project ascending or the whole one-off list cleared gets a Pynchon quote performed by one of four ceremonies (`CEREMONIES`: sand, ink, type, rise), never the same one twice in a row (`lastCeremony` in localStorage). Words and visuals are always new.
- **Time carried shows in both.** The ascension response includes `carriedDays` (from the project's `createdAt`). The quote prompt says how long it was carried, and `ceremonyTierFor()` makes the ceremony grander: `ceremony-base` (under 30 days), `ceremony-long`, `ceremony-epic` (180+ days) slow the animation and brighten the amber glow behind the words.
- **Rewards stay rare.** Only those two moments are big. Nothing else gets an overlay or a quote.
- **Pleasures need no applause.** Treats and shopping (Wishlist, Acquired) get no ceremony; they already reward themselves. The Acquired card states only "Wanted for 4 months." Errands are chores, not shopping, so they get the small beat.
- **Undoing is gently marked.** Unchecking, or restoring from Done or Olympus, plays `undo-beat`: a quieter sage outline, wordless.
- **Afterlife by size.** Big things are honored (Olympus, with their quote); small things are released (Done clears weekly).
- Reduced motion: beats and the epic glow don't animate, and ceremonies show the quote still.

**4. Fresh starts.** Oedipa's slate is what you finished: it clears on time's rhythm, and what's still waiting simply waits, without judgment.
- **The slate is finished things.** Done clears every Sunday 23:59 PT; checked Errands clear at the end of each day; habits uncheck at 5 AM PT. Unfinished things never expire.
- **Silent resets.** An unchecked habit resets with no trace. A turnover (day or week) is invisible: no marker, no "last week: 14 done".
- **No age on what waits.** A task never shows how long it has waited, not on the list and not on a card (principle 1).
- **Time does it.** No "fresh start" button, no "clear all". Resets belong to the rhythm.
- **The day begins at 5 AM PT,** not midnight: late nights still count as today.
- **Returning is just today.** Coming back after days away looks like any morning: no "welcome back", no sign you were gone.
- **The rhythm is felt, not explained.** No "resets at 5 AM" hints in the UI.
- **Cleared means gone from view.** Nothing visible survives a clear. The history stays in the data (`events*.json`) for a future bigger-picture place.
- **Beginning again is real.** Restoring from Olympus starts the project at 0%, and its old steps stay behind.
- **Each morning is a little new.** Every habit-day gets one of `DAWN_VARIANTS` (8) wordless background moods (`body.dawn-N`, chosen by `applyDawn()` in `app.js`; consecutive days always differ). Same palette, blooms drift; no words, no animation.

**5. Quiet design.** Oedipa never reaches out. It waits to be opened, and once open it stays calm: it explains itself once, speaks only when something fails, and asks only before what can't be undone.
- **Never reaches out.** No push notifications, no emails, no badge on the icon. Ever.
- **Calm lists.** Long lists show a few plus "– N more" (as now).
- **No pending counts.** No "One-off (12)". Counts of what you *have* stay (wardrobe "Tops (14)", "Acquired (6)"): that's the mirror, not pressure.
- **Empty is plain.** Every empty list says "Nothing here." (`.empty-state`), with no instructions and no illustration.
- **Explains once, then never.** One-time hints (`HINTS` in `app.js`: hold to reorder, tap a garment for its story, tap a step to edit) show on a first visit, stay for that visit, then never again (`hint-<key>` in localStorage). Use `placeHint()` / `hintHTML()`; new features may add a hint only when a gesture isn't discoverable.
- **Saving is silent.** Every tap saves itself. Only a failure speaks: `apiFetch()` shows "Didn't save. Try again." (`#save-status`) on a network error or a 5xx on a write, and reloads to undo the optimistic check.
- **Asks only before what can't be undone.** Deleting a project, garment or dream, or restoring from Olympus (which lets its quote go), goes through `askConfirm(text, okLabel)` (`#confirm-overlay`: "Keep it" secondary, the action primary). Everything else just happens.
- **A soft haptic on small finishes.** `haptic()` fires at the tap of every finish-beat (`navigator.vibrate` on Android; on iOS, the native-switch tick via a hidden `<input switch>`). No sounds, ever.
- **Gentle ambient life.** At rest, the day's blooms drift slowly (`body::before`, `bloomDrift`, ~50s) and a faint amber light breathes behind each Olympus title (`olympusBreath`, 7s). Visible if you look, never pulling the eye. Nothing else idles or loops.
- **Waiting is wordless.** While Oedipa thinks (stylist, photo analysis), the button keeps its label and an amber light sweeps across it (`.is-waiting`). No spinners, no "Loading…".
- Reduced motion: no drift, no breathing; the waiting button gets a still amber tint.

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
- **Projects:** Progress 0–100 via +/− buttons. Sub-steps (`steps[]`) are a pure checklist — don't affect progress. Auto-ascends to Olympus at 100% with a fresh Pynchon quote and a ceremony scaled to how long it was carried (principle 3). Route ordering in `server.js` matters: step routes must be registered before `/:category/:id`. Step text is edited inline by tapping it (admin only) — `startEditStep()` replaces the span with an input, same pattern as `addStep()`, reuses `.step-text-input` CSS.
- **Treats / Hard Things:** Stateless. 20% chance each in randomizer.
- **Done:** Completed one-offs; cleared every Sunday 23:59 PT.
- **Olympus:** Ascended projects. Restoring resets progress to 0; steps not restored.
- **Shopping:** One page, two lists (the nav has no room for a sixth item). **Errands** (`shoppingList`) is a quick checklist whose checked items clear daily. **Wishlist** holds longer-term wants that never clear; each can carry an optional one-line note the user writes in the edit overlay. Tapping a wish opens its card; "Bought it" moves it to **Acquired** (collapsed archive, newest first, showing how long it was wanted) and offers "Add to wardrobe", which prefills name, origin (the shop's domain), acquired date and memory (the note). Items move between Errands and Wishlist via the edit dropdown on phones or the "→ wishlist / → errands" action on desktop. API: `POST /api/wishlist/:id/acquire`, `POST /api/shopping/move`.
- **Wishlist names:** a wish's row reads as one chip: its name, the shop beneath, and the product photo in place of the shop icon when there is one (`wishTextHTML()`, `renderLinkChip(url, { title, image })`; a photo the shop won't serve falls back to the icon). The name comes, in order, from words typed with the link, the note (when the wish is only a link; the note then isn't repeated below), the name saved from the shop's page, then the link's own words (`urlSlugTitle()`, which drops product codes like "Kp228"), then the shop's name. `POST /api/wishlist/:id/resolve` reads the page once (`fetchLinkPreview()`: schema.org Product name, `og:title`, `twitter:title`, `<title>`; every character code decoded; shop-name suffixes, bot walls, "Product" and bare codes rejected by `cleanProductName()`) and saves `name`, `image` and `resolvedAt` on the wish; `lookUpWishNames()` asks for wishes with no name, again after `WISH_RELOOK_DAYS` (7) for shops that gave nothing. Changing a wish's link clears them. Acquired keeps `name` and `image`.
- **Wishlist fold:** only the first `WISH_VISIBLE` (3) wishes show; the rest sit behind "— N more" (`.show-more-btn`, the One-off pattern), open for the rest of the visit.
- **Photo → Errands:** "Add from a photo" (a `.btn-text` under Errands, admin-only) takes up to 4 photos of anything that says what to buy: a recipe, a screenshot of a text ("can you grab razors?"), a handwritten list, an empty package. `POST /api/shopping/read-photo` (Claude Opus 5.5, low effort, `SHOP_PHOTO_SCHEMA`, `SHOP_PHOTO_RULES`) returns `{ title, items: [{ text, staple, swap }] }`: lines written the way they're bought ("2 lemons", "razors (Venus, sensitive)"), recipe pantry staples flagged, and a swap where useful. `title` says what the photo was ("pork larb", "text from mom"). Photos are never saved. The review card (`#shop-photo-overlay`) shows the lines ticked and staples unticked under "Probably in your pantry"; "Add to errands" sends only ticked lines to `POST /api/shopping/from-photo`, which puts them together at the top of Errands. While reading, the primary button waits wordlessly (`.is-waiting`).
- **Swaps:** groceries always get a swap (a Trader Joe's product when there's one, else a common substitute); other things only when there's a real alternative. An errand with a `swap` shows "swap?" in its row actions; tapping reveals it in amber under the item (`openSwaps`, this visit only). "use this" (admin-only) makes the swap the item and clears it. Typed errands never have one.
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
outfitPasses: { id, date, itemIds, prompt }         // one entry per "Not my style"
recentSuggestions: { date, itemIds }                // last 10 outfits the stylist suggested (capped)
shoppingList: { id, text, done, createdAt, swap }    // Errands; done items clear at the end of each PT day; swap only on lines read from a photo
wishlist:   { id, text, note, createdAt, name, image, resolvedAt } // longer-term wants; never auto-clear; note is the user's optional one-liner;
                                                     // name/image saved from the link's page (image is a URL, never base64)
acquired:   { id, text, note, name, image, createdAt, acquiredAt } // bought wishes; createdAt→acquiredAt = how long it was wanted
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

**Legibility — non-negotiable.** Check size and contrast every time text or a control is added or restyled. Quiet is a design choice; hard to read is a defect. Express hierarchy through position, weight, fill and spacing, never by going below these floors:
- **Size:** at least `0.7rem` (~11px) for anything tappable or meant to be read, mobile block included. Purely decorative marks (a chevron, a count in parentheses) are the only exception.
- **Contrast** (WCAG AA), measured against the actual surface behind it (glass card over the plum background, not pure black): **4.5:1** for text under ~18px, **3:1** for large text and for a control's visible boundary. With ivory `#f0e8e0` on a glass card, that means roughly **≥ 0.6 opacity** for small text; `0.45` measures only 3.9:1. Compute it rather than eyeballing it, and note the ratio in a CSS comment when it's close.
- **Tap targets:** at least 44px tall, even when the visible text is small (use padding / `min-height`).
- **Pill buttons meet all three:** `.btn-primary`, `.btn-secondary` and `.btn-tertiary` labels are 0.7rem on every screen size. The tertiary label is 0.62 opacity (6.1–6.5:1; 0.45 was 3.9:1). An invisible `::after` extends each ~34px pill to a 44px tap area without changing its look.
- **Floors by color:** for 4.5:1 on every surface the app uses (page, plum bloom, glass card, glass row inside a card), text needs at least **ivory 0.58, sage 0.72, amber 0.82** opacity. Icon-only controls (×, +, ‹, the lock) need 3:1, roughly ivory 0.42 / sage 0.5. A container's `opacity` multiplies into its text: the Done and Acquired rows are 0.85, with their text tuned so the effective value still clears the floor.
- **Exempt:** the decorative ▸ category chevron (size), the separator dot between Treats and Hard Things, disabled controls, and the "(day by day)" title suffix, which is large text (3:1).
- **No debt:** as of the 2026-10-22 pass every text style meets the floors. The floating-nav labels are 0.7rem with 0.04em tracking in 68px slots (70px on desktop); expanded items don't clip (`overflow: visible`), so "WARDROBE" fits.

**Button hierarchy — non-negotiable.** Emphasis follows how central an action is to the screen, not how often it's built. At most **one** primary per screen or overlay.
- **Primary — `.btn-primary`** (filled sage pill with glow): the action the screen exists for. Home → "Surprise me"; Wardrobe → "What should I wear?"; overlays → the confirming action ("Got it", "Love it", "Save").
- **Secondary — `.btn-secondary`** (glass pill): alternatives next to the primary ("Re-spin", "Cancel", "Add photo").
- **Tertiary — `.btn-tertiary`** (ghost pill: no fill, no glow, dim ivory text): maintenance/admin actions such as "+ Add garment". Never sage-filled.
- Icon-only adds (`.add-btn`, `.wardrobe-add-btn`), edit links and `.back-btn` sit below tertiary.
- Buttons hug their label — never `width: 100%`. Size signals nothing; fill and glow carry the hierarchy. To give a button its own line, change its alignment, not its width.
- No one-off button classes. Every button is one of the three tiers (plus icon-only/back), or a text action.
- **Two buttons max per group.** An overlay, form or action row shows at most two pill buttons (still at most one primary). A third action is a **text action — `.btn-text`**: no fill, no border, uppercase Inter at 0.7rem and 0.62 opacity (~6:1 contrast) with a faint underline, 44px tap height. It sits on its own line, sharing the buttons' edge (one alignment per group, never centered under end-aligned buttons): end-aligned under the buttons in an `.action-text-row` (outfit card → "Not my style"). It can't share the buttons' row: two legible pills plus a text action don't fit the ~300px card width. or start-aligned directly under the thing it acts on with `.action-text-row-start` (dream editor → "Remove photo" under the photo). When a step changes what matters, demote rather than add: in the add-garment form, once a photo is in, "Analyze photos" (secondary) + "Save" (primary) are the buttons and "Add photo" becomes the text action "Add another photo" (`setWardrobeCameraBtn()`).

**Done treatment — non-negotiable.** Finished things are greyed out and sit at the end of the page, below everything still open. They're a quiet record, not something to act on.
- **Position:** a Done section is always the last list on its page (Home: after Projects, only the Treats / Hard Things links below; Shopping: after Wishlist and Acquired). New pages with finished items follow the same order.
- **Look:** a done row has no glass card (no fill, border, shadow or blur), just a hairline beneath it and tighter padding. Its name is struck through, and all its text (name, "4d ago", "undo") is ivory 0.58, the legibility floor. The checked box keeps its sage fill at 0.7 with no glow. The Done heading is ivory 0.58, not sage. Never use container opacity to grey a row: it multiplies into the text and breaks the floor.
- **Checked in place:** a checked habit (and anything else checked where it stands) gets the same row treatment via `.task-item.done`. Habits stay where they are rather than sinking, so your order holds when they uncheck at 5 AM. Done project steps keep their order too (sequence matters) and are just struck through and greyed.

**App header is Home-only.** The `#header` block (Oedipa title, profile switcher, Surprise me, lock) shows only on the main view. Every `show*()` for a secondary view adds `body.secondary-view`, which hides `#header`; the view's own title (`.olympus-header`) is the page header. New views must add `secondary-view` too.

**Wardrobe IA.** Two sections, top to bottom: (1) outfit picker — prompt input + "What should I wear?" primary; (2) "My closet" — `.wardrobe-closet-header` with the serif subheader, then "+ Add garment" (tertiary, admin-only) on its own line beneath it, aligned right, then the categories. Categories start collapsed on every visit; saving a garment expands its category. Under the title, `#wardrobe-closet-line` shows a quiet summary (pieces · colors · most loyal).

**Wardrobe history.** "Love it" on a suggested outfit is the only way wears are recorded (`POST /api/wardrobe/wear`, admin-only). Re-spin and × record nothing. Everything else is derived on request by `computeWardrobeStats()` in `server.js` (`GET /api/wardrobe/stats`), never stored:
- **Rows:** a worn piece shows its total ("worn 6 times"); an unworn piece just shows its color. No time-since, no "never worn" (first principle: a kind mirror).
- **Garment card:** tapping a row opens `#garment-overlay`, showing the wear count (only when there is one), "Usually seen with" (pieces worn together at least `FRIEND_MIN_TOGETHER` times), "Its story" (the last `WEAR_STORY_LENGTH` wears with prompt and weather), and origin/memory.
- **Rotation nudge:** the outfit stylist sees each piece's wear history and is told to favor neglected pieces when two fit equally well.

**Outfit stylist.** `POST /api/wardrobe/suggest-outfit` calls Claude Opus 5.5 at `effort: 'low'` (wardrobe is used occasionally; keep each call lean) with schema-constrained JSON output (`OUTFIT_SCHEMA`: `itemIds`, `why`) and `fallbacks: 'default'` (beta `server-side-fallback-2026-07-01`) so a declined request is retried server-side. `STYLIST_RULES` (color story, one level of dressiness, weather and walking, structure, rotation, taste) and the closet list form a cached system prefix; the occasion, weather, the last 6 loved outfits, the last 6 "Not my style" outfits (`outfitPasses`, recorded by `POST /api/wardrobe/pass`, admin-only) the main pieces (dress, jumpsuit, top, bottom) of the last 10 suggestions (`recentSuggestions`, saved after every suggestion — re-read before writing, since the AI call takes seconds) so one favorite doesn't anchor every outfit, and the outfits already shown (`exclude`, sent by the frontend's `shownOutfits`, reset when the prompt changes) go in the user message. The one-line `why` shows in amber under the pieces (`#outfit-why`). Any failure or refusal falls back to `randomOutfitPick()` with no `why`. Nothing is trained: the model only learns from what each request includes. "Love it" and "Not my style" persist; Re-spin's exclusions live only in the browser for the current prompt, and a re-spin must change the main piece, not just shoes or a layer. "Never worn" is only favored when the piece wasn't suggested recently; otherwise a never-loved favorite wins every time. "Not my style" (a `.btn-text` text action on its own line under Re-spin / Love it) records the dislike and immediately spins a new outfit. "Love it" ends the flow and clears the prompt box; closing with × keeps the text so it can be tweaked and asked again. Photo analysis (`/api/wardrobe/analyze-photo`) still uses Haiku 4.5.

**Outfit photo.** Under the prompt, "Add photo" (a `.btn-text`) attaches one picture to the request: a party flier, an invitation, an outfit to echo. Words, a photo, or both are enough to ask. The app resizes it to 1568px JPEG (`attachOutfitPhoto()`) and sends it as `photo: { image, mimeType }` with every request for that occasion, so Re-spin sees it too; it is never saved (`uploadedPhotoFrom()` in `server.js`). The stylist works out what it is: a flier is read for the event, theme, dress code and time (current weather is then only a hint); a look is recreated in spirit from the closet only. It returns `occasion`, its reading of the photo in under 8 words, which replaces the prompt echo and is saved as the wear's prompt when nothing was typed. A new or removed photo starts a fresh set of spins; "Love it" clears it, × keeps it.

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
