// Tiny static file server for the tests: serves the repo root like Vercel does.
const http = require("http"), fs = require("fs"), path = require("path");
const root = path.join(__dirname, ".."), port = Number(process.env.PORT) || 4173;
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".webmanifest": "application/manifest+json", ".json": "application/json" };
http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const file = path.join(root, p === "/" ? "index.html" : p);
  if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (err, body) => {
    if (err) { res.writeHead(404).end("Not found"); return; }
    res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream" }).end(body);
  });
}).listen(port, () => console.log(`Serving on http://localhost:${port}`));
