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
