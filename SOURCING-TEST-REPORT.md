# LCSC / EasyEDA verification

Tested on September 11, 2026 (Vancouver time).

## Implementation

- JLCPCB/LCSC is the default supplier; DigiKey remains selectable.
- Basic-part preference is enabled in both native sourcing workflows and the browser finder.
- Searches query the Basic catalog before falling back to the full catalog. Exact part selections are preserved.
- EasyEDA symbols and footprints download automatically, are converted with easyeda2kicad 1.0.1, and are cached per LCSC number.
- Import checks cover C-number, MPN, library linkage, and matching symbol pin / footprint pad numbers.
- The native integration registers imported libraries during placement and BOM completion. BOM completion preserves existing symbols and footprints.

## Automated and file checks

- 57 offline tests passed, covering source separation, stock, purchase minima, Basic preference/fallback, exact part identity, arrays versus discrete passives, grouped BOMs, conflicting assignments, unavailable AI, malformed CAD, pin/pad mismatches, and converter failures.
- The custom KiCad Schematic Editor compiled successfully.
- Stock KiCad 10's CLI parsed and exported SVGs for the imported symbols and footprints of C2040 (RP2040), C17414 (0805 10 kΩ resistor), C14663 (0603 100 nF capacitor), and C2912962 (MP28167GQ-Z).
- Native patch reverse-application check passed.
- Final live run: all 12 scenarios passed, including natural-language searches, Basic selection, EasyEDA downloads, grouped BOM completion, DigiKey switching, impossible quantities, nonexistent parts, and input validation.
- Live checks are reproducible with `node scripts/live-sourcing-check.mjs`; the local run output is in `.runtime/qa/live-sourcing-results.jsonl`.

## Issues found and fixed

- Common Basic parts were absent from the first page of the unrestricted catalog: query the Basic catalog explicitly.
- A JLC placement-related quantity was incorrectly treated as purchase MOQ: use the catalog's `minPurchaseNum` field.
- Empty filtered results use `list: null, total: 0`: handle this observed response as empty while rejecting malformed responses.
- AI-expanded keyword queries could miss Basic commodity parts: use a concise value/package query for ordinary passives.
- Exact C-number searches could collide with another part's MPN: compare C-numbers to C-numbers.
- Resistor arrays could match a discrete package-size prefix: reject arrays for ordinary passive searches.

## Native interactive verification

After the user disabled Smart App Control, the rebuilt editor launched successfully. No security settings were changed by the agent.

- Removed the quantity input from both finders. Native UI verification confirms it is gone; each finder searches for one component. BOM quantities still come from the schematic.
- Built `examples/sourcing-demo/sourcing-demo.kicad_sch`: a three-part RC divider with two 10 kΩ 0805 resistors and one 100 nF capacitor.
- Ran native **Fill Missing Parts** with **Use AI** unchecked and **Prefer JLCPCB Basic parts** checked. Both BOM lines completed. R1/R2 were assigned C17414 and C1 C14663; all three saved symbols have Basic library type.
- Preserved the existing resistor footprints and capacitor MPN. C1's previously empty footprint became `AutoBOM_C14663:C0603` automatically.
- Saved through the native BOM dialog and exported `sourcing-demo.csv`. Read-back confirms quantity 2 for R1/R2, quantity 1 for C1, exact LCSC numbers, MPNs and footprints.
- KiCad CLI exported the saved schematic and netlist. ERC: **0 errors, 1 warning** for the intentional single-pin VIN input label. The netlist connects R1 pin 2, R2 pin 1 and C1 pin 1 at VOUT.
- A single exact C2040 finder search loaded an EasyEDA RP2040 symbol from a newly registered library and placed it as U1. Copy/paste created U2. Saving and CLI netlist export confirmed both retained their C2040 number and matching EasyEDA footprint. This unwired placement fixture is local at `.runtime/qa/native/sourcing-test.kicad_sch`.
- BOM retries used no AI. This final placement check used one exact-part finder review; the earlier resistor placement attempt used one additional review. No AI was used to generate the circuit.

Native testing found and fixed three integration problems: a newly registered symbol library was not explicitly loaded; Windows path separator differences caused false library-name conflicts; and the LCSC stock recheck condition incorrectly marked a successful completion unresolved. Import errors now reach the BOM error handler instead of producing a misleading success message.

## Suggested improvements

- Extend the conservative no-AI fast paths to more component families.
- Keep the placement button visible above long candidate explanations, and clear its placement instruction once placement ends.
- Add a concise JLCPCB export preset including Basic/Extended type. The current standard CSV includes sourcing fields but does not automatically include library type.
- Add explicit voltage, power and tolerance requirements before using automatic selections in a production design.

Stock/price checks are snapshots. Assembly attrition, board quantity multipliers, setup fees, and complete datasheet/geometry verification are outside these tests.

## Search intelligence and latency follow-up

The reported `find a 10 A relay` failure was reproduced against the live catalog: `10 A relay` returned no results, and `10A relay` returned 21 out-of-stock industrial items. `10A Power Relays` returned stocked PCB relays. Category-aware query variants now address this mismatch while retaining Basic-first sourcing.

Added conservative deterministic interpretation for exact LCSC IDs, simple passives, and simple relay requests. Any unrecognized extra constraints fall through to AI. Relay matching checks category, current, coil voltage, contact form, and combined current/AC-or-DC-voltage contact ratings when specified. AI instructions now require checking explicit requirements and prohibit inventing CAD availability. Failed or out-of-list AI selections are visibly unverified.

AI interpretation is cached for ten minutes (maximum 100 entries), while supplier stock is always fetched again. The finder imports at most three candidates automatically instead of eight, and CAD import runs concurrently with review. Exact/simple searches omit both AI calls. External AI calls have a 30-second timeout.

All **68 automated tests** passed. Live no-AI measurements including automatic EasyEDA imports:

| Request | End-to-end time |
| --- | --- |
| find a 10 A relay, first import | 5.46 s |
| same relay request, CAD cached | 1.39 s |
| 10A relay with 5V coil | 2.23 s |
| C17414, CAD cached | 0.32 s |
| 10k 0805 resistor, CAD cached | 0.35 s |

The 10 A search returned C86414, C88653 and C62754, each with a verified imported symbol/footprint pair. The 5 V coil search returned only 5 V coil candidates. All these relays were Extended; Basic preference was retained, with fallback when no suitable Basic candidate was found. The production service was restarted and its HTTP endpoint returned the same three placeable relay candidates in 1.72 s. Measurements are snapshots, not latency guarantees; no AI credits were used for these live checks. Detailed timing output is local in `.runtime/qa/search-speed.jsonl`.
