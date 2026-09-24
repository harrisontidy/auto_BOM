# Cold search performance — September 12, 2026

The user's observed 5+ seconds was not reproduced with the canonical request in the initial fresh-process measurement. That request took 1,485 ms: 1,186 ms catalog access, 298 ms CAD resolution, and 1 ms interpretation. Code inspection found that reordered ordinary passive requests could miss the deterministic parser and invoke AI. The exact path taken by the user's earlier request was not recorded.

Changes:

- Recognize ordinary resistor/capacitor requests in different word orders without AI. Extra electrical requirements still use the fuller interpretation/review path.
- Standard SMD passives resolve directly to their generic KiCad symbol and package, avoiding the initial scan of every installed symbol library.
- Limit catalog traffic to two simultaneous requests instead of serializing everything, reducing blocking between independent searches/BOM workers. Basic-first ordering within each search is retained.
- Stock and prices still come from a live supplier request. No final recommendation or inventory cache was added.

Measured after the changes, using a new Node process for each request:

| Request | Search time | Live catalog requests |
| --- | ---: | ---: |
| 100k 0805 resistor | 539 ms | 1 |
| resistor 0805 100k | 456 ms | 1 |
| find me a 100k resistor in 0805 | 494 ms | 1 |
| 0805 47k resistor | 425 ms | 1 |
| capacitor 0603 100nF | 358 ms | 1 |
| resistor 0603 4.7k | 430 ms | 1 |

These runs reset application interpretation, query and symbol-index caches. AI and EasyEDA downloads were disabled for the benchmark; installed KiCad libraries remained available. Operating-system file/DNS caches and supplier-side caches were not controlled. The network portion also got faster between the initial and later measurements, so the entire before/after difference cannot be attributed to our code.

After restarting the real app service, its first request for `resistor 0805 100k` took 483 ms over local HTTP, including 469 ms inside search. The returned Basic part was C149504. CAD resolution took 1 ms. This does not include native editor rendering or user typing time.

All 113 automated tests passed, including first-request AI bypass for reordered values, preservation of extra constraints, and bounded concurrent catalog requests releasing slots after failures.

Repeat with `node scripts/cold-search-benchmark.mjs`. Raw results are in `.runtime/qa/cold-search.json`. New IC searches, AI review, catalog retries and first-time EasyEDA conversion still take longer. No universal subsecond guarantee is implied.
