let cachedToken = null;

export function buildSearchQuery(component) {
  if (component.supplierPartNumber) return component.supplierPartNumber.trim();
  if (component.aiSearchTerms) return component.aiSearchTerms.trim();
  const searchableValue = (component.normalizedValue || component.value || "").replaceAll("Ω", "ohm").replaceAll("µ", "u");
  return [component.componentType, searchableValue, simplifyFootprint(component.footprint)].filter(Boolean).join(" ").trim();
}

export async function searchDigiKey(component, environment = process.env) {
  requireVariables(environment, ["DIGIKEY_CLIENT_ID", "DIGIKEY_CLIENT_SECRET"]);
  const host = environment.DIGIKEY_ENV === "production" ? "https://api.digikey.com" : "https://sandbox-api.digikey.com";
  const token = await getToken(host, environment);
  const queries = buildSearchQueries(component);
  let lastResult = { query: queries[0] || "", candidates: [] };
  for (const query of queries) {
    lastResult = await runKeywordSearch(host, token, query, component, environment);
    if (lastResult.candidates.length) return lastResult;
  }
  return lastResult;
}

export function buildSearchQueries(component) {
  const explicitPartNumber = String(component.supplierPartNumber || "").trim();
  if (explicitPartNumber) return [explicitPartNumber];
  const fallbackFirst = component.componentType === "Capacitor";
  return [...new Set([
    buildSpecializedQuery(component),
    fallbackFirst ? buildFallbackQuery(component) : buildSearchQuery(component),
    fallbackFirst ? buildSearchQuery(component) : buildFallbackQuery(component),
  ].filter(Boolean))];
}

export function isExactPartNumberMatch(requestedPartNumber, candidate) {
  const requested = normalizePartNumber(requestedPartNumber);
  if (!requested) return true;
  return [candidate.manufacturerPartNumber, candidate.digiKeyPartNumber]
    .some((partNumber) => normalizePartNumber(partNumber) === requested);
}

export function isCompatibleCandidate(component, candidate) {
  const explicitPartNumber = String(component.supplierPartNumber || "").trim();
  if (explicitPartNumber) return isExactPartNumberMatch(explicitPartNumber, candidate);
  const type = String(component.componentType || "").toLowerCase();
  const parameterName = /resistor/.test(type) ? "Resistance"
    : /capacitor/.test(type) ? "Capacitance"
      : /inductor|choke/.test(type) ? "Inductance" : "";
  if (parameterName) {
    const requestedValue = parseEngineeringValue(component.normalizedValue || component.value, parameterName);
    const candidateValue = parseEngineeringValue(candidate.parameters?.[parameterName], parameterName);
    if (requestedValue !== null && (candidateValue === null || !approximatelyEqual(requestedValue, candidateValue))) return false;
  }
  const packageSize = simplifyFootprint(component.footprint);
  if (/^(0201|0402|0603|0805|1206|1210)$/.test(packageSize)) {
    const candidatePackage = String(candidate.parameters?.["Package / Case"] || "");
    if (!new RegExp(`(?:^|[^0-9])${packageSize}(?:[^0-9]|$)`, "i").test(candidatePackage)) return false;
  }
  return true;
}

export function buildSpecializedQuery(component) {
  const type = String(component.componentType || "");
  if (!/regulator|converter|power management/i.test(type)) return "";
  const text = [component.originalQuery, component.summary, component.value, ...(component.requirements || []), component.aiSearchTerms].filter(Boolean).join(" ");
  const labeledOutput = text.match(/(?:output(?:\s+of)?|regulated\s+to|\bto)\s*(\d+(?:\.\d+)?)\s*V/i)?.[1]
    || text.match(/(\d+(?:\.\d+)?)\s*V\s*(?:output|out\b)/i)?.[1];
  const inputVoltage = text.match(/(\d+(?:\.\d+)?)\s*V\s*(?:input|in\b)/i)?.[1];
  const voltages = [...text.matchAll(/(\d+(?:\.\d+)?)\s*V\b/gi)].map((match) => match[1]);
  const outputVoltage = labeledOutput || voltages.find((voltage) => voltage !== inputVoltage) || voltages[0];
  const outputCurrent = text.match(/(\d+(?:\.\d+)?)\s*A/i)?.[1];
  const topology = /\bbuck\b|step[ -]?down/i.test(text) ? "buck"
    : /\bboost\b|step[ -]?up/i.test(text) ? "boost"
      : /\blinear\b|\bldo\b/i.test(text) ? "linear" : "switching";
  return [outputVoltage && `${outputVoltage}V`, outputCurrent && `${outputCurrent}A`, topology, "regulator"].filter(Boolean).join(" ");
}

