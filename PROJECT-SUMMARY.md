# Auto BOM for KiCad

Auto BOM reduces the manual component searching and BOM work required when designing a board. It brings supplier inventory, component recommendations, symbol and footprint imports, and sourcing information directly into KiCad.

## Describe, compare, and place components

Describe the component you need inside KiCad—for example, a “3.3 V regulator, at least 1 A, small SMD package.” The component finder searches available supplier inventory and presents candidates to compare against your requirements, reducing the need to switch between supplier websites and external AI recommendations.

Once you choose a part with available, checked CAD, click **Place**. The tool imports the corresponding symbol and footprint, adds manufacturer and supplier information, and attaches the component to the cursor for placement in the schematic. Automatic EasyEDA symbol and footprint imports are supported today. Broader automatic CAD-model support is a development direction; downloading 3D models is not currently included.

## Fill missing BOM information

Schematics often contain passives and other generic components without manufacturer part numbers. Auto BOM scans for missing sourcing information and suggests parts from your chosen supplier based on component values, packages, and other requirements. Suggestions are presented for review before anything is applied, with alternative-part searches and unresolved results where a suitable match cannot be established.

The project supports JLCPCB/LCSC and DigiKey, including preferences for JLCPCB Basic parts and passive packages such as 0805. The goal is to make selecting purchasable components and completing a BOM part of the design workflow.

## What works today

- JLCPCB/LCSC sourcing, with a preference for Basic parts and DigiKey as an alternative supplier.
- Natural-language searches, plus direct searches for part numbers and common passive values. Results appear progressively while CAD downloads and review finish.
- Automatic EasyEDA symbol and footprint downloads, with checks on part identity and pin/pad numbering. Installed KiCad libraries provide another source of CAD.
- BOM suggestions that can be reviewed line by line, alternative-part searches, and explicit unresolved results when a match cannot be established.
- Passive mounting and size preferences, including 0805 SMT defaults and ceramic capacitors when an unspecified generic capacitor is being sourced.
- JLCPCB-oriented BOM and component placement CSV exports from the PCB editor.
- A Windows launcher that keeps the service console hidden and records startup errors.

## Current limits

This is a development prototype, not an official KiCad feature or a finished installer. It uses a local Node.js service and native KiCad patches. The build instructions currently target Windows with MSYS2; the native integration has not been validated across other operating systems.

The JLCPCB catalog connection uses a public website endpoint, not a guaranteed partner API. CAD availability varies. Imported footprints, pin mapping, electrical ratings, and assembly rotations still need review. Reported supplier stock can change before an order is placed.

The automated suite currently passes 127 tests. These include mocked supplier cases and do not prove live supplier availability or manufacturing correctness. Earlier live searches and native builds are described in the test reports. Full GUI regression testing of review, undo, save/reopen, and export is still incomplete, and acceptance of the repaired exports in JLCPCB's upload flow has not been verified. Passive preferences currently reset when the BOM dialog is recreated.

## Feedback

Feedback on the component-selection workflow, incomplete BOMs, CAD compatibility checks, and integration with KiCad's APIs would be useful. The full prototype can continue independently while smaller, generally useful pieces are discussed with upstream maintainers. No upstream acceptance is implied.

Contact: [Harrison Tidy](mailto:harrisontidy37@icloud.com).

Development has been substantially assisted by OpenAI Codex. This summary was adapted from Harrison's project description with Codex assistance.
