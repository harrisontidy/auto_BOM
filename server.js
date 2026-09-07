import { createReadStream } from "node:fs";
import { createServer } from "node:http";
import { extname, join } from "node:path";

const port = 4173;
const root = process.cwd();
const contentTypes = {
  ".css": "text/css",
  ".csv": "text/csv",
  ".html": "text/html",
  ".js": "text/javascript",
  ".json": "application/json",
};

createServer((request, response) => {
  const pathname = new URL(request.url, `http://${request.headers.host}`).pathname;
  const relativePath = pathname === "/" ? "index.html" : pathname.slice(1);

  if (relativePath.includes("..")) {
    response.writeHead(400).end("Bad request");
    return;
  }

  const filePath = join(root, relativePath);
  const stream = createReadStream(filePath);
  stream.on("open", () => {
    response.writeHead(200, { "Content-Type": contentTypes[extname(filePath)] || "application/octet-stream" });
    stream.pipe(response);
  });
  stream.on("error", () => response.writeHead(404).end("Not found"));
}).listen(port, () => console.log(`auto_BOM running at http://localhost:${port}`));

