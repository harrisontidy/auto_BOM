# Auto BOM for KiCad

I started this as a personal project to make it easier to choose parts and get a small PCB ready for JLCPCB assembly. The aim is to spend less time moving between supplier websites, CAD downloads, and the BOM table.

The prototype adds a component finder and BOM completion to a custom KiCad build. You can describe a part, compare in-stock candidates, and place a selected symbol with its sourcing information. You can also draw a schematic with ordinary symbols, then review suggestions for missing part numbers and footprints.

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

Development and this summary were assisted by OpenAI Codex. This page describes the independent prototype; it is not a human-written submission to KiCad's issue tracker.
