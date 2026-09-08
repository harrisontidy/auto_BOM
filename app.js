import { parseCsv } from "./parser.js";

const pageParameters = new URLSearchParams(window.location.search);
const embeddedInKiCad = pageParameters.get("embedded") === "kicad";
const bomManagerMode = pageParameters.get("view") === "bom";
if (embeddedInKiCad) {
  document.body.classList.add("kicad-embedded");
}
if (bomManagerMode) {
  document.body.classList.add("bom-manager");
  document.title = "Auto BOM — Complete Schematic";
}

const $ = (selector) => document.querySelector(selector);
const ui = {
  componentForm: $("#component-form"), componentQuery: $("#component-query"),
  componentSearch: $("#component-search"), interpretedRequest: $("#interpreted-request"), componentResults: $("#component-results"),
  componentCards: $("#component-cards"), resultCount: $("#result-count"), finderView: $("#finder-view"), bomView: $("#bom-view"),
  file: $("#file-input"), sample: $("#sample-button"), stressTest: $("#stress-test-button"), export: $("#export-button"),
  empty: $("#empty-state"), results: $("#results"), bom: $("#bom-body"), candidates: $("#candidate-panel"),
  candidateBody: $("#candidate-body"), candidateContext: $("#candidate-context"), aiResult: $("#ai-result"),
  message: $("#message"), apiStatus: $("#api-status"), schematicBomPanel: $("#schematic-bom-panel"),
  csvImportPanel: $("#csv-import-panel"), schematicRefresh: $("#schematic-refresh"),
};
let bom = [];
let configuration = { digikey: false, openai: false };
let importGeneration = 0;
let nativeConnected = false;
let nativeBom = false;

const configurationReady = checkConfiguration();

window.addEventListener("autobom-native", (event) => {
  nativeConnected = Boolean(event.detail?.connected);
  updateApiStatus();
  if (nativeConnected && bomManagerMode) postToKiCad({ command: "getSchematic" });
});
window.addEventListener("autobom-schematic", (event) => loadSchematicBom(event.detail?.symbols || []));
if (embeddedInKiCad) setTimeout(() => postToKiCad({ command: "ping" }), 250);
ui.finderView.classList.toggle("hidden", bomManagerMode);
ui.bomView.classList.toggle("hidden", !bomManagerMode);
ui.schematicBomPanel.classList.toggle("hidden", !(bomManagerMode && embeddedInKiCad));
ui.csvImportPanel.classList.toggle("hidden", bomManagerMode && embeddedInKiCad);
if (bomManagerMode) $("#app-title").textContent = "BOM Completion";
ui.schematicRefresh.addEventListener("click", () => postToKiCad({ command: "getSchematic" }));

ui.componentForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const query = ui.componentQuery.value.trim();
  if (!query) return showMessage("Describe the component you need.", true);
  ui.componentSearch.disabled = true;
  ui.componentSearch.textContent = "Searching…";
  ui.componentResults.classList.add("hidden");
  ui.interpretedRequest.classList.add("hidden");
  showMessage("AI is turning your request into component requirements, then DigiKey will search live stock.");
  try {
    const result = await postJson("/api/components/search", { query, quantity: 1 });
    renderComponentSearch(result);
    showMessage(`Found ${result.candidates.length} in-stock DigiKey options.`);
  } catch (error) {
    showMessage(error.message, true);
  } finally {
    ui.componentSearch.disabled = false;
    ui.componentSearch.textContent = "Find parts";
  }
});

function renderComponentSearch(result) {
  const { component, candidates, review } = result;
  ui.interpretedRequest.replaceChildren(
    element("strong", component.summary),
    element("p", [...component.requirements, ...component.assumptions.map((item) => `Assumed: ${item}`)].join(" · ")),
  );
  ui.interpretedRequest.classList.remove("hidden");
  const ordered = [...candidates].sort((a, b) => {
    const aRecommended = a.digiKeyPartNumber === review?.selectedDigiKeyPartNumber || a.manufacturerPartNumber === review?.selectedManufacturerPartNumber;
    const bRecommended = b.digiKeyPartNumber === review?.selectedDigiKeyPartNumber || b.manufacturerPartNumber === review?.selectedManufacturerPartNumber;
    return Number(bRecommended) - Number(aRecommended) || Number(Boolean(b.kicadAssets?.placeable)) - Number(Boolean(a.kicadAssets?.placeable));
  });
  ui.resultCount.textContent = `${candidates.length} options`;
  ui.componentCards.replaceChildren(...ordered.map((candidate, index) => componentCard(component, candidate, review, index)));
  ui.componentResults.classList.remove("hidden");
}

