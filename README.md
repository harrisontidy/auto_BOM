# auto_BOM

`auto_BOM` turns a KiCad BOM export into a clean component list, searches DigiKey for orderable candidates, and sends those candidates through an optional AI review.

## Current prototype

The current prototype can:

- import a KiCad-style CSV file;
- recognize common column names such as `Reference`, `Value`, `Footprint`, and `Quantity`;
- normalize resistor and capacitor values such as `4k7`, `10K`, `0.1uF`, and `100nF`;
- group duplicate component rows;
- flag missing values, footprints, and references;
- export the cleaned BOM as JSON;
- search DigiKey Product Information V4 using two-legged OAuth;
- ask the OpenAI Responses API to double-check candidates and report missing requirements.

Imported files are parsed in the browser. A single component is sent to the local backend when you search. That component and its DigiKey candidates are sent to OpenAI only when you click **AI double-check**.

## Run it

Start the local server, open `http://localhost:4173`, and click **Load sample** or choose a KiCad CSV export.

If Node.js is installed, you can run the parser checks:

```powershell
node --test
```

```powershell
node server.js
```

## API configuration

Copy `.env.example` to a file named `.env` and fill in your keys. The server loads it automatically, and Git ignores it so real secrets are not committed. DigiKey sandbox credentials come from a DigiKey developer application subscribed to Product Information V4. The server uses sandbox unless `DIGIKEY_ENV=production` is set.

The AI review uses `OPENAI_API_KEY`, a strict JSON schema, and `store: false`. Its output is advice; it does not prove electrical compatibility or bypass import warnings.

## Planned milestones

1. Add deterministic electrical and package constraints.
2. Save projects and approved selections in SQLite.
3. Add quantity-aware pricing and candidate ranking.
4. Add a human approval step before creating a supplier cart.

## Why the design starts small

Supplier search and AI recommendations are only useful if the imported data is reliable. This prototype establishes a visible, testable input pipeline first. Electrical compatibility rules will remain deterministic; AI will help interpret incomplete notes and compare candidates.
