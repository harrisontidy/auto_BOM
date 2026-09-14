import { applyAiInterpretation, parseCsv } from "../parser.js";
import { interpretBomCsv, reviewCandidates } from "./ai.js";
import { isExactPartNumberMatch } from "./digikey.js";
import { searchSupplier, sourcingSupplier, supplierLabel, supplierField, candidatePartNumber } from "./sourcing.js";
import { resolveKiCadAssets } from "./kicad-assets.js";
import { assessSpecifications, assessSchematicPins } from './specification-checks.js';

const MIN_AI_CONFIDENCE = 0.7;

export async function completeSchematicBom(symbols, environment = process.env, dependencies = {}) {
  validateSymbols(symbols);
  const supplier = sourcingSupplier(environment.SOURCING_SUPPLIER || "lcsc");
  const services = {
    interpretBomCsv: dependencies.interpretBomCsv || interpretBomCsv,
    reviewCandidates: dependencies.reviewCandidates || reviewCandidates,
    search: dependencies.searchSupplier || dependencies.searchDigiKey || searchSupplier,
    resolveKiCadAssets: dependencies.resolveKiCadAssets || resolveKiCadAssets,
  };
  if (!symbols.length) return { summary: "The schematic has no BOM parts.", completed: 0, failed: 0, parts: [] };

  const normalizedSymbols = mergeSymbolsByReference(symbols);
  const demand=new Map();
  for(const symbol of normalizedSymbols)for(const [kind,value] of [['supplier',symbol[supplierField(supplier)]],['mpn',symbol.manufacturerPartNumber]]) {
    if(value?.trim()){const key=`${kind}:${normalizeIdentifier(value)}`;demand.set(key,(demand.get(key)||0)+1);}
  }
  const exactSearches=new Map(), searchService=services.search;
  services.search=(component,env)=>{
    if(!component.supplierPartNumber)return searchService(component,env);
    const key=JSON.stringify([component.supplier,normalizeIdentifier(component.supplierPartNumber),component.quantity]);
    if(!exactSearches.has(key))exactSearches.set(key,Promise.resolve().then(()=>searchService(component,env)));
    return exactSearches.get(key);
  };
  const csv = symbolsToCsv(normalizedSymbols, supplier);
  let parts = parseCsv(csv).map(part => applyPassiveDefaults(part, normalizedSymbols, environment));
  const byReference = new Map(normalizedSymbols.map((symbol) => [symbol.reference, symbol]));
  const needsInterpretation = parts.filter(part => !isPlainPassive(part) && !getSearchabilityError(part, '')
    && !part.references.some(ref => {
      const symbol=byReference.get(ref);
      return symbol?.manufacturerPartNumber?.trim() || symbol?.[supplierField(supplier)]?.trim();
    }));
  let aiFallback = false;
  if (environment.OPENAI_API_KEY && needsInterpretation.length) {
    try {
      const neededRefs=new Set(needsInterpretation.flatMap(part=>part.references));
      const limitedCsv=symbolsToCsv(normalizedSymbols.filter(symbol=>neededRefs.has(symbol.reference)),supplier);
      const interpreted = await services.interpretBomCsv(limitedCsv, needsInterpretation, environment);
      if (!Array.isArray(interpreted?.parts) || !interpreted.parts.length) throw new Error("AI BOM interpretation returned no parts.");
      parts = parts.map((original) => {
        if(!needsInterpretation.includes(original))return original;
        const ai = interpreted.parts.find((part) => part.references?.some((reference) => original.references.includes(reference)))
          || interpreted.parts.find((part) => part.id === original.id) || {};
        const interpretedPart = applyAiInterpretation(original, {...ai,value:original.value,footprint:original.footprint,supplierPartNumber:original.supplierPartNumber});
        interpretedPart.warnings = [...new Set([...(interpretedPart.warnings || []), ...(original.warnings || [])])];
        return interpretedPart;
      });
    } catch {
      aiFallback = true;
    }
  }

  const tasks = parts.map((part) => async () => completePart({ ...part, supplier }, byReference, environment, services, demand));
  const completedParts = await runWithConcurrency(tasks, 3);
  const completed = completedParts.filter((part) => part.status === "completed" || part.status === "already assigned").length;
  const failed = completedParts.length - completed;
  const summary = failed
      ? `Prepared ${completed} of ${completedParts.length} BOM lines; ${failed} remain unresolved. Review proposals before applying.`
      : `Prepared ${supplierLabel(supplier)} selections for all ${completedParts.length} BOM lines. Review proposals before applying.`;
  return {
    summary: aiFallback ? `${summary} AI parsing was unavailable, so standard BOM parsing was used.` : summary,
    completed,
    failed,
    aiFallback,
    interpretedLines: environment.OPENAI_API_KEY ? needsInterpretation.length : 0,
    parts: completedParts,
  };
}