function componentCard(component, candidate, review, index) {
  const recommended = candidate.digiKeyPartNumber === review?.selectedDigiKeyPartNumber
    || candidate.manufacturerPartNumber === review?.selectedManufacturerPartNumber;
  const card = element("article", "", `component-card${recommended ? " recommended" : ""}`);
  const title = element("div", "", "card-title");
  const heading = element("div", "");
  heading.append(element("strong", candidate.manufacturerPartNumber || candidate.digiKeyPartNumber));
  heading.append(element("span", `${candidate.manufacturer} · ${candidate.packageType || "standard packaging"}`));
  title.append(heading);
  if (recommended) title.append(element("span", "Best match", "badge"));
  card.append(title, element("p", candidate.description, "description"));
  const facts = element("div", "", "facts");
  facts.append(
    fact("Stock", candidate.quantityAvailable.toLocaleString()),
    fact("Unit price", candidate.unitPrice == null ? "—" : `${candidate.currency} ${candidate.unitPrice.toFixed(4)}`),
    fact("Minimum", String(candidate.minimumOrderQuantity)),
  );
  card.append(facts);
  const assets = candidate.kicadAssets;
  if (assets) card.append(element("p", assets.placeable
    ? `KiCad: ${assets.symbolId} · ${assets.footprintId}${assets.modelExpected ? " · 3D model from footprint" : ""}`
    : "KiCad: exact CAD data was not found; DigiKey details are still available.", `asset-note${assets.placeable ? " ready" : ""}`));
  const actions = element("div", "", "card-actions");
  if (candidate.productUrl) {
    const link = element("a", "DigiKey page", "text-link");
    link.href = candidate.productUrl; link.target = "_blank"; link.rel = "noreferrer"; actions.append(link);
    link.addEventListener("click", (event) => {
      if (document.body.classList.contains("kicad-embedded") && postToKiCad({ command: "openUrl", url: candidate.productUrl })) event.preventDefault();
    });
  }
  const place = element("button", "Place in schematic", "button primary");
  place.type = "button";
  if (assets && !assets.placeable) { place.disabled = true; place.textContent = "CAD unavailable"; }
  place.addEventListener("click", () => placeCandidate(place, component, candidate));
  actions.append(place);
  card.append(actions);
  if (recommended && review?.reasoning) card.append(element("p", review.reasoning, "recommendation-note"));
  card.dataset.index = String(index);
  return card;
}

async function placeCandidate(button, component, candidate) {
  button.disabled = true;
  button.textContent = "Preparing…";
  try {
    const assets = candidate.kicadAssets || await postJson("/api/components/assets", { component, candidate });
    if (!assets.placeable) throw new Error(`No safe KiCad symbol and footprint pair was found for ${candidate.manufacturerPartNumber}. Open the DigiKey page to obtain the manufacturer's CAD model.`);
    const payload = { command: "place", symbolId: assets.symbolId, footprintId: assets.footprintId,
      value: component.value || candidate.manufacturerPartNumber, manufacturerPartNumber: candidate.manufacturerPartNumber,
      digiKeyPartNumber: candidate.digiKeyPartNumber, datasheetUrl: candidate.datasheetUrl };
    if (!postToKiCad(payload)) throw new Error("Open this tool using the Auto BOM for KiCad desktop shortcut to place parts.");
    showMessage(`Move the ${candidate.manufacturerPartNumber} symbol onto the schematic and click to place it.`);
    button.textContent = "Ready to place";
  } catch (error) {
    showMessage(error.message, true);
    button.disabled = false;
    button.textContent = "Place in schematic";
  }
}

