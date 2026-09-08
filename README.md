# auto_BOM

`auto_BOM` turns a KiCad BOM export into a clean component list, asks AI to check how the CSV should be interpreted, searches DigiKey automatically, and asks AI to review the candidates.

## Current prototype

The current prototype can:

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

The browser performs a deterministic first pass so a malformed file fails clearly. When AI is configured, the CSV and that first pass are sent to OpenAI for semantic review. The corrected lines are then searched automatically through DigiKey, with at most three lines processed concurrently. Each returned candidate list is sent to OpenAI for review. Importing a file starts this process automatically.

## Run it

Start the local server, open `http://localhost:4173`, and click **Load sample** or choose a KiCad CSV export.

Click **Load stress test** to run the fictional EV high-voltage power-management BOM in `examples/ev_hv_power_management_stress_test.csv`. It intentionally includes common passives, high-voltage parts, generic IC requirements, connectors, test points, mounting holes, and DNP rows so parser and sourcing failures are easy to find.

On Windows, double-click the **auto_BOM** desktop shortcut. It runs `Start auto_BOM.ps1`, starts the server in the background when needed, and opens the app in your default browser.

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

The AI review uses `OPENAI_API_KEY`, strict JSON schemas, and `store: false`. It may interpret column meaning and improve search wording, but it is instructed not to invent electrical specifications. Its output does not prove electrical compatibility.

## Planned milestones

1. Add deterministic electrical and package constraints.
2. Save projects and approved selections in SQLite.
3. Add quantity-aware pricing and candidate ranking.
4. Add a human approval step before creating a supplier cart.

## Why the design starts small

Supplier search and AI recommendations are only useful if the imported data is reliable. This prototype establishes a visible, testable input pipeline first. Electrical compatibility rules will remain deterministic; AI will help interpret incomplete notes and compare candidates.
