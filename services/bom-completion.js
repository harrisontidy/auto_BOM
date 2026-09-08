import { applyAiInterpretation, parseCsv } from "../parser.js";
import { interpretBomCsv, reviewCandidates } from "./ai.js";
import { isExactPartNumberMatch, searchDigiKey } from "./digikey.js";
import { resolveKiCadAssets } from "./kicad-assets.js";

const MIN_AI_CONFIDENCE = 0.7;

export async function completeSchematicBom(symbols, environment = process.env, dependencies = {}) {
  validateSymbols(symbols);
  const services = {
    interpretBomCsv: dependencies.interpretBomCsv || interpretBomCsv,
    reviewCandidates: dependencies.reviewCandidates || reviewCandidates,
    searchDigiKey: dependencies.searchDigiKey || searchDigiKey,
    resolveKiCadAssets: dependencies.resolveKiCadAssets || resolveKiCadAssets,
  };
  if (!symbols.length) return { summary: "The schematic has no BOM parts.", completed: 0, failed: 0, parts: [] };

  const normalizedSymbols = mergeSymbolsByReference(symbols);
  const csv = symbolsToCsv(normalizedSymbols);
  let parts = parseCsv(csv);
  let aiFallback = false;
  if (environment.OPENAI_API_KEY) {
    try {
      const interpreted = await services.interpretBomCsv(csv, parts, environment);
      if (!Array.isArray(interpreted?.parts) || !interpreted.parts.length) throw new Error("AI BOM interpretation returned no parts.");
      parts = parts.map((original) => {
        const ai = interpreted.parts.find((part) => part.references?.some((reference) => original.references.includes(reference)))
          || interpreted.parts.find((part) => part.id === original.id) || {};
        const interpretedPart = applyAiInterpretation(original, ai);
        interpretedPart.warnings = [...new Set([...(interpretedPart.warnings || []), ...(original.warnings || [])])];
        return interpretedPart;
      });
    } catch {
      aiFallback = true;
    }
  }

  const byReference = new Map(normalizedSymbols.map((symbol) => [symbol.reference, symbol]));
  const tasks = parts.map((part) => async () => completePart(part, byReference, environment, services));
  const completedParts = await runWithConcurrency(tasks, 3);
  const completed = completedParts.filter((part) => part.status === "completed" || part.status === "already assigned").length;
  const failed = completedParts.length - completed;
  const summary = failed
      ? `Completed ${completed} of ${completedParts.length} BOM lines; ${failed} need review.`
      : `Completed all ${completedParts.length} BOM lines and saved their DigiKey selections.`;
  return {
    summary: aiFallback ? `${summary} AI parsing was unavailable, so standard BOM parsing was used.` : summary,
    completed,
    failed,
    aiFallback,
    parts: completedParts,
  };
}

