# Progressive component search — September 12, 2026

The custom KiCad finder and browser interface now display supplier matches before CAD preparation and review finish. Cards update as those independent operations return. Pending review/CAD is labeled; the native placement control remains disabled until CAD is ready and review has returned. Review concerns remain visible and still require engineering judgment.

The query stays editable during work. Search again replaces the current job, requests cancellation, and ignores events from older generations. Server-side catalog fetches receive cancellation signals; work such as a CAD converter or AI request already in progress may still finish. Cancelled jobs cannot publish late results. Jobs expire after three minutes and their retained count is bounded. The synchronous endpoint remains available to existing scripts.

Validation:

- All 116 automated tests pass. New tests hold CAD and AI review pending independently, verify early catalog results and subsequent updates, and verify cancellation, late-result suppression and failure reporting.
- Live HTTP test returned an intermediate update at 2.13 seconds and completion at 2.25 seconds for a resistor search. This single measurement was supplier-latency dependent; progressive rendering does not promise a faster external supplier response.
- Native editor rebuilt and installed successfully after closing the KiCad manager, which had retained the old editor library.
- Native smoke test: ESP32-S2 search completed, displayed C529594 with its installed symbol/footprint, and loaded the symbol onto the placement cursor without the previous library error. Placement was cancelled to leave the schematic unchanged.
- Browser JavaScript syntax checked. A browser visual regression test and exhaustive native interaction testing were not performed.

The full custom integration remains the main product. This update does not remove AI review, automatic EasyEDA downloads, Basic-part preference, or live stock validation.
