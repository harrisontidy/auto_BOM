# auto_BOM

**An AI design assistant for finding parts, building a circuit, and finishing your BOM in KiCad.**

auto_BOM now feels more like working with a design assistant than filling in a search form. Ask about a part or circuit, talk through the requirements, review supplier options, and place the result on the schematic. When you are ready to build out the design, ask for a typical application circuit, then review and place it. Existing schematics can get the same treatment through BOM completion, with each suggested change available to inspect before applying it.

This is a working prototype built around patched KiCad 10.0.6 and a local Node.js service. The native assistant requires a custom Windows build and appears inside KiCad's Schematic Editor.

## A quick tour

Search for a part in plain language. In this demo run, the ESP32-S3 search took just a few seconds, and the assistant showed the supplier match and its stock, price, package, and CAD details.

![ESP32-S3 search result in the Design Assistant](docs/images/esp32-search.png)

Once you have a suitable part, ask for its typical application circuit. This 3.3 V CAN transceiver circuit was generated in under 10 seconds in the demo run. The assistant shows the proposed circuit and components before you place them.

![CAN transceiver application circuit ready to place](docs/images/application-circuit-ready.png)

Place the application circuit into the schematic, then carry on with your design.

![Placed CAN transceiver circuit in the schematic](docs/images/application-circuit-placed.png)

The Design Assistant stays beside your schematic while you search, ask follow-up questions, and place parts.

![The Design Assistant open beside a demo schematic](docs/images/design-assistant.png)

Finally, open the BOM editor and choose **Fill Missing Parts**. The before-and-after view shows supplier and manufacturer part details filled in for the parts in the schematic.

| Before filling missing parts | After filling missing parts |
| --- | --- |
| <img src="docs/images/bom-before.png" alt="BOM before filling remaining part numbers" width="700"> | <img src="docs/images/bom-filled.png" alt="BOM after filling part numbers and supplier details" width="700"> |

The timing above is from this demo run. Search and circuit-generation times vary with the connection, supplier response, and whether a circuit recipe has already been generated.

## What you can do

### Find a part by describing the job

Open the **Design Assistant** and ask for something like:

> Find a small 3.3 V CAN transceiver to connect a microcontroller to an external CAN bus.

You can ask follow-up questions, change a requirement, or talk through a circuit idea before searching. Results include supplier stock, price, package, and the reasons a part was suggested. The assistant normally presents one recommendation or up to three options.

- Search **JLCPCB / LCSC** or **DigiKey**, with a preference for JLCPCB Basic parts enabled by default.
- Import symbols and footprints from EasyEDA for LCSC parts, or SnapMagic for DigiKey parts. Compatible installed KiCad libraries are also used.
- Click **Place in Schematic** when CAD is ready. Manufacturer and supplier part numbers, pricing, product links, and datasheets come with the symbol.

Direct search also handles exact LCSC C-numbers, common value/package passives, and simple relay requests without AI. Stock is checked again on each search.

### Start from a typical application circuit

A recommended part can be the starting point for a circuit, too. Choose **Generate typical application circuit** to prepare a draft from its datasheet, then review the component list and design notes before placing it.

The generator supports common regulator, op-amp, timer, and digital-IC support circuits. It can adapt values to your requested operating point, check the arithmetic, and place supporting components with wires and labels as a movable block. Validated recipes are cached, so repeating the same request is much faster.