async function completePart(part, byReference, environment, services) {
  const sourceSymbols = part.references.map((reference) => byReference.get(reference)).filter(Boolean);
  const incompleteSymbols = sourceSymbols.filter((symbol) =>
    !String(symbol.digiKeyPartNumber || "").trim() || !String(symbol.manufacturerPartNumber || "").trim());
  const existingDigiKeyNumbers = new Map();
  for (const symbol of sourceSymbols) {
    const partNumber = String(symbol.digiKeyPartNumber || "").trim();
    if (partNumber) existingDigiKeyNumbers.set(normalizeIdentifier(partNumber), partNumber);
  }
  const existingDigiKey = [...existingDigiKeyNumbers.values()][0] || "";
  const existingMpn = (incompleteSymbols.find((symbol) => String(symbol.manufacturerPartNumber || "").trim())
    || sourceSymbols.find((symbol) => String(symbol.manufacturerPartNumber || "").trim()))?.manufacturerPartNumber || "";
  const existingDatasheet = sourceSymbols.find((symbol) => String(symbol.datasheetUrl || "").trim())?.datasheetUrl || "";
  const existingFootprint = (incompleteSymbols.find((symbol) => String(symbol.footprint || "").trim())
    || sourceSymbols.find((symbol) => String(symbol.footprint || "").trim()))?.footprint || part.footprint || "";

  if (existingDigiKeyNumbers.size > 1) {
    return resultFor(part, {
      references: incompleteSymbols.length
        ? incompleteSymbols.map((symbol) => String(symbol.reference).trim())
        : part.references,
      status: "needs review",
      error: "This grouped BOM line contains conflicting existing DigiKey part numbers.",
    });
  }

  if (!incompleteSymbols.length) {
    return resultFor(part, {
      status: "already assigned", manufacturerPartNumber: existingMpn, digiKeyPartNumber: existingDigiKey,
      datasheetUrl: existingDatasheet, footprintId: existingFootprint,
    });
  }

  const references = incompleteSymbols.map((symbol) => String(symbol.reference).trim());

  if (existingDigiKey) {
    return completeFromExistingDigiKey(part, references, existingDigiKey, existingMpn,
      existingDatasheet, existingFootprint, environment, services);
  }

  const searchabilityError = getSearchabilityError(part, existingMpn);
  if (searchabilityError) return resultFor(part, { references, status: "needs review", error: searchabilityError });

  try {
    const searchable = { ...part, supplierPartNumber: String(existingMpn || "").trim() };
    const search = await services.searchDigiKey(searchable, environment);
    const candidates = (search.candidates || []).filter((candidate) => isUsableInStockCandidate(candidate, part.quantity));
    if (!candidates.length) return resultFor(part, { references, status: "needs review", error: "No complete, in-stock DigiKey match was found." });

    let selected;
    if (existingMpn) {
      selected = candidates.find((candidate) => isExactPartNumberMatch(existingMpn, candidate));
      if (!selected) return resultFor(part, { references, status: "needs review", error: `DigiKey did not return an exact match for ${existingMpn}.` });
    } else if (standardPassiveKind(part)) {
      selected = candidates.find((candidate) => isCompatibleStandardPassive(part, candidate));
      if (!selected) return resultFor(part, { references, status: "needs review", error: "No in-stock DigiKey candidate matched the stated value and package." });
    } else {
      if (!environment.OPENAI_API_KEY) {
        return resultFor(part, { references, status: "needs review", error: "AI review is required to choose this type of part safely." });
      }

      try {
        const review = await services.reviewCandidates(searchable, candidates, environment);
        const concerns = Array.isArray(review?.concerns) ? review.concerns.filter(Boolean) : [];
        const confidence = Number(review?.confidence);
        if (concerns.length) {
          return resultFor(part, { references, status: "needs review", error: `AI review raised concerns: ${concerns.join("; ")}` });
        }
        if (!Number.isFinite(confidence) || confidence < MIN_AI_CONFIDENCE) {
          return resultFor(part, { references, status: "needs review", error: "AI confidence was too low to assign this part automatically." });
        }
        selected = findReviewedCandidate(candidates, review);
        if (!selected) throw new Error("AI review did not select one of the supplied DigiKey candidates.");
      } catch (error) {
        return resultFor(part, { references, status: "needs review", error: `AI candidate review failed: ${error.message}` });
      }
    }

    const assets = await services.resolveKiCadAssets(searchable, selected, environment);
    return resultFor(part, {
      references,
      status: "completed",
      manufacturerPartNumber: selected.manufacturerPartNumber,
      digiKeyPartNumber: selected.digiKeyPartNumber,
      datasheetUrl: selected.datasheetUrl,
      manufacturer: selected.manufacturer,
      productUrl: selected.productUrl,
      footprintId: existingFootprint || assets.footprintId,
      stock: selected.quantityAvailable,
      unitPrice: selected.unitPrice,
      currency: selected.currency,
      description: selected.description,
    });
  } catch (error) {
    return resultFor(part, { references, status: "needs review", error: error.message });
  }
}

async function completeFromExistingDigiKey(part, references, digiKeyPartNumber, manufacturerPartNumber,
  datasheetUrl, footprintId, environment, services) {
  const fallback = {
    references,
    status: manufacturerPartNumber ? "completed" : "needs review",
    manufacturerPartNumber,
    digiKeyPartNumber,
    datasheetUrl,
    footprintId,
    error: manufacturerPartNumber ? "" : `Could not enrich ${digiKeyPartNumber} with its manufacturer part number.`,
  };
  try {
    const searchable = { ...part, supplierPartNumber: digiKeyPartNumber };
    const search = await services.searchDigiKey(searchable, environment);
    const selected = (search.candidates || []).find((candidate) => isExactPartNumberMatch(digiKeyPartNumber, candidate));
    if (!selected?.manufacturerPartNumber) return resultFor(part, fallback);
    let assets = { footprintId: "" };
    try { assets = await services.resolveKiCadAssets(searchable, selected, environment); } catch { /* Existing assignment remains authoritative. */ }
    return resultFor(part, {
      ...fallback,
      status: "completed",
      error: "",
      manufacturerPartNumber: selected.manufacturerPartNumber || manufacturerPartNumber,
      digiKeyPartNumber,
      datasheetUrl: selected.datasheetUrl || datasheetUrl,
      manufacturer: selected.manufacturer,
      productUrl: selected.productUrl,
      footprintId: footprintId || assets.footprintId,
      stock: selected.quantityAvailable,
      unitPrice: selected.unitPrice,
      currency: selected.currency,
      description: selected.description,
    });
  } catch {
    return resultFor(part, fallback);
  }
}