function postToKiCad(payload) {
  const message = JSON.stringify(payload);
  if (window.webkit?.messageHandlers?.autobom) { window.webkit.messageHandlers.autobom.postMessage(message); return true; }
  if (window.chrome?.webview?.postMessage) { window.chrome.webview.postMessage(message); return true; }
  if (typeof window.external?.invoke === "function") { window.external.invoke(message); return true; }
  return false;
}

function fact(label, value) { const item = element("div", ""); item.append(element("span", label), element("strong", value)); return item; }

ui.sample.addEventListener("click", async () => {
  try {
    const response = await fetch("sample_bom.csv");
    if (!response.ok) throw new Error("Could not load the sample BOM.");
    await loadBom(await response.text());
  } catch (error) { showMessage(error.message, true); }
});

ui.stressTest.addEventListener("click", async () => {
  try {
    const response = await fetch("examples/ev_hv_power_management_stress_test.csv");
    if (!response.ok) throw new Error("Could not load the stress-test BOM.");
    await loadBom(await response.text());
  } catch (error) { showMessage(error.message, true); }
});

ui.file.addEventListener("change", async () => {
  const file = ui.file.files[0];
  if (file) await loadBom(await file.text());
});

ui.export.addEventListener("click", () => {
  const exportBom = bom.map(({ candidates, ...part }) => ({ ...part, candidates }));
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([JSON.stringify(exportBom, null, 2)], { type: "application/json" }));
  link.download = "analyzed-bom.json";
  link.click();
  URL.revokeObjectURL(link.href);
});

async function loadBom(text, schematicSymbols = null) {
  const generation = ++importGeneration;
  try {
    await configurationReady;
    bom = parseCsv(text).map((part) => ({ ...part, analysisStatus: "Parsed", candidates: [], review: null }));
    if (schematicSymbols) {
      const byReference = new Map(schematicSymbols.map((symbol) => [symbol.reference, symbol]));
      bom = bom.map((part) => {
        const sourceSymbols = part.references.map((reference) => byReference.get(reference)).filter(Boolean);
        const manufacturerPartNumber = sourceSymbols.find((symbol) => symbol.manufacturerPartNumber)?.manufacturerPartNumber || "";
        const digiKeyPartNumber = sourceSymbols.find((symbol) => symbol.digiKeyPartNumber)?.digiKeyPartNumber || "";
        return { ...part, supplierPartNumber: manufacturerPartNumber || part.supplierPartNumber,
          existingManufacturerPartNumber: manufacturerPartNumber, existingDigiKeyPartNumber: digiKeyPartNumber,
          nativeHasDigiKeyPartNumber: sourceSymbols.length > 0 && sourceSymbols.every((symbol) => symbol.digiKeyPartNumber) };
      });
    }
    renderBom();
    if (configuration.openai) {
      showMessage("AI is reviewing the CSV structure and correcting the first-pass import…");
      try {
        const interpreted = await postJson("/api/ai/parse", { csv: text, deterministicParts: bom });
        if (generation !== importGeneration) return;
        bom = interpreted.parts.map((part) => ({ ...part, analysisStatus: "AI parsed", candidates: [], review: null }));
        showMessage(interpreted.summary);
        renderBom();
      } catch (error) {
        showMessage(`The normal parser succeeded, but AI CSV review failed: ${error.message}. Continuing with the parsed BOM.`, true);
      }
    }
    if (generation === importGeneration) await analyzeAllParts(generation);
  } catch (error) { showMessage(error.message, true); }
}

async function loadSchematicBom(symbols) {
  nativeBom = true;
  if (!symbols.length) {
    bom = [];
    ui.bom.replaceChildren();
    ui.results.classList.add("hidden");
    ui.candidates.classList.add("hidden");
    ui.empty.classList.remove("hidden");
    ui.empty.querySelector("p").textContent = "The open schematic has no BOM components yet.";
    return showMessage("The open schematic has no BOM components yet.");
  }
  const text = toCsv(symbols.map((symbol) => ({
    Reference: symbol.reference, Value: symbol.value, Footprint: symbol.footprint,
    "Supplier Part Number": symbol.digiKeyPartNumber || symbol.manufacturerPartNumber,
  })));
  await loadBom(text, symbols);
}

