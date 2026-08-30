# Project Chronicle Log

Full history of meaningful decisions, pruned to the 3 most recent on the Notion page. This file is the permanent record.

---

## 2026-07-02 — Wardrobe feature: from broken analysis to a full digitized closet

**Context:** Valentina reported the wardrobe photo-analysis feature wasn't working, then began actively digitizing her closet through the session, surfacing UX and structural gaps as the list grew.

**What shipped (PRs #12–#18, all merged to `main`):**
- **#12 — Fix silent photo-analysis failures.** `analyzePhotos()` swallowed non-401 error responses (e.g. missing `ANTHROPIC_API_KEY`), leaving the form empty with no feedback. Now surfaces the real error via alert; server-side JSON parsing hardened against stray markdown fences from the vision model.
- **#13 — Simplify the wardrobe list.** Replaced heavy glass-card rows with flat, minimal single-line rows (hairline dividers, no background/border/shadow/blur). Added collapsible categories with live item counts, so the list stays scannable as it grows.
- **#14 — Auto-detected subcategories.** Each category (Tops, Bottoms, Shoes, Outerwear, Accessories) got a preset subcategory list. Claude vision now infers subcategory alongside existing metadata; items group under subcategory labels within each category.
- **#15 — Backfill subcategories for pre-existing items.** Items saved before subcategories existed were all dumping into "Other." Added a keyword-based fallback (matches item name against category-specific keyword lists) so legacy items group correctly with zero data migration.
- **#16 — Full metadata editing.** "Edit" on a wardrobe item previously only changed the name. Now reuses the add-item modal, pre-filled, and saves via PUT — every field (brand, color, material, pattern, occasion, season, category, subcategory) is editable, including moving an item to a different category.
- **#17 — Weather-aware outfit suggestions.** "What should I wear?" now requests browser geolocation (gracefully skipped if denied, with a hard timeout so a stuck permission prompt can't hang the request) and looks up current conditions via Open-Meteo (free, no API key). The stylist prompt factors in weather; the overlay shows the conditions used.
- **#18 — Added Dresses and Jumpsuits & Rompers categories.** Dresses had no home and would've been miscategorized as Tops. Added both as full categories with their own subcategory presets, wired through every touch point (vision prompt, no-AI fallback, add-form dropdown, keyword-grouping fallback).

**Working pattern established this session:** each PR was tested end-to-end locally (seeded data, headless Chromium via Playwright) before merging, since this sandbox has no test suite. Also established: when a PR for this branch has already been merged, restart the branch from `origin/main` and cherry-pick only the unmerged commit before opening the next PR — avoids re-diffing already-merged history.

**Open thread:** #17's actual Open-Meteo API call was never verified against the real service — this sandbox's network policy blocks arbitrary outbound hosts. Worth a manual check on the live app (allow location, confirm a temperature line appears).

---
