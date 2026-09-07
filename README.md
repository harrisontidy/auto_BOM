# auto_BOM

`auto_BOM` is an early-stage bill-of-materials assistant for electronics projects. The goal is to turn a KiCad BOM export into a clean, reviewable list and later use supplier data and AI-assisted reasoning to recommend exact orderable parts.

## Current prototype

The first milestone runs entirely in the browser and can:

- import a KiCad-style CSV file;
- recognize common column names such as `Reference`, `Value`, `Footprint`, and `Quantity`;
- normalize resistor and capacitor values such as `4k7`, `10K`, `0.1uF`, and `100nF`;
- group duplicate component rows;
- flag missing values, footprints, and references;
- export the cleaned BOM as JSON.

No BOM data leaves your computer in this version.

## Run it

Open `index.html` in a browser and click **Load sample**, or choose one of your own KiCad CSV exports.

If Node.js is installed, you can run the parser checks:

```powershell
node --test
```

For the most reliable local preview, start the tiny development server and open `http://localhost:4173`:

```powershell
node server.js
```

## Planned milestones

1. Add a Python API and SQLite database for saved projects and selections.
2. Search DigiKey for compatible orderable parts.
3. Add deterministic electrical and package constraints.
4. Use an LLM to interpret notes and explain candidate rankings.
5. Add a human review step before creating a supplier cart.

## Why the design starts small

Supplier search and AI recommendations are only useful if the imported data is reliable. This prototype establishes a visible, testable input pipeline first. Electrical compatibility rules will remain deterministic; AI will help interpret incomplete notes and compare candidates.
