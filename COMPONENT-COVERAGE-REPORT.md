# Component search coverage — 2026-09-11

Added conservative catalog interpretation for common parts and bare IC family names. Unrecognized extra requirements still go to AI review. Basic-first sourcing and fresh stock checks remain enabled.

Named attributes distinguish continuous diode current from surge current, crystals from oscillators, transceivers from drivers, N-channel devices from mixed arrays, PTC hold current from trip current, and fixed buck regulators from buck-boost converters. Connector contact counts, rows and pitch are checked separately.

Category vocabulary fixes improve optoisolator, switch, regulator and temperature searches. Temperature interface is checked in attributes instead of relying on keyword indexing. Family searches exclude development boards and substring lookalikes; explicit `MPN:` requests require an exact part number. Deterministic recommendations choose the first placeable match in supplier rank order when another shortlisted part has unavailable CAD, and explain when none has verified CAD.

## Verification

- 87 automated tests passed, including negative specification tests and CAD-aware selection.
- 30/30 live catalog searches returned stocked matches before and after the final query fix. The final catalog-only run had median 631 ms, range 279–1,936 ms.
- No AI calls were permitted in the live matrix; injected AI functions throw if invoked.
- A full automatic asset run had at least one verified placeable result in 22/30 cases. This includes installed-library fallbacks and EasyEDA downloads, not 22 fresh downloads.
- EasyEDA returned missing-data errors for some parts and HTTP 403 errors later in the run. No further full download run was made against that refusal.
- Restarted the production service and verified `30V N-channel MOSFET` through its HTTP endpoint: Basic C20917 / AO3400A, placeable, 460 ms including cached assets.

## Live matrix

CAD counts are from the full asset run before the final temperature-query change. Final catalog results passed for every row.

| Query | Placeable shortlist results |
| --- | ---: |
| 10k 0603 resistor | 1 |
| 100nF 0603 capacitor | 1 |
| 10uH inductor | 1 |
| red 0603 LED | 1 |
| 1A 40V Schottky | 3 |
| 30V N-channel MOSFET | 1 |
| NPN transistor SOT-23 | 3 |
| 16MHz crystal | 1 |
| 1x4 2.54mm pin header | 3 |
| USB Type-C 16 pin | 2 |
| tactile switch | 2 |
| 500mA resettable fuse | 3 |
| optocoupler | 2 |
| 3.3V LDO | 1 |
| 5V 3A buck regulator | 0 |
| I2C temperature sensor | 0 |
| Hall sensor | 0 |
| RS485 transceiver | 0 |
| RP2040 | 1 |
| NE555 | 0 |
| ADS1115 | 1 |
| INA226 | 0 |
| W5500 | 1 |
| SX1262 | 1 |
| DRV8871 | 1 |
| AD9833 | 0 |
| AT24C256 | 0 |
| BME280 | 1 |
| MPN: ADS1115IDGSR | 1 |
| 10A relay with 5V coil | 3 |

The final I2C sensor search finds TMP112/TMP75 variants instead of a single obscure sensor whose name contains I2C. CAD availability for those new candidates has not been retested.

## Reproduction and limits

Run `npm test` for offline tests. `node scripts/component-matrix.mjs --catalog-only` performs real catalog requests; omitting that flag also attempts real CAD downloads. Detailed snapshots are in `.runtime/qa/component-matrix-catalog.json` and `.runtime/qa/component-matrix.json`.

These are representative searches, not every component or proof of circuit suitability. Stock and latency change. Unspecified electrical, thermal and timing requirements remain selection concerns. The next reliability improvement should address unavailable CAD with clear retry status and a supported alternative library source. No purchases or AI-credit-consuming schematic generation were performed for this matrix.