async function analyzeAllParts(generation) {
  if (!configuration.digikey) {
    showMessage("BOM imported. Add DigiKey credentials to search every line automatically.", true);
    return;
  }
  let completed = 0;
  let supplierBlocked = "";
  const work = bom.map((part) => async () => {
    if (generation !== importGeneration) return;
    if (nativeBom && part.nativeHasDigiKeyPartNumber) {
      part.analysisStatus = "Already assigned";
      completed += 1; renderBom(); return;
    }
    if (supplierBlocked) {
      part.analysisStatus = "Search blocked";
      part.analysisError = supplierBlocked;
      completed += 1; renderBom(); return;
    }
    part.analysisStatus = "Searching DigiKey…"; renderBom();
    try {
      const result = await postJson("/api/digikey/search", { component: part });
      part.searchQuery = result.query;
      part.candidates = result.candidates;
      part.selectedCandidate = result.candidates[0] || null;
      part.analysisStatus = result.candidates.length ? "Reviewing candidates…" : "No candidates";
      renderBom();
      if (configuration.openai && result.candidates.length && needsAiCandidateReview(part)) {
        part.review = await postJson("/api/ai/review", { component: part, candidates: result.candidates });
        part.selectedCandidate = result.candidates.find((candidate) =>
          candidate.digiKeyPartNumber === part.review.selectedDigiKeyPartNumber
          || candidate.manufacturerPartNumber === part.review.selectedManufacturerPartNumber
        ) || part.selectedCandidate;
        part.analysisStatus = "Selected";
      } else if (result.candidates.length) part.analysisStatus = "Selected";
      if (nativeBom && part.selectedCandidate) {
        const assets = await postJson("/api/components/assets", { component: part, candidate: part.selectedCandidate });
        postToKiCad({ command: "updateBomFields", references: part.references,
          manufacturerPartNumber: part.selectedCandidate.manufacturerPartNumber,
          digiKeyPartNumber: part.selectedCandidate.digiKeyPartNumber,
          datasheetUrl: part.selectedCandidate.datasheetUrl,
          footprintId: part.footprint ? "" : assets.footprintId });
        if (!part.footprint && assets.footprintId) {
          part.footprint = assets.footprintId;
          part.packageDescription ||= assets.footprintId;
          part.warnings = part.warnings.filter((warning) => warning !== "Footprint not present in export");
        }
        part.analysisStatus = "Saved to schematic";
      }
    } catch (error) {
      part.analysisStatus = "Analysis failed";
      part.analysisError = error.message;
      if (/\(401\)|\(403\)|not authorized|DigiKey denied/i.test(error.message)) supplierBlocked = error.message;
    }
    completed += 1;
    renderBom();
    showMessage(`Automatic analysis: ${completed} of ${bom.length} BOM lines complete.${supplierBlocked ? ` DigiKey stopped: ${supplierBlocked}` : ""}`, Boolean(supplierBlocked));
  });
  await runWithConcurrency(work, 3);
  if (generation !== importGeneration) return;
  const successful = bom.filter((part) => part.candidates.length).length;
  const reviewed = bom.filter((part) => part.review).length;
  showMessage(`Analysis complete: ${successful} lines have DigiKey candidates and ${reviewed} received an AI candidate review.${supplierBlocked ? ` DigiKey access needs attention: ${supplierBlocked}` : ""}`, Boolean(supplierBlocked));
}

function renderBom() {
  ui.bom.replaceChildren(...bom.map((part) => {
    const row = document.createElement("tr");
    const selected = part.selectedCandidate;
    [part.references.join(", ") || "—", `${part.componentType}\n${part.normalizedValue || part.value}\n${part.packageDescription || part.footprint}`, String(part.quantity)]
      .forEach((value) => addCell(row, value));
    addCell(row, selected?.manufacturerPartNumber || part.existingManufacturerPartNumber || "—");
    addCell(row, selected?.digiKeyPartNumber || part.existingDigiKeyPartNumber || "—");
    addCell(row, selected ? String(selected.quantityAvailable) : "—");
    addCell(row, selected?.unitPrice == null ? "—" : `${selected.currency} ${selected.unitPrice.toFixed(4)}`);
    const check = part.warnings.length ? part.warnings.join("; ") : part.analysisStatus;
    addCell(row, "").append(tag(check, Boolean(part.warnings.length || part.analysisError)));
    const button = element("button", part.candidates.length ? "View results" : part.analysisStatus, "button secondary");
    button.type = "button";
    button.disabled = !part.candidates.length;
    button.title = part.analysisError || "";
    button.addEventListener("click", () => showPartResults(part));
    addCell(row, "").append(button);
    return row;
  }));
  $("#line-count").textContent = bom.length;
  $("#part-count").textContent = bom.reduce((sum, part) => sum + part.quantity, 0);
  $("#warning-count").textContent = bom.filter((part) => part.warnings.length).length;
  ui.empty.classList.add("hidden");
  ui.results.classList.remove("hidden");
}

