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

## 2026-10-29 — LIFE becomes Oedipa
**Decision:** The app is renamed **Oedipa**, with "life, day by day" kept as its subtitle. It changed on the home header, the profile screen, the browser title, the home-screen name and the manifest. The repo, Railway service and data files keep their names.
**Why:** The Pynchon voice was already the app's soul. Oedipa Maas, the heroine of *The Crying of Lot 49*, sets out to sort someone's affairs and finds hidden patterns everywhere, which is what this app does with a life. "LIFE" was generic and impossible to own; Oedipa is distinctive, and the old name lives on as the tagline. Known trade-offs: most people will first hear "Oedipus", the reference is niche, and spelling isn't obvious. All of that is acceptable for a craft project built for its maker.

## 2026-10-29 — First principle: a kind mirror
**Decision:** Oedipa's first principle, distilled over 20 this-or-that questions: *Oedipa only remembers what happened. It counts what you did, never what you didn't, and keeps it for when you want to look.* Totals only grow, there are no streaks and nothing shows time-since, reflections are plain numbers, and the Pynchon voice is reserved for rewards. It never judges. Absence may steer systems privately but is never displayed. Applied right away: Wardrobe rows now show "worn 6 times" (or the color, if unworn) instead of "worn 3 wks ago" and "never worn", and the garment card dropped "Never worn. Yet." and "last … ago".
**Why:** Asked what Oedipa does when it works perfectly, the answer was "it makes me see myself": a mirror, kind rather than harsh, there when looked at, and never a verdict. Showing gaps turns a mirror into a scorecard.

## 2026-10-29 — Second principle: off the hook
**Decision:** Oedipa's second principle, distilled over 17 questions: *Oedipa lets life decide. Hand it a choice from your lists and chance picks, playfully, so you don't have to. You can always spin again.* The gift is permission. Chance only picks from your own lists and only when asked; picks are honestly random (weighted odds are fine); the reveal is playful and wordless. Re-spins are free, and skips are never shown. Built right away: a plain nudge after three re-spins in a row, and a hidden wild card that has the stylist build about one outfit in four around a randomly chosen piece of yours.
**Why:** What letting life decide gives isn't efficiency or surprise but permission: once life has chosen, you're off the hook. Taste still matters for clothes, so chance enters the Wardrobe as an occasional, unmarked wild card rather than replacing the stylist.

## 2026-10-30 — Third principle: scaled ceremony
**Decision:** Oedipa's third principle, distilled over 21 questions: *Oedipa marks what you finish in proportion to what it took. Small things settle quietly; big things get a laugh, never the same twice. It never rewards what already rewards itself.* Built right away:
- a calm amber beat for small finishes (one-offs, habits, errands, steps, hard things done);
- a quieter sage beat for undoing;
- four rotating ceremonies (sand, ink, type, rise) for the two big moments, grander and slower the longer a project was carried, with the quote told how long it took;
- no ceremony for treats or shopping, and "It's yours now." dropped from the Acquired card.

**Why:** Finishing should feel earned, not addictive. The user's sharpest point was that shopping and treats already feed the dopamine loop, so Oedipa shouldn't add to them, and that big rewards stay meaningful only by staying rare.

## 2026-10-30 — Fourth principle: fresh starts
**Decision:** Oedipa's fourth principle, distilled over 16 questions: *Oedipa's slate is what you finished: it clears on time's rhythm, and what's still waiting simply waits, without judgment.*
- What's finished clears on a schedule: Done weekly, Errands daily, habits at 5 AM PT.
- Unfinished things never expire and never show their age.
- Resets are silent and invisible. There's no fresh-start button and no "welcome back".
- Restoring from Olympus truly begins again.

Built right away: each morning gets one of eight wordless background moods, so a new day feels slightly new without a single word.
**Why:** A clean slate means the finished things go, not the pending ones. Expiring or aging unfinished tasks would be a quiet verdict, which breaks the kind mirror. The rhythm should be felt rather than explained or triggered by hand.

## 2026-10-30 — Fifth principle: quiet design
**Decision:** Oedipa's fifth principle, distilled over 20 questions: *Oedipa never reaches out. It waits to be opened, and once open it stays calm: it explains itself once, speaks only when something fails, and asks only before what can't be undone.*
- No notifications of any kind.
- No counts of what's pending, though counts of what you have stay.
- Empty lists say "Nothing here."
- A failed save says so in one plain line.
- Built right away:
  - confirmation before deleting a project, garment or dream, or restoring from Olympus;
  - three one-time hints;
  - a soft haptic on small finishes;
  - the day's background blooms slowly drift;
  - a faint amber light breathes on Olympus;
  - waiting buttons keep their label under a sweeping amber light instead of "Asking…".

**Why:** The app's job is to be there when looked at, not to compete for attention. The user chose gentle ambient life over total stillness, so the calm is alive rather than inert, but nothing ever speaks first.

## 2026-10-30 — Wardrobe reads a photo
**Decision:** "What should I wear?" can now take a photo as well as (or instead of) words: a party flier, an invitation, or an outfit for inspiration. The stylist sees the picture, works out which it is, and either dresses for the event it describes or rebuilds the look from pieces already in the closet. With no words typed, its short reading of the photo stands in for the prompt. The photo is never stored.
**Why:** The occasion often arrives as an image, not a sentence. Typing out a flier's theme and dress code is the kind of choosing Oedipa exists to take off your hands (principle 2), and "Add photo" stays a quiet text action so "What should I wear?" is still the screen's one primary button.

## 2026-11-01 — Recipes become errands
**Decision:** A recipe photo (or a few pages) can now become groceries. Oedipa reads it into lines written the way you buy them ("2 lemons", "1 bunch mint"), shows them on a review card with pantry staples unticked, and adds only what you keep. Each recipe line carries a quiet "swap?" for when it's hard to find, favoring something Trader Joe's carries; "use this" makes the swap the item. Photos are never stored.
**Why:** Copying a recipe into a list is pure chore. The review step keeps you in charge of what you already have, and the swap sits out of sight until a shelf comes up empty, so chores typed by hand stay as plain as before.

## 2026-11-01 — Any photo becomes errands
**Decision:** "Add from a recipe" became "Add from a photo". The same review card now reads a screenshot of a text asking for razors, a handwritten list or an empty package, not just recipes. Groceries still always get a Trader Joe's-first swap; other things get one only when there's a real alternative, so "swap?" doesn't appear on razors for nothing.
**Why:** Requests to buy something arrive as messages as often as recipes. One door for every photo keeps Shopping simple.
