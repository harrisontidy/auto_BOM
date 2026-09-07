import "./config.js";
import { createReadStream } from "node:fs";
import { createServer } from "node:http";
import { extname, join } from "node:path";
import { interpretBomCsv, reviewCandidates } from "./services/ai.js";
import { searchDigiKey } from "./services/digikey.js";
import { applyAiInterpretation } from "./parser.js";

const port = Number(process.env.PORT || 4173);
const root = process.cwd();
const contentTypes = { ".css": "text/css", ".csv": "text/csv", ".html": "text/html", ".js": "text/javascript", ".json": "application/json" };

createServer(async (request, response) => {
  try {
    if (request.method === "GET" && request.url === "/api/status") {
      return sendJson(response, 200, {
        digikey: Boolean(process.env.DIGIKEY_CLIENT_ID && process.env.DIGIKEY_CLIENT_SECRET),
        digikeyEnvironment: process.env.DIGIKEY_ENV === "production" ? "production" : "sandbox",
        openai: Boolean(process.env.OPENAI_API_KEY),
      });
    }
    if (request.method === "POST" && request.url === "/api/digikey/search") {
      const { component } = await readBody(request);
      if (!component || !(component.value || component.footprint || component.supplierPartNumber || component.aiSearchTerms)) return sendJson(response, 400, { error: "No searchable component information was found." });
      return sendJson(response, 200, await searchDigiKey(component));
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
}).listen(port, () => console.log(`auto_BOM running at http://localhost:${port}`));

function serveStatic(request, response) {
  const pathname = new URL(request.url, `http://${request.headers.host}`).pathname;
  const relativePath = pathname === "/" ? "index.html" : decodeURIComponent(pathname.slice(1));
  if (relativePath.includes("..")) return response.writeHead(400).end("Bad request");
  const filePath = join(root, relativePath);
  const stream = createReadStream(filePath);
  stream.on("open", () => { response.writeHead(200, { "Content-Type": contentTypes[extname(filePath)] || "application/octet-stream" }); stream.pipe(response); });
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
function sendJson(response, status, data) { response.writeHead(status, { "Content-Type": "application/json" }); response.end(JSON.stringify(data)); }
