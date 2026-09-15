import "./config.js";
import { createReadStream } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { interpretBomCsv, reviewCandidates } from "./services/ai.js";
import { searchDigiKey } from "./services/digikey.js";
import { sourcingSupplier } from "./services/sourcing.js";
import { resolveKiCadAssets } from "./services/kicad-assets.js";
import { completeSchematicBom, validateSymbols } from "./services/bom-completion.js";
import { searchComponents } from "./services/component-search.js";
import { createHttpLibrary } from "./services/http-library.js";
import { createSearchJobs } from './services/search-jobs.js';
import { applyAiInterpretation } from "./parser.js";

const port = Number(process.env.PORT || 4173);
const root = process.cwd();
const httpLibrary = createHttpLibrary(join(root, '.runtime', 'http-library.json'));
const searchJobs = createSearchJobs(async (...args) => {
  const result=await searchComponents(...args);
  try {await httpLibrary.record(result);} catch(error) {console.error('HTTP library update failed:',error.message);}
  return result;
});
const serverStartedAt = Date.now();
const protocolVersion = 3;
const publicFiles = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
  ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
]);

createServer(async (request, response) => {
  try {
    const jobRoute = request.url.match(/^\/api\/components\/jobs\/([a-f0-9-]{36})$/);
    const cancelRoute = request.url.match(/^\/api\/components\/jobs\/([a-f0-9-]{36})\/cancel$/);
    if(cancelRoute && request.method==='POST') {
      const job=searchJobs.cancel(cancelRoute[1]);
      return sendJson(response,job?200:404,job||{error:'Search not found.'});
    }
    if(jobRoute && ['GET','DELETE'].includes(request.method)) {
      const job=request.method==='DELETE'?searchJobs.cancel(jobRoute[1]):searchJobs.get(jobRoute[1]);
      return sendJson(response,job?200:404,job||{error:'Search expired or not found.'});
    }
    if (request.method === 'GET' && request.url.startsWith('/kicad-api/v1/')) {
      const result = await httpLibrary.get(request.url.slice('/kicad-api/v1'.length));
      return sendJson(response, result === null ? 404 : 200, result ?? {error: 'Part or endpoint not found.'});
    }
    if (request.method === "GET" && request.url === "/api/status") {
      return sendJson(response, 200, {
        service: "auto-bom",
        protocolVersion,
        processId: process.pid,
        projectRoot: root,
        serverStartedAt,
        kicadStockDataHome: process.env.KICAD_STOCK_DATA_HOME || "",
        digikey: Boolean(process.env.DIGIKEY_CLIENT_ID && process.env.DIGIKEY_CLIENT_SECRET),
        supplier: sourcingSupplier(),
        lcsc: true,
        lcscAccess: "Public JLCPCB catalog; no API key required. Availability can change.",
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
    if (request.method === "POST" && ["/api/components/search", "/api/components/jobs"].includes(request.url)) {
      const { query, quantity, bomContext, preferBasic = true, supplier = sourcingSupplier() } = await readBody(request);
      if(bomContext!==undefined) {
        try {validateSymbols(bomContext);} catch(error) {return sendJson(response,400,{error:error.message});}
      }
      if (typeof preferBasic !== "boolean") return sendJson(response, 400, { error: "preferBasic must be true or false." });
      if (!["lcsc", "digikey"].includes(supplier)) return sendJson(response, 400, { error: "Supplier must be lcsc or digikey." });
      if (typeof query !== "string" || !query.trim() || query.length > 1_000) return sendJson(response, 400, { error: "Describe the component in 1,000 characters or fewer." });
      if (quantity !== undefined && (!Number.isInteger(Number(quantity)) || Number(quantity) < 1 || Number(quantity) > 1_000_000)) return sendJson(response, 400, { error: "Quantity must be a whole number from 1 to 1,000,000." });
      const requestedQuantity=Math.max(Number(quantity)||1,new Set((bomContext||[]).map(symbol=>symbol.reference)).size);
      if(request.url==='/api/components/jobs')return sendJson(response,202,searchJobs.start({query,quantity:requestedQuantity,supplier,preferBasic,bomContext}));
      const result = await searchComponents({ query, quantity:requestedQuantity, supplier, preferBasic, bomContext });
      try { await httpLibrary.record(result); }
      catch (error) { console.error('Could not update the local KiCad HTTP library:', error.message); }
      return sendJson(response, 200, result);
    }
    if (request.method === "POST" && request.url === "/api/components/assets") {
      const { component, candidate } = await readBody(request);
      if (!component || !candidate) return sendJson(response, 400, { error: "A component and selected candidate are required." });
      return sendJson(response, 200, await resolveKiCadAssets(component, candidate));
    }
    if (request.method === "POST" && request.url === "/api/bom/complete") {
      const { symbols, useAi = true, preferBasic = true, passivePackage = '0805', passiveMounting = 'smt', supplier = sourcingSupplier() } = await readBody(request);
      if (!['smt','through-hole','none'].includes(passiveMounting)) return sendJson(response, 400, { error: 'Unsupported passive mounting preference.' });
      if (!['0201','0402','0603','0805','1206','1210','none'].includes(passivePackage)) return sendJson(response, 400, { error: 'Unsupported passive package preference.' });
      if (typeof preferBasic !== "boolean") return sendJson(response, 400, { error: "preferBasic must be true or false." });
      if (!["lcsc", "digikey"].includes(supplier)) return sendJson(response, 400, { error: "Supplier must be lcsc or digikey." });
      if (typeof useAi !== "boolean") return sendJson(response, 400, { error: "useAi must be true or false." });
      try { validateSymbols(symbols); } catch (error) { return sendJson(response, 400, { error: error.message }); }
      const completionEnvironment = { ...process.env, SOURCING_SUPPLIER: supplier, PREFER_BASIC: String(preferBasic), PASSIVE_PACKAGE: passivePackage, PASSIVE_MOUNTING: passiveMounting, OPENAI_API_KEY: useAi ? process.env.OPENAI_API_KEY : "" };
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
      return sendJson(response, 200, { summary: `AI reviewed ${parts.length} BOM lines and prepared component searches.`, parts });
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
