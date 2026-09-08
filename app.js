const $ = (selector) => document.querySelector(selector);
const ui = {
  form: $("#component-form"), query: $("#component-query"), search: $("#component-search"),
  interpreted: $("#interpreted-request"), results: $("#component-results"), cards: $("#component-cards"),
  count: $("#result-count"), message: $("#message"), apiStatus: $("#api-status"),
};

checkConfiguration();
ui.query.focus();

ui.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const query = ui.query.value.trim();
  if (!query) return showMessage("Describe the component you need first.", true);
  setSearching(true);
  ui.results.classList.add("hidden");
  ui.interpreted.classList.add("hidden");
  showMessage("Understanding your request and checking current DigiKey stock…");
  try {
    const result = await postJson("/api/components/search", { query });
    renderResults(result);
    showMessage(result.candidates.length
      ? `Found ${result.candidates.length} in-stock options. The best overall match is first.`
      : "No in-stock match was found. Try describing the part with fewer restrictions.", !result.candidates.length);
  } catch (error) {
    showMessage(error.message, true);
  } finally {
    setSearching(false);
  }
});

function renderResults({ component, candidates, review }) {
  const details = [...component.requirements, ...component.assumptions.map((item) => `Assumption: ${item}`)];
  ui.interpreted.replaceChildren(element("strong", component.summary), element("p", details.join(" · ")));
  ui.interpreted.classList.remove("hidden");
  const ordered = [...candidates].sort((a, b) => Number(isRecommended(b, review)) - Number(isRecommended(a, review))
    || Number(Boolean(b.kicadAssets?.placeable)) - Number(Boolean(a.kicadAssets?.placeable)));
  ui.count.textContent = `${ordered.length} option${ordered.length === 1 ? "" : "s"}`;
  ui.cards.replaceChildren(...ordered.map((candidate) => componentCard(component, candidate, review)));
  ui.results.classList.remove("hidden");
}

function componentCard(component, candidate, review) {
  const recommended = isRecommended(candidate, review);
  const concerns = Array.isArray(review?.concerns) ? review.concerns.filter(Boolean) : [];
  const confidence = Number(review?.confidence);
  const lowConfidence = Number.isFinite(confidence) && confidence < 0.7;
  const needsReview = recommended && (concerns.length > 0 || lowConfidence);
  const card = element("article", "", `component-card${recommended ? " recommended" : ""}`);
  const title = element("div", "", "card-title");
  const heading = element("div");
  heading.append(element("strong", candidate.manufacturerPartNumber || candidate.digiKeyPartNumber));
  heading.append(element("span", `${candidate.manufacturer} · ${candidate.packageType || "standard packaging"}`));
  title.append(heading);
  if (recommended) title.append(element("span", needsReview ? "Needs review" : "Best match", `badge${needsReview ? " warning" : ""}`));
  card.append(title, element("p", candidate.description, "description"));
  const facts = element("div", "", "facts");
  facts.append(
    fact("In stock", Number(candidate.quantityAvailable || 0).toLocaleString()),
    fact("Unit price", candidate.unitPrice == null ? "—" : `${candidate.currency} ${candidate.unitPrice.toFixed(4)}`),
    fact("Order minimum", String(candidate.minimumOrderQuantity || 1)),
  );
  card.append(facts);
  const assets = candidate.kicadAssets;
  if (assets) card.append(element("p", assets.placeable
    ? `Ready for KiCad: ${assets.symbolId} · ${assets.footprintId}`
    : "No safe symbol and footprint pair is available in the installed KiCad libraries.", `asset-note${assets.placeable ? " ready" : ""}`));
  const actions = element("div", "", "card-actions");
  if (candidate.productUrl) {
    const link = element("a", "Open on DigiKey", "text-link");
    link.href = candidate.productUrl; link.target = "_blank"; link.rel = "noreferrer"; actions.append(link);
  }
  card.append(actions);
  if (recommended && (review?.reasoning || concerns.length || lowConfidence)) {
    const note = element("div", "", `recommendation-note${needsReview ? " warning" : ""}`);
    if (review?.reasoning) note.append(element("p", review.reasoning));
    if (needsReview) {
      note.append(element("strong", "Review before using"));
      const issues = element("ul");
      for (const concern of concerns) issues.append(element("li", concern));
      if (lowConfidence) issues.append(element("li", `AI confidence is ${Math.round(confidence * 100)}%.`));
      note.append(issues);
    }
    card.append(note);
  }
  return card;
}

function isRecommended(candidate, review) {
  return candidate.digiKeyPartNumber === review?.selectedDigiKeyPartNumber
    || candidate.manufacturerPartNumber === review?.selectedManufacturerPartNumber;
}

async function checkConfiguration() {
  try {
    const configuration = await (await fetch("/api/status")).json();
    const enabled = [configuration.openai && "AI", configuration.digikey && "DigiKey"].filter(Boolean);
    ui.apiStatus.textContent = enabled.length === 2 ? "AI + DigiKey ready" : `${enabled.join(" + ") || "Setup required"}`;
    ui.apiStatus.className = `api-status ${enabled.length === 2 ? "ready" : "partial"}`;
  } catch {
    ui.apiStatus.textContent = "Service unavailable";
    ui.apiStatus.className = "api-status partial";
  }
}

function setSearching(searching) {
  ui.search.disabled = searching;
  ui.search.textContent = searching ? "Searching…" : "Find parts";
}

async function postJson(url, body) {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "The request failed.");
  return data;
}

function fact(label, value) { const item = element("div"); item.append(element("span", label), element("strong", value)); return item; }
function element(name, text = "", className = "") { const item = document.createElement(name); item.textContent = text; item.className = className; return item; }
function showMessage(text, error = false) { ui.message.textContent = text; ui.message.className = `message${error ? " error" : ""}`; }
