# JLCPCB export repair

2026-09-12

The supplied legacy PCB BOM used semicolons, extra trailing fields and a blank supplier column. The placement file used generic KiCad column names. JLCPCB rejected their combined processing.

Native changes in patch 0011:
- PCB BOM emits properly escaped comma-separated CSV with stable JLCPCB column names and saved LCSC sourcing IDs. It supports existing LCSC Part #, LCSC PN, LCSC Part and LCSC aliases. Parts with different MPNs or LCSC IDs are not grouped together. DNP and BOM exclusions use the current variant.
- Placement CSV emits Designator, Comment, Footprint, Mid X, Mid Y, Rotation, Layer. Coordinates are always millimetres and string fields escape embedded quotes. The interactive dialog starts with combined CSV, no bottom-X mirroring, and DNP/BOM exclusions enabled. Users can still change footprint inclusion options.
- The custom PCB editor compiled and linked successfully after KiCad was closed.

Corrected copies of the two supplied CSVs were created beside the originals as mytest-JLCPCB-BOM.csv and mytest-JLCPCB-CPL.csv. Nine references match uniquely between files. All nine LCSC IDs were recovered from the saved schematic and confirmed present in the saved board. Coordinates and rotations were preserved and checked against the board footprint positions, including KiCad's inverted exported Y coordinate. Outputs were parsed again and rendered for inspection. No part substitutions or rotation corrections were made.

Limits: the new native export menus have not been exercised through the GUI in this turn. The files have not been uploaded to JLCPCB by the agent, so processing acceptance is unverified. Imported EasyEDA rotations/polarities still need assembly-preview verification. The XT60 is a through-hole connector; whether the chosen assembly service will fit it must be resolved in that order. Native exports require PCB sourcing fields to be updated from the schematic when those fields change.

Requirements checked against JLCPCB's official BOM and CPL guide: https://jlcpcb.com/help/article/how-to-generate-bom-and-centroid-files-from-kicad-8
