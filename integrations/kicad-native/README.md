# Native KiCad integration

This source patch adds Auto BOM to KiCad 10.0.6 as native wxWidgets controls:

- **Component Finder** is a docked Schematic Editor panel for natural-language DigiKey search and interactive symbol placement.
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
  git -C "$env:USERPROFILE\source\auto-bom-kicad" am $_.FullName
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
- Enter a component description and press Enter or click **Find Parts**. The panel keeps the request visible, shows progress, and displays native candidate cards with current DigiKey data.
- Click **Place in Schematic** when the result has a safe installed KiCad symbol and footprint. The symbol attaches to the cursor with supplier fields already populated.
- Open **Tools → Generate Bill of Materials...** for final sourcing. Use **Fill Missing Parts**, optionally clear **Use AI when filling missing part numbers**, review the updated rows, and export with KiCad's normal controls.

BOM completion reads the active schematic variant, skips DNP and BOM-excluded symbols, preserves existing part numbers, and applies accepted fields as one undoable schematic edit. Pressing **Export** before completion runs the same fill operation first and only continues automatically when every line is resolved.

## CAD asset behavior

Auto BOM resolves symbols, footprints, and standard 3D models from the KiCad libraries installed on the machine. Exact library symbols are used for known ICs; ordinary passives may use safe generic symbols plus value-appropriate standard footprints. Connectors and ICs are not assigned generic pinouts when an exact symbol cannot be established.

External CAD download/import is not implemented yet. DigiKey or third-party symbol, footprint, and 3D-model files are not fetched automatically. Candidates without a safe local symbol and footprint remain visible for review, but cannot be placed from the panel.

The KiCad source patch is distributed under KiCad's GPL terms.
