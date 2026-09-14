# Auto BOM testing and private maintainer research

Tested September 11, 2026. These are private project notes, not text intended for an upstream issue, email, or merge request.

## Changes

- Ordinary passives with recognized packages and explicit part numbers bypass AI interpretation. Only ambiguous lines are sent for interpretation.
- Repeated assigned parts share one lookup per run and their combined schematic demand is checked against stock. Stock results are not reused across runs.
- Conflicting fields on duplicate references, missing footprints, and unresolved specifications remain flagged for review.
- AI cannot invent a missing value or footprint and thereby make an incomplete line appear complete.
- Additional passive constraints, such as a 50 V rating, require review instead of being silently treated as an ordinary capacitor request.

## Results

All 110 automated tests passed, including nine new hardening tests. A 200-resistor test made one supplier lookup and no AI calls. Tests also covered conflicting references, insufficient shared stock, missing footprints, and an AI outage.

Live supplier tests used synthetic schematic inputs with AI disabled:

| Input | Symbols | Completed grouped BOM lines | Elapsed |
| --- | ---: | ---: | ---: |
| RC filter bank | 18 | 2 / 2 | 0.93 s |
| RP2040, ADC, optocoupler, photodiode, relay | 5 | 5 / 5 | 1.65 s |
| Six ordinary resistor/capacitor values | 6 | 6 / 6 | 2.11 s |
| Three incomplete or constrained entries | 3 | 0 / 3, correctly unresolved | 1.17 s |

The valid inputs completed 13 grouped lines covering 29 symbols. All selected passive lines were JLCPCB Basic parts. Completed lines were checked for supplier IDs, footprint IDs, and sufficient stock. These are single-run timings with the current local cache, not cold-download guarantees or a measured before/after speed comparison.

The restarted running service also passed an HTTP request: two 10k 0603 resistors became one Basic C25804 BOM line, with zero interpreted lines. Raw matrix results are in `.runtime/qa/bom-matrix.json`; repeat the live matrix with `node scripts/bom-matrix.mjs`.

This turn tested service logic and live catalog responses. It did not repeat native KiCad placement/undo tests, qualify a physical board, or test Linux/macOS.

## Remaining drawbacks

- Public supplier and CAD endpoints can change or reject requests. Prior testing encountered download blocking; universal CAD availability is not guaranteed.
- A footprint ID and matching pin/pad identifiers do not prove dimensions, electrical suitability, or compatibility with an existing schematic symbol. Datasheet and pin-mapping checks still matter.
- Stock is a snapshot. Board order multipliers, assembly attrition, fees, and final cart availability are not covered.
- Ambiguous components still need review and may incur AI latency/cost. Strict constraints can intentionally leave lines unresolved.
- The custom native build and supporting runtimes increase installation and maintenance work. Current input validation caps a request at 200 symbols.
- Supplier/CAD provenance and redistribution permissions need checking before wider distribution.

## What KiCad asks for

New contributors must first find or open a relevant issue, explain the user-visible problem, and obtain lead-team acceptance and assignment before submitting a merge request. Unassigned submissions are automatically closed. Their stated concern is limited review capacity. [Code Contribution Policy](https://dev-docs.kicad.org/en/rules-guidelines/code-contribution/index.html)

AI-assisted code requires human understanding, review, accountability, and disclosure; substantial assistance uses an `Assisted-by` trailer. Contribution prose—including issues, commit messages, comments, and documentation—must be human-written. The current prototype therefore needs personal review and appropriate preparation before any upstream submission. [Tool-Generated Content Policy](https://dev-docs.kicad.org/en/rules-guidelines/tool-generated-content/index.html)

KiCad already supports read-only HTTP libraries that connect external part metadata to symbols and footprints in other libraries. They do not themselves contain the CAD definitions. This makes an external lookup service worth evaluating, although it does not by itself implement live schematic BOM editing. [HTTP Libraries](https://dev-docs.kicad.org/en/apis-and-binding/http-libraries/index.html)

## Likely reaction and approach

My assessment, not maintainer feedback: reducing sourcing and field-entry work is useful, but the entire vendor-specific fork is a large support commitment. Expect questions about correctness, offline behavior, privacy, credentials, cross-platform support, cancellation/undo, and long-term endpoint stability. I would not submit the whole fork now.

1. Add a field-change preview with per-line accept/reject and reasons for unresolved selections.
2. Strengthen rating, pin-mapping, and mechanical validation; test real fixture projects and failure recovery across platforms.
3. Prototype external HTTP-library lookup, then identify the smallest supplier-neutral extension needed for BOM editing.
4. Search existing discussions, including [quick access to commonly used components](https://gitlab.com/kicad/code/kicad/-/issues/6028), without treating related discussion as endorsement.
5. Personally write a short problem-focused issue with a small demo, test evidence, limitations, and an architecture question. Ask whether that scope is wanted and whether you may work on it. Seek assignment before preparing an upstream MR.

No maintainers were contacted and nothing was submitted.
