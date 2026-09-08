# auto_BOM

`auto_BOM` adds component sourcing and BOM completion directly to KiCad. Describe a component in plain language, compare current DigiKey results, and place a compatible part into the schematic. When the design is ready, KiCad's existing **Generate Bill of Materials** dialog can fill missing manufacturer and DigiKey part numbers before exporting.

## Current prototype

The KiCad integration has two native workflows:

### Component Finder

- Opens as a docked wxWidgets panel in the Schematic Editor. It is not an embedded webpage.
- Accepts requests such as `efficient 5 V 3 A buck regulator` or `10 kOhm 0805 resistor`.
- Uses AI to turn natural language into concise requirements, then searches DigiKey Product Information V4.
- Shows in-stock candidates with manufacturer part number, DigiKey part number, stock, unit price, package, and a short recommendation.
- Resolves symbols, footprints, and standard 3D models from the KiCad libraries installed on this computer.
- Places a selected result on the cursor and writes its manufacturer, supplier, pricing, product URL, and datasheet fields into the symbol.
- Uses exact installed symbols for known ICs and safe generic symbols for ordinary passives. It does not invent IC pinouts.

### BOM completion

- Lives inside KiCad's existing **Tools → Generate Bill of Materials...** dialog.
- Adds **Fill Missing Parts** and **Use AI when filling missing part numbers** controls to the normal BOM editor and exporter.
- Reads the open schematic directly, respects the active variant and BOM/DNP exclusions, and preserves part numbers already chosen by the designer.
- Searches missing lines automatically, fills the schematic fields as one undoable edit, refreshes KiCad's BOM preview, and then uses KiCad's normal export formats.
- Can run automatically when **Export** is pressed; unresolved lines stay visible for review instead of being silently exported.

The component panel contains only the finder. BOM tables, CSV import controls, and final checks are kept in KiCad's normal BOM window.

## Run it in KiCad

The first build is large. Build the patched KiCad applications and required runtime files once:

```powershell
& ".\integrations\kicad-native\Build custom KiCad.ps1"
```

Then launch the integrated KiCad manager:

```powershell
& ".\Start KiCad.ps1"
```

If setup has retargeted the regular **KiCad 10.0** desktop or Start-menu shortcut, opening that shortcut runs the same launcher. The original stock shortcut can be kept alongside it as **KiCad 10.0 (Stock)**.

In the Schematic Editor, press **Ctrl+Alt+A**, click the Component Finder toolbar button, or use **View → Panels → Component Finder**. Type a request and press Enter or click **Find Parts**. When a candidate has an installed symbol and footprint, click **Place in Schematic** and place it normally on the sheet.

Open **Tools → Generate Bill of Materials...** to complete missing part numbers and export the finished BOM.

Build, patch, and launcher details are in [integrations/kicad-native/README.md](integrations/kicad-native/README.md).

## API configuration

Copy `.env.example` to `.env` and add the credentials for your DigiKey developer application and OpenAI account. `.env` is ignored by Git and the local server only listens on `127.0.0.1`.

```text
DIGIKEY_CLIENT_ID=...
DIGIKEY_CLIENT_SECRET=...
DIGIKEY_ENV=production
OPENAI_API_KEY=...
```

DigiKey sandbox credentials are useful for authentication testing, but the sandbox catalog contains sample data. Live price and stock results require an approved production application subscribed to Product Information V4 and `DIGIKEY_ENV=production`.

`OPENAI_MODEL` defaults to `gpt-5-mini`. AI interprets requests and reviews meaningful choices; deterministic checks enforce common passive values and packages and prevent approximate DigiKey matches from replacing exact manufacturer part-number searches. The circuit designer still needs to verify electrical compatibility against the datasheet.

## Architecture

The patched KiCad UI communicates with a local Node.js service at `http://127.0.0.1:4173`:

```text
Native KiCad panel ── component request ──► local service ──► OpenAI + DigiKey
Native KiCad BOM dialog ── schematic BOM ─► local service ──► completed fields
```

Credentials stay in the local `.env` file and are never compiled into KiCad. A small standalone browser finder remains available at `http://localhost:4173` for backend development, but schematic placement and integrated BOM completion require the patched KiCad build.

CAD resolution currently uses libraries already installed with KiCad. The prototype does not yet download or import external symbol, footprint, or 3D-model files from DigiKey or third-party CAD providers. A result without a safe installed symbol and footprint can be reviewed and opened on DigiKey, but its **Place in Schematic** button remains disabled.

## Development

Run the local service and automated checks with Node.js:

```powershell
npm start
npm test
```

Changes to the Node service, AI logic, or DigiKey logic do not require a KiCad rebuild. Changes to the native panel or BOM dialog do.

## Planned milestones

1. Import verified manufacturer CAD assets when KiCad has no matching library part.
2. Add more deterministic electrical and package constraints.
3. Save projects and approved selections in SQLite.
4. Create a DigiKey cart from the approved final BOM.
