import "./config.js";
import { createReadStream } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { interpretBomCsv, interpretComponentRequest, reviewCandidates } from "./services/ai.js";
import { searchDigiKey } from "./services/digikey.js";
import { resolveKiCadAssets } from "./services/kicad-assets.js";
import { completeSchematicBom, validateSymbols } from "./services/bom-completion.js";
import { applyAiInterpretation } from "./parser.js";

const port = Number(process.env.PORT || 4173);
const root = process.cwd();
const serverStartedAt = Date.now();
const protocolVersion = 2;
const publicFiles = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
  ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
]);

createServer(async (request, response) => {
  try {
    if (request.method === "GET" && request.url === "/api/status") {
      return sendJson(response, 200, {
        service: "auto-bom",
        protocolVersion,
        processId: process.pid,
        projectRoot: root,
        serverStartedAt,
        kicadStockDataHome: process.env.KICAD_STOCK_DATA_HOME || "",
        digikey: Boolean(process.env.DIGIKEY_CLIENT_ID && process.env.DIGIKEY_CLIENT_SECRET),
        digikeyEnvironment: process.env.DIGIKEY_ENV === "production" ? "production" : "sandbox",
        openai: Boolean(process.env.OPENAI_API_KEY),
      });
    }
    if (request.method === "POST" && request.url === "/api/digikey/search") {
      const { component } = await readBody(request);
      const searchableFields = ["value", "footprint", "supplierPartNumber", "aiSearchTerms"];
      if (!isRecord(component) || !searchableFields.some((field) => typeof component[field] === "string" && component[field].trim())) return sendJson(response, 400, { error: "No searchable component information was found." });
      return sendJson(response, 200, await searchDigiKey(component));
    }
    if (request.method === "POST" && request.url === "/api/components/search") {
      const { query, quantity } = await readBody(request);
      if (typeof query !== "string" || !query.trim() || query.length > 1_000) return sendJson(response, 400, { error: "Describe the component in 1,000 characters or fewer." });
      if (quantity !== undefined && (!Number.isInteger(Number(quantity)) || Number(quantity) < 1 || Number(quantity) > 1_000_000)) return sendJson(response, 400, { error: "Quantity must be a whole number from 1 to 1,000,000." });
      const interpreted = await interpretComponentRequest(query, quantity);
      const component = {
        ...interpreted,
        summary: String(interpreted.summary || "").replace(/\s*[,\u00b7-]?\s*(?:qty|quantity)\s*(?:=|:)?\s*\d+\s*$/i, "").trim(),
        originalQuery: query,
        normalizedValue: interpreted.value,
        footprint: interpreted.package,
        aiSearchTerms: interpreted.searchTerms,
        quantity: Math.max(1, Number(quantity) || interpreted.quantity || 1),
      };
      const result = await searchDigiKey(component);
      const candidates = await Promise.all(result.candidates.map(async (candidate) => ({
        ...candidate,
        kicadAssets: await resolveKiCadAssets(component, candidate),
      })));
      let review = null;
      if (candidates.length) {
        try {
          review = await reviewCandidates(component, candidates);
        } catch {
          review = {
            selectedDigiKeyPartNumber: candidates[0].digiKeyPartNumber,
            selectedManufacturerPartNumber: candidates[0].manufacturerPartNumber,
            reasoning: "AI review was unavailable, so the first in-stock DigiKey result is shown.",
            fallback: true,
          };
        }
      }
      return sendJson(response, 200, { component, query: result.query, candidates, review });
    }
    if (request.method === "POST" && request.url === "/api/components/assets") {
      const { component, candidate } = await readBody(request);
      if (!component || !candidate) return sendJson(response, 400, { error: "A component and selected DigiKey candidate are required." });
      return sendJson(response, 200, await resolveKiCadAssets(component, candidate));
    }
    if (request.method === "POST" && request.url === "/api/bom/complete") {
      const { symbols, useAi = true } = await readBody(request);
      if (typeof useAi !== "boolean") return sendJson(response, 400, { error: "useAi must be true or false." });
      try { validateSymbols(symbols); } catch (error) { return sendJson(response, 400, { error: error.message }); }
      const completionEnvironment = useAi ? process.env : { ...process.env, OPENAI_API_KEY: "" };
      return sendJson(response, 200, await completeSchematicBom(symbols, completionEnvironment));
    }
    if (request.method === "POST" && request.url === "/api/ai/parse") {
      const { csv, deterministicParts } = await readBody(request);
      if (!Array.isArray(deterministicParts) || deterministicParts.length > 200) return sendJson(response, 400, { error: "A deterministic BOM with at most 200 lines is required." });
      const interpreted = await interpretBomCsv(csv, deterministicParts);
      const parts = deterministicParts.map((original, index) => {
        const ai = interpreted.parts.find((part) => part.references?.some((reference) => original.references.includes(reference)))
          || interpreted.parts.find((part) => part.id === original.id) || {};
        return applyAiInterpretation(original, ai);
      });
      return sendJson(response, 200, { summary: `AI reviewed ${parts.length} BOM lines and prepared DigiKey searches.`, parts });
    }
    if (request.method === "POST" && request.url === "/api/ai/review") {
      const { component, candidates } = await readBody(request);
      if (!component || !Array.isArray(candidates) || !candidates.length) return sendJson(response, 400, { error: "A component and candidate list are required." });
      return sendJson(response, 200, await reviewCandidates(component, candidates.slice(0, 8)));
    }
    if (request.method !== "GET") return sendJson(response, 404, { error: "Not found." });
    return serveStatic(request, response);
  } catch (error) { return sendJson(response, 502, { error: error.message }); }
}).listen(port, "127.0.0.1", () => console.log(`auto_BOM running at http://localhost:${port}`));

function serveStatic(request, response) {
  const pathname = new URL(request.url, "http://localhost").pathname;
  const publicFile = publicFiles.get(pathname);
  if (!publicFile) return response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not found");
  const [relativePath, contentType] = publicFile;
  const filePath = join(root, relativePath);
  const stream = createReadStream(filePath);
  stream.on("open", () => {
    response.writeHead(200, { "Content-Type": contentType, "X-Content-Type-Options": "nosniff" });
    stream.pipe(response);
  });
  stream.on("error", () => response.writeHead(404).end("Not found"));
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => { body += chunk; if (body.length > 1_000_000) reject(new Error("Request is too large.")); });
    request.on("end", () => { try { resolve(JSON.parse(body || "{}")); } catch { reject(new Error("Invalid JSON body.")); } });
    request.on("error", reject);
  });
}
function isRecord(value) { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function sendJson(response, status, data) { response.writeHead(status, { "Content-Type": "application/json" }); response.end(JSON.stringify(data)); }
