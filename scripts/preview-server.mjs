// Minimal static file server for previewing generated reports and glossary pages
// in a browser. No dependencies. Usage: `node scripts/preview-server.mjs [port]`
// Then open http://localhost:<port>/ (redirects to the latest glossary index).

import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(import.meta.url), "..", "..");
const PORT = Number(process.argv[2] ?? process.env.PORT ?? 4599);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".prom": "text/plain; charset=utf-8",
  ".jsonl": "application/x-ndjson; charset=utf-8",
};

const DEFAULT_PAGE = "/reports/latest/glossary/index.html";

const server = createServer((req, res) => {
  let urlPath = decodeURIComponent((req.url ?? "/").split("?")[0]);
  if (urlPath === "/") urlPath = DEFAULT_PAGE;

  // Contain requests to the repo root (no path traversal).
  const abs = normalize(join(ROOT, urlPath));
  if (!abs.startsWith(ROOT)) {
    res.writeHead(403).end("Forbidden");
    return;
  }
  if (!existsSync(abs) || !statSync(abs).isFile()) {
    res.writeHead(404, { "content-type": "text/html; charset=utf-8" })
      .end(`<h1>404</h1><p>Not found: ${urlPath}</p><p><a href="${DEFAULT_PAGE}">Glossary index</a></p>`);
    return;
  }
  res.writeHead(200, { "content-type": TYPES[extname(abs).toLowerCase()] ?? "application/octet-stream" });
  createReadStream(abs).pipe(res);
});

server.listen(PORT, () => {
  console.log(`Preview server: http://localhost:${PORT}${DEFAULT_PAGE}`);
  console.log(`Report:         http://localhost:${PORT}/reports/latest/report.html`);
});
