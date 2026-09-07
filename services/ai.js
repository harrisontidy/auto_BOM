export async function reviewCandidates(component, candidates, environment = process.env) {
  if (!environment.OPENAI_API_KEY) throw new Error("AI review is not configured. Add OPENAI_API_KEY to your environment.");
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${environment.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: environment.OPENAI_MODEL || "gpt-5-mini",
      store: false,
      instructions: "Review electronic component sourcing candidates. Never invent a specification. Treat missing electrical requirements as concerns. Prefer active, stocked parts. Your recommendation is advisory and must not claim that an unverified part is electrically safe.",
      input: JSON.stringify({ component, candidates }),
      text: { format: { type: "json_schema", name: "bom_candidate_review", strict: true, schema: {
        type: "object",
        properties: {
          recommendation: { type: "string" }, reasoning: { type: "string" }, confidence: { type: "number", minimum: 0, maximum: 1 },
          concerns: { type: "array", items: { type: "string" } },
        },
        required: ["recommendation", "reasoning", "confidence", "concerns"], additionalProperties: false,
      } } },
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`AI review failed (${response.status}): ${data.error?.message || "Unknown error"}`);
  const outputText = data.output_text || data.output?.flatMap((item) => item.content || []).find((item) => item.type === "output_text")?.text;
  if (!outputText) throw new Error("AI review returned no result.");
  return JSON.parse(outputText);
}

