# Repository guide

Auto BOM has two main pieces: a local JavaScript service and a modified KiCad editor. KiCad asks the service to search suppliers, prepare CAD libraries, and propose BOM changes. The editor presents those changes for review and applies them to the schematic.

## Where things live

| Location | Purpose |
| --- | --- |
| `services/` | Backend features: searches, supplier connections, BOM completion, CAD imports, and validation. |
| `public/` | The separate browser interface: `index.html` is its structure, `app.js` handles interaction, and `styles.css` controls appearance. KiCad's native panels are implemented separately. |
| `tests/` | Automated checks. Run them from the repository root with `npm test`. Most use controlled test data rather than live supplier requests. |
| `scripts/` | Developer utilities, live supplier checks, benchmarks, and fixture generation. |
| `integrations/kicad-native/` | Patches and build tools for the custom KiCad editor. |
| `integrations/kicad-http/` | A smaller experimental integration that exposes saved search results through KiCad's HTTP library interface. It does not replace the native panels. |
| `examples/` | Sample BOM CSVs and a schematic fixture. The fixture's SVG, netlist, and ERC reports are supporting outputs, not application code. |
| `docs/testing/` | Historical test reports. Their results and paths describe the version tested at that time, not a guarantee about today's release. |

## Top-level files

| File | Purpose |
| --- | --- |
| `README.md` | Main introduction and setup instructions. |
| `PROJECT-SUMMARY.md` | Longer explanation of the project and its limitations. Kept here to preserve existing public links. |
| `package.json` | Node project metadata and commands such as `npm start` and `npm test`. |
| `server.js` | Starts the local HTTP service, defines API routes, and serves the browser interface. |
| `config.js` | Loads local settings from `.env` without overwriting existing environment variables. |
| `parser.js` | Reads BOM CSV data and interprets values, packages, and component types. |
| `.env.example` | Settings template with placeholders. Copy it to `.env` for your own configuration. |
| `.gitignore` | Keeps secrets, downloaded libraries, build outputs, and temporary files out of Git. |
| `.gitattributes` | Git rules for handling repository files. |
| `requirements-easyeda.txt` | Python dependencies for the EasyEDA conversion tool. |
| `Setup EasyEDA.ps1` | Prepares the local Python environment used by that tool. |
| `Start KiCad.ps1` | Starts the custom KiCad project manager with its runtime paths and local service. |
| `Start Auto BOM in KiCad.ps1` | Starts the custom schematic editor directly. |
| `Start auto_BOM.ps1` | Starts the local service and, optionally, its browser interface. |
| `Launch KiCad.vbs` / `Launch auto_BOM.vbs` | Windows wrappers for launching without leaving a console window open. |

The launcher scripts stay at the top level because installed shortcuts and other scripts refer to them there.

## Backend modules

| File in `services/` | Responsibility |
| --- | --- |
| `component-search.js` | Coordinates request interpretation, supplier search, candidate review, and CAD preparation. |
| `search-jobs.js` | Tracks search jobs and progressive results so callers can receive updates. |
| `component-request.js` | Recognizes structured requests and common component requirements. |
| `catalog-rules.js` | Component-family rules and filters used to narrow supplier results. |
| `search-intent.js` | Recognizes broader functional requests and related search categories. |
| `supplier-categories.js` | Maps requests to supplier categories using `data/jlcpcb-categories.json`. |
| `sourcing.js` | Selects the supplier and provides shared supplier-field conventions. |
| `lcsc.js` | Queries and normalizes the JLCPCB assembly-parts catalog. This is not a separate LCSC warehouse inventory client. |
| `digikey.js` | DigiKey search, product normalization, matching, and ordering constraints. |
| `ai.js` | AI request interpretation and candidate-review calls. |
| `bom-completion.js` | Groups schematic parts, respects existing assignments, and prepares sourcing proposals. |
| `specification-checks.js` | Compares electrical requirements and schematic pin functions with candidate evidence. |
| `kicad-assets.js` | Chooses installed CAD assets or obtains external ones and coordinates remapping. |
| `easyeda.js` | Downloads/converts EasyEDA assets and validates their structure and identity. |
| `footprint-remap.js` | Matches unique pin functions and creates a footprint copy with translated pad numbers. |
| `http-library.js` | Stores and exposes search results through the experimental HTTP library integration. |

## Tests and developer scripts

Each `tests/*.test.js` file groups checks for a feature. For example, `parser.test.js` checks BOM parsing, `lcsc.test.js` checks catalog handling, and `footprint-remap.test.js` checks mapping and geometry preservation. A passing test suite covers those cases; it does not replace native UI testing or electrical design verification.

| Script in `scripts/` | Purpose |
| --- | --- |
| `live-sourcing-check.mjs` | Checks actual supplier responses. |
| `component-matrix.mjs` | Exercises a collection of component-search requests. |
| `bom-matrix.mjs` | Exercises BOM completion on multiple example inputs. |
| `category-matrix.mjs` | Checks requests across component categories. |
| `discovery-matrix.mjs` | Exercises broader discovery requests. |
| `cold-search-benchmark.mjs` | Measures searches in fresh processes to reduce application-cache effects. |
| `refresh-categories.mjs` | Updates the supplier-category snapshot. |
| `create-sourcing-demo.mjs` | Generates the small schematic fixture. |

Live scripts can contact suppliers and, depending on the script and configuration, use AI. They are separate from the regular automated test command.

## Native KiCad files

`integrations/kicad-native/patches/` contains the changes to KiCad's C++ source, in numbered order. These are patches, not a complete copy of KiCad. The full KiCad source and build directory live in a separate checkout. `Build custom KiCad.ps1` builds that checkout; consult the integration README for setup and patch instructions.

`Launcher.cs` is the Windows launcher source. `Build launcher.ps1` compiles it. Compiled executables and DLLs are local build outputs, not the editable source files.

The HTTP integration contains its own README and `AutoBOM.kicad_httplib`, which tells KiCad how to reach the local HTTP library.

## Local files that are not published

- `.env`: API keys and local configuration.
- `.runtime/`: temporary output, logs, benchmarks, and local tool environments.
- `.easyeda_cache/` and `autoBOM/easyeda-v1/`: generated/downloaded CAD caches when those local paths are used.
- Compiled launcher executables and dependency directories.

## Why the JavaScript stays in separate files

Source modules are split by responsibility so that changes are easier to understand, test, and review. Putting all supplier logic, CAD conversion, and BOM handling into one large file would make maintenance harder.

Bundling means generating a combined distribution file from those source modules. It can be useful for shipping an application, but it would not replace the organized source in GitHub. This local Node service does not currently need a bundler; adding one solely to hide the file count would add unnecessary build tooling.

To follow a workflow, start with `server.js`, then `services/component-search.js` or `services/bom-completion.js`, and finally the supplier/CAD modules they call.
