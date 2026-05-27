#!/usr/bin/env node
// Copies the Pyodide runtime out of node_modules into web/public/pyodide
// so we can serve it from our own origin. Self-hosting avoids COEP
// issues, makes the app offline-ready (with the service worker), and
// removes the CDN dependency.

import { promises as fs } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const src = join(root, "node_modules", "pyodide");
const dst = join(root, "public", "pyodide");

// Files Pyodide loads lazily. Strip TypeScript declarations and source
// maps — saves ~10 MB and the browser doesn't need them.
const SKIP = (name) =>
  name.endsWith(".d.ts") ||
  name.endsWith(".map") ||
  name === "README.md" ||
  name === "package.json" ||
  name === "console.html";

async function copyTree(from, to) {
  await fs.mkdir(to, { recursive: true });
  const entries = await fs.readdir(from, { withFileTypes: true });
  let copied = 0;
  let bytes = 0;
  for (const ent of entries) {
    if (SKIP(ent.name)) continue;
    const srcPath = join(from, ent.name);
    const dstPath = join(to, ent.name);
    if (ent.isDirectory()) {
      const sub = await copyTree(srcPath, dstPath);
      copied += sub.copied;
      bytes += sub.bytes;
    } else {
      await fs.copyFile(srcPath, dstPath);
      const st = await fs.stat(dstPath);
      bytes += st.size;
      copied++;
    }
  }
  return { copied, bytes };
}

const stats = await copyTree(src, dst);
console.log(
  `pyodide → public/pyodide: ${stats.copied} files, ` +
    `${(stats.bytes / 1024 / 1024).toFixed(1)} MB`,
);
