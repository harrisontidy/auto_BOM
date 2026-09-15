# Native KiCad integration

This source patch adds Auto BOM to KiCad 10.0.6 as native wxWidgets controls:

- **Component Finder** is a docked Schematic Editor panel for natural-language JLCPCB/LCSC or DigiKey search and interactive symbol placement.
- **Generate Bill of Materials...** includes **Fill Missing Parts** and **Use AI when filling missing part numbers** alongside KiCad's existing BOM table, preview, and exporter.

The panel does not use a WebView, and it contains no CSV importer or BOM table. Both native surfaces call the local Auto BOM service on `127.0.0.1:4173`; DigiKey and OpenAI credentials remain in `.env` and are never compiled into KiCad.

KiCad 10 does not expose docked Schematic Editor panes through its external plugin API, so this integration is maintained as a patch against the KiCad source tree.

## Local development checkout

The current development checkout is:

```text
C:\Users\harri\source\auto-bom-kicad
```

It is based on KiCad 10.0.6 and uses the branch `codex/component-finder-assistant`. KiCad source and build products stay outside this repository. The reproducible changes are stored as numbered patches in `patches` and should be applied in filename order.

## Recreate the checkout

Install KiCad's documented MSYS2/UCRT64 build dependencies, then run:

```powershell
git clone --depth 1 --branch 10.0.6 https://github.com/KiCad/kicad-source-mirror.git "$env:USERPROFILE\source\auto-bom-kicad"
git -C "$env:USERPROFILE\source\auto-bom-kicad" switch -c codex/component-finder-assistant
Get-ChildItem "C:\path\to\auto_BOM\integrations\kicad-native\patches\*.patch" | Sort-Object Name | ForEach-Object {
  if ($_.Name -match '^(000[789]|001[01])-') {
    git -C "$env:USERPROFILE\source\auto-bom-kicad" apply $_.FullName
  } else {
    git -C "$env:USERPROFILE\source\auto-bom-kicad" am $_.FullName
  }
}
```

## Build

From the Auto BOM repository, run:

```powershell
& ".\integrations\kicad-native\Build custom KiCad.ps1"
```

The script configures a release, DPI-aware build and builds the KiCad manager, Schematic Editor, PCB Editor, Gerber Viewer, supporting utilities, and required image/schema runtime assets. It uses `C:\Users\<name>\source\auto-bom-kicad` by default; another checkout and parallel-job count can be supplied explicitly:

```powershell
& ".\integrations\kicad-native\Build custom KiCad.ps1" `
  -KiCadSource "D:\source\auto-bom-kicad" `
  -ParallelJobs 8
```

The first build is large. Later native C++ changes normally rebuild only affected targets. JavaScript, server, DigiKey, and AI changes only require restarting the local Auto BOM service; they do not require recompiling KiCad.

## Run

To build the current Windows launcher from source, run `& ".\integrations\kicad-native\Build launcher.ps1"` from the repository root. Open the resulting `KiCad-AutoBOM-Launcher.exe`, or point a **KiCad - Auto BOM** shortcut at it. The generated executable is not committed. It invokes the local startup script with a process-scoped `RemoteSigned` policy, hides the console, and writes startup logs under `%LOCALAPPDATA%\auto_BOM\logs`. It does not change the machine's execution policy. The KiCad build and library prerequisites below still apply.

Start the custom KiCad manager and its local service with:

```powershell
& ".\Start KiCad.ps1"
```

To open a particular KiCad project:

```powershell
& ".\Start KiCad.ps1" -Project "C:\path\to\board.kicad_pro"
```

The launcher verifies the manager, editors, schemas, and image archive before starting. It starts the Auto BOM service without a browser, points the custom build at the stock KiCad 10 symbol, footprint, 3D-model, and template libraries, prepares the required MSYS2/build DLL paths, and opens the patched KiCad manager.

The normal **KiCad 10.0** desktop and Start-menu shortcuts can be retargeted to `Start KiCad.ps1`, with copies of the stock shortcuts retained as **KiCad 10.0 (Stock)**. This avoids modifying or mixing DLLs into the official KiCad installation.

## Use the integration

In the Schematic Editor:

- Press **Ctrl+Alt+A**, click the Component Finder toolbar button, or use **View → Panels → Component Finder** to show or hide the finder.
- Enter a component description and press Enter or click **Find Parts**. The panel keeps the request visible, shows progress, and displays native candidate cards with data from the selected supplier. JLCPCB / LCSC is the default and requires no sourcing key.
- Click **Place in Schematic** when the result has a safe installed KiCad symbol and footprint. The symbol attaches to the cursor with supplier fields already populated.
- Open **Tools → Generate Bill of Materials...** for final sourcing. Use **Fill Missing Parts**, optionally clear **Use AI when filling missing part numbers**, review the updated rows, and export with KiCad's normal controls.

