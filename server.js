import { createReadStream } from "node:fs";
import { access, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import reclubImport from "./api/reclub-import.js";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "public");
const host = process.env.HOST || (process.env.VERCEL ? "0.0.0.0" : "127.0.0.1");
const port = Number(process.env.PORT || 5173);
const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp"
};
const maxRequestBytes = 4096;

function sendJson(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

async function parseJsonBody(req, res) {
  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of req) {
    totalBytes += chunk.length;
    if (totalBytes > maxRequestBytes) {
      sendJson(res, 413, { error: "The request is too large." });
      req.resume();
      return null;
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    sendJson(res, 400, { error: "Send a valid JSON request." });
    return null;
  }
}

async function serveStaticFile(pathname, req, res) {
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    res.writeHead(400).end("Bad request");
    return;
  }

  let filePath = resolve(root, `.${decodedPath}`);
  if (filePath !== root && !filePath.startsWith(`${root}${sep}`)) {
    res.writeHead(403).end("Forbidden");
    return;
  }
  if (decodedPath.endsWith("/")) filePath = resolve(filePath, "index.html");
  try {
    await access(filePath);
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      res.writeHead(404).end("Not found");
      return;
    }
    res.writeHead(200, {
      "content-type": mimeTypes[extname(filePath)] || "application/octet-stream",
      "content-length": fileStat.size
    });
    if (req.method === "HEAD") res.end();
    else createReadStream(filePath).pipe(res);
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "EACCES") {
      res.writeHead(404).end("Not found");
      return;
    }
    console.error("Local static file request failed:", error);
    res.writeHead(500).end("Could not serve this file.");
  }
}

const server = createServer(async (req, res) => {
  let pathname;
  try {
    pathname = new URL(req.url, `http://${req.headers.host || "localhost"}`).pathname;
  } catch {
    res.writeHead(400).end("Bad request");
    return;
  }

  if (pathname === "/api/reclub-import") {
    if (req.method !== "POST") {
      res.writeHead(405, { allow: "POST" }).end("Method not allowed");
      return;
    }
    const body = await parseJsonBody(req, res);
    if (res.writableEnded) return;
    const apiResponse = {
      headers: {},
      setHeader(name, value) { this.headers[name] = value; },
      status(code) { this.statusCode = code; return this; },
      json(payload) {
        res.writeHead(this.statusCode, {
          ...this.headers,
          "content-type": "application/json; charset=utf-8"
        });
        res.end(JSON.stringify(payload));
      }
    };
    try {
      await reclubImport({
        method: req.method,
        headers: req.headers,
        body
      }, apiResponse);
    } catch (error) {
      console.error("Local Reclub import request failed:", error);
      if (!res.writableEnded) sendJson(res, 500, { error: "The Reclub import request failed." });
    }
    return;
  }

  if (pathname.startsWith("/api/")) {
    res.writeHead(404).end("Not found");
    return;
  }
  if (!["GET", "HEAD"].includes(req.method)) {
    res.writeHead(405, { allow: "GET, HEAD" }).end("Method not allowed");
    return;
  }
  await serveStaticFile(pathname, req, res);
});

server.listen(port, host, () => {
  console.log(`Gear Up Rally is running at http://${host}:${port}`);
});