This feature is experimental. Some parts and datasheets are unsupported, and a generated circuit still needs engineering review. Pin and connectivity checks help catch mistakes; they do not establish that a design will work. See [application generation and its limits](docs/ASK.md#generate-typical-application-circuit).

### Finish the BOM you already have

In **Tools → Generate Bill of Materials...**, click **Fill Missing Parts**. auto_BOM reads the active schematic, groups quantities, and looks for parts that match the existing values and packages.

Review proposed changes line by line, search for alternatives, and select which rows to apply. Accepted changes form one undoable edit. Existing part numbers and assigned footprints are preserved, and DNP and BOM-excluded parts are skipped. Unresolved lines stay visible for review.

Unspecified resistors and generic capacitors default to 0805 SMT, with controls for other sizes or through-hole parts. Explicit part numbers, footprints, and component requirements take priority.

**Export** exports the current table. It does not start a new sourcing search. The patched PCB Editor also includes JLCPCB BOM and placement CSV output. Update the board from the schematic after sourcing changes, then check the uploaded parts and rotations in the assembly preview.

## Try it

### Local service and browser interface

Install a recent Node.js LTS release, then run from the repository root:

```powershell
npm install
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
npm start
```

If you already have a `.env`, keep it. Open [localhost:4173](http://localhost:4173) for the standalone browser interface. It is useful for trying searches and conversations; schematic placement and the integrated BOM workflow require the custom KiCad build.

Choose your connection in **Connection & sourcing** in the browser, or **Settings** in the native assistant:

| Feature | What you need |
| --- | --- |
| JLCPCB / LCSC catalog search | No supplier API key. This is the default supplier. |
| Assistant through your Codex account | An installed Codex app/CLI with a signed-in account. Uses your Codex allowance. |
| Assistant through the OpenAI API | `OPENAI_API_KEY` in `.env`. API usage is billed separately. |
| DigiKey search | `DIGIKEY_CLIENT_ID` and `DIGIKEY_CLIENT_SECRET` in `.env`. Use `DIGIKEY_ENV=production` for live catalog data. |
| EasyEDA CAD imports | Run `& ".\Setup EasyEDA.ps1"` once. |
| DigiKey CAD imports | Connect SnapMagic through assistant Settings or the browser's connection link. |

Assistant model and reasoning choices live in the interface. Standalone AI-assisted search and BOM completion use the API configuration, including `OPENAI_MODEL`. The app does not silently switch from Codex to API billing. Codex requests currently use Fast mode, which consumes allowance at the higher Fast-mode rate.

### Inside KiCad

Install KiCad 10 with its standard libraries and prepare the patched source checkout and MSYS2/UCRT64 build dependencies using the [native integration guide](integrations/kicad-native/README.md). Then build and launch:

```powershell
& ".\integrations\kicad-native\Build custom KiCad.ps1"
& ".\Start KiCad.ps1"
```

The first build is large. The launcher starts the local service and opens the custom KiCad manager with the required libraries and runtime paths.

In the Schematic Editor, press **Ctrl+Alt+A** to open the assistant. Enter sends a message; Shift+Enter adds a new line. Use **Settings** to choose your connection and supplier. Open **Tools → Generate Bill of Materials...** when you are ready to complete the BOM.

The [small sourcing demo](examples/sourcing-demo/README.md) is a useful first project.

## A few things to know

- **Supplier data is a snapshot.** JLCPCB results use reported assembly stock, not LCSC warehouse or presale stock. Prices are component estimates and exclude assembly fees, shipping, and taxes. Board counts and assembly attrition are not inferred from the schematic.
- **CAD is checked, but still needs a look.** Imported libraries are checked for part identity, symbol/footprint links, and pin/pad agreement. Review geometry and electrical details against the datasheet. Downloaded 3D models are not included.
- **Keep imported libraries with your project.** Downloads are cached under `%LOCALAPPDATA%/autoBOM`. Copy the libraries and update paths when sharing or moving a design.
- **Online services can fail.** The JLCPCB catalog and SnapMagic connections use website endpoints that may change. Failures are shown rather than silently switching suppliers.
- **The app runs locally, but requests use online services.** The service listens on `127.0.0.1:4173`. Credentials stay out of the KiCad build and `.env` is ignored by Git. Conversation history is temporary and is sent to the selected AI connection with each question.

## Development

The native wxWidgets interface talks to the local Node.js service, which handles supplier searches, AI requests, CAD imports, and proposed BOM changes. The browser interface uses the same backend.

```powershell
npm test
```

The test suite covers search constraints, supplier handling, CAD validation, BOM completion, conversations, and circuit generation. For opt-in checks against the running service and configured providers, run `node scripts/live-sourcing-check.mjs`.

Backend changes need a service restart. Changes to the native interface need a KiCad rebuild. Automated checks and recorded netlist tests cover more ground than the current native UI checks; see the reports for what was actually exercised.

- [Repository guide](docs/REPOSITORY.md): source layout and developer utilities.
- [Native integration](integrations/kicad-native/README.md): builds, launchers, and the patch sequence.
- [Assistant and circuit generation](docs/ASK.md): connections, behavior, and known limits.
- [Test reports](docs/testing/): recorded checks and remaining validation work.
- [Circuit generation benchmarks](docs/application-fast-path-benchmark-2026-09-20.md): measured cold and cached timings.

The KiCad source patches are distributed under KiCad's GPL terms.
