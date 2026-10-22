# The Chronicle — full log

Every meaningful decision about LIFE (day by day), oldest first. The Notion page keeps only the latest three; this file keeps everything.

---

## 2026-10-17 — Mobile overlays stop spilling off-screen
**Decision:** The app no longer lets iOS zoom in when a text field is tapped (`maximum-scale=1`). The page can never scroll sideways, and overlays size themselves to the visible screen and scroll inside when tall.
**Why:** Every input uses text smaller than 16px, so iOS zoomed in on tap and stayed zoomed. "Today's outfit" then ran off the right edge. Fixing it once at the page level covers every screen.

## 2026-10-17 — Page titles clear the iOS status bar
**Decision:** The body's top padding includes the phone's real status-bar height (`env(safe-area-inset-top)`).
**Why:** Installed to the home screen, the app draws under the status bar, and iOS 26 blurs that strip. Page titles were sitting inside the blur.

## 2026-10-17 — A three-tier button hierarchy
**Decision:** Every button is primary (filled sage, glow), secondary (glass) or tertiary (ghost outline). There's at most one primary per screen or overlay, buttons hug their label (never full width), and there are no one-off button styles. "Surprise me" became Home's primary; the old `.surprise-btn` style was deleted.
**Why:** On Wardrobe, "+ Add garment" was the loudest thing on screen while "What should I wear?", the screen's purpose, was a small dark pill. Emphasis should follow how central an action is. Size was tried as a signal and rejected: fill and glow carry the hierarchy.

## 2026-10-17 — The app header belongs to Home only
**Decision:** The LIFE title, profile switcher, "Surprise me" and lock only show on Home. Secondary views open with their own title as the page header.
**Why:** On Wardrobe, three buttons from three different contexts were competing at once. Each page should lead with what it is.

## 2026-10-17 — Wardrobe gets a clear structure
**Decision:** Wardrobe has two sections: the outfit picker (prompt and "What should I wear?"), then "My closet". "My closet" has a serif subheader and a summary line, then "+ Add garment" on its own line aligned right, then the categories. Categories start collapsed on every visit, and saving a garment opens its category.
**Why:** Asking for an outfit and maintaining the closet are different jobs. Collapsed categories turn the closet into a scannable index.

## 2026-10-17 — Completion quotes must feel new every time
**Decision:** Pynchon quotes are written at the moment of finishing, never pre-generated. Each prompt carries the project's name, a randomly drawn angle (a secret postal dispatch, a stamped memo, an inventory of leftover objects…), and the last 12 quotes as a do-not-echo list. Entropy and "They" became an occasional palette rather than a checklist. The celebration overlay opens instantly and the quote fills in.
**Why:** One fixed prompt listing the same motifs, with no knowledge of the project or of past quotes, produced near-identical quotes. That made finishing a project feel hollow.

## 2026-10-17 — The wardrobe remembers what you wear
**Decision:** "Love it" now records the outfit as worn, along with the prompt, date and weather. Everything else is derived from that log, never stored:
- each row shows "worn 3 wks ago" or a ghosted "never worn"
- tapping a garment opens its card: wear count, "Usually seen with", "Its story" and origin/memory
- an amber Pynchon-voiced dossier is written from the garment's real history, and only rewritten after it's worn again
- the closet line names the most loyal piece
- the stylist nudges neglected pieces back into rotation

Garments gained optional origin, acquired and memory fields.
**Why:** The closet knew what each piece *was* but nothing about its life with its owner. Wear history makes the wardrobe personal, and it's the foundation for the rest.

## 2026-10-20 — Shopping splits into needs and wants
**Decision:** Shopping became one page with two lists. **Errands** is a quick checklist that clears daily, as before. **Wishlist** is for longer-term wants that never clear on their own, each with an optional one-line note written by the user. Buying a wish moves it to an **Acquired** archive that remembers how long it was wanted, and offers to add it to the Wardrobe with its origin filled in. Existing items containing links moved to the wishlist automatically.
**Why:** Groceries and covetable things were sharing one list with a daily clear-out, so checking off a tote you were eyeing erased it by morning. Needs want speed; wants deserve time, and the moment of finally getting one is worth marking.

## 2026-10-20 — Garment dossiers removed
**Decision:** The AI-written Pynchon "dossier" on each garment card is gone, along with any cached ones stored on garments.
**Why:** In practice it ran to a long paragraph that took over the card. For never-worn pieces it had nothing real to say. The card is better as plain history.

## 2026-10-20 — Data gets safeguards
**Decision:** Saves became all-or-nothing (write a temp file, then swap it in). Each profile gets a daily snapshot, kept for 14 days. A damaged data file restores itself from the newest snapshot, and a missing Railway volume triggers a loud warning. Wardrobe changes are now fully tracked: every garment edit is logged field by field, and deleted garments are kept whole in the activity log.
**Why:** There was exactly one copy of everything, overwritten in place. Finishing a project also silently undid any change made while its quote was being written (a bug introduced by on-demand quotes, now fixed). The wardrobe, built up by hand over time, is the hardest data to recreate.

