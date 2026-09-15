# Standard KiCad lookup prototype

This optional integration uses KiCad's existing HTTP-library interface. It does not require the custom editor. The Auto BOM service must be running, and KiCad's standard symbol/footprint libraries must be installed and enabled.

1. Start Auto BOM and search for a part in its browser interface.
2. In standard KiCad, open Preferences > Manage Symbol Libraries. Add `AutoBOM.kicad_httplib` from this folder as an HTTP library.
3. Open the normal symbol chooser and browse the Auto BOM supplier category. Reopen/refresh the chooser after new searches; metadata can be cached for 30 seconds.

The service saves up to 500 recent search results with installed CAD matches in `.runtime/http-library.json`. It retains them across service restarts. Entries are search candidates, not approved circuit matches. Stock is explicitly labeled as a snapshot with a timestamp; searching again refreshes it. Library reads do not contact a supplier or use AI.

Downloaded EasyEDA libraries are excluded from this first prototype because stock KiCad needs those additional libraries registered separately. The prototype also does not implement the docked finder, live schematic BOM editing, or automatic field-change review. Those still use the native integration.

Validation: automated persistence/field-format tests and live HTTP endpoint checks passed. The stock KiCad symbol chooser has not yet been tested with this configuration.

Protocol reference: [KiCad HTTP libraries](https://dev-docs.kicad.org/en/apis-and-binding/http-libraries/index.html).