async function completePart(part, byReference, environment, services, demand) {
  const field = supplierField(part.supplier);
  const label = supplierLabel(part.supplier);
  const sourceSymbols = part.references.map((reference) => byReference.get(reference)).filter(Boolean);
  const conflicting=sourceSymbols.filter(symbol=>symbol.conflicts?.length);
  const mpns=new Set(sourceSymbols.map(symbol=>normalizeIdentifier(symbol.manufacturerPartNumber)).filter(Boolean));
  if(conflicting.length || mpns.size>1)return resultFor(part,{status:'needs review',error:conflicting.length
    ? `Conflicting fields on repeated schematic reference: ${conflicting.map(s=>s.reference).join(', ')}.`
    : 'This grouped BOM line contains conflicting manufacturer part numbers.'});
  const incompleteSymbols = sourceSymbols.filter((symbol) =>
    !String(symbol[field] || "").trim() || !String(symbol.manufacturerPartNumber || "").trim());
  const existingSupplierNumbers = new Map();
  for (const symbol of sourceSymbols) {
    const partNumber = String(symbol[field] || "").trim();
    if (partNumber) existingSupplierNumbers.set(normalizeIdentifier(partNumber), partNumber);
  }
  const existingSupplier = [...existingSupplierNumbers.values()][0] || "";
  const existingMpn = (incompleteSymbols.find((symbol) => String(symbol.manufacturerPartNumber || "").trim())
    || sourceSymbols.find((symbol) => String(symbol.manufacturerPartNumber || "").trim()))?.manufacturerPartNumber || "";
  part={...part,quantity:Math.max(part.quantity,demand.get(existingSupplier?`supplier:${normalizeIdentifier(existingSupplier)}`:`mpn:${normalizeIdentifier(existingMpn)}`)||0)};
  const existingDatasheet = sourceSymbols.find((symbol) => String(symbol.datasheetUrl || "").trim())?.datasheetUrl || "";
  const existingFootprint = (incompleteSymbols.find((symbol) => String(symbol.footprint || "").trim())
    || sourceSymbols.find((symbol) => String(symbol.footprint || "").trim()))?.footprint || part.footprint || "";

  if (existingSupplierNumbers.size > 1) {
    return resultFor(part, {
      references: incompleteSymbols.length
        ? incompleteSymbols.map((symbol) => String(symbol.reference).trim())
        : part.references,
      status: "needs review",
      error: `This grouped BOM line contains conflicting existing ${label} part numbers.`,
    });
  }

  if (!incompleteSymbols.length && part.supplier !== "lcsc" && existingFootprint) {
    return resultFor(part, {
      status: "already assigned", manufacturerPartNumber: existingMpn, supplierPartNumber: existingSupplier,
      datasheetUrl: existingDatasheet, footprintId: existingFootprint,
    });
  }

  const references = (part.supplier === "lcsc" ? sourceSymbols : incompleteSymbols).map((symbol) => String(symbol.reference).trim());

  if (existingSupplier) {
    return completeFromExistingSupplier(part, references, existingSupplier, existingMpn,
      existingDatasheet, existingFootprint, environment, services, sourceSymbols);
  }

  const searchabilityError = getSearchabilityError(part, existingMpn);
  if (searchabilityError) return resultFor(part, { references, status: "needs review", error: searchabilityError });

  try {
    const searchable = { ...part, bomContext:sourceSymbols, originalQuery:part.value, preferBasic: environment.PREFER_BASIC !== "false", supplierPartNumber: String(existingMpn || "").trim() };
    const search = await services.search(searchable, environment);
    const candidates = (search.candidates || []).map(candidate=>({...candidate,verification:assessSpecifications(searchable,candidate)}))
      .filter((candidate) => isUsableInStockCandidate(candidate, part.quantity) && !candidate.verification.mismatches.length);
    if (!candidates.length) return resultFor(part, { references, status: "needs review", error: `No complete, in-stock ${label} match was found.` });

    let selected;
    if (existingMpn) {
      selected = candidates.find((candidate) => isExactPartNumberMatch(existingMpn, candidate));
      if (!selected) return resultFor(part, { references, status: "needs review", error: `${label} did not return an exact match for ${existingMpn}.` });
    } else if (isPlainPassive(part)) {
      selected = candidates.find((candidate) => isCompatibleStandardPassive(part, candidate));
      if (!selected) return resultFor(part, { references, status: "needs review", error: `No in-stock ${label} candidate matched the stated value and package.` });
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
        if (!selected) throw new Error("AI review did not select one of the supplied candidates.");
      } catch (error) {
        return resultFor(part, { references, status: "needs review", error: `AI candidate review failed: ${error.message}` });
      }
    }

    if(selected.verification.unknown.length) return resultFor(part,{references,status:'needs review',
      error:`Supplier specifications need review: ${selected.verification.unknown.join(' ')}`,verification:selected.verification});
    const assets = await services.resolveKiCadAssets(searchable, selected, environment);
    const pins=assessSchematicPins(sourceSymbols,assets);
    if(pins.mismatches.length || pins.unknown.length)return resultFor(part,{references,status:'needs review',
      error:[...pins.mismatches,...pins.unknown].join(' '),verification:selected.verification});
    return resultFor(part, {
      references,
      status: existingFootprint || assets.footprintId ? "completed" : "needs review",
      error: existingFootprint || assets.footprintId ? '' : 'A supplier match was found, but no footprint is available. Assign and verify a footprint before completing this line.',
      manufacturerPartNumber: selected.manufacturerPartNumber,
      supplierPartNumber: candidatePartNumber(selected),
      datasheetUrl: selected.datasheetUrl,
      manufacturer: selected.manufacturer,
      productUrl: selected.productUrl,
      footprintId: existingFootprint || assets.footprintId,
      stock: selected.quantityAvailable,
      unitPrice: selected.unitPrice,
      currency: selected.currency,
      description: selected.description,
      libraryType: selected.libraryType,
      kicadAssets: assets,
      verification: selected.verification,
    });
  } catch (error) {
    return resultFor(part, { references, status: "needs review", error: error.message });
  }
}

