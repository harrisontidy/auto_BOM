export async function reviewCandidates(component, candidates, environment = process.env) {
  if (!environment.OPENAI_API_KEY) throw new Error("AI review is not configured. Add OPENAI_API_KEY to your environment.");
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST", signal: AbortSignal.timeout(30_000),
    headers: { Authorization: `Bearer ${environment.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: environment.OPENAI_MODEL || "gpt-5-mini",
      ...(/^gpt-[5-9]/.test(environment.OPENAI_MODEL || 'gpt-5-mini') ? { reasoning: { effort: environment.OPENAI_REASONING_EFFORT || 'low' } } : {}),
      store: false,
      instructions: `Choose a practical supplier candidate that satisfies the explicit requirements. If every candidate conflicts with an explicit requirement, return empty selectedSupplierPartNumber and selectedManufacturerPartNumber instead of choosing a known mismatch. For exploratory requests, the originalQuery is authoritative: inferred application preferences and unanswered design questions are not hard requirements. Do not reject a wearable component because the user did not specify touch, size, interface or environmental ratings. Explain at most three important checks; do reject explicit mismatches. Never treat an OLED as an LCD match. The goal is a complete, inexpensive, in-stock BOM, not a design audit. For ordinary SMD resistors, the stated resistance and footprint are sufficient; prefer a common thick-film part. For ordinary SMD capacitors, use ceramic MLCC unless the BOM or footprint indicates otherwise. Do not complain about unspecified tolerance, dielectric, voltage, power, or manufacturer for ordinary passives. Prefer candidates that match the explicit value and package, are active, can fulfill the requested quantity, have a low minimum order, and have the lowest unit price. If CAD asset data is present, prefer placeable candidates when otherwise comparable. If absent, do not claim symbols or footprints are available. In the reasoning, call that the Schematic Editor, never the PCB tool. Check every explicit electrical, mechanical and interface requirement against the candidate parameters. Do not treat a keyword match or stock availability as evidence of electrical suitability. Report unmet or unverified explicit requirements. For relays distinguish coil voltage, switching-current maximum, contact form and contact rating at the actual load voltage; never infer a combined current/voltage rating from independent maxima. Preserve Basic preference among electrically compatible candidates. Keep reasoning to two short sentences. Select only a part number present in the candidate list. Use supplierPartNumber (or digiKeyPartNumber for legacy DigiKey candidates) as selectedSupplierPartNumber. For JLCPCB candidates stockSource refers to JLCPCB inventory; libraryType Basic/Extended is not an electrical specification and unitPrice excludes assembly fees.`,
      input: JSON.stringify({ component, candidates }),
      text: { format: { type: "json_schema", name: "bom_candidate_review", strict: true, schema: {
        type: "object",
        properties: {
          recommendation: { type: "string" }, selectedSupplierPartNumber: { type: "string" }, selectedManufacturerPartNumber: { type: "string" }, reasoning: { type: "string" }, confidence: { type: "number", minimum: 0, maximum: 1 },
          concerns: { type: "array", items: { type: "string" } },
        },
        required: ["recommendation", "selectedSupplierPartNumber", "selectedManufacturerPartNumber", "reasoning", "confidence", "concerns"], additionalProperties: false,
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
    method: "POST", signal: AbortSignal.timeout(30_000),
    headers: { Authorization: `Bearer ${environment.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: environment.OPENAI_MODEL || "gpt-5-mini",
      ...(/^gpt-5/.test(environment.OPENAI_MODEL || 'gpt-5-mini') ? { reasoning: { effort: 'low' } } : {}),
      store: false,
      instructions: `Convert a natural-language electronics component request into a concise electronics distributor keyword search. Understand informal use cases such as LCD for a smartwatch or microphone for a wearable. Separate the physical component category from the application: search for a display panel, not a smartwatch product or display-driver IC. Preserve the application in requirements. requirements must contain only facts explicitly stated by the user; unanswered questions belong in assumptions. Put inferred size, power and interface preferences in assumptions, never invent exact specifications. If details are missing, offer exploratory candidates with specific checks rather than claiming a complete design match. Preserve every explicit electrical, mechanical, interface, package, and temperature requirement in requirements. Apply ordinary defaults only when safe: commodity SMD resistors may default to thick film and 1%; non-polarized SMD capacitors may default to ceramic X7R/X5R. Never invent an IC part number, pinout, voltage, current, or package. searchQueries must contain up to three genuinely different searches in order: concise specific keywords, a distributor category synonym, then a broader physical component category. Leave application phrases like for a smartwatch out of keywords. Broader retrieval must not remove original requirements from the review. Never substitute a driver chip for the physical device. searchTerms must be a short set of common distributor keywords without commas, parentheses, labels such as "output", or words such as "unspecified". For example, a 5 V 3 A efficient regulator request should produce searchTerms similar to "5V 3A buck regulator". componentType should be a common noun such as Resistor, Capacitor, Diode, Connector, Microcontroller, Voltage regulator, or Integrated circuit. Keep summary concise and do not include quantity.`,
      input: JSON.stringify({ request: query.trim(), requestedQuantity: Math.max(1, Number(quantity) || 1) }),
      text: { format: { type: "json_schema", name: "component_request", strict: true, schema: {
        type: "object",
        properties: {
          summary: { type: "string" }, componentType: { type: "string" }, value: { type: "string" }, package: { type: "string" },
          searchTerms: { type: "string" }, quantity: { type: "integer", minimum: 1 }, pinCount: { type: "integer", minimum: 0 },
          searchQueries: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 3 },
          requirements: { type: "array", items: { type: "string" } }, assumptions: { type: "array", items: { type: "string" } },
        },
        required: ["summary", "componentType", "value", "package", "searchTerms", "searchQueries", "quantity", "pinCount", "requirements", "assumptions"], additionalProperties: false,
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
    method: "POST", signal: AbortSignal.timeout(30_000),
    headers: { Authorization: `Bearer ${environment.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: environment.OPENAI_MODEL || "gpt-5-mini",
      store: false,
      instructions: `Interpret an electronic BOM CSV exported by KiCad or another EDA tool and produce useful electronics distributor search terms. A column named Designation commonly contains the component value, while Designator commonly contains references. Preserve every explicit reference, value, footprint, and quantity. Use reference prefixes and footprints to classify component type and physical package. The goal is a complete, inexpensive, in-stock BOM. For an ordinary SMD resistor, value and package are enough. For an ordinary SMD capacitor, assume a ceramic MLCC unless the BOM or polarized footprint says otherwise. Do not create warnings for missing tolerance, dielectric, voltage, power, manufacturer, or supplier number on ordinary parts. Only warn when the CSV lacks an essential searchable value or footprint. Keep search terms concise and based on explicit facts plus those standard passive defaults.`,
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
