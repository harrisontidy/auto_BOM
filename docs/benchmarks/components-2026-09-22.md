# Component benchmark — September 22, 2026

50/50 search attempts recorded; 5/5 circuit tests recorded.

## Search results

| Supplier | Attempts | Returned parts | No match | Clarification | Errors | Any placeable CAD | Median | p95 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| lcsc | 25 | 19 | 6 | 0 | 0 | 19 | 15.91 s | 36.43 s |
| digikey | 25 | 19 | 6 | 0 | 0 | 11 | 15.69 s | 29.32 s |
| total | 50 | 38 | 12 | 0 | 0 | 30 | 15.79 s | 33.83 s |

Mean 19.06 s; minimum 11.21 s; maximum 36.52 s. 14 searches used the refinement stage; 0 returned an AI-review fallback. Median and percentiles use nearest ranks over all attempts, including empty results and errors.

## Findings

22 exact-part queries returned the exact MPN; 5 returned a suffix variant; 7 returned none. This is identifier matching, not a datasheet audit.

The largest measured search cost is AI planning and candidate review. Supplier retrieval averaged about two seconds. The empty results include insufficient ratings (1 W resistor, 1 A inductor), a missing shielded-construction claim, near-name substitutions rejected by review, and exact-part searches that returned no candidates after refinement. These are retrieval and matching weaknesses; no-match does not establish that the part is unavailable.

## Searches that returned no match

- **Find 0.1 ohm 1 watt current sense resistor.** (digikey, 26.65 s): I couldn't verify a match for your requirements in this supplier search. None of the supplied 0.1 Ω current-sense resistors meets the requested 1 W power rating. This does not mean the part does not exist.
- **Find 10k through-hole trimmer potentiometer.** (lcsc, 21.92 s): I couldn't verify a match for your requirements in this supplier search. No stocked matching category was found in the searched JLCPCB catalog pages. Some displays, motors and modules may need separate sourcing. This does not mean the part does not exist.
- **Find 10uH shielded power inductor rated at least 2A.** (lcsc, 33.83 s): I couldn't verify a match for your requirements in this supplier search. Neither 1.8 A part meets the current requirement, and the 2.4 A SRP0520-100K lacks supplied evidence of shielded construction. This does not mean the part does not exist.
- **Find 4.7uH SMD power inductor rated at least 1A.** (digikey, 31.21 s): I couldn't verify a match for your requirements in this supplier search. The only candidate is rated 800 mA, below the required 1 A minimum. This does not mean the part does not exist.
- **Find common mode choke for USB 2.0 data lines.** (lcsc, 20.86 s): I couldn't verify a match for your requirements in this supplier search. I tried refining the search without relaxing your requirements. This does not mean the part does not exist.
- **Find MCP1700T-3302E/TT.** (digikey, 27.91 s): I couldn't verify a match for your requirements in this supplier search. I tried refining the search without relaxing your requirements. This does not mean the part does not exist.
- **Find TPS62160DSGR.** (digikey, 26.67 s): I couldn't verify a match for your requirements in this supplier search. I tried refining the search without relaxing your requirements. This does not mean the part does not exist.
- **Find LM358DR.** (lcsc, 26.79 s): I couldn't verify a match for your requirements in this supplier search. The only supplied candidate is onsemi LM358DR2G, not the requested LM358DR. This does not mean the part does not exist.
- **Find TL072CP.** (lcsc, 29.00 s): I couldn't verify a match for your requirements in this supplier search. The only candidate is TL072CPSR, not the requested exact part TL072CP. This does not mean the part does not exist.
- **Find SN74LVC1G125DBVR.** (digikey, 25.68 s): I couldn't verify a match for your requirements in this supplier search. I tried refining the search without relaxing your requirements. This does not mean the part does not exist.
- **Find CD4017BE.** (lcsc, 36.43 s): I couldn't verify a match for your requirements in this supplier search. The only candidate is TDSEMIC CD4017BE-TD, not the exact requested CD4017BE. This does not mean the part does not exist.
- **Find CH340C.** (digikey, 26.01 s): I couldn't verify a match for your requirements in this supplier search. I tried refining the search without relaxing your requirements. This does not mean the part does not exist.

## Search time breakdown

| Stage | Mean across all searches |
|---|---:|
| AI planning | 9.27 s |
| Supplier lookup | 2.22 s |
| AI candidate review | 6.76 s |
| CAD lookup / preparation | 2.60 s |

## By category

| Category | Attempts | Returned | Placeable CAD | Median |
|---|---:|---:|---:|---:|
| resistors | 5 | 3 | 3 | 16.61 s |
| capacitors | 5 | 5 | 4 | 14.26 s |
| magnetics | 5 | 2 | 1 | 27.77 s |
| diodes | 5 | 5 | 5 | 14.38 s |
| transistors | 5 | 5 | 5 | 15.95 s |
| linear_regulators | 5 | 4 | 3 | 14.24 s |
| switching_regulators | 5 | 4 | 4 | 14.38 s |
| opamps | 5 | 3 | 1 | 16.39 s |
| logic_timers | 5 | 3 | 2 | 18.52 s |
| interfaces | 5 | 4 | 2 | 15.79 s |

