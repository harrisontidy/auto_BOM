import { parseCsv } from "./parser.js";

const fileInput = document.querySelector("#file-input");
const sampleButton = document.querySelector("#sample-button");
const emptyState = document.querySelector("#empty-state");
const results = document.querySelector("#results");
const body = document.querySelector("#bom-body");
const exportButton = document.querySelector("#export-button");
let currentBom = [];

sampleButton.addEventListener("click", async () => {
  try {
    const response = await fetch("sample_bom.csv");
    if (!response.ok) throw new Error("Could not load the sample BOM.");
    currentBom = parseCsv(await response.text());
    render(currentBom);
  } catch (error) {
    window.alert(`${error.message} Start the local server with: node server.js`);
  }
});

fileInput.addEventListener("change", async () => {
  const file = fileInput.files[0];
  if (!file) return;
  try {
    currentBom = parseCsv(await file.text());
    render(currentBom);
  } catch (error) {
    window.alert(error.message);
  }
});

exportButton.addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(currentBom, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "cleaned-bom.json";
  link.click();
  URL.revokeObjectURL(link.href);
});

function render(bom) {
  body.replaceChildren(...bom.map((part) => {
    const row = document.createElement("tr");
    const values = [
      part.references.join(", ") || "—",
      part.value || "—",
      part.normalizedValue || "—",
      part.footprint || "—",
      part.quantity,
    ];
    for (const value of values) {
      const cell = document.createElement("td");
      cell.textContent = value;
      row.append(cell);
    }
    const status = document.createElement("td");
    status.innerHTML = part.warnings.length
      ? `<span class="badge warning">${part.warnings.join(", ")}</span>`
      : '<span class="badge ready">Ready</span>';
    row.append(status);
    return row;
  }));

  document.querySelector("#line-count").textContent = bom.length;
  document.querySelector("#part-count").textContent = bom.reduce((sum, part) => sum + part.quantity, 0);
  document.querySelector("#warning-count").textContent = bom.filter((part) => part.warnings.length).length;
  emptyState.classList.add("hidden");
  results.classList.remove("hidden");
}
