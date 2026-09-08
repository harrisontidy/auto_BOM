# auto_BOM

`auto_BOM` is a component finder built into KiCad. Describe the part you need in plain language, compare live DigiKey options, and place the selected symbol into the schematic with its footprint and supplier metadata attached. The BOM importer remains available as a final sourcing check.

## Current prototype

The current prototype can:

- turn a natural-language component request into concise DigiKey search requirements;
- return inexpensive, in-stock DigiKey candidates with quantity-aware pricing;
- use AI to select and explain the closest result;
- resolve an exact KiCad library symbol when one exists, with safe generic symbols for ordinary passives;
- assign a matching KiCad footprint and its standard 3D model;
- place the selected part from the docked Schematic Editor panel;
- attach manufacturer part number, DigiKey part number, and datasheet fields to the symbol;
- import a KiCad-style CSV file;
- recognize common column names such as `Reference`, `Designator`, `Value`, `Designation`, `Footprint`, and `Quantity`;
- split comma-separated designators and derive safe component/package facts from references and footprints;
- normalize resistor and capacitor values such as `4k7`, `10K`, `0.1uF`, and `100nF`;
- group duplicate component rows;
- flag missing values, footprints, and references;
- export the cleaned BOM as JSON;
- have AI review the raw CSV and correct the deterministic first-pass interpretation;
- search every unique BOM line through DigiKey Product Information V4 using two-legged OAuth;
- ask AI to review each candidate list and report missing requirements.
- run inside a real docked panel in a custom KiCad 10.0.6 Schematic Editor build.

The browser performs a deterministic first pass so a malformed file fails clearly. When AI is configured, the CSV and that first pass are sent to OpenAI for semantic review. The corrected lines are then searched automatically through DigiKey, with at most three lines processed concurrently. Each returned candidate list is sent to OpenAI for review. Importing a file starts this process automatically.

## Run it

For the full workflow, double-click the **Auto BOM for KiCad** desktop shortcut. Enter a request such as `10 kOhm 0805 resistor, inexpensive, need 6`, choose a result, and click **Place in schematic**. Move the attached symbol to its position and click once in KiCad.

The web version is also available at `http://localhost:4173`, but placing parts requires the docked KiCad panel.

Click **Load stress test** to run the fictional EV high-voltage power-management BOM in `examples/ev_hv_power_management_stress_test.csv`. It intentionally includes common passives, high-voltage parts, generic IC requirements, connectors, test points, mounting holes, and DNP rows so parser and sourcing failures are easy to find.

On Windows, the **auto_BOM** desktop shortcut opens the standalone web version. It runs `Start auto_BOM.ps1` and starts the server in the background when needed.

For the native Schematic Editor panel, run `Start Auto BOM in KiCad.ps1`. Build and patch details are in `integrations/kicad-native/README.md`.

If Node.js is installed, you can run the parser checks:

```powershell
node --test
```

```powershell
node server.js
```

## API configuration

Copy `.env.example` to a file named `.env` and fill in your keys. The server loads it automatically, and Git ignores it so real secrets are not committed. DigiKey sandbox credentials come from a DigiKey developer application subscribed to Product Information V4. The server uses sandbox unless `DIGIKEY_ENV=production` is set.

DigiKey's sandbox is only for checking authentication and response handling; its catalog response is sample data and cannot produce a real price/stock BOM. A completed purchasing list requires credentials from an approved production app and `DIGIKEY_ENV=production`.

The AI review uses `OPENAI_API_KEY`, strict JSON schemas, and `store: false`. `OPENAI_MODEL` defaults to `gpt-5-mini` to keep requests inexpensive. AI translates the request and ranks real DigiKey results; it is instructed not to invent IC pinouts, voltage ratings, packages, or part numbers. The person designing the circuit remains responsible for electrical compatibility.

## Planned milestones

1. Add more deterministic electrical and package constraints.
2. Import manufacturer CAD assets when KiCad has no matching symbol.
3. Save projects and approved selections in SQLite.
4. Create a DigiKey cart from the approved final BOM.

## Why the design starts small

Supplier search and AI recommendations are only useful if the imported data is reliable. This prototype establishes a visible, testable input pipeline first. Electrical compatibility rules will remain deterministic; AI will help interpret incomplete notes and compare candidates.
