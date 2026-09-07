const COLUMN_ALIASES = {
  reference: ["reference", "references", "ref", "refs", "designator", "designators", "refdes"],
  value: ["value", "val", "designation", "comment", "component value", "part value"],
  footprint: ["footprint", "package", "pcb footprint", "pcb package", "land pattern"],
  quantity: ["quantity", "qty", "count"],
  supplierPartNumber: ["supplier and ref", "supplier reference", "supplier part number", "supplier pn", "digikey part number", "mpn", "manufacturer part number"],
};

const COMPONENT_TYPES = {
  C: "Capacitor", R: "Resistor", L: "Inductor", D: "Diode", LED: "LED", Q: "Transistor",
  U: "Integrated circuit", IC: "Integrated circuit", J: "Connector", P: "Connector", F: "Fuse",
  Y: "Crystal / oscillator", X: "Crystal / oscillator", SW: "Switch", K: "Relay", T: "Transformer",
  RV: "Variable resistor", FB: "Ferrite bead", TP: "Test point",
};

export function parseCsv(text) {
  const rows = splitCsv(text.trim());
  if (rows.length < 2) throw new Error("The CSV needs a header and at least one component row.");
  const originalHeaders = rows[0].map((header) => header.trim());
  const normalizedHeaders = originalHeaders.map(normalizeHeader);
  const index = Object.fromEntries(Object.entries(COLUMN_ALIASES).map(([field, aliases]) => [
    field, normalizedHeaders.findIndex((header) => aliases.some((alias) => normalizeHeader(alias) === header)),
  ]));
  if (index.reference < 0 && index.value < 0) throw new Error(`Could not identify useful BOM columns. Found: ${originalHeaders.join(", ")}.`);

  const parts = rows.slice(1).filter((row) => row.some((cell) => cell.trim())).map((row, rowIndex) => {
    const references = splitReferences(valueAt(row, index.reference));
    return completePart({
      id: `bom-${rowIndex + 1}`,
      references,
      value: valueAt(row, index.value),
      valueSource: index.value >= 0 ? originalHeaders[index.value] : "",
      footprint: valueAt(row, index.footprint),
      supplierPartNumber: valueAt(row, index.supplierPartNumber),
      quantity: Number.parseInt(valueAt(row, index.quantity), 10),
      sourceFields: Object.fromEntries(originalHeaders.map((header, column) => [header, (row[column] || "").trim()])),
    });
  });
  return groupParts(parts);
}

export function completePart(part) {
  const references = Array.isArray(part.references) ? part.references.flatMap(splitReferences) : splitReferences(part.references || "");
  const value = String(part.value || "").trim();
  const footprint = String(part.footprint || "").trim();
  const parsedQuantity = Number.parseInt(part.quantity, 10);
  const quantity = Number.isFinite(parsedQuantity) ? parsedQuantity : Math.max(references.length, 1);
  const componentType = part.componentType || inferComponentType(references, footprint);
  const warnings = (part.warnings || []).filter((warning) => !/^(Reference not present|.* value not present in export|Footprint not present in export|Quantity \d+ does not match \d+ references)$/.test(warning));
  if (!references.length) warnings.push("Reference not present");
  if (!value) warnings.push(`${componentType || "Component"} value not present in export`);
  if (!footprint) warnings.push("Footprint not present in export");
  if (references.length && Number.isFinite(parsedQuantity) && quantity !== references.length) warnings.push(`Quantity ${quantity} does not match ${references.length} references`);
  return {
    ...part, references, value, normalizedValue: normalizeValue(value), footprint,
    packageDescription: part.packageDescription || inferPackage(footprint), componentType,
    supplierPartNumber: String(part.supplierPartNumber || "").trim(), quantity,
    warnings: [...new Set(warnings)],
  };
}

export function applyAiInterpretation(original, ai = {}) {
  return completePart({
    ...original,
    componentType: ai.componentType || original.componentType,
    packageDescription: ai.packageDescription || original.packageDescription,
    references: original.references.length ? original.references : ai.references,
    value: original.value || ai.value,
    footprint: original.footprint || ai.footprint,
    supplierPartNumber: original.supplierPartNumber || ai.supplierPartNumber,
    quantity: original.quantity,
    aiSearchTerms: ai.searchTerms || "",
    warnings: original.warnings || [],
    sourceFields: original.sourceFields,
  });
}

