# Small sourcing test

Open `sourcing-demo.kicad_sch` in the custom KiCad editor. This is an RC divider with R1/R2 = 10 kΩ and C1 = 100 nF. Its nominal unloaded DC gain is 1/2 and cutoff is approximately 318 Hz.

Native Auto BOM selected Basic parts C17414 for R1/R2 and C14663 for C1, with AI disabled. It preserved the resistor footprints and automatically filled C1's empty footprint from EasyEDA. The grouped native export is `sourcing-demo.csv`.

`final-erc.rpt` has zero errors and one expected warning: VIN is an external input label connected to a single pin. `sourcing-demo.net` records the tested connections. This schematic is a software test, not a finished PCB or an assembly order.

Imported libraries are stored in this machine's Auto BOM cache and registered globally. Other machines should run Setup EasyEDA and source the same part numbers to populate their libraries.

`node scripts/create-sourcing-demo.mjs` recreates the unsourced fixture and overwrites this sample. Preserve a copy before using it to repeat the test.
