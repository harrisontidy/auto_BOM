import { parseCsv } from "./parser.js";

const $ = (selector) => document.querySelector(selector);
const ui = {
  file: $("#file-input"), sample: $("#sample-button"), export: $("#export-button"), ai: $("#ai-button"),
  empty: $("#empty-state"), results: $("#results"), bom: $("#bom-body"), candidates: $("#candidate-panel"),
  candidateBody: $("#candidate-body"), candidateContext: $("#candidate-context"), aiResult: $("#ai-result"),
  message: $("#message"), apiStatus: $("#api-status"),
};
let bom = [];
let selectedPart = null;
let candidates = [];

checkConfiguration();

ui.sample.addEventListener("click", async () => {
  try {
    const response = await fetch("sample_bom.csv");
    if (!response.ok) throw new Error("Could not load the sample BOM.");
    loadBom(await response.text());
  } catch (error) { showMessage(error.message, true); }
});

ui.file.addEventListener("change", async () => {
  const file = ui.file.files[0];
  if (file) loadBom(await file.text());
});

ui.export.addEventListener("click", () => {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([JSON.stringify(bom, null, 2)], { type: "application/json" }));
  link.download = "cleaned-bom.json";
  link.click();
  URL.revokeObjectURL(link.href);
});

ui.ai.addEventListener("click", async () => {
  if (!selectedPart || !candidates.length) return;
  setBusy(ui.ai, true, "Reviewing…");
  ui.aiResult.classList.add("hidden");
  try {
    const result = await postJson("/api/ai/review", { component: selectedPart, candidates });
    ui.aiResult.replaceChildren(
      element("h3", `AI review: ${result.recommendation}`),
      element("p", result.reasoning),
      element("p", `Confidence: ${Math.round(result.confidence * 100)}%${result.concerns.length ? ` · Concerns: ${result.concerns.join("; ")}` : ""}`),
    );
    ui.aiResult.classList.remove("hidden");
  } catch (error) { showMessage(error.message, true); }
  finally { setBusy(ui.ai, false, "AI double-check"); }
});

function loadBom(text) {
  try {
    bom = parseCsv(text);
    renderBom();
    showMessage("BOM imported. Search one line at a time and check the requirements before choosing a part.");
  } catch (error) { showMessage(error.message, true); }
}

function renderBom() {
  ui.bom.replaceChildren(...bom.map((part) => {
    const row = document.createElement("tr");
    [part.references.join(", ") || "—", part.value || "—", part.normalizedValue || "—", part.footprint || "—", String(part.quantity)]
      .forEach((value) => addCell(row, value));
    addCell(row, "").append(tag(part.warnings.length ? part.warnings.join(", ") : "Ready", part.warnings.length));
    const button = element("button", "Find parts", "button secondary");
    button.type = "button";
    button.addEventListener("click", () => searchPart(part, button));
    addCell(row, "").append(button);
    return row;
  }));
  $("#line-count").textContent = bom.length;
  $("#part-count").textContent = bom.reduce((sum, part) => sum + part.quantity, 0);
  $("#warning-count").textContent = bom.filter((part) => part.warnings.length).length;
  ui.empty.classList.add("hidden");
  ui.results.classList.remove("hidden");
  ui.candidates.classList.add("hidden");
}

async function searchPart(part, button) {
  selectedPart = part;
  setBusy(button, true, "Searching…");
  ui.aiResult.classList.add("hidden");
  try {
    const result = await postJson("/api/digikey/search", { component: part });
    candidates = result.candidates;
    renderCandidates(result.query);
    ui.candidates.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) { showMessage(error.message, true); }
  finally { setBusy(button, false, "Find parts"); }
}

function renderCandidates(query) {
  ui.candidateContext.textContent = `${selectedPart.references.join(", ")} · Search: ${query}`;
  ui.candidateBody.replaceChildren(...candidates.map((candidate) => {
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
  ui.candidates.classList.remove("hidden");
}

async function checkConfiguration() {
  try {
    const status = await (await fetch("/api/status")).json();
    const enabled = [status.digikey && "DigiKey", status.openai && "AI"].filter(Boolean);
    ui.apiStatus.textContent = enabled.length === 2 ? "DigiKey + AI configured" : `${enabled.join(" + ") || "No APIs"} configured`;
    ui.apiStatus.className = `api-status ${enabled.length === 2 ? "ready" : "partial"}`;
  } catch { ui.apiStatus.textContent = "Backend unavailable"; ui.apiStatus.className = "api-status partial"; }
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
function setBusy(button, busy, text) { button.disabled = busy; button.textContent = text; }
function showMessage(text, error = false) { ui.message.textContent = text; ui.message.className = `message${error ? " error" : ""}`; }