async function runKeywordSearch(host, token, query, component, environment) {
  const requestedQuantity = Math.max(Number(component.quantity) || 1, 1);
  const response = await fetch(`${host}/products/v4/search/keyword`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`, "Content-Type": "application/json", "X-DIGIKEY-Client-Id": environment.DIGIKEY_CLIENT_ID,
      "X-DIGIKEY-Locale-Site": environment.DIGIKEY_SITE || "CA", "X-DIGIKEY-Locale-Language": environment.DIGIKEY_LANGUAGE || "en",
      "X-DIGIKEY-Locale-Currency": environment.DIGIKEY_CURRENCY || "CAD",
    },
    body: JSON.stringify({ Keywords: query, Limit: 12, Offset: 0, FilterOptionsRequest: {
      MinimumQuantityAvailable: requestedQuantity, MarketPlaceFilter: "ExcludeMarketPlace", SearchOptions: ["InStock", "NormallyStocking"],
    } }),
  });
  if (response.status === 403) throw new Error(`DigiKey denied Product Information V4 for this ${environment.DIGIKEY_ENV === "production" ? "production" : "sandbox"} Client ID. Use credentials from the same DigiKey app that has Product Information V4 enabled.`);
  const data = await readJson(response, "DigiKey search");
  const seen = new Set();
  const candidates = [...(data.ExactMatches || []), ...(data.Products || [])].map((product) => normalizeProduct(product, requestedQuantity)).filter((candidate) => {
    const key = candidate.digiKeyPartNumber || candidate.manufacturerPartNumber;
    if (!key || seen.has(key) || !candidateCanFulfill(candidate, requestedQuantity)
        || !isCompatibleCandidate(component, candidate)) return false;
    seen.add(key); return true;
  }).sort(compareCandidates).slice(0, 8);
  return { query, candidates };
}

export function buildFallbackQuery(component) {
  const value = searchValue(component);
  const packageName = simplifyFootprint(component.footprint);
  if (component.componentType === "Capacitor") {
    const construction = /CP_|Radial/i.test(component.footprint || "") ? "electrolytic" : "ceramic";
    return [value, packageName, construction, "capacitor"].filter(Boolean).join(" ").trim();
  }
  return [value, packageName, component.componentType].filter(Boolean).join(" ").trim();
}

function searchValue(component) {
  const value = (component.normalizedValue || component.value || "").replaceAll("Ω", "ohm").replaceAll("µ", "u");
  if (component.componentType !== "Capacitor") return value;
  const nanofarads = value.match(/^(\d+(?:\.\d+)?)\s*nF$/i);
  if (nanofarads && Number(nanofarads[1]) >= 100) return `${Number(nanofarads[1]) / 1000}uF`;
  return value.replace(/\s+/g, "");
}

export function normalizeProduct(product, requestedQuantity = 1) {
  const variation = selectProductVariation(product.ProductVariations || [], requestedQuantity);
  const pricing = variation.StandardPricing || product.StandardPricing || [];
  const priceTier = [...pricing].filter((tier) => Number(tier.BreakQuantity || 1) <= requestedQuantity)
    .sort((a, b) => Number(b.BreakQuantity || 1) - Number(a.BreakQuantity || 1))[0] || pricing[0];
  const unitPrice = priceTier?.UnitPrice ?? product.UnitPrice;
  const checks = [];
  if (product.Discontinued || product.EndOfLife) checks.push("Lifecycle warning");
  if ((variation.QuantityAvailableforPackageType || 0) < requestedQuantity) checks.push("Out of stock");
  return {
    digiKeyPartNumber: variation.DigiKeyProductNumber || "", manufacturerPartNumber: product.ManufacturerProductNumber || "",
    manufacturer: product.Manufacturer?.Name || "Unknown", description: product.Description?.ProductDescription || product.Description?.DetailedDescription || "",
    quantityAvailable: variation.QuantityAvailableforPackageType ?? 0,
    minimumOrderQuantity: variation.MinimumOrderQuantity || 1,
    packageType: variation.PackageType?.Name || "",
    unitPrice: Number.isFinite(unitPrice) ? unitPrice : null,
    currency: "CAD", status: product.ProductStatus?.Status || product.ProductStatus?.StatusName || "Unknown", productUrl: product.ProductUrl || "",
    datasheetUrl: product.DatasheetUrl || "", parameters: Object.fromEntries((product.Parameters || []).map((p) => [p.ParameterText, p.ValueText])), checks,
  };
}

export function selectProductVariation(variations, requestedQuantity = 1) {
  const needed = Math.max(Number(requestedQuantity) || 1, 1);
  return [...variations]
    .filter((variation) => Number(variation.QuantityAvailableforPackageType || 0) >= needed
      && Number(variation.MinimumOrderQuantity || 1) <= needed)
    .sort((a, b) => variationScore(b, needed) - variationScore(a, needed))[0] || {};
}

export function candidateCanFulfill(candidate, requestedQuantity = 1) {
  const needed = Math.max(Number(requestedQuantity) || 1, 1);
  return Number(candidate?.quantityAvailable || 0) >= needed
    && Number(candidate?.minimumOrderQuantity || 1) <= needed;
}

function variationScore(variation, requestedQuantity = 1) {
  const packageBonus = /cut tape/i.test(variation.PackageType?.Name || "") ? 1e12 : 0;
  const inStock = variation.QuantityAvailableforPackageType || 0;
  const lowMinimumBonus = Number(variation.MinimumOrderQuantity || 1) <= requestedQuantity ? 1e9 : 0;
  return packageBonus + lowMinimumBonus + inStock;
}

function compareCandidates(a, b) {
  const aAvailable = a.quantityAvailable > 0 ? 0 : 1;
  const bAvailable = b.quantityAvailable > 0 ? 0 : 1;
  if (aAvailable !== bAvailable) return aAvailable - bAvailable;
  const aPrice = a.unitPrice ?? Number.POSITIVE_INFINITY;
  const bPrice = b.unitPrice ?? Number.POSITIVE_INFINITY;
  if (aPrice !== bPrice) return aPrice - bPrice;
  return a.minimumOrderQuantity - b.minimumOrderQuantity;
}

async function getToken(host, environment) {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) return cachedToken.value;
  const body = new URLSearchParams({ client_id: environment.DIGIKEY_CLIENT_ID, client_secret: environment.DIGIKEY_CLIENT_SECRET, grant_type: "client_credentials" });
  const response = await fetch(`${host}/v1/oauth2/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  const data = await readJson(response, "DigiKey authentication");
  cachedToken = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return cachedToken.value;
}

function simplifyFootprint(footprint = "") {
  const size = footprint.match(/(?:^|[_:])(0201|0402|0603|0805|1206|1210)(?:_|$)/i);
  return size ? size[1] : footprint.split(":").at(-1).replaceAll("_", " ");
}
function parseEngineeringValue(value, parameterName) {
  const text = String(value || "").trim().replaceAll(",", "").replaceAll("µ", "u").replaceAll("Ω", "ohm");
  const units = parameterName === "Resistance" ? "(?:ohms?)"
    : parameterName === "Capacitance" ? "(?:f|farads?)"
      : "(?:h|henrys?)";
  const match = text.match(new RegExp(`(-?\\d+(?:\\.\\d+)?)\\s*([pnumkM]?)\\s*${units}\\b`, "i"));
  if (!match) return null;
  const rawPrefix = match[2];
  const scale = rawPrefix === "p" || rawPrefix === "P" ? 1e-12
    : rawPrefix === "n" || rawPrefix === "N" ? 1e-9
      : rawPrefix === "u" || rawPrefix === "U" ? 1e-6
        : rawPrefix === "m" ? 1e-3
          : rawPrefix === "k" || rawPrefix === "K" ? 1e3
            : rawPrefix === "M" ? 1e6 : 1;
  return Number(match[1]) * scale;
}
function approximatelyEqual(left, right) {
  return Math.abs(left - right) <= Math.max(Math.abs(left), Math.abs(right), 1e-30) * 1e-6;
}
function normalizePartNumber(value = "") { return String(value).trim().toUpperCase().replace(/[^A-Z0-9]/g, ""); }
function requireVariables(environment, names) { const missing = names.filter((name) => !environment[name]); if (missing.length) throw new Error(`DigiKey is not configured. Add ${missing.join(" and ")} to your environment.`); }
async function readJson(response, label) {
  const rawBody = await response.text();
  let data = {};
  try { data = rawBody ? JSON.parse(rawBody) : {}; } catch { data = {}; }
  if (!response.ok) {
    const gatewayCode = response.headers.get("x-mashery-error-code");
    const detail = data.Detail || data.title || data.message || gatewayCode || rawBody.trim() || response.statusText || "Unknown error";
    throw new Error(`${label} failed (${response.status}): ${detail}`);
  }
  return data;
}
