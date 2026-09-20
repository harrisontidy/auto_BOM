# Discovery and CAD reliability follow-up — September 11, 2026

## Changes now running

- Check installed KiCad libraries and validated cached EasyEDA assets across the supplier pool before downloading. Surface usable matching options while retaining Basic preference.
- For simple catalog/part-number searches, download one matching part initially. If unavailable, try additional candidates, bounded to six total and a 15-second cutoff before starting another alternative. A single converter operation retains its own timeout.
- Return up to three already-ready choices. General natural-language searches still compare up to three initial candidates.
- Space fresh downloads three seconds apart. Pause uncached downloads for one minute after a 403/429 refusal, and remember unavailable part data for one minute. Cached and installed assets remain usable.
- Show concise download failures rather than Python command lines. Do not invent IC pinouts or custom display footprints to improve the success count.
- AI interpretation now produces up to three distinct supplier queries, from specific keywords to a broader category, while retaining original requirements for review. Lower reasoning effort reduced latency in the tested informal requests.
- Recognize display panels, microphones, accelerometers and vibration motors by category. Exclude display drivers and buzzers from those physical-device searches. Known discovery categories can still retrieve options if interpretation fails; unsuccessful review remains visibly unverified.
- Treat OLED as an explicitly labelled alternative to a requested LCD. Inferred smartwatch preferences such as touch support do not become invented hard requirements.
- Handle names such as LIS3DH without requiring consecutive digits, and retry MPU6050 as MPU-6050.

## Results

94 automated tests pass. Production service restarted; its MPU6050 HTTP search returned C24112 / MPU-6050 with a usable installed library pair in 1.50 seconds.

| Test set | Stocked search results | At least one usable symbol/footprint pair |
| --- | ---: | ---: |
| Original 30 searches, previous run | 30/30 | 22/30 |
| Original 30 searches, follow-up run | 30/30 | 28/30 |
| Additional 30 part-name searches, final run | 28/30 | 23/30 (23/28 stocked searches) |

The original follow-up result was recorded before the final cache-first and single-download changes. These figures mix validated EasyEDA downloads with installed KiCad library matches. They are snapshot coverage, not a guarantee for arbitrary parts.

The additional set: STM32F103C8T6, ESP32-C3, ATmega328P, CH340C, CP2102N, FT232RL, MCP23017, PCF8574, 74HC595, 74HC14, LM358, TL072, MCP6002, LM393, TL431, AMS1117, TP4056, MCP73831, DS3231, PCF8563, MAX98357A, PAM8403, MPU6050, LIS3DH, ADXL345, BMP280, SHT31, BH1750, VL53L0X and DRV8833. BMP280 and VL53L0X returned no stocked match. Family searches may return different package/function variants; those are labelled for review, not promised to be drop-in equivalents.

## Informal requests tested with real AI and catalog calls

| Request | Observed result | Total time after AI tuning |
| --- | --- | ---: |
| LCD for a smart watch | Three stocked OLED alternatives; no matching stocked LCD in searched assembly-catalog pages. CAD blocked during this run. Explicit mismatch retained. | 31.1 s |
| tiny microphone for a wearable | Three stocked microphone options; CAD blocked during this run. | 24.2 s |
| accelerometer for a step counter | Three stocked, placeable accelerometers. Built-in step counting remains a specification to check. | 18.5 s |
| vibration motor for a smartwatch | No stocked matching category found. Buzzers correctly excluded. | 13.2 s |

Before tuning, LCD and microphone searches took 48.3 and 56.7 seconds, respectively. Timings include variable network service latency and are not controlled benchmarks. The 60 part-name/catalog searches used no AI calls. The informal request tests used a small number of real AI interpretation/review calls; token charges were not measured.

## Why failures remain

EasyEDA returned both missing-data responses and HTTP 403 refusals. Some previously refused parts downloaded successfully later; the precise upstream reason for refusal is unknown. A refusal is not proof that the part permanently lacks CAD. The app now pauses rather than repeatedly requesting uncached assets during that condition.

JLCPCB's assembly catalog is a subset of parts one might purchase elsewhere. A requested LCD panel, motor or module can have no stocked assembly-catalog match even if other distributors sell it. Display/FPC geometry and pin mappings need actual library data; a generic connector is not automatically a valid display footprint.

Detailed snapshots: `.runtime/qa/component-matrix.json`, `.runtime/qa/discovery-named.json`, `.runtime/qa/discovery-natural.json`. Reproduce the named set with `node scripts/discovery-matrix.mjs`; add `--catalog-only` to skip CAD. Use `node --env-file=.env scripts/discovery-matrix.mjs --natural` for the four AI-assisted requests. Live runs make external requests; stock, CAD availability and latency change.