async function completeFromExistingSupplier(part, references, digiKeyPartNumber, manufacturerPartNumber,
  datasheetUrl, footprintId, environment, services, sourceSymbols = []) {
  const fallback = {
    references,
    status: manufacturerPartNumber && footprintId && part.supplier !== "lcsc" ? "completed" : "needs review",
    manufacturerPartNumber,
    supplierPartNumber: digiKeyPartNumber,
    datasheetUrl,
    footprintId,
    error: part.supplier === "lcsc" ? "The existing LCSC selection could not be verified against current JLCPCB stock."
      : manufacturerPartNumber ? footprintId ? "" : "A footprint is still required for this existing selection."
      : `Could not enrich ${digiKeyPartNumber} with its manufacturer part number.`,
  };
  try {
    const searchable = { ...part, bomContext:sourceSymbols, supplierPartNumber: digiKeyPartNumber };
    const search = await services.search(searchable, environment);
    const selected = (search.candidates || []).find((candidate) => isExactPartNumberMatch(digiKeyPartNumber, candidate));
    if (!selected?.manufacturerPartNumber) return resultFor(part, fallback);
    if (manufacturerPartNumber && !isExactPartNumberMatch(manufacturerPartNumber, { manufacturerPartNumber: selected.manufacturerPartNumber })) return resultFor(part, { ...fallback, status: "needs review", error: "The existing supplier number does not match the specified manufacturer part number." });
    if (part.supplier === "lcsc" && !isUsableInStockCandidate(selected, part.quantity)) return resultFor(part, fallback);
    const verification=assessSpecifications({...part,originalQuery:part.value},selected);
    if(verification.mismatches.length || verification.unknown.length) return resultFor(part,{...fallback,status:'needs review',verification,
      error:`Existing selection needs specification review: ${[...verification.mismatches,...verification.unknown].join(' ')}`});
    let assets = { footprintId: "" };
    try { assets = await services.resolveKiCadAssets(searchable, selected, environment); } catch { /* Existing assignment remains authoritative. */ }
    const pins=assessSchematicPins(sourceSymbols,assets);
    if(pins.mismatches.length || pins.unknown.length)return resultFor(part,{...fallback,status:'needs review',verification,
      error:[...pins.mismatches,...pins.unknown].join(' ')});
    return resultFor(part, {
      ...fallback,
      status: footprintId || assets.footprintId ? "completed" : "needs review",
      error: footprintId || assets.footprintId ? '' : 'The supplier selection is verified, but a footprint is still required.',
      manufacturerPartNumber: selected.manufacturerPartNumber || manufacturerPartNumber,
      supplierPartNumber: digiKeyPartNumber,
      datasheetUrl: selected.datasheetUrl || datasheetUrl,
      manufacturer: selected.manufacturer,
      productUrl: selected.productUrl,
      footprintId: footprintId || assets.footprintId,
      stock: selected.quantityAvailable,
      unitPrice: selected.unitPrice,
      currency: selected.currency,
      description: selected.description,
      libraryType: selected.libraryType,
      kicadAssets: assets,
      verification,
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
    supplier: part.supplier,
    supplierPartNumber: values.supplierPartNumber || "",
    [supplierField(part.supplier)]: values.supplierPartNumber || "",
    datasheetUrl: values.datasheetUrl || "",
    footprintId: values.footprintId || "",
    stock: values.stock ?? null,
    unitPrice: values.unitPrice ?? null,
    currency: values.currency || (part.supplier === "lcsc" ? "USD" : "CAD"),
    description: [values.description, part.defaultNote].filter(Boolean).join(' '),
    libraryType: values.libraryType || "",
    kicadAssets: values.kicadAssets || {},
    manufacturer: values.manufacturer || "",
    productUrl: values.productUrl || "",
    status: values.status,
    error: values.error || "",
    verification: values.verification || {},
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
    for (const field of ["value", "footprint", "manufacturerPartNumber", "digiKeyPartNumber", "lcscPartNumber", "datasheetUrl"]) {
      if (symbol[field] != null && typeof symbol[field] !== "string") throw new Error(`${field} must be text for ${reference}.`);
    }
    if(symbol.pins!==undefined && (!Array.isArray(symbol.pins)||symbol.pins.length>5000
      || symbol.pins.some(pin=>!pin||typeof pin.number!=='string'||typeof pin.name!=='string'||pin.number.length>128||pin.name.length>256)))
      throw new Error(`Invalid pin information for ${reference}.`);
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
    for (const field of ["value", "footprint", "manufacturerPartNumber", "digiKeyPartNumber", "lcscPartNumber", "datasheetUrl"]) {
      if(existing[field]?.trim() && symbol[field]?.trim() && existing[field].trim()!==symbol[field].trim())existing.conflicts=[...(existing.conflicts||[]),field];
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

export function applyPassiveDefaults(part, symbols, environment = {}) {
  const size = environment.PASSIVE_PACKAGE ?? '0805';
  const mounting = environment.PASSIVE_MOUNTING ?? 'smt';
  if (!['smt','through-hole','none'].includes(mounting)) throw new Error('Unsupported passive mounting preference.');
  if (!['0201','0402','0603','0805','1206','1210','none'].includes(size)) throw new Error('Unsupported passive package preference.');
  const sources = symbols.filter(symbol => part.references.includes(symbol.reference));
  const explicit = sources.some(symbol => symbol.footprint?.trim() || symbol.manufacturerPartNumber?.trim()
    || symbol.lcscPartNumber?.trim() || symbol.digiKeyPartNumber?.trim());
  const text = [part.value, ...sources.map(symbol => symbol.symbolId)].join(' ');
  if (mounting === 'none' || (size === 'none' && mounting === 'smt') || explicit || part.footprint || part.packageDescription
    || !['Resistor','Capacitor'].includes(part.componentType)
    || /polar|electroly|tantal|film|radial|axial|through.hole|\bTHT\b|:C_Polarized|:CP(?:_|\b)|potentiometer|network|array|\b(?:0201|0402|0603|0805|1206|1210)\b/i.test(text)) return part;
  const capacitor = part.componentType === 'Capacitor';
  if (mounting === 'through-hole') return {...part, packageDescription:'Through-hole',
    passiveMounting:mounting, capacitorTechnology:capacitor?'ceramic':undefined,
    defaultNote:'Using preferred through-hole mounting; lead spacing and body dimensions must be verified.'};
  return {...part, package:size, packageDescription:`${size} SMT`, capacitorTechnology:capacitor?'ceramic':undefined,
    passiveMounting:mounting,
    defaultNote:`Using preferred ${size} SMT${capacitor?' ceramic capacitor':''}; no package was specified.`};
}

function isPlainPassive(part) {
  const kind=standardPassiveKind(part),value=String(part.value||'').trim();
  if(!kind || !standardPackageCode(part.footprint||part.packageDescription||''))return false;
  return kind==='Resistor' ? /^(?:\d+(?:\.\d+)?\s*(?:[kKmM]?(?:ohms?|Ω)|[rRkKmM])?|\d*[rRkKmM]\d+)$/i.test(value)
    : /^\d+(?:\.\d+)?\s*[pnuµμm]?[FH]$/i.test(value);
}

function isUsableInStockCandidate(candidate, requestedQuantity = 1) {
  if (!candidate?.manufacturerPartNumber || !candidatePartNumber(candidate)) return false;
  const stock = Number(candidate.quantityAvailable);
  if (!Number.isFinite(stock) || stock < Math.max(1, Number(requestedQuantity) || 1)
    || Number(candidate.minimumOrderQuantity || 1) > Math.max(1, Number(requestedQuantity) || 1)) return false;
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
  const digiKeyPartNumber = String(review.selectedSupplierPartNumber || review.selectedDigiKeyPartNumber || "").trim();
  const manufacturerPartNumber = String(review.selectedManufacturerPartNumber || "").trim();
  if (!digiKeyPartNumber && !manufacturerPartNumber) return null;
  return candidates.find((candidate) =>
    (!digiKeyPartNumber || candidatePartNumber(candidate) === digiKeyPartNumber)
    && (!manufacturerPartNumber || candidate.manufacturerPartNumber === manufacturerPartNumber)) || null;
}

function normalizeIdentifier(value) { return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, ""); }

function symbolsToCsv(symbols, supplier) {
  const field = supplierField(supplier);
  const headers = ["Reference", "Value", "Footprint", "Manufacturer Part Number", "Supplier Part Number"];
  const quote = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  return [headers.map(quote).join(","), ...symbols.map((symbol) => [
    symbol.reference, symbol.value, symbol.footprint, symbol.manufacturerPartNumber, symbol[field],
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