function resultFor(part, values) {
  return {
    references: values.references || part.references,
    value: part.normalizedValue || part.value,
    componentType: part.componentType,
    manufacturerPartNumber: values.manufacturerPartNumber || "",
    digiKeyPartNumber: values.digiKeyPartNumber || "",
    datasheetUrl: values.datasheetUrl || "",
    footprintId: values.footprintId || "",
    stock: values.stock ?? null,
    unitPrice: values.unitPrice ?? null,
    currency: values.currency || "CAD",
    description: values.description || "",
    manufacturer: values.manufacturer || "",
    productUrl: values.productUrl || "",
    status: values.status,
    error: values.error || "",
  };
}

export function validateSymbols(symbols) {
  if (!Array.isArray(symbols) || symbols.length > 200) throw new Error("A schematic with at most 200 symbols is required.");
  for (const symbol of symbols) {
    if (!symbol || typeof symbol !== "object" || Array.isArray(symbol)) throw new Error("Every schematic symbol must be an object.");
    if (typeof symbol.reference !== "string") throw new Error("Every schematic symbol reference must be text.");
    const reference = String(symbol.reference || "").trim();
    if (!reference) throw new Error("Every schematic symbol needs a reference.");
    if (reference.length > 128) throw new Error("A schematic symbol reference is too long.");
    for (const field of ["value", "footprint", "manufacturerPartNumber", "digiKeyPartNumber", "datasheetUrl"]) {
      if (symbol[field] != null && typeof symbol[field] !== "string") throw new Error(`${field} must be text for ${reference}.`);
    }
  }
}

function mergeSymbolsByReference(symbols) {
  const merged = new Map();
  for (const symbol of symbols) {
    const reference = symbol.reference.trim();
    const existing = merged.get(reference);
    if (!existing) {
      merged.set(reference, { ...symbol, reference });
      continue;
    }
    for (const field of ["value", "footprint", "manufacturerPartNumber", "digiKeyPartNumber", "datasheetUrl"]) {
      if (!existing[field] && symbol[field]) existing[field] = symbol[field];
    }
  }
  return [...merged.values()];
}

