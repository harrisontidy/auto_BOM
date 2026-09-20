const $ = (selector) => document.querySelector(selector);
const ui = {
  mode: $('#mode'), provider: $('#ask-provider'), conversation: $('#conversation'),
  preferBasic: $("#prefer-basic"),
  supplier: $("#supplier"), supplierNote: $("#supplier-note"),
  form: $("#component-form"), query: $("#component-query"), search: $("#component-search"),
  interpreted: $("#interpreted-request"), results: $("#component-results"), cards: $("#component-cards"),
  count: $("#result-count"), message: $("#message"), apiStatus: $("#api-status"),
};

ui.supplier.value = localStorage.getItem("autoBOM.supplier") === "digikey" ? "digikey" : "lcsc";
updateSupplierNote();
checkConfiguration();
ui.supplier.addEventListener("change", () => {
  localStorage.setItem("autoBOM.supplier", ui.supplier.value);
  ui.results.classList.add("hidden");
  updateSupplierNote();
  checkConfiguration();
});
ui.query.focus();

function updateSupplierNote() {
  ui.supplierNote.textContent = ui.supplier.value === "lcsc" ? "Checks JLCPCB catalog stock. Prices exclude assembly fees. No sourcing API key needed." : "Requires your DigiKey API credentials.";
}