function showPartResults(part) {
  ui.candidateContext.textContent = `${part.references.join(", ")} · Search: ${part.searchQuery || part.aiSearchTerms || "—"}`;
  ui.candidateBody.replaceChildren(...part.candidates.map((candidate) => {
    const row = document.createElement("tr");
    const link = element("a", candidate.digiKeyPartNumber || candidate.manufacturerPartNumber, "part-link");
    link.href = candidate.productUrl; link.target = "_blank"; link.rel = "noreferrer";
    addCell(row, "").append(link);
    addCell(row, `${candidate.manufacturer}\n${candidate.manufacturerPartNumber}`);
    addCell(row, candidate.description, "description");
    addCell(row, String(candidate.quantityAvailable));
    addCell(row, candidate.unitPrice == null ? "—" : `${candidate.currency} ${candidate.unitPrice.toFixed(4)}`);
    addCell(row, "").append(tag(candidate.checks.length ? candidate.checks.join(", ") : candidate.status, candidate.checks.length));
    return row;
  }));
  if (part.review) {
    ui.aiResult.replaceChildren(
      element("h3", `Selected: ${part.review.selectedManufacturerPartNumber || part.review.recommendation}`), element("p", part.review.reasoning),
      element("p", `Confidence: ${Math.round(part.review.confidence * 100)}%${part.review.concerns.length ? ` · Concerns: ${part.review.concerns.join("; ")}` : ""}`),
    );
    ui.aiResult.classList.remove("hidden");
  } else ui.aiResult.classList.add("hidden");
  ui.candidates.classList.remove("hidden");
  ui.candidates.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function checkConfiguration() {
  try {
    configuration = await (await fetch("/api/status")).json();
    updateApiStatus();
  } catch { ui.apiStatus.textContent = "Backend unavailable"; ui.apiStatus.className = "api-status partial"; }
}

function updateApiStatus() {
  const enabled = [configuration.digikey && "DigiKey", configuration.openai && "AI", nativeConnected && "KiCad linked"].filter(Boolean);
  ui.apiStatus.textContent = enabled.length ? enabled.join(" + ") : "No APIs configured";
  ui.apiStatus.className = `api-status ${configuration.digikey && configuration.openai ? "ready" : "partial"}`;
}

async function runWithConcurrency(tasks, limit) {
  let next = 0;
  async function worker() { while (next < tasks.length) { const task = tasks[next]; next += 1; await task(); } }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
}

async function postJson(url, body) {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "The request failed.");
  return data;
}

function addCell(row, text, className = "") { const cell = element("td", text, className); row.append(cell); return cell; }
function tag(text, warning = false) { return element("span", text, `tag${warning ? " warning" : ""}`); }
function element(name, text, className = "") { const item = document.createElement(name); item.textContent = text; item.className = className; return item; }
function showMessage(text, error = false) { ui.message.textContent = text; ui.message.className = `message${error ? " error" : ""}`; }
function needsAiCandidateReview(part) {
  if (part.supplierPartNumber) return false;
  return !/^(Resistor|Capacitor|Inductor|Diode|LED|Fuse|Ferrite bead)$/i.test(part.componentType);
}
function toCsv(rows) {
  const headers = Object.keys(rows[0]);
  const quote = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  return [headers.map(quote).join(","), ...rows.map((row) => headers.map((header) => quote(row[header])).join(","))].join("\n");
}
