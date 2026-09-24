# Application generation timing — September 20, 2026

Three sequential, fresh-process runs using GPT-6 Astra, medium reasoning, and the existing Fast/priority configuration. Each run downloaded its PDF anew, rebuilt the in-memory symbol index, selected PDF pages anew, rendered fresh images, and generated a new plan. No saved circuit, application PDF, or in-process cache was reused. Installed KiCad libraries are inputs, not cached generated results. Operating-system, CDN and provider-side prompt caching cannot be disabled or verified by this test. The parts and direct official datasheet URLs were supplied, as they would be after selecting a part; supplier search is outside the measured interval.

| Stage | TPS5430DDAR | NE555P | OPA1655DBV |
|---|---:|---:|---:|
| CAD lookup | 0.392 s | 0.353 s | 0.389 s |
| Model/session setup | 0.107 s | 0.122 s | 0.133 s |
| Datasheet retrieval | 0.219 s | 0.500 s | 0.452 s |
| PDF text + image processing | 1.329 s | 1.144 s | 1.444 s |
| AI page selection | 6.323 s | 4.608 s | 4.580 s |
| AI circuit design | 70.032 s | 48.593 s | 46.960 s |
| AI arithmetic correction | 0.000 s | 0.000 s | 0.000 s |
| Wiring layout | 0.197 s | 0.157 s | 0.199 s |
| Other local work | 0.004 s | 0.004 s | 0.003 s |
| **Total** | **78.603 s** | **55.481 s** | **54.159 s** |

PDF processing excludes the separately listed AI page-selection call; there is no double counting. Other local work includes validation and bookkeeping. AI call durations include transport/session work, any provider wait, input processing and output generation; this instrumentation cannot split those internal costs.

## Requests and outcomes

All three successful plans were exported as temporary schematics and checked with KiCad CLI netlist export. Every generated source net matched the exported pin connectivity. This checks connection preservation, not electrical performance or interactive placement. Interactive placement/resizing were not tested because the user requested background-only work.

- **TPS5430DDAR**: Generate a 12 V input to 5.1 V output buck regulator circuit, up to 2 A. Generated 8 symbols and 7 calculation records.

- **NE555P**: Generate a 5 V astable timer circuit with approximately 1 Hz output. No LED or output load needed. Generated 6 symbols and 6 calculation records.

- **OPA1655DBV**: Generate a non-inverting amplifier with gain 11, plus and minus 12 V supplies, and a 10 kilohm gain resistor to ground. Input signal is centered on ground. Generated 5 symbols and 6 calculation records.

An initial TL071CP attempt stopped at exact-symbol lookup in 0.358 s. It is recorded separately rather than counted as a successful full-generation test. OPA1655DBV replaced it in a fresh process.

## What to optimize next

1. The AI circuit-design call dominates. Measure a lower-reasoning run against the same connectivity and arithmetic checks before changing the default. Reduce repeated prose in the structured plan while retaining pin/net mappings and equation provenance.
2. AI page selection costs about 5–6 seconds. A deterministic page shortlist could skip that model call on unambiguous datasheets, with the current AI selection retained for difficult documents.
3. Consider giving the design call selected-page text plus essential global specifications instead of the entire PDF text. Benchmark correctness as well as latency.
4. Downloads and wiring each take well under one second in these runs. Optimizing them further will have little effect on total time.

These are three individual measurements, not averages or latency guarantees. No timing-driven model/effort change was made.
