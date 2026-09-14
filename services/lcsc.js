import { buildSearchQueries, candidateCanFulfill, isCompatibleCandidate, isExactPartNumberMatch } from "./digikey.js";
import { catalogQueries, matchesRelayRequirements } from './component-request.js';
import { matchesCatalogRules } from './catalog-rules.js';
import { discoveryIntent } from './search-intent.js';
import { supplierCategoryIntent } from './supplier-categories.js';
import { assessSpecifications } from './specification-checks.js';

// Public JLCPCB parts-catalog endpoint, also used by kicad_jlcimport.
// This is not LCSC's credentialed partner API. Fail visibly if the website API changes.
const SEARCH_URL = "https://jlcpcb.com/api/overseas-pcb-order/v1/shoppingCart/smtGood/selectSmtComponentList";
let activeRequests = 0;
const requestWaiters = [];
async function withCatalogSlot(request) {
  if (activeRequests >= 2) await new Promise(resolve => requestWaiters.push(resolve));
  else activeRequests++;
  try { return await request(); }
  finally {
    const next = requestWaiters.shift();
    if (next) next();
    else activeRequests--;
  }
}
const successfulQueries = new Map();

export async function searchJlcpcb(component, environment = process.env, fetchImpl = fetch) {
  const rejectedSpecifications = new Set();
  const quantity = Math.max(1, Number(component.quantity) || 1);
  const explicit = String(component.supplierPartNumber || "").trim();
  const intent = !explicit && (!component.fastPath || component.fastPath==='category')
    ? component.discoveryRetry ? supplierCategoryIntent({...component,originalQuery:''})
      : discoveryIntent(component) || supplierCategoryIntent(component) : null;
  const planned = Array.isArray(component.searchQueries) ? component.searchQueries.filter(q => typeof q === 'string' && q.trim()).slice(0, 3) : [];
  let queries = explicit ? [explicit] : intent ? [...new Set([...intent.queries,...planned])]
    : catalogQueries(component, [...new Set([...planned, passiveQuery(component), ...buildSearchQueries(component)].filter(Boolean))]);
  const queryKey=JSON.stringify(queries), remembered=successfulQueries.get(queryKey);
  if(remembered?.expires>Date.now() && queries.includes(remembered.query))queries=[remembered.query,...queries.filter(q=>q!==remembered.query)];
  if (!queries.length) throw new Error("Enter an LCSC C-number, manufacturer part number, or component description.");
  let lastQuery = queries[0];
  const preferBasic = component.preferBasic ?? environment.PREFER_BASIC !== "false";
  // Search the Basic catalog first: sorting an arbitrary first page misses common Basic parts.
  for (const libraryFilter of preferBasic && !explicit ? ["base", ""] : [""]) {
  for (const query of queries.slice(0, 3)) {
    lastQuery = query;
    const candidates = [];
    const seen = new Set();
    for (let page = 1; page <= (intent ? 3 : 2); page++) {
      const request = async () => {
        const response = await fetchImpl(SEARCH_URL, {
          method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ keyword: query, currentPage: page, pageSize: 50, ...(libraryFilter ? { componentLibraryType: libraryFilter } : {}) }),
          signal: environment.SEARCH_SIGNAL ? AbortSignal.any([environment.SEARCH_SIGNAL, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000),
        });
        if (!response.ok) throw new Error(`JLCPCB catalog unavailable (${response.status}). Try again later; no other supplier was substituted.`);
        const data = await response.json();
        const info = data?.data?.componentPageInfo;
        // JLCPCB represents a valid empty filtered result as list:null, total:0.
        if (Number(data.code) === 200 && info?.total === 0 && info.list === null) return { ...info, list: [] };
        if (Number(data.code) !== 200 || !Array.isArray(info?.list)) throw new Error("JLCPCB returned an unexpected catalog response. Stock could not be verified.");
        return info;
      };
      // Bound traffic while letting an interactive lookup overlap another BOM request.
      const info = await withCatalogSlot(request);
      for (const item of info.list) {
        const candidate = normalizeJlcpcbProduct(item, quantity);
        if (libraryFilter === "base" && candidate.libraryType !== "Basic") continue;
        if (!candidate.lcscPartNumber || !candidate.manufacturerPartNumber || seen.has(candidate.lcscPartNumber)) continue;
        if (!candidateCanFulfill(candidate, quantity) || candidate.checks.length) continue;
        const exactMatch = /^C\d+$/i.test(explicit) ? candidate.lcscPartNumber === explicit.toUpperCase() : isExactPartNumberMatch(explicit, candidate);
        if (explicit ? !exactMatch : !isCompatibleCandidate(component, candidate)) continue;
        if (!explicit && !matchesRelayRequirements(component, candidate)) continue;
        if (!explicit && !matchesCatalogRules(component, candidate)) continue;
        const specifications=assessSpecifications(component,candidate);
        if (specifications.mismatches.length) {
          for(const note of specifications.mismatches)if(rejectedSpecifications.size<4)rejectedSpecifications.add(note);
          continue;
        }
        if (intent && !intent.category.test(candidate.description || '')) continue;
        if (intent) candidate.discoveryNote = [intent.note, intent.alternative?.(candidate)].filter(Boolean).join(' ');
        if (component.discoveryRetry) candidate.discoveryNote = `Broader related search result for "${component.originalQuery}". This is an alternative to review against the original requirements. ${candidate.discoveryNote || ''}`;
        seen.add(candidate.lcscPartNumber);
        candidates.push(candidate);
      }
      if (candidates.length >= 8 || info.list.length < 50 || page * 50 >= Number(info.total)) break;
    }
    if (candidates.length) {
      successfulQueries.set(queryKey,{query,expires:Date.now()+600_000});
      if(successfulQueries.size>256)successfulQueries.delete(successfulQueries.keys().next().value);
      return {
      query, supplier: "lcsc", stockSource: "JLCPCB parts catalog", checkedAt: new Date().toISOString(),
      candidates: candidates.sort((a, b) => (component.manufacturerFamily ? Number(b.manufacturerPartNumber.toUpperCase() === component.manufacturerFamily.toUpperCase()) - Number(a.manufacturerPartNumber.toUpperCase() === component.manufacturerFamily.toUpperCase()) : 0)
        || (preferBasic ? Number(b.libraryType === "Basic") - Number(a.libraryType === "Basic") : 0)
        || (a.unitPrice ?? Infinity) - (b.unitPrice ?? Infinity)).slice(0, 8),
      };
    }
  }
  }
  return { query: lastQuery, supplier: "lcsc", candidates: [], searchNotes: rejectedSpecifications.size
    ? ['Returned parts did not satisfy the original specifications.',...rejectedSpecifications]
    : intent ? ['No stocked matching category was found in the searched JLCPCB catalog pages. Some displays, motors and modules may need separate sourcing.'] : [] };
}

