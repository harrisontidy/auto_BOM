# Native KiCad integration

This integration adds a native **Component Finder** pane and a separate **Complete BOM with DigiKey** window to KiCad's Schematic Editor. It is a source patch for KiCad 10.0.6 because KiCad 10 does not expose Schematic Editor panes through its external plugin API.

The finder loads `http://127.0.0.1:4173/?embedded=kicad`; the BOM window uses `?embedded=kicad&view=bom`. AI and DigiKey credentials remain in the local Auto BOM server and are never compiled into KiCad.

## Local development checkout

The current development checkout is:

```text
C:\Users\harri\source\auto-bom-kicad
```

It is based on KiCad 10.0.6 and uses the branch `codex/component-finder-assistant`. KiCad's source and build products are intentionally kept out of this repository. The reproducible source changes are the numbered patches in `patches`; apply them in order.

## Recreate the checkout

Install KiCad's documented MSYS2/UCRT64 build dependencies, then run:

```powershell
git clone --depth 1 --branch 10.0.6 https://github.com/KiCad/kicad-source-mirror.git "$env:USERPROFILE\source\auto-bom-kicad"
git -C "$env:USERPROFILE\source\auto-bom-kicad" switch -c codex/component-finder-assistant
Get-ChildItem "C:\path\to\auto_BOM\integrations\kicad-native\patches\*.patch" | Sort-Object Name | ForEach-Object {
  git -C "$env:USERPROFILE\source\auto-bom-kicad" am $_.FullName
}
```

Build Eeschema, PCB Editor, and their required runtime assets:

```powershell
& ".\integrations\kicad-native\Build custom KiCad.ps1"
```

The first build is large. Changes to the Auto BOM HTML, CSS, JavaScript, server, DigiKey logic, or AI logic do not require rebuilding KiCad. Refreshing the WebView or reopening Eeschema loads those changes.

## Run

```powershell
& ".\Start Auto BOM in KiCad.ps1"
```

To open a particular schematic:

```powershell
& ".\Start Auto BOM in KiCad.ps1" -Schematic "C:\path\to\board.kicad_sch"
```

The launcher starts the local Auto BOM server without opening a browser, prepares the custom-build DLL path, and starts the patched Schematic Editor. The custom build is configured as per-monitor DPI aware so KiCad and its embedded browser stay sharp at Windows display scaling above 100%.

Inside the Schematic Editor:

- Press **Ctrl+Alt+A**, click the Component Finder toolbar button, or use **View → Panels → Component Finder** to show or hide the finder.
- Use **Tools → Complete BOM with DigiKey...** to scan the current schematic and write missing manufacturer part number, DigiKey part number, datasheet, and footprint fields back to its symbols.
- Placing a search result uses an exact installed KiCad library symbol and its assigned footprint when available. Common passives use safe standard symbols and footprints. Unknown IC pinouts are never replaced with an invented generic symbol.

The KiCad source patch is distributed under KiCad's GPL terms.