## 2026-10-20 — Dream photos move out of the data file; no backup button
**Decision:** Dream photos are now stored as image files on the volume, and the data file holds only a link to each one. Existing photos were moved out automatically. Orphaned photos are swept daily, but only once no snapshot still refers to them. The planned in-app backup button was dropped.
**Why:** Each photo added ~100 KB to a file that's read and rewritten on every tap, so the app would slow as dreams accumulated. Daily snapshots and self-repair already cover what a manual backup button was for.

## 2026-10-22 — The outfit stylist gets taste
**Decision:** Outfit suggestions moved from Haiku 4.5 to Opus 5.5 at low effort. The stylist now follows explicit rules: one color story, one level of dressiness, and dressing for the weather and any walking. It sees recently loved outfits as a guide to taste, never repeats an outfit already shown on Re-spin, and gives a one-line reason under each outfit. The closet list is cached so quick re-spins cost less.
**Why:** A real suggestion for drinks and a walk to dinner paired a bright red dress with burgundy pumps under an office blazer: clashing reds and three different levels of formality. The old prompt only asked for "compatible patterns and seasons," and the smallest model was choosing from short text descriptions with no reasoning. Wardrobe is used occasionally, so a stronger model at low effort is affordable.

## 2026-10-22 — "Not my style"
**Decision:** The outfit card gained a "Not my style" button. It records the outfit as a dislike and spins a new one. The last six dislikes go along with every request as a direction to avoid, mirroring how the last six loved outfits guide taste.
**Why:** Nothing is trained; the stylist only knows what each request tells it. Re-spin is ambiguous ("not tonight" isn't "not me"), so dislikes needed their own explicit signal rather than reading every re-spin as one.

## 2026-10-22 — Two buttons max; a third action is text
**Decision:** Any group of actions shows at most two pill buttons (with at most one primary). A third action becomes a text action: no fill, no border, small uppercase text with a faint underline, on its own line. It's centered under the buttons, or sits directly under the thing it acts on. Applied to the outfit card ("Not my style"), the dream editor ("Remove photo") and the add-garment form (after a photo is added, "Analyze photos" becomes a secondary button, not a second primary, and "Add photo" becomes "Add another photo" as text).
**Why:** Three pills in a row read as three equal choices and crowd a phone-width card; the add-garment form even showed two primaries at once. A different presentation for the third action keeps the hierarchy legible at a glance.

## 2026-10-22 — Legibility becomes a rule
**Decision:** Size and contrast are checked every time text or a control changes: at least ~11px for anything read or tapped, WCAG AA contrast (4.5:1 for small text) measured against the real glass surface, and 44px tap targets. The new text action went from ~10px at 3.9:1 to ~11px at 6.1:1. About 37 older declarations below the size floor are recorded as known debt.
**Why:** The app's editorial restraint had drifted into text that was hard to read, especially on a phone in daylight. Hierarchy should come from position, weight and fill, not from fading or shrinking text past legibility.

## 2026-10-22 — The stylist stops circling one dress
**Decision:** The stylist now remembers its last 10 suggestions and steers away from their main pieces. A re-spin must change the main piece (dress, jumpsuit or top), not just the shoes or coat. "Never worn" is only favored for pieces that weren't suggested recently.
**Why:** It kept suggesting the same DOEN black lace dress. "Never worn" was treated as a rotation bonus, but a piece only counts as worn after "Love it", so an unloved favorite won every time. Re-spin only blocked exact combinations, and with no memory of past suggestions similar evening prompts kept landing on the same answer.

## 2026-10-22 — Pill buttons meet the legibility floor
**Decision:** Every pill button label is now ~11px on all screens; on phones they had shrunk to ~10px, and outline pills to ~9px. The outline pill's label went from 3.9:1 to 6.1:1 contrast. Each pill gained an invisible 44px tap area, so it's easier to hit without looking bigger.
**Why:** The first bulk pass under the new legibility rule. Pills are the most-tapped controls in the app, and their phone labels were smaller than the text action meant to rank below them.

## 2026-10-22 — Legibility debt cleared
**Decision:** Every remaining text style was raised to the floor: 32 sizes up to ~11px and 54 colors up to WCAG AA. Ivory text is now at least 58% opacity, sage 72% and amber 82%, measured against the lightest surface each can sit on. Icon buttons meet 3:1. The faded Done and Acquired rows went from 55–60% to 85% so their text stays readable. The floating nav's slots widened slightly (58→68px on phones) so its labels could grow from ~8px to ~11px.
**Why:** The new legibility rule applied to everything, not just what gets touched next. The quiet, editorial feel now comes from hierarchy (serif vs uppercase labels, position, fill) instead of from text too faint or small to read.
