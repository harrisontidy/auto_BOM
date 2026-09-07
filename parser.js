const COLUMN_ALIASES = {
  reference: ["reference", "references", "ref", "refs", "designator"],
  value: ["value", "val", "comment"],
  footprint: ["footprint", "package", "pcb footprint"],
  quantity: ["quantity", "qty", "count"],
};

export function parseCsv(text) {
  const rows = splitCsv(text.trim());
  if (rows.length < 2) throw new Error("The CSV needs a header and at least one component row.");

  const headers = rows[0].map((header) => header.trim().toLowerCase());
  const index = Object.fromEntries(
    Object.entries(COLUMN_ALIASES).map(([field, aliases]) => [field, headers.findIndex((header) => aliases.includes(header))]),
  );

  if (index.reference < 0 && index.value < 0) {
    throw new Error("Could not find a Reference or Value column.");
  }

  const parts = rows.slice(1).filter((row) => row.some((cell) => cell.trim())).map((row) => {
    const references = valueAt(row, index.reference).split(/[;\s]+/).filter(Boolean);
    const value = valueAt(row, index.value);
    const footprint = valueAt(row, index.footprint);
    const parsedQuantity = Number.parseInt(valueAt(row, index.quantity), 10);
    const quantity = Number.isFinite(parsedQuantity) ? parsedQuantity : Math.max(references.length, 1);
    const warnings = [];
    if (!references.length) warnings.push("Missing reference");
    if (!value) warnings.push("Missing value");
    if (!footprint) warnings.push("Missing footprint");
    return { references, value, normalizedValue: normalizeValue(value), footprint, quantity, warnings };
  });

  return groupParts(parts);
}

export function normalizeValue(input) {
  const value = input.trim().replace(/Ω/gi, "ohm").replace(/µ/gi, "u");
  const resistor = value.match(/^(\d+(?:\.\d+)?|\d*[RKM]\d+)([RKM]?)(?:ohm)?$/i);
  if (resistor) {
    const compact = resistor[1];
    const embedded = compact.match(/^(\d*)([RKM])(\d+)$/i);
    let number;
    let multiplier = 1;
    if (embedded) {
      number = Number(`${embedded[1] || "0"}.${embedded[3]}`);
      multiplier = { r: 1, k: 1e3, m: 1e6 }[embedded[2].toLowerCase()];
    } else {
      number = Number(compact);
      multiplier = { "": 1, r: 1, k: 1e3, m: 1e6 }[(resistor[2] || "").toLowerCase()];
    }
    if (Number.isFinite(number)) return formatEngineering(number * multiplier, "Ω");
  }

  const capacitor = value.match(/^(\d+(?:\.\d+)?)\s*(pf|nf|uf|mf|f)$/i);
  if (capacitor) {
    const farads = Number(capacitor[1]) * { pf: 1e-12, nf: 1e-9, uf: 1e-6, mf: 1e-3, f: 1 }[capacitor[2].toLowerCase()];
    return formatEngineering(farads, "F");
  }
  return value;
}

function formatEngineering(number, unit) {
  const prefixes = unit === "Ω"
    ? [[1e6, "M"], [1e3, "k"], [1, ""]]
    : [[1e-3, "m"], [1e-6, "µ"], [1e-9, "n"], [1e-12, "p"]];
  const [scale, prefix] = prefixes.find(([candidate]) => Math.abs(number) >= candidate) || prefixes.at(-1);
  return `${Number((number / scale).toPrecision(6))} ${prefix}${unit}`;
}

function groupParts(parts) {
  const groups = new Map();
  for (const part of parts) {
    const key = `${part.normalizedValue.toLowerCase()}|${part.footprint.toLowerCase()}|${part.warnings.join("|")}`;
    const existing = groups.get(key);
    if (existing) {
      existing.references.push(...part.references);
      existing.quantity += part.quantity;
    } else {
      groups.set(key, { ...part, references: [...part.references] });
    }
  }
  return [...groups.values()];
}

function valueAt(row, index) {
  return index >= 0 ? (row[index] || "").trim() : "";
}

function splitCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '"' && quoted && text[i + 1] === '"') {
      cell += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  row.push(cell);
  rows.push(row);
  return rows;
}