BOM completion reads the active schematic variant, skips DNP and BOM-excluded symbols, and opens a review dialog showing current fields, proposed fields, stock, library type, CAD source and unresolved reasons. Select the lines to apply; unchecked lines remain unchanged. Existing fields are preserved and accepted fields form one undoable schematic edit. **Cancel search** abandons the client request without applying proposals; supplier work already started may still finish on the service. **Export** exports the current table without starting sourcing.

## CAD asset behavior

Auto BOM resolves symbols, footprints, and standard 3D models from the KiCad libraries installed on the machine. Exact library symbols are used for known ICs; ordinary passives may use safe generic symbols plus value-appropriate standard footprints. Connectors and ICs are not assigned generic pinouts when an exact symbol cannot be established.

LCSC results now automatically import EasyEDA symbols and footprints. Run `Setup EasyEDA.ps1` once to install the pinned converter. Placement and BOM completion register each downloaded `AutoBOM_C...` library using KiCad's library manager. Existing schematic symbols and assigned footprints are preserved. Imported pairs are checked for matching C-number, MPN, library links, and pin/pad numbering. Import failures are displayed in the finder and installed libraries provide a fallback when available. 3D-model downloads are not included.

Both native workflows default to **Prefer JLCPCB Basic parts**. Exact assigned part numbers are preserved even when they are Extended parts.

The custom editor now runs on this machine after the user disabled Smart App Control. Native tests verified automatic BOM completion, EasyEDA footprint assignment, newly imported symbol placement, and copy/paste with supplier metadata preserved. See `../../SOURCING-TEST-REPORT.md` for results and remaining limitations.

The KiCad source patch is distributed under KiCad's GPL terms.

Patch 0006 adds supplier selection, LCSC field mapping, JLCPCB stock checks, and automatic EasyEDA imports. The finder places one component at a time without a quantity control; BOM completion counts the schematic's actual references. Apply it after 0005 and rebuild the Schematic Editor. The BOM dialog has its own supplier selector and saves LCSC numbers in the LCSC Part # field.

Patch 0007 adds per-line BOM review, cancellation and explicit loading of installed symbol libraries before placement. It is a plain diff, applied with `git apply` after 0006. The optional `../kicad-http` prototype begins the separate stock-KiCad lookup path.

Patch 0008 adds progressive Component Finder results. Supplier matches appear before CAD and review finish, with pending labels and placement disabled until that candidate has CAD and the review has returned. Search again supersedes the old job; result events are checked against the current search generation. Apply this plain diff after 0007. The original synchronous search endpoint remains available for scripts.

Patch 0009 adds alternative selection inside BOM review, verified/unknown specification details, original schematic pin metadata, and combined stock-demand checks before applying selected lines. Apply this plain diff after 0008. Select a review row and choose **Find alternatives for selected line** to search without rerunning the whole BOM. Original electrical values and packages remain constraints. Existing assigned part numbers must be cleared in the BOM table before replacement; assigned footprints are preserved. See `../../BOM-ALTERNATIVES-REPORT.md` for validation and pending interface tests.

Patch 0010 handles null CAD/verification data in unresolved review rows and adds passive mounting/size defaults. Apply with `git apply` after 0009. Unspecified resistors and generic capacitors default to 0805 SMT; capacitors require ceramic catalog evidence. Choose SMT, through-hole, or no default, and select the SMT size separately. Explicit footprints, part numbers and polarized/other specified capacitor technologies take priority. Through-hole parts still require footprint geometry verification. Current selections reset to SMT/0805 when the dialog is recreated.

Patch 0011 changes PCB Editor **Fabrication Outputs → Bill of Materials** to JLCPCB comma-separated CSV with Comment, Designator, Footprint and LCSC Part #. It reads saved footprint sourcing fields and groups only parts with matching value, footprint, MPN and supplier ID. DNP/BOM exclusions follow the active variant. **Component Placement** CSV uses JLCPCB headers and millimetres with proper string escaping; the interactive dialog defaults to combined CSV, excludes DNP/BOM-excluded parts, and does not mirror bottom X. Gerber/ASCII placement output remains available. Rebuild `pcbnew` after applying the plain patch. Updating PCB fields from the schematic before export is still required if sourcing changed. Import acceptance and part rotations must be checked in the assembly preview.
