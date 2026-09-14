# Passive defaults and null review fix

2026-09-12

The review crash `[json.exception.type_error.306] cannot use value() with null` occurred because unresolved BOM rows contained `kicadAssets: null`, which native review accessed as an object. The service now returns object-shaped optional CAD and verification fields; native review also normalizes null/missing fields for older responses.

Native review now offers separate mounting and SMT size controls. Defaults are SMT/0805 for unspecified resistors and generic capacitors. Capacitors require ceramic/MLCC catalog evidence. Through-hole and no-default options are available. Explicit parts, footprints and technology requests take priority. Unknown capacitor technology stays unresolved; unsupported through-hole geometry is not invented. Settings currently reset when the dialog is recreated.

Validation: 127 automated tests passed, including empty optional data, omitted package completion, configurable size, mounting mismatch rejection, polarized capacitor preservation and ceramic evidence checks. A live no-AI test completed all six blinker passives with blank footprints:

| Value | LCSC part | Footprint |
|---|---|---|
| 10k | C17414 | R_0805_2012Metric |
| 68k | C17801 | R_0805_2012Metric |
| 1k | C17513 | R_0805_2012Metric |
| 100nF | C49678 | C_0805_2012Metric |
| 10uF | C15850 | C_0805_2012Metric |
| 10nF | C1710 | C_0805_2012Metric |

Stock reflects the live test, not future availability. These defaults establish mounting/package/technology preferences, not unstated voltage, power, dielectric or tolerance requirements.

The final custom Schematic Editor build compiled and linked successfully after the user saved and closed KiCad. The updated service is running. A live HTTP test completed a resistor and capacitor with omitted footprints and returned a normal unresolved row for a resistor with no electrical value. Foreground workflow testing remains separate from automated service validation.