## Typical application circuits

| Type | Part | Generated | Time | Path | Symbols |
|---|---|---|---:|---|---:|
| linear regulator | AMS1117-3.3 | yes | 50.79 s | full-datasheet | 2 |
| buck regulator | TPS5430DDAR | yes | 17.19 s | blueprint | 8 |
| op-amp | OPA1655DBVR | yes | 17.38 s | blueprint | 5 |
| timer | NE555P | yes | 23.96 s | blueprint | 6 |
| CAN transceiver | SN65HVD230DR | yes | 14.41 s | blueprint | 5 |

### linear regulator � AMS1117-3.3

- CAD lookup: 0.48 s
- Model/session setup: 0.11 s
- Datasheet retrieval: 0.38 s
- Fast PDF preparation: 0.21 s
- AI blueprint adaptation: 7.74 s
- Blueprint fallback: 0.00 s � No supplied blueprint fits the requested 5 V to 3.3 V, 100 mA linear regulator. Supply a fixed-output LDO blueprint or use the full-design fallback.
- AI page selection: 4.21 s
- PDF preparation including page selection: 5.14 s
- AI circuit design: 36.32 s
- Wiring layout: 0.32 s

### buck regulator � TPS5430DDAR

- CAD lookup: 0.43 s
- Model/session setup: 0.12 s
- Datasheet retrieval: 2.43 s
- Fast PDF preparation: 0.42 s
- AI blueprint adaptation: 13.02 s
- Blueprint calculations + wiring: 0.31 s

### op-amp � OPA1655DBVR

- CAD lookup: 0.37 s
- Model/session setup: 0.10 s
- Datasheet retrieval: 2.35 s
- Fast PDF preparation: 1.04 s
- AI blueprint adaptation: 13.10 s
- Blueprint calculations + wiring: 0.34 s

### timer � NE555P

- CAD lookup: 0.36 s
- Model/session setup: 0.12 s
- Datasheet retrieval: 0.68 s
- Fast PDF preparation: 0.48 s
- AI blueprint adaptation: 22.04 s
- Blueprint calculations + wiring: 0.22 s

### CAN transceiver � SN65HVD230DR

- CAD lookup: 0.30 s
- Model/session setup: 0.13 s
- Datasheet retrieval: 0.69 s
- Fast PDF preparation: 0.38 s
- AI blueprint adaptation: 12.06 s
- Blueprint calculations + wiring: 0.78 s


## Connectivity verification

All five generated circuits were exported as temporary KiCad schematics and processed by kicad-cli in the background. Every expected net matched the exported pin-to-pin connections, including the imported CAN-transceiver symbol. This checks schematic connectivity against each generated plan, not independent electrical correctness or live editor placement. No user schematic was modified.

## Interpretation and method

These are real full chat-search calls: AI planning, live supplier lookup, candidate review and CAD preparation. Each query ran once in a fresh process with empty conversation history, GPT-6 Astra, medium reasoning, Basic preference enabled, and Fast mode as configured by the app. Three searches ran concurrently. This is a batch-load benchmark, not isolated single-user latency. Supplier calls were not replaced with fixtures. Installed libraries and existing persistent CAD files remained available as in normal use; supplier stock was fetched live. External/provider caching is not controlled.

Returned parts means the application returned candidates, not an independent electrical suitability certification. Exact MPN comparisons, source supplier IDs, CAD errors, and full assistant explanations are recorded per row in the CSV/JSON. A suffix variant is flagged separately and is not automatically accepted as equivalent. No-match results do not prove a supplier lacks the part.

The five circuit runs total 123.73 seconds (mean 24.75 s, median 17.38 s). Four used blueprints. AMS1117-3.3 fell back because its pin-name classification did not supply the fixed-output LDO blueprint; that attempt took 50.79 s. A single five-case sample does not establish 80% coverage across arbitrary circuits. None of these uncached circuit runs reached five seconds.

Stage durations are unions of overlapping spans within a stage; CAD and AI review overlap, so stage times must not be added to obtain elapsed time. Circuit tests run sequentially on the selected search results with recipe caching disabled. The page-selection timing is nested inside full PDF preparation and must not be added twice. Circuit times exclude the earlier part search. Fast adaptation uses low reasoning; the full-design fallback uses medium reasoning. The fresh-process search benchmark still tests the normal cached-CAD lookup path. No schematic was changed.

User reduced search count to 50 during the run. First 50 cover 10 categories. Circuit LDO switched from empty MCP1700 result to AMS1117; sensor beyond the cutoff replaced with CAN transceiver. No circuit outcomes informed these choices.

[All search rows (CSV)](components-2026-09-22.csv) · [Full results and circuit stage timings (JSON)](components-2026-09-22.json)
