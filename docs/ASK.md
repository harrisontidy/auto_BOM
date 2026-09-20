# Component conversations

Ask adds a conversation beside the existing component-search workflow. It is intended for requirements such as “an easy-to-solder MCU with Wi-Fi, Bluetooth, SPI and a display interface,” where clarification and tradeoffs matter as much as matching a value or package.

The native **Design Assistant** provides one **Ask for parts** conversation. Ask questions, discuss circuit ideas, or request parts in the bottom composer; Enter sends and Shift+Enter inserts a newline. Stop cancels the request while preserving the draft. The header **Settings** dialog contains connection, supplier, Basic preference, model and reasoning controls. Ordinary questions return answers without searching. Suggestions appear below the answer in the same scroll surface, with one confidently reviewed choice or at most three distinct options. CAD diagnostics are collapsed; review concerns remain visible. Placement still requires selecting a candidate in KiCad. BOM alternatives retain their constrained search entry point.

## Connections

- **Codex account:** the installed Codex App Server manages ChatGPT sign-in and token refresh. The application never reads authentication files or copies tokens. Both planning and candidate review use this connection and consume Codex allowance. No automatic fallback to API billing occurs. Sign in to Codex first if no account is available. `CODEX_EXECUTABLE` optionally selects the executable.
- **OpenAI API:** uses `OPENAI_API_KEY`; API usage is billed separately. Chat planning and candidate review use the selected model/reasoning. Standalone part search retains `OPENAI_MODEL`.

**Latest available** is resolved from the connection's model catalog when sending, using the newest GPT generation and preferring its full model. **Auto reasoning** uses that model's recommended default; API mode uses medium. Codex's supported effort levels come from its model metadata, excluding autonomous-delegation Ultra mode from this bounded assistant. API mode offers conservative low/medium/high choices, with documented extra-high/maximum options for Astra. Unavailable models and unsupported levels produce an error instead of silently changing providers or models. Higher levels can take longer and use more allowance. Model metadata is cached for one minute, and explicit selections last until the panel/page or connection changes.

The Codex adapter creates temporary structured-output requests with environment access disabled, read-only sandboxing and no supported host actions. It closes its owned process after completion, cancellation or timeout. Model availability still depends on the signed-in account. These connection choices do not switch the model running the Codex task used to develop this repository.

## Request path

1. The UI submits the question, prior conversation and supplier preferences to `/api/ask/jobs`.
2. The planner returns an answer and a structured search plan. It must retain earlier requirements unless the user changes them, distinguish assumptions, and identify the component being requested rather than its application.
3. The shared search pipeline retrieves supplier candidates, checks catalog evidence, prepares CAD and reviews the shortlist. The plan is reused directly, avoiding a second interpretation call.
4. The UI polls the existing job endpoint and shows progressive results. Final search context is retained for follow-up questions.

`services/ask.js` handles planning and orchestration; `services/codex-provider.js` implements the documented Codex JSON-RPC transport. `services/component-search.js` remains the shared search/CAD implementation. Patch 0013 supplies the native controls.

## Evidence and limits

MCU queries are no longer redirected to display categories just because they mention a display. Catalog checks reject obvious category conflicts, insufficient GPIO totals and explicitly unsupported capabilities. Missing Wi-Fi, Bluetooth or DSI attributes remain unknown. A total GPIO count does not establish how many pins remain after peripheral assignments. MIPI CSI does not verify DSI.

This version does not browse or read full datasheets. Candidate review uses supplied catalog evidence; it can highlight uncertainty, not certify an electrical design. An empty search does not prove that no suitable part exists. Hard-to-solder packages and module pin availability still need checking. Natural-language requirement retention is model-dependent and should be reviewed.

Conversation history lasts only while the panel/page remains open and is bounded to ten completed exchanges. Starting a new conversation or reloading clears it. It is sent to the selected AI connection on each question. Supplier requests, catalog limits and CAD conversion can still make uncached searches slow. Ask is deliberately more expensive than direct search for a simple resistor.

## Validation

