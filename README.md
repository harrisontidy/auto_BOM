# auto_BOM

See [the project summary](PROJECT-SUMMARY.md) for the latest features, validation limits, and contact information.

`auto_BOM` adds component sourcing and BOM completion directly to KiCad. Describe a component in plain language, compare current JLCPCB / LCSC or DigiKey results, and place a compatible part into the schematic. When the design is ready, KiCad's existing **Generate Bill of Materials** dialog can fill missing manufacturer and supplier part numbers before exporting.

## Current prototype

The KiCad integration has two native workflows:

### Component Finder

- Opens as a docked wxWidgets panel in the Schematic Editor. It is not an embedded webpage.
- Accepts requests such as `efficient 5 V 3 A buck regulator` or `10 kOhm 0805 resistor`.
- Uses AI to turn natural language into concise requirements, then searches JLCPCB / LCSC by default, or DigiKey Product Information V4.
- Shows in-stock candidates with manufacturer part number, supplier part number, stock, unit price, package, and a short recommendation.
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

## Sourcing options

The native Component Finder and BOM dialog now have a **JLCPCB / LCSC** or **DigiKey** selector. JLCPCB / LCSC is the default. The browser finder remembers its selection locally. The finder places one component at a time; copy and paste for more. BOM completion uses the actual grouped quantity in the current schematic.

The finder handles exact LCSC C-numbers, simple value/package passives (`10k 0805 resistor`), and simple relay requests (`10A relay with 5V coil`) without AI. More detailed requests retain AI interpretation and specification review. Language interpretations are reused briefly, but stock is checked again on every search. The finder automatically downloads CAD for a shortlist of up to three candidates while AI review runs concurrently. BOM completion still operates on the full sourcing results.

Relay searches use JLCPCB's Power Relays category and verify catalog switching current, explicit coil voltage and contact form. When AC/DC load voltage is specified, the current and voltage must appear together in a suitable contact rating; independent maximum ratings are insufficient. Unspecified coil voltage and load-rating limitations are displayed for review. Catalog checks are not a replacement for the chosen part's datasheet and load-specific ratings.

**Prefer JLCPCB Basic parts** is enabled in both workflows. It searches the Basic catalog first, then falls back to Extended parts if no matching, in-stock Basic part is found. Exact C-numbers and existing manufacturer selections remain authoritative. Clear the checkbox to search without the Basic preference.

JLCPCB / LCSC uses the public JLCPCB assembly parts catalog without an API key. It checks reported JLCPCB stock, excludes insufficient stock and order minima above the requested quantity, and shows Basic/Extended library type. Prices are USD component estimates, excluding assembly/setup fees, shipping, and taxes. LCSC warehouse stock and presale stock are not substituted for JLCPCB stock. Confirm availability in the final assembly order.

The website catalog endpoint is not the credentialed LCSC partner API and has no guaranteed interface or availability. Failures are reported; the app never silently falls back to DigiKey. Requests are serialized and searches are bounded to two pages per query.

An exact **C-number**, such as `C2040`, can be searched without an OpenAI key. Natural-language requests still use the existing OpenAI configuration. Exact C-numbers are matched exactly, not as substrings.

BOM completion writes **LCSC Part #**, **JLCPCB Stock**, **JLCPCB Unit Price**, and **JLCPCB Product URL**. Existing DigiKey fields remain separate. Existing LCSC assignments are rechecked during completion; unavailable or conflicting selections stay unresolved rather than being replaced. KiCad's normal BOM exporter is retained: review its column mapping against JLCPCB's upload requirements. Board quantities and assembly attrition are not inferred from the schematic.

Sources: [JLCImport catalog client](https://github.com/jvanderberg/kicad_jlcimport/blob/main/src/kicad_jlcimport/easyeda/api.py), [LCSC partner API](https://www.lcsc.com/agent).

## API configuration

Copy `.env.example` to `.env`. LCSC/JLCPCB sourcing needs no key; add an OpenAI key for natural-language interpretation. DigiKey credentials are optional and only used when DigiKey is selected. `.env` is ignored by Git and the local server only listens on `127.0.0.1`.

```text
SOURCING_SUPPLIER=lcsc
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
Native KiCad panel ── component request ──► local service ──► OpenAI + selected supplier
Native KiCad BOM dialog ── schematic BOM ─► local service ──► completed fields
```

Credentials stay in the local `.env` file and are never compiled into KiCad. A small standalone browser finder remains available at `http://localhost:4173` for backend development, but schematic placement and integrated BOM completion require the patched KiCad build.

LCSC results automatically download EasyEDA symbols and footprints using the pinned [easyeda2kicad converter](https://github.com/uPesy/easyeda2kicad.py). Run `Setup EasyEDA.ps1` once on a new installation; setup is already done on this computer. No EasyEDA API key is required. Files are cached under `%LOCALAPPDATA%/autoBOM/easyeda-v1`, with a separate `AutoBOM_C...` library per part. Placement and BOM completion register the downloaded libraries in KiCad. Existing schematic symbols and assigned footprints are preserved during BOM completion; downloaded footprints fill empty footprint fields.

The importer verifies the LCSC number, manufacturer part number, symbol-to-footprint link, and pin/pad number correspondence before exposing the pair for placement. These checks do not verify every geometric or electrical detail against a datasheet. Failures are shown in the finder; compatible installed KiCad assets remain available as fallback. Cached files are revalidated before reuse. 3D-model downloads are not included. Keep the cached libraries when sharing/moving projects, or copy them and update the library paths.

Configuration overrides: `EASYEDA_PYTHON` selects the converter's Python interpreter, `EASYEDA_LIBRARY_DIR` selects its library directory, and `EASYEDA_DOWNLOADS=false` uses installed KiCad libraries only. The converter is installed in an isolated `.runtime/easyeda` environment and does not modify KiCad's Python packages.

Run `npm test` for offline checks. `node scripts/live-sourcing-check.mjs` runs opt-in integration checks against the running local service, JLCPCB, configured DigiKey credentials, and configured AI service.

## Development

Run the local service and automated checks with Node.js:

```powershell
npm start
npm test
```

Changes to the Node service, AI logic, or DigiKey logic do not require a KiCad rebuild. Changes to the native panel or BOM dialog do.

## Planned milestones

1. Add 3D-model imports and additional CAD providers.
2. Add more deterministic electrical and package constraints.
3. Save projects and approved selections in SQLite.
4. Create a DigiKey cart from the approved final BOM.
