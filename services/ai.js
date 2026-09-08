export async function reviewCandidates(component, candidates, environment = process.env) {
  if (!environment.OPENAI_API_KEY) throw new Error("AI review is not configured. Add OPENAI_API_KEY to your environment.");
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${environment.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: environment.OPENAI_MODEL || "gpt-5-mini",
      store: false,
      instructions: `Choose one practical DigiKey candidate for this BOM line. The goal is a complete, inexpensive, in-stock BOM, not a design audit. For ordinary SMD resistors, the stated resistance and footprint are sufficient; prefer a common thick-film part. For ordinary SMD capacitors, use ceramic MLCC unless the BOM or footprint indicates otherwise. Do not complain about unspecified tolerance, dielectric, voltage, power, or manufacturer for ordinary passives. Prefer candidates that match the explicit value and package, are active, can fulfill the requested quantity, have a low minimum order, and have the lowest unit price. When otherwise comparable, prefer a candidate whose kicadAssets.placeable is true so it can be placed in KiCad's Schematic Editor. In the reasoning, call that the Schematic Editor, never the PCB tool. Only report a concern when no candidate matches an explicit value/package or the BOM is truly unsearchable. Select only a part number present in the candidate list.`,
      input: JSON.stringify({ component, candidates }),
      text: { format: { type: "json_schema", name: "bom_candidate_review", strict: true, schema: {
        type: "object",
        properties: {
          recommendation: { type: "string" }, selectedDigiKeyPartNumber: { type: "string" }, selectedManufacturerPartNumber: { type: "string" }, reasoning: { type: "string" }, confidence: { type: "number", minimum: 0, maximum: 1 },
          concerns: { type: "array", items: { type: "string" } },
        },
        required: ["recommendation", "selectedDigiKeyPartNumber", "selectedManufacturerPartNumber", "reasoning", "confidence", "concerns"], additionalProperties: false,
      } } },
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`AI review failed (${response.status}): ${data.error?.message || "Unknown error"}`);
  const outputText = data.output_text || data.output?.flatMap((item) => item.content || []).find((item) => item.type === "output_text")?.text;
  if (!outputText) throw new Error("AI review returned no result.");
  return JSON.parse(outputText);
}

export async function interpretComponentRequest(query, quantity = 1, environment = process.env) {
  if (!environment.OPENAI_API_KEY) throw new Error("AI component search is not configured. Add OPENAI_API_KEY to your environment.");
  if (!query?.trim()) throw new Error("Describe the component you need.");
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${environment.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: environment.OPENAI_MODEL || "gpt-5-mini",
      store: false,
      instructions: `Convert a natural-language electronics component request into a concise DigiKey keyword search. Preserve every explicit electrical, mechanical, interface, package, and temperature requirement in requirements. Apply ordinary defaults only when safe: commodity SMD resistors may default to thick film and 1%; non-polarized SMD capacitors may default to ceramic X7R/X5R. Never invent an IC part number, pinout, voltage, current, or package. searchTerms must be a short set of common distributor keywords without commas, parentheses, labels such as "output", or words such as "unspecified". For example, a 5 V 3 A efficient regulator request should produce searchTerms similar to "5V 3A buck regulator". componentType should be a common noun such as Resistor, Capacitor, Diode, Connector, Microcontroller, Voltage regulator, or Integrated circuit. Keep summary concise and do not include quantity.`,
      input: JSON.stringify({ request: query.trim(), requestedQuantity: Math.max(1, Number(quantity) || 1) }),
      text: { format: { type: "json_schema", name: "component_request", strict: true, schema: {
        type: "object",
        properties: {
          summary: { type: "string" }, componentType: { type: "string" }, value: { type: "string" }, package: { type: "string" },
          searchTerms: { type: "string" }, quantity: { type: "integer", minimum: 1 }, pinCount: { type: "integer", minimum: 0 },
          requirements: { type: "array", items: { type: "string" } }, assumptions: { type: "array", items: { type: "string" } },
        },
        required: ["summary", "componentType", "value", "package", "searchTerms", "quantity", "pinCount", "requirements", "assumptions"], additionalProperties: false,
      } } },
    }),
  });
  const data = await readOpenAiResponse(response, "AI component interpretation");
  return JSON.parse(extractOutputText(data));
}

export async function interpretBomCsv(csv, deterministicParts, environment = process.env) {
  if (!environment.OPENAI_API_KEY) throw new Error("AI parsing is not configured. Add OPENAI_API_KEY to your environment.");
  if (!csv?.trim()) throw new Error("CSV text is required.");
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${environment.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: environment.OPENAI_MODEL || "gpt-5-mini",
      store: false,
      instructions: `Interpret an electronic BOM CSV exported by KiCad or another EDA tool and produce useful DigiKey search terms. A column named Designation commonly contains the component value, while Designator commonly contains references. Preserve every explicit reference, value, footprint, and quantity. Use reference prefixes and footprints to classify component type and physical package. The goal is a complete, inexpensive, in-stock BOM. For an ordinary SMD resistor, value and package are enough. For an ordinary SMD capacitor, assume a ceramic MLCC unless the BOM or polarized footprint says otherwise. Do not create warnings for missing tolerance, dielectric, voltage, power, manufacturer, or supplier number on ordinary parts. Only warn when the CSV lacks an essential searchable value or footprint. Keep search terms concise and based on explicit facts plus those standard passive defaults.`,
      input: JSON.stringify({ csv, deterministicFirstPass: deterministicParts }),
      text: { format: { type: "json_schema", name: "interpreted_bom", strict: true, schema: {
        type: "object",
        properties: {
          summary: { type: "string" },
          parts: { type: "array", items: { type: "object", properties: {
            id: { type: "string" }, references: { type: "array", items: { type: "string" } }, value: { type: "string" },
            valueSource: { type: "string" }, footprint: { type: "string" }, componentType: { type: "string" },
            packageDescription: { type: "string" }, supplierPartNumber: { type: "string" }, quantity: { type: "integer", minimum: 1 },
            warnings: { type: "array", items: { type: "string" } }, searchTerms: { type: "string" },
          }, required: ["id", "references", "value", "valueSource", "footprint", "componentType", "packageDescription", "supplierPartNumber", "quantity", "warnings", "searchTerms"], additionalProperties: false } },
        }, required: ["summary", "parts"], additionalProperties: false,
      } } },
    }),
  });
  const data = await readOpenAiResponse(response, "AI BOM interpretation");
  return JSON.parse(extractOutputText(data));
}

async function readOpenAiResponse(response, label) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${label} failed (${response.status}): ${data.error?.message || "Unknown error"}`);
  return data;
}

function extractOutputText(data) {
  const outputText = data.output_text || data.output?.flatMap((item) => item.content || []).find((item) => item.type === "output_text")?.text;
  if (!outputText) throw new Error("AI returned no structured result.");
  return outputText;
}