export function normalizeValue(input = "") {
  const value = input.trim().replace(/Ω/gi, "ohm").replace(/µ/gi, "u");
  const resistor = value.match(/^(\d+(?:\.\d+)?|\d*[RKM]\d+)([RKM]?)(?:ohm)?$/i);
  if (resistor) {
    const embedded = resistor[1].match(/^(\d*)([RKM])(\d+)$/i);
    const number = embedded ? Number(`${embedded[1] || "0"}.${embedded[3]}`) : Number(resistor[1]);
    const scaleKey = embedded?.[2] || resistor[2] || "";
    const multiplier = { "": 1, r: 1, k: 1e3, m: 1e6 }[scaleKey.toLowerCase()];
    if (Number.isFinite(number)) return formatEngineering(number * multiplier, "Ω");
  }
  const units = value.match(/^(\d+(?:\.\d+)?)\s*(pf|nf|uf|mf|f|ph|nh|uh|mh|h)$/i);
  if (units) {
    const unit = units[2].toLowerCase();
    const base = unit.endsWith("f") ? "F" : "H";
    const number = Number(units[1]) * { pf: 1e-12, nf: 1e-9, uf: 1e-6, mf: 1e-3, f: 1, ph: 1e-12, nh: 1e-9, uh: 1e-6, mh: 1e-3, h: 1 }[unit];
    return formatEngineering(number, base);
  }
  return value;
}

export function inferComponentType(references = [], footprint = "") {
  const prefix = references[0]?.match(/^[A-Za-z]+/)?.[0]?.toUpperCase();
  if (prefix && COMPONENT_TYPES[prefix]) return COMPONENT_TYPES[prefix];
  const upper = footprint.toUpperCase();
  if (/CAPACITOR|(?:^|:)C[_-]|CP_/.test(upper)) return "Capacitor";
  if (/RESISTOR|(?:^|:)R[_-]/.test(upper)) return "Resistor";
  if (/CONNECTOR|HEADER|TERMINAL|JST|USB/.test(upper)) return "Connector";
  return "Component";
}

export function inferPackage(footprint = "") {
  if (!footprint) return "";
  const smd = footprint.match(/(?:^|[_:])(0201|0402|0603|0805|1206|1210|1812)_(\d{4})Metric(?:_|$)/i);
  if (smd) return `${smd[1]} (${Number(smd[2].slice(0, 2)) / 10} × ${Number(smd[2].slice(2)) / 10} mm)`;
  const radial = footprint.match(/Radial_D([\d.]+)mm_P([\d.]+)mm/i);
  if (radial) return `Radial, ${Number(radial[1])} mm diameter, ${Number(radial[2])} mm pitch`;
  const pitch = footprint.match(/(?:^|_)P([\d.]+)mm(?:_|$)/i)?.[1];
  const body = footprint.split(":").at(-1).replaceAll("_", " ");
  return pitch ? `${body} (${Number(pitch)} mm pitch)` : body;
}

function formatEngineering(number, unit) {
  const prefixes = unit === "Ω" ? [[1e6, "M"], [1e3, "k"], [1, ""]] : [[1e-3, "m"], [1e-6, "µ"], [1e-9, "n"], [1e-12, "p"]];
  const [scale, prefix] = prefixes.find(([candidate]) => Math.abs(number) >= candidate) || prefixes.at(-1);
  return `${Number((number / scale).toPrecision(6))} ${prefix}${unit}`;
}

function groupParts(parts) {
  const groups = new Map();
  for (const part of parts) {
    const key = [part.componentType, part.normalizedValue, part.footprint, part.supplierPartNumber, part.warnings.join("|")].join("|").toLowerCase();
    const existing = groups.get(key);
    if (existing) { existing.references.push(...part.references); existing.quantity += part.quantity; }
    else groups.set(key, { ...part, references: [...part.references] });
  }
  return [...groups.values()];
}

function normalizeHeader(header) { return header.trim().toLowerCase().replace(/[^a-z0-9]+/g, ""); }
function splitReferences(value) { return String(value || "").split(/[,;\s]+/).map((item) => item.trim()).filter(Boolean); }
function valueAt(row, index) { return index >= 0 ? (row[index] || "").trim() : ""; }

function splitCsv(text) {
  const rows = []; let row = []; let cell = ""; let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '"' && quoted && text[i + 1] === '"') { cell += '"'; i += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) { row.push(cell); cell = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) { if (char === "\r" && text[i + 1] === "\n") i += 1; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += char;
  }
  row.push(cell); rows.push(row); return rows;
}