function passiveQuery(component) {
  const type = String(component.componentType || '').toLowerCase();
  const kind = /resistor/.test(type) ? 'resistor' : /capacitor/.test(type) ? 'capacitor' : /inductor/.test(type) ? 'inductor' : '';
  if (!kind || /array|network|variable/.test(type)) return '';
  const value = String(component.normalizedValue || component.value || '').replaceAll('Ω', 'ohm').replace(/[µμ]/g, 'u').replace(/\s+/g, '');
  const size = String(component.footprint || component.package || '').match(/(?:^|[^0-9])(0201|0402|0603|0805|1206|1210)(?:[^0-9]|$)/)?.[1];
  return value && size ? `${value} ${size} ${kind}` : '';
}

function number(value, fallback = null) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value)) ? Number(value) : fallback;
}
function httpsUrl(value) {
  try { const url = new URL(value); return url.protocol === "https:" ? url.href : ""; } catch { return ""; }
}

export function normalizeJlcpcbProduct(item, quantity = 1) {
  const lcscPartNumber = /^C\d+$/i.test(item.componentCode || "") ? item.componentCode.toUpperCase() : "";
  const prices = (Array.isArray(item.componentPrices) ? item.componentPrices : [])
    .filter((tier) => number(tier.startNumber) !== null && number(tier.productPrice) !== null)
    .sort((a, b) => Number(a.startNumber) - Number(b.startNumber));
  // minPurchaseNum is the catalog's purchase minimum. leastPatchNumber is not MOQ.
  const minimumOrderQuantity = Math.max(1, number(item.minPurchaseNum, 1));
  const orderQuantity = Math.max(quantity, minimumOrderQuantity);
  const tier = prices.filter((p) => Number(p.startNumber) <= orderQuantity
    && (number(p.endNumber, -1) < 0 || Number(p.endNumber) >= orderQuantity)).at(-1);
  const quantityAvailable = Math.max(0, number(item.stockCount, 0));
  const parameters = Object.fromEntries((Array.isArray(item.attributes) ? item.attributes : [])
    .filter((a) => typeof a.attribute_name_en === "string" && a.attribute_value_name != null)
    .map((a) => [a.attribute_name_en, String(a.attribute_value_name)]));
  parameters["Package / Case"] = item.componentSpecificationEn || "";
  const checks = [];
  if (quantityAvailable < quantity) checks.push("Insufficient JLCPCB stock");
  if (item.isBuyComponent === "0" || item.isBuyComponent === 0 || item.isBuyComponent === false) checks.push(item.noBuyReason || "Not available to order");
  return {
    supplier: "lcsc", supplierPartNumber: lcscPartNumber, lcscPartNumber,
    manufacturerPartNumber: item.componentModelEn || "", manufacturer: item.componentBrandEn || "Unknown",
    description: item.describe || item.componentName || "", parameters,
    quantityAvailable, minimumOrderQuantity, unitPrice: tier ? number(tier.productPrice) : null, currency: "USD",
    libraryType: item.componentLibraryType === "base" ? "Basic" : item.componentLibraryType === "expand" ? "Extended" : "Unknown",
    packageType: item.componentSpecificationEn || "", status: checks.length ? "Needs review" : "In stock",
    stockSource: "JLCPCB parts catalog", stockCheckedAt: new Date().toISOString(),
    productUrl: `https://jlcpcb.com/partdetail/${encodeURIComponent(lcscPartNumber)}`,
    lcscUrl: httpsUrl(item.lcscGoodsUrl), datasheetUrl: httpsUrl(item.dataManualUrl), checks,
  };
}