let searchGeneration = 0;
let activeJob = null;
let conversation = [];
let searching = false;
let modelCatalog = null;
let modelRequest = 0;
const modelControl = $('#ask-model'), effortControl = $('#ask-effort');
async function loadModels() {
  const generation=++modelRequest;
  modelCatalog=null;modelControl.replaceChildren(new Option('Latest available','latest'));updateEfforts();
  try {
    const response=await fetch(`/api/ask/models?provider=${ui.provider.value}`);
    const data=await response.json();if(generation!==modelRequest)return;
    if(!response.ok)throw new Error(data.error||'Model list unavailable.');
    modelCatalog=data;
    modelControl.replaceChildren(new Option(`Latest: ${data.latest}`,'latest'),...data.models.map(m=>new Option(m.name,m.id)));
    updateEfforts();
  }catch(error){if(generation===modelRequest)showMessage(error.message,true);}
}
function updateEfforts() {
  const id=modelControl.value==='latest'?modelCatalog?.latest:modelControl.value;
  const model=modelCatalog?.models.find(m=>m.id===id);
  const labels={low:'Low — faster',medium:'Medium',high:'High',xhigh:'Extra high',max:'Maximum'};
  effortControl.replaceChildren(new Option(model?`Auto: ${model.defaultEffort}`:'Auto reasoning','auto'),...(model?.efforts||[]).map(e=>new Option(labels[e]||e,e)));
}
ui.provider.addEventListener('change',()=>{loadModels();checkConfiguration();});
modelControl.addEventListener('change',updateEfforts);
ui.query.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();if(!searching)ui.form.requestSubmit();}});
document.querySelectorAll('[data-prompt]').forEach(button=>button.addEventListener('click',()=>{ui.query.value=button.dataset.prompt;ui.query.focus();}));
function chatMessage(role,content) {const item=element('article','',`chat-message ${role}`);item.append(element('strong',role==='user'?'You':'Assistant'),element('div',content));return item;}
ui.mode.addEventListener('change', () => {
  $('#ask-controls').classList.toggle('hidden', ui.mode.value !== 'ask');
  modelControl.classList.toggle('hidden',ui.mode.value!=='ask');effortControl.classList.toggle('hidden',ui.mode.value!=='ask');
  ui.conversation.classList.toggle('hidden',ui.mode.value!=='ask');
  ui.search.textContent = ui.mode.value === 'ask' ? 'Send' : 'Find parts';
  ui.results.classList.add('hidden');
  checkConfiguration();
});
$('#new-conversation').addEventListener('click', () => {conversation=[];ui.conversation.replaceChildren();ui.query.value='';ui.results.classList.add('hidden');ui.interpreted.classList.add('hidden');$('#welcome').classList.remove('hidden');ui.query.focus();});
ui.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if(searching) {++searchGeneration;if(activeJob)fetch(`/api/components/jobs/${activeJob}`,{method:'DELETE'}).catch(()=>{});activeJob=null;setSearching(false);showMessage('Stopped. Your message is preserved.');return;}
  const query = ui.query.value.trim();
  if (!query) return showMessage("Describe the component you need first.", true);
  const generation = ++searchGeneration;
  if(activeJob)fetch(`/api/components/jobs/${activeJob}`,{method:'DELETE'}).catch(()=>{});
  activeJob=null;
  setSearching(true);
  $('#welcome').classList.add('hidden');
  if(ui.mode.value==='ask')ui.conversation.append(chatMessage('user',query));
  ui.results.classList.add("hidden");
  ui.interpreted.classList.add("hidden");
  showMessage(`Understanding your request and checking ${ui.supplier.value === "lcsc" ? "JLCPCB" : "DigiKey"} stock…`);
  try {
    const asking = ui.mode.value === 'ask';
    let job = await postJson(asking ? '/api/ask/jobs' : "/api/components/jobs", { query, supplier: ui.supplier.value, quantity: 1, preferBasic: ui.preferBasic.checked,
      ...(asking ? {provider:ui.provider.value,history:conversation,model:modelControl.value,effort:effortControl.value} : {}) });
    if(generation!==searchGeneration){fetch(`/api/components/jobs/${job.id}`,{method:'DELETE'}).catch(()=>{});return;}
    activeJob=job.id;
    let revision=-1;
    while(true) {
      if(generation!==searchGeneration)return;
      if(job.result && job.revision!==revision) {
        renderResults(job.result);revision=job.revision;
        if(job.status==='running')showMessage('Parts found. Review and CAD preparation are updating…');
      }
      if(job.status==='complete')break;
      if(job.status!=='running')throw new Error(job.error||'Search cancelled.');
      await new Promise(resolve=>setTimeout(resolve,150));
      if(generation!==searchGeneration)return;
      const response=await fetch(`/api/components/jobs/${job.id}`);
      job=await response.json();
      if(!response.ok)throw new Error(job.error||'Search unavailable.');
    }
    const result=job.result;
    if (result.assistant) {
      const assistant = result.assistant;
      conversation.push({role:'user',content:query},{role:'assistant',content:`${assistant.answer}\nSearch context: ${assistant.context || assistant.query}`});
      ui.conversation.append(chatMessage('assistant',assistant.answer));
      showMessage(`${assistant.model} · ${assistant.effort} reasoning`);
      ui.query.value='';
    }
    if (result.conversationOnly) {ui.interpreted.classList.add('hidden');ui.results.classList.add('hidden');return;}
    showMessage(result.candidates.length
      ? `Found ${result.candidates.length} in-stock options. The best overall match is first.`
      : "No in-stock match was found. Try describing the part with fewer restrictions.", !result.candidates.length);
  } catch (error) {
    if(generation===searchGeneration)showMessage(error.message, true);
  } finally {
    if(generation===searchGeneration){activeJob=null;setSearching(false);}
  }
});