DigiKey CAD uses the selected part number and manufacturer to find an exact SnapMagic model, request a KiCad V6+ ZIP, validate it, and import/cache the symbol and footprint. Connect at `http://localhost:4173/snapmagic`, also available in native Settings. Passwords are forwarded to SnapMagic and never saved; Windows encrypts the session using DPAPI for the current user under LocalAppData/autoBOM. Disconnect removes the saved session. Expired sessions require signing in again. Non-Windows sessions are memory-only; ZIP import currently requires Windows PowerShell.

The protocol was researched from [datasheet-cli](https://github.com/akiselev/datasheet-cli/blob/master/apps/datasheet-cli/src/snapeda.rs); this implementation is independent and does not bundle or execute that project. It uses undocumented SnapMagic website endpoints, not the supported partner API. Provider refusals stop downloads; authentication and verification are not bypassed. Automatic download was live-tested twice with NHD-C12832A1Z-FSW-FBW-3V3, including after a service restart. Both tests explicitly skipped existing ZIPs and cache, validated 19 electrical pins/pads, and the resulting symbol was loaded by KiCad CLI.

Existing KiCad V6+ ZIPs in Downloads remain a fallback. Filenames must match the manufacturer part number (hyphens/underscores and duplicate suffixes are handled). Cached libraries are under LocalAppData/autoBOM/digikey-cad-v1. Identity, symbol/footprint linkage, pin/pad agreement, and pad geometry are checked; mounting holes do not count as electrical pins. Licenses are retained. This initial importer supports one symbol/footprint pair, with no inherited symbols or external 3D references. Override directories with DIGIKEY_CAD_DOWNLOAD_DIR and DIGIKEY_CAD_LIBRARY_DIR. Imported CAD still needs datasheet review.

### Typical application circuits

The native result card offers a collapsible **Typical application circuit** section when a reviewed template exists. The initial template covers Microchip MCP1700 SOT-23 (`/TT`) fixed-output variants for either JLCPCB/LCSC or DigiKey. It places the regulator, input/output 1 µF ceramic capacitors, wiring, a ground junction, and uniquely named local supply labels as a movable block. Placement is undoable; Escape cancels. Parts are annotated to avoid duplicate references. The main part keeps supplier identity; passive part numbers remain blank. Passive sourcing requirements are carried into later AutoBOM selection.

The topology and pin mapping come from Microchip DS20001826F Table 3-1, Figure 6-1 and Sections 5.1–5.2. The 16 V X7R 0805 passive choice is a starting sourcing constraint, not a manufacturer-mandated package. Verify effective capacitance under DC bias, input/dropout/current/thermal limits, and physical capacitor placement for your design. Other parts use the general datasheet-based generator described below; unsupported topology or package cases return a specific limitation.

Native compilation and backend topology/identity/requirements tests pass. Interactive circuit placement and undo remain to be visually checked: the native automation helper failed with “foreground window did not report a process id.” Restart an already-open editor to load the rebuilt module.

Automated tests cover conversation routing, clarification without supplier traffic, invalid inputs, wrong-category filtering, GPIO/capability evidence, and Codex transport cancellation/errors. Live checks confirmed ChatGPT account discovery, a structured explanation, and an ESP32-C3 module search with prepared CAD. Those checks do not establish every device's suitability or prove all native interface interactions.

## Reply presentation

Native replies render Markdown headings, emphasis, lists and code using KiCad's bundled renderer. Raw HTML is escaped and embedded resources are blocked. The outer conversation receives wheel gestures over answer text and result cards, including fractional wheel deltas. Once an answer arrives from the service, the panel reveals it in short timed increments; **Show all** skips the reveal. This is a presentation animation, not token streaming from the model. Scrolling up keeps the current reading position while text appears.

## Search quality and concise cards

Planned supplier queries run before broad categories. Full-color display requests reject documented single-color displays and withhold listings without color evidence. AI review can decline every candidate; the native panel does not badge low-confidence or fallback choices as Best match. Weak/empty searches receive at most one extra planning pass using prior result evidence, preserving the original query and requirements. Final replies summarize the selected part and the review reasoning. Part details contain catalog specifications and electrical review; CAD details contain symbols, footprints, pin validation, import status and 3D information. Generic CAD cautions no longer repeat outside the disclosure.


## Allowance and practical selection

The native composer shows account-wide Codex allowance percentages and actual quota-window lengths, refreshing every minute. Hover for reset times. API mode hides the indicator. No 24-hour estimate or usage history is collected.

Only user-stated constraints are hard requirements. The original user messages are preserved separately from generated search wording. Plausible regulators can be offered with concise design checks without claiming a validated application circuit. Actual rating conflicts and unverified defining capabilities still reject candidates. Reviewed circuit-template availability is separate from IC suitability.


## Generate typical application circuit

Every recommended part has a Generate typical application circuit action. It is an explicit, on-demand request using the selected Codex or API connection. The resulting card shows a component list, datasheet link, expandable design notes, and Place application circuit. Ordinary follow-up chat preserves the last part cards and directs circuit requests to this action instead of drawing ASCII circuits.

The general path resolves an exact single-unit KiCad symbol and pin map, downloads a public HTTPS PDF, asks the selected model to identify relevant pages, and supplies both text and rendered circuit/pinout pages for extraction. The compiled plan requires source-page evidence, valid pin numbers, one net per pin, and complete connected/no-connect coverage. Native placement rejects conflicting nets on stacked physical pins. Source documents cannot authorize tool actions. CAD library registration follows the existing validated import path.

Generated drafts now use compact placement based on real symbol pin geometry and orthogonal wires for signal connections. Ground and external ports use a small number of local labels, with per-placement unique names. They are not PCB layouts. Supporting R/C/L, polarized capacitors, diodes, LEDs, crystals and 2–4-pin connectors are supported without supplier part numbers. Support footprints stay blank for subsequent selection. Multiple-unit primary symbols, additional active ICs/transistors, unreadable drawings or unspecified required component values can produce a specific unsupported/missing-information response. This is broad component-driven extraction, not a guarantee that every datasheet has an automatically placeable circuit. Review AI-extracted drafts against their source.

The previously reviewed MCP1700 SOT-23 reference and XL1509-5.0E1 12 V to 5 V / 2 A reference are fast paths. The general path was live-tested separately on TI NE555P astable operation: seven symbols with the documented timing/load values and NC control pin. KiCad CLI exported netlists for both NE555P and XL1509 reference fixtures and their pins/nets were checked. Native interactive placement/undo was not exercised during this update because the user requested background-only work.

### Adapting a reference design

Generation can adapt the documented topology using datasheet equations rather than requiring an exact worked-example operating point. It selects practical component values and recalculates achieved output, timing or gain. Equations carry page citations, SI-valued inputs and their provenance. A bounded arithmetic parser independently checks numeric results without executing model code; one correction pass can repair a calculation mismatch. This checks arithmetic, not the correctness of the model's equation selection or physical assumptions.

Routine missing preferences use documented defaults or explicitly stated reference operating assumptions. Only an essential unresolved input or an actual operating conflict should block a draft. Calculations and assumptions are in expandable design notes; ordinary replies omit repetitive heat/ripple/layout review boilerplate unless asked. Actual known conflicts are still reported. Requests with operating requirements bypass fixed reference fast paths so the general generator checks those requirements. Both suppliers share this logic.


### Compact routing and Fast mode

The service recognizes buck topology from its connections and places input bypass, bootstrap, catch diode, inductor, output capacitor and divider in a compact arrangement. Other single-unit circuits place supporting parts near the primary pins they serve. A bounded 25 mil orthogonal router avoids symbol bodies, NC pins and unrelated nets; it preserves T junctions and collapses straight segments. Routing failures stop placement rather than returning disconnected components. Native patch 0023 checks the actual loaded symbol pin positions against the routing geometry before adding items. Save and reopen the editor after installing the patch. Backend tests check full connectivity including unintended joins and NCs; KiCad CLI netlists for TPS5430 and NE555 matched their source circuits. Interactive placement was not exercised because the user requested background-only work.

Codex assistant requests enable service_tier=fast and features.fast_mode. The installed app server confirmed the selected service tier as priority for GPT-6 Astra. This preserves the selected model and reasoning effort, uses the higher Fast-mode credit rate, and does not alter the user's global Codex configuration. There is no separate extra-fast tier implemented.
