import { parseCsv } from "./parser.js";

const $ = (selector) => document.querySelector(selector);
const ui = {
  file: $("#file-input"), sample: $("#sample-button"), export: $("#export-button"),
  empty: $("#empty-state"), results: $("#results"), bom: $("#bom-body"), candidates: $("#candidate-panel"),
  candidateBody: $("#candidate-body"), candidateContext: $("#candidate-context"), aiResult: $("#ai-result"),
  message: $("#message"), apiStatus: $("#api-status"),
};
let bom = [];
let configuration = { digikey: false, openai: false };
let importGeneration = 0;

checkConfiguration();

ui.sample.addEventListener("click", async () => {
  try {
    const response = await fetch("sample_bom.csv");
    if (!response.ok) throw new Error("Could not load the sample BOM.");
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

async function loadBom(text) {
  const generation = ++importGeneration;
  try {
    bom = parseCsv(text).map((part) => ({ ...part, analysisStatus: "Parsed", candidates: [], review: null }));
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

async function analyzeAllParts(generation) {
  if (!configuration.digikey) {
    showMessage("BOM imported. Add DigiKey credentials to search every line automatically.", true);
    return;
  }
  let completed = 0;
  let supplierBlocked = "";
  const work = bom.map((part) => async () => {
    if (generation !== importGeneration) return;
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
      if (configuration.openai && result.candidates.length) {
        part.review = await postJson("/api/ai/review", { component: part, candidates: result.candidates });
        part.selectedCandidate = result.candidates.find((candidate) =>
          candidate.digiKeyPartNumber === part.review.selectedDigiKeyPartNumber
          || candidate.manufacturerPartNumber === part.review.selectedManufacturerPartNumber
        ) || part.selectedCandidate;
        part.analysisStatus = "Selected";
      } else if (result.candidates.length) part.analysisStatus = "Selected";
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
    addCell(row, selected?.manufacturerPartNumber || "—");
    addCell(row, selected?.digiKeyPartNumber || "—");
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
    const enabled = [configuration.digikey && "DigiKey", configuration.openai && "AI"].filter(Boolean);
    ui.apiStatus.textContent = enabled.length === 2 ? `DigiKey ${configuration.digikeyEnvironment} + AI configured` : `${enabled.join(" + ") || "No APIs"} configured`;
    ui.apiStatus.className = `api-status ${enabled.length === 2 ? "ready" : "partial"}`;
  } catch { ui.apiStatus.textContent = "Backend unavailable"; ui.apiStatus.className = "api-status partial"; }
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
