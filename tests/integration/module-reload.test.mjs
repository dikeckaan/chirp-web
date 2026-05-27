// Reproduce the module-reload bug in plain Node:
//   - boot Pyodide + the CHIRP bundle (mirroring web/src/pyodide/worker.ts)
//   - count vendor drivers
//   - load f4hwn UV-K5 via module_loader.load_module
//   - count drivers again
//   - simulate a "page reload": fresh Pyodide, replay the auto-reload
//     flow from App.tsx (load_module first, then list_drivers)

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";

const ROOT = resolve(import.meta.dirname, "../..");
const BUNDLE = resolve(ROOT, "web/public/chirp-bundle/chirp_pkg.tar");
const F4HWN = resolve(ROOT, "../chirp/f4hwn.fusion.chirp.v5.5.0.py");

const require = createRequire(resolve(ROOT, "web/package.json"));
const { loadPyodide } = require("pyodide");

async function freshRuntime() {
  const py = await loadPyodide({
    indexURL: resolve(ROOT, "web/node_modules/pyodide"),
  });
  const tar = readFileSync(BUNDLE);
  py.FS.mkdirTree("/home/pyodide");
  py.FS.writeFile("/home/pyodide/chirp_pkg.tar", tar);
  await py.runPythonAsync(`
import tarfile, sys
with tarfile.open('/home/pyodide/chirp_pkg.tar') as tf:
    tf.extractall('/home/pyodide')
for p in ('/home/pyodide/shims', '/home/pyodide'):
    if p not in sys.path:
        sys.path.insert(0, p)
from chirp_web import boot
boot.startup()
`);
  return py;
}

async function loadF4hwn(py) {
  const src = readFileSync(F4HWN);
  py.FS.writeFile("/tmp/f4hwn.py", src);
  return await py.runPythonAsync(`
from chirp_web import module_loader
with open('/tmp/f4hwn.py', 'rb') as fp:
    data = fp.read()
result = module_loader.load_module('f4hwn.fusion.chirp.v5.5.0.py', data)
import json
json.dumps(result)
`);
}

async function listUVK5(py) {
  return await py.runPythonAsync(`
from chirp_web import api
import json
drivers = api.list_drivers()
uvk5 = [d for d in drivers if 'UV-K5' in d['name'] or 'uvk5' in d['id'].lower()]
json.dumps({"total": len(drivers), "uvk5": uvk5})
`);
}

console.log("=== Session 1: fresh boot + load f4hwn ===");
const py1 = await freshRuntime();
console.log("before load:", await listUVK5(py1));
console.log("loadModule:", await loadF4hwn(py1));
console.log("after load:", await listUVK5(py1));

console.log("\n=== Session 2: fresh boot, then auto-reload f4hwn ===");
const py2 = await freshRuntime();
console.log("before reload:", await listUVK5(py2));
console.log("loadModule on fresh:", await loadF4hwn(py2));
console.log("after auto-reload:", await listUVK5(py2));

process.exit(0);