function renderResults({ component, candidates, review, assistant }) {
  const details = [...component.requirements, ...component.assumptions.map((item) => `Assumption: ${item}`)];
  ui.interpreted.replaceChildren(element("strong", component.summary), element("p", details.join(" · ")));
  if (assistant) ui.interpreted.prepend(element('p',assistant.answer));
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
  heading.append(element("strong", candidate.manufacturerPartNumber || candidate.supplierPartNumber));
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
  facts.append(fact("Supplier part", candidate.supplierPartNumber || candidate.digiKeyPartNumber));
  if (candidate.libraryType) facts.append(fact("Assembly library", candidate.libraryType));
  card.append(facts);
  if (candidate.stockSource) card.append(element("p", `Stock source: ${candidate.stockSource}. Recheck availability when ordering.`, "hint"));
  const assets = candidate.kicadAssets;
  if(candidate.reviewPending)card.append(element('p','Review in progress…','hint'));
  if(assets?.pending)card.append(element('p','Preparing symbol and footprint…','hint'));
  if (assets?.imported) card.append(element("p", "EasyEDA symbol and footprint downloaded and linked for KiCad.", "hint"));
  if (assets?.importError) card.append(element("p", assets.importError, "hint"));
  if (assets && !assets.pending) card.append(element("p", assets.placeable
    ? `Ready for KiCad: ${assets.symbolId} · ${assets.footprintId}`
    : "No safe symbol and footprint pair is available in the installed KiCad libraries.", `asset-note${assets.placeable ? " ready" : ""}`));
  const actions = element("div", "", "card-actions");
  for(const audit of [candidate.verification,assets?.validation]) {
    for(const [key,label] of [['checked','Verified'],['unknown','Check manually']])
      if(audit?.[key]?.length)card.append(element('p',`${label}: ${audit[key].join(' ')}`,'hint'));
  }
  if (candidate.productUrl) {
    const link = element("a", candidate.supplier === "lcsc" ? "Open on JLCPCB" : "Open on DigiKey", "text-link");
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
  return Boolean(review && ((candidate.supplierPartNumber && candidate.supplierPartNumber === review.selectedSupplierPartNumber)
    || (candidate.digiKeyPartNumber && candidate.digiKeyPartNumber === review.selectedDigiKeyPartNumber)
    || (candidate.manufacturerPartNumber && candidate.manufacturerPartNumber === review.selectedManufacturerPartNumber)));
}

async function checkConfiguration() {
  try {
    if(ui.mode.value==='ask' && ui.provider.value==='codex') {
      const response=await fetch('/api/ask/account');const account=await response.json();
      ui.apiStatus.textContent=response.ok&&account.connected?'Codex account connected':'Codex sign-in needed';
      ui.apiStatus.className=`api-status ${response.ok&&account.connected?'ready':'partial'}`;
      return;
    }
    const configuration = await (await fetch("/api/status")).json();
    const available = ui.supplier.value === "lcsc" || configuration.digikey;
    const enabled = [configuration.openai && "AI", available && (ui.supplier.value === "lcsc" ? "JLCPCB / LCSC" : "DigiKey")].filter(Boolean);
    ui.apiStatus.textContent = enabled.length === 2 ? `${enabled.join(" + ")} ready` : `${enabled.join(" + ") || "Setup required"}`;
    ui.apiStatus.className = `api-status ${enabled.length === 2 ? "ready" : "partial"}`;
  } catch {
    ui.apiStatus.textContent = "Service unavailable";
    ui.apiStatus.className = "api-status partial";
  }
}

function setSearching(searching) {
  setSearchState(searching);
  ui.mode.disabled = searching;
  ui.provider.disabled = searching;
  $('#new-conversation').disabled = searching;
  ui.preferBasic.disabled = searching;
  ui.search.disabled = false;
  ui.supplier.disabled = searching;
  ui.search.textContent = searching ? "Search again" : "Find parts";
  ui.query.disabled=searching;modelControl.disabled=searching;effortControl.disabled=searching;
  ui.search.disabled=false;ui.search.textContent=searching?'Stop':ui.mode.value==='ask'?'Send':'Find parts';
}
function setSearchState(value) {searching=value;}

async function postJson(url, body) {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "The request failed.");
  return data;
}

function fact(label, value) { const item = element("div"); item.append(element("span", label), element("strong", value)); return item; }
function element(name, text = "", className = "") { const item = document.createElement(name); item.textContent = text; item.className = className; return item; }
function showMessage(text, error = false) { ui.message.textContent = text; ui.message.className = `message${error ? " error" : ""}`; }
loadModels();
