# BOM alternatives and compatibility review

Date: 2026-09-12

## Changes

- Native BOM review can open Component Finder for a selected line and use a candidate without rerunning the whole BOM. Select-all-ready and clear-selection controls simplify review.
- Searches retain the original schematic values and package requirements even when the search text changes. Named supplier attributes support checks of passive values, tolerance, power, rated voltage, temperature range, interfaces, package and stock. Missing evidence is shown as unknown; definite mismatches are rejected.
- Imported CAD checks cover library identity, pin/pad numbering, valid pad geometry, coincident electrical pads, explicit pin counts and supported package body dimensions. Cached imported assets are revalidated.
- BOM checks compare original schematic pin numbers and names against the candidate. Missing pins and named functions moved to another pin block automatic assignment. Uncertain aliases remain manual checks.
- Applying selected lines checks combined demand for the same supplier part, including existing schematic assignments.
- AI review, automatic EasyEDA downloads, Basic-part preference and progressive results remain enabled features. Ordinary passive checks do not require AI.

## Validation completed

- 122 automated tests passed, zero failures, after the final service change.
- Custom Schematic Editor compiled and linked successfully with patch 0009.
- Live BOM matrix: 13 valid grouped lines spanning 29 symbols completed across three cases; three incomplete/constrained entries correctly remained unresolved. Runs took approximately 1.5–1.8 seconds per case in the running service. These are not cold-start benchmarks.
- Live 100k 0805 refinement returned Basic part C149504 with value, package, stock and schematic pin-number checks, approximately 943 ms in the running service.
- Live photodiode test caught a real pin-function conflict: the original Device:D_Photo has pin 1 K / pin 2 A, while EasyEDA C264281 (PD204-6C) has pin 1 A / pin 2 C. The candidate was marked non-placeable for that BOM context instead of silently assigning an incompatible footprint.

## Interface verification paused

The user requested pausing foreground interface tests. A separate four-symbol fixture is prepared in `.runtime/qa/bom-e2e/`, with two resistors, one capacitor and the deliberately conflicting photodiode. No review changes have been applied to it.

The following checks remain pending: cancel review without changes; choose an alternative and apply only selected rows; undo/redo accepted sourcing fields; save and reopen; export and verify the resulting BOM. Compilation and service tests do not establish that these new native interactions work end to end.

## Limits and next verification

- This is a structured compatibility check, not full datasheet or circuit validation. Unknown specifications, pin aliases, unsupported geometry and incomplete supplier data still require review.
- Existing assigned part numbers are preserved. To replace one through refinement, clear its assignment in the BOM table first. Existing footprints are also preserved and may need independent compatibility review.
- Supplier response time and CAD downloads remain variable. The new checks do not establish a new uncached latency claim.
- Resume the prepared native workflow checks next, then expand uncached supplier measurements and real-device pin/package fixtures based on any failures.

Reproducible native changes: `integrations/kicad-native/patches/0009-bom-alternatives-and-pin-review.patch`.
