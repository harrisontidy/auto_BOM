# Catalog-wide category search — September 11, 2026

Replaced the small hand-maintained discovery list as the primary category fallback with a snapshot of **853 categories** from JLCPCB's public [all-components directory](https://jlcpcb.com/parts/all-electronic-components). Category names, IDs and parent groups are stored locally; live stock is not cached. `node scripts/refresh-categories.mjs` refreshes this snapshot and refuses incomplete responses.

The supplied DigiKey category list was used to broaden the test scope across board/circuit components: optical detectors, RF, protection, memory, communication modules, sensors, transformers, audio, passives and connectors. Workshop supplies and tools were not used as circuit substitutes. The snapshot is JLCPCB's taxonomy, not a claim that its assembly inventory equals all of DigiKey or LCSC.

## Implemented behavior

- Recognize full supplier category names, plurals, spacing variations, a small set of common synonyms, and unambiguous one-character spelling errors. Detailed requests with extra specifications still use AI review.
- Search the category's actual vocabulary and shorter keywords when needed. Verify candidate category labels so photodiodes do not become phototransistors, LEDs or optocouplers.
- Remember successful query wording for ten minutes while fetching fresh inventory each time.
- When no stock is found, make one bounded AI-assisted related search. Preserve the original request and explicit requirements. Functional alternatives are labelled, reviewed, and never presented as exact replacements. Exact C-numbers/explicit MPN requests do not silently broaden.
- Cache related-search interpretation plans for ten minutes. Broader query plans now feed both JLCPCB and the optional DigiKey search path.
- Keep validated installed/cached CAD ahead of new downloads. Category discovery does not imply stock availability, full datasheet suitability or CAD availability.

## Verification

101 automated tests pass, including recognition of all 853 category names, photodiode category exclusions, bounded related-search retries, preserving original requests, fresh stock checks and exact-ID handling.

The no-AI live catalog matrix covered 43 varied requests: 40 were recognized directly and 38 returned stocked candidates. The three unrecognized phrases proceed to the general AI path rather than being unsupported categories. Laser diode and NOR FLASH had no direct result. A subsequent real AI-assisted NOR FLASH retry found three stocked, placeable NOR flash parts, including C481388 / SST39VF800A-70-4C-EKE. That full retry took 26.0 seconds; it is intentionally only used after an empty initial search.

The reported failure was reproduced: `photo diode` returned only unavailable items, while `Photodiodes` returned stocked detectors. The running app now resolves `photo diode` to the correct category, finds eight supplier candidates, and automatically prepares a matching part. The first live app check returned C264281 / PD204-6C with usable CAD in 1.66 seconds. After the final restart, two checks with cached CAD took 1.14 and 1.07 seconds. Stock was fetched again both times.

Coverage is broader than the earlier named-part tests, but the matrix is not an exhaustive live inventory/CAD test of every category. Direct DigiKey network access was not retested in this change; its query-plan integration is covered by code tests. No fabrication orders or purchases were made.

Artifacts: `services/data/jlcpcb-categories.json`, `scripts/category-matrix.mjs`, `.runtime/qa/category-matrix.json`.
