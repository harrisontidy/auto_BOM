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
  const query = buildSearchQuery(component);
  const token = await getToken(host, environment);
  const response = await fetch(`${host}/products/v4/search/keyword`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`, "Content-Type": "application/json", "X-DIGIKEY-Client-Id": environment.DIGIKEY_CLIENT_ID,
      "X-DIGIKEY-Locale-Site": environment.DIGIKEY_SITE || "CA", "X-DIGIKEY-Locale-Language": environment.DIGIKEY_LANGUAGE || "en",
      "X-DIGIKEY-Locale-Currency": environment.DIGIKEY_CURRENCY || "CAD",
    },
    body: JSON.stringify({
      Keywords: query, Limit: 12, Offset: 0,
      FilterOptionsRequest: { MinimumQuantityAvailable: Math.max(component.quantity || 1, 1), MarketPlaceFilter: "ExcludeMarketPlace", SearchOptions: ["InStock", "NormallyStocking"] },
    }),
  });
  if (response.status === 403) {
    throw new Error(`DigiKey denied Product Information V4 for this ${environment.DIGIKEY_ENV === "production" ? "production" : "sandbox"} Client ID. Use credentials from the same DigiKey app that has Product Information V4 enabled.`);
  }
  const data = await readJson(response, "DigiKey search");
  const seen = new Set();
  const candidates = [...(data.ExactMatches || []), ...(data.Products || [])].map(normalizeProduct).filter((candidate) => {
    const key = candidate.digiKeyPartNumber || candidate.manufacturerPartNumber;
    if (!key || seen.has(key)) return false;
    seen.add(key); return true;
  }).sort(compareCandidates).slice(0, 8);
  return { query, candidates };
}

function normalizeProduct(product) {
  const variation = [...(product.ProductVariations || [])].sort((a, b) => variationScore(b) - variationScore(a))[0] || {};
  const pricing = variation.StandardPricing || product.StandardPricing || [];
  const unitPrice = pricing[0]?.UnitPrice ?? product.UnitPrice;
  const checks = [];
  if (product.Discontinued || product.EndOfLife) checks.push("Lifecycle warning");
  if ((product.QuantityAvailable || 0) < 1) checks.push("Out of stock");
  return {
    digiKeyPartNumber: variation.DigiKeyProductNumber || "", manufacturerPartNumber: product.ManufacturerProductNumber || "",
    manufacturer: product.Manufacturer?.Name || "Unknown", description: product.Description?.ProductDescription || product.Description?.DetailedDescription || "",
    quantityAvailable: variation.QuantityAvailableforPackageType ?? product.QuantityAvailable ?? 0,
    minimumOrderQuantity: variation.MinimumOrderQuantity || 1,
    packageType: variation.PackageType?.Name || "",
    unitPrice: Number.isFinite(unitPrice) ? unitPrice : null,
    currency: "CAD", status: product.ProductStatus?.Status || product.ProductStatus?.StatusName || "Unknown", productUrl: product.ProductUrl || "",
    datasheetUrl: product.DatasheetUrl || "", parameters: Object.fromEntries((product.Parameters || []).map((p) => [p.ParameterText, p.ValueText])), checks,
  };
}

function variationScore(variation) {
  const packageBonus = /cut tape/i.test(variation.PackageType?.Name || "") ? 1e12 : 0;
  const inStock = variation.QuantityAvailableforPackageType || 0;
  const lowMinimumBonus = variation.MinimumOrderQuantity <= 1 ? 1e9 : 0;
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
