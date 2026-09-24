# Common-circuit fast path — September 20, 2026

The default fast path keeps the selected model, uses low reasoning when supported, and requests a small declarative blueprint adapter. Code expands the topology, evaluates equations, chooses preferred component values, verifies pin coverage, and routes wires. It does not run AI-written JavaScript. Unsupported or invalid adapters automatically use the original full-datasheet/image workflow and selected reasoning effort.

## Measurements

| Circuit | Previous full design | Fresh blueprint | Saved recipe |
|---|---:|---:|---:|
| TPS5430DDAR | 78.60 s | 44.07 s | 0.63 s |
| NE555P | 55.48 s | 17.58 s | 0.54 s |
| OPA1655DBV | 54.16 s | 13.27 s | 0.58 s |

Fresh runs used separate Node processes and a new empty recipe directory. All PDFs were downloaded again. Repeat runs also used separate processes, demonstrating that the saved recipes survive a backend restart. OS/CDN/provider caching is outside the application’s control. Parts and datasheet links were already selected; supplier search is not included. The fresh runs used GPT-6 Astra with low reasoning and Fast mode; the previous baseline used medium reasoning. Each row is one run, not an average or an 80% coverage claim.

| Stage | TPS5430DDAR | NE555P | OPA1655DBV |
|---|---:|---:|---:|
| CAD lookup | 0.42 s | 0.39 s | 0.47 s |
| Model/session setup | 0.14 s | 0.16 s | 0.16 s |
| Datasheet retrieval | 5.59 s | 1.01 s | 0.65 s |
| Fast PDF preparation | 0.62 s | 0.92 s | 0.85 s |
| AI blueprint adaptation | 37.03 s | 14.90 s | 10.92 s |
| Blueprint calculations + wiring | 0.25 s | 0.20 s | 0.21 s |

The regulator download alone took 5.59 seconds in this round, versus 0.22 seconds in the earlier baseline. The AI adapter still dominates fresh-generation time. The five-second cold-generation target was not achieved. Repeated identical requests complete under one second in these tests.

## Validation and failed trials

- All three final fresh requests used the blueprint path without falling back.
- KiCad CLI exported each generated schematic. Every source net matched the exported pin connectivity.
- Regression fixtures retain the live adapters and verify calculated values and complete pin coverage.
- An initial selected-page-only trial omitted capacitor requirements and fell back. The final fast input includes the full text (bounded to 120,000 characters). Images remain available through the full-design fallback.
- Earlier trials exposed equation-unit and endpoint-notation differences. Unit enums, explicit component aliases, dependency ordering and U1-to-primary normalization handle these without another AI call.
- GPT-5.6 Luna was tested but was not enabled by default: it did not consistently improve successful end-to-end latency. One later trial fell back and then encountered an external workspace-routing timeout. Failed trials were not treated as fast successes.
- Interactive editor placement was not exercised; work stayed in the background. Connection checks do not establish physical circuit performance.

## Recipe reuse

The saved key includes the exact manufacturer part, datasheet URL, complete request, symbol ID, pin map and blueprint definitions. Recipes expire after 24 hours and the directory is capped at 200 entries. Every reuse re-expands, recalculates, validates and reroutes the recipe against current library geometry. Changed operating requirements produce a different key; the app does not reuse a 5 V design for a 3.3 V request. This is intentionally separate from the generic blueprints, which apply across parts and operating points.

Common families currently include adjustable buck, external-diode boost, fixed/adjustable linear regulator, inverting/non-inverting op-amp, astable timer, and digital-IC bypass/support circuits. Exotic arrangements and unsupported extra active devices retain the slower fallback. No measured claim is made that these cover 80% of all circuits.

Internal controls for reproducible testing: APPLICATION_FAST_PATH=false restores the full path; APPLICATION_CACHE=false disables recipe reads/writes; APPLICATION_CACHE_DIR selects an isolated recipe store; APPLICATION_FAST_MODEL overrides the fast-stage model only when available in the account catalog. No extra sidebar settings were added.
