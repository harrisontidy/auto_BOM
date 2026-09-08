# Native KiCad integration

This integration adds a real docked **Auto BOM Assistant** WebView to the right side of KiCad's Schematic Editor. It is a source patch for KiCad 10.0.6 because KiCad 10 does not expose Schematic Editor panes through its external plugin API.

The pane loads `http://127.0.0.1:4173/?embedded=kicad`. AI and DigiKey credentials remain in the local Auto BOM server and are never compiled into KiCad.

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

The launcher starts the local Auto BOM server without opening a browser, prepares the custom-build DLL path, and starts the patched Schematic Editor.

The KiCad source patch is distributed under KiCad's GPL terms.
