export async function reviewCandidates(component, candidates, environment = process.env) {
  if (!environment.OPENAI_API_KEY) throw new Error("AI review is not configured. Add OPENAI_API_KEY to your environment.");
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${environment.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: environment.OPENAI_MODEL || "gpt-5-mini",
      store: false,
      instructions: `Choose one practical DigiKey candidate for this BOM line. The goal is a complete, inexpensive, in-stock BOM, not a design audit. For ordinary SMD resistors, the stated resistance and footprint are sufficient; prefer a common thick-film part. For ordinary SMD capacitors, use ceramic MLCC unless the BOM or footprint indicates otherwise. Do not complain about unspecified tolerance, dielectric, voltage, power, or manufacturer for ordinary passives. Prefer candidates that match the explicit value and package, are active, can fulfill the requested quantity, have a low minimum order, and have the lowest unit price. Only report a concern when no candidate matches an explicit value/package or the BOM is truly unsearchable. Select only a part number present in the candidate list.`,
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