function getSearchabilityError(part, exactPartNumber) {
  if (String(exactPartNumber || "").trim()) return "";
  const value = String(part.value || "").trim();
  if ((part.warnings || []).some((warning) => /value not present|missing (?:an? )?(?:electrical )?value/i.test(warning))) {
    return "The component has no electrical value to search for.";
  }
  const normalizedValue = value.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const referencePrefix = String(part.references?.[0] || "").match(/^[A-Za-z]+/)?.[0]?.toLowerCase() || "";
  const normalizedType = String(part.componentType || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (!normalizedValue || normalizedValue === referencePrefix || normalizedValue === normalizedType
      || ["component", "device", "unknown", "value", "tbd"].includes(normalizedValue)) {
    return `The value "${value || "(blank)"}" is only a placeholder and cannot identify a purchasable part.`;
  }
  const kind = standardPassiveKind(part);
  if (kind && parsePassiveValue(part.normalizedValue || value, kind) == null) {
    return `The ${kind.toLowerCase()} value "${value}" is not a usable electrical value.`;
  }
  return "";
}

function standardPassiveKind(part) {
  const type = String(part.componentType || "").toLowerCase();
  if (type === "resistor") return "Resistor";
  if (type === "capacitor") return "Capacitor";
  if (type === "inductor") return "Inductor";
  return "";
}

function isUsableInStockCandidate(candidate, requestedQuantity = 1) {
  if (!candidate?.manufacturerPartNumber || !candidate?.digiKeyPartNumber) return false;
  const stock = Number(candidate.quantityAvailable);
  if (!Number.isFinite(stock) || stock < Math.max(1, Number(requestedQuantity) || 1)) return false;
  const warnings = [...(candidate.checks || []), candidate.status || ""].join(" ");
  return !/out of stock|discontinued|end of life|obsolete|not recommended/i.test(warnings);
}

function isCompatibleStandardPassive(part, candidate) {
  const kind = standardPassiveKind(part);
  const requestedValue = parsePassiveValue(part.normalizedValue || part.value, kind);
  if (requestedValue == null) return false;
  const parameterName = { Resistor: /resistance/i, Capacitor: /capacitance/i, Inductor: /inductance/i }[kind];
  const parameterValues = Object.entries(candidate.parameters || {})
    .filter(([name]) => parameterName.test(name)).map(([, value]) => value);
  const candidateValues = [...parameterValues, candidate.description].filter(Boolean)
    .map((value) => parsePassiveValue(value, kind)).filter((value) => value != null);
  if (!candidateValues.some((value) => nearlyEqual(value, requestedValue))) return false;

  const requestedPackage = standardPackageCode([part.footprint, part.packageDescription].filter(Boolean).join(" "));
  if (!requestedPackage) return true;
  const candidateText = [candidate.description, candidate.packageType,
    ...Object.values(candidate.parameters || {})].filter(Boolean).join(" ");
  return standardPackageCode(candidateText) === requestedPackage;
}

function parsePassiveValue(input, kind) {
  const text = String(input || "").replace(/[µμ]/g, "u");
  if (kind === "Resistor") {
    const explicit = text.match(/(\d+(?:\.\d+)?)\s*([kKmM]?)\s*(?:ohms?\b|Ω)/i);
    if (explicit) return Number(explicit[1]) * ({ "": 1, k: 1e3, K: 1e3, m: 1e6, M: 1e6 }[explicit[2]] || 1);
    const embedded = text.match(/\b(\d*)([rRkKmM])(\d+)\b/);
    if (embedded) return Number(`${embedded[1] || "0"}.${embedded[3]}`)
      * ({ r: 1, R: 1, k: 1e3, K: 1e3, m: 1e6, M: 1e6 }[embedded[2]] || 1);
    return null;
  }
  const unit = kind === "Capacitor" ? "f" : "h";
  const match = text.match(new RegExp(`(\\d+(?:\\.\\d+)?)\\s*([pnum]?)${unit}\\b`, "i"));
  if (!match) return null;
  return Number(match[1]) * ({ "": 1, p: 1e-12, n: 1e-9, u: 1e-6, m: 1e-3 }[match[2].toLowerCase()] || 1);
}

function standardPackageCode(input) {
  return String(input || "").match(/(?:^|[^0-9])(0201|0402|0603|0805|1206|1210|1812)(?:[^0-9]|$)/i)?.[1] || "";
}

function nearlyEqual(a, b) { return Math.abs(a - b) <= Math.max(Math.abs(a), Math.abs(b), 1e-18) * 1e-6; }

function findReviewedCandidate(candidates, review = {}) {
  const digiKeyPartNumber = String(review.selectedDigiKeyPartNumber || "").trim();
  const manufacturerPartNumber = String(review.selectedManufacturerPartNumber || "").trim();
  if (!digiKeyPartNumber && !manufacturerPartNumber) return null;
  return candidates.find((candidate) =>
    (!digiKeyPartNumber || candidate.digiKeyPartNumber === digiKeyPartNumber)
    && (!manufacturerPartNumber || candidate.manufacturerPartNumber === manufacturerPartNumber)) || null;
}

function normalizeIdentifier(value) { return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, ""); }

function symbolsToCsv(symbols) {
  const headers = ["Reference", "Value", "Footprint", "Manufacturer Part Number", "DigiKey Part Number"];
  const quote = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  return [headers.map(quote).join(","), ...symbols.map((symbol) => [
    symbol.reference, symbol.value, symbol.footprint, symbol.manufacturerPartNumber, symbol.digiKeyPartNumber,
  ].map(quote).join(","))].join("\n");
}

async function runWithConcurrency(tasks, limit) {
  const results = new Array(tasks.length);
  let next = 0;
  async function worker() {
    while (next < tasks.length) {
      const index = next++;
      results[index] = await tasks[index]();
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}
