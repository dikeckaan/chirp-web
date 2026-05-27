/// <reference lib="webworker" />
// Pyodide host worker.
//
// Lifecycle:
//   1. Main thread posts `{ type: "init", bundleUrl, bundleSha }`.
//   2. We load Pyodide as an ES module from the official CDN.
//   3. We fetch the bundle, write it to Pyodide FS, untar at /home/pyodide.
//   4. We add `/home/pyodide/shims` and `/home/pyodide` to sys.path and
//      call `chirp_web.boot.startup()`.
//   5. We post `{ type: "ready", ... }` and start serving RPC calls.

import type { WorkerInbound, WorkerOutbound } from "./messages";
import { WebSerialWorkerProxy } from "../webserial/worker-proxy";

declare const self: DedicatedWorkerGlobalScope;

let pyodide: any = null;
let rpcDispatch: ((method: string, args: unknown[]) => unknown) | null = null;
let serialProxy: WebSerialWorkerProxy | null = null;

function post(msg: WorkerOutbound, transfer?: Transferable[]): void {
  if (transfer && transfer.length) {
    self.postMessage(msg, transfer);
  } else {
    self.postMessage(msg);
  }
}

// Pyodide is served from our own origin (see web/scripts/copy-pyodide.js)
// to avoid COEP `require-corp` blocking and to make the app fully
// offline-capable through the service worker.
const PYODIDE_INDEX_URL = "/pyodide/";

interface PyodideModule {
  loadPyodide: (opts: { indexURL: string }) => Promise<unknown>;
}

async function loadPyodide(): Promise<any> {
  // /* @vite-ignore */ stops Vite from trying to resolve the URL at
  // bundle time — it's loaded from `/pyodide/` at runtime.
  const mod = (await import(
    /* @vite-ignore */ `${PYODIDE_INDEX_URL}pyodide.mjs`
  )) as PyodideModule;
  return await mod.loadPyodide({ indexURL: PYODIDE_INDEX_URL });
}

async function fetchBundle(url: string): Promise<Uint8Array> {
  post({ type: "progress", label: "CHIRP paketi indiriliyor" });
  const res = await fetch(url, { credentials: "same-origin" });
  if (!res.ok) {
    throw new Error(`Bundle fetch failed: ${res.status} ${res.statusText}`);
  }
  const buf = await res.arrayBuffer();
  return new Uint8Array(buf);
}

async function init(
  bundleUrl: string,
  bundleSha: string,
  serialSab: SharedArrayBuffer,
): Promise<void> {
  // Expose the WebSerial sync proxy to Python BEFORE booting CHIRP —
  // the shim's `import serial` lookup happens during boot.startup().
  serialProxy = new WebSerialWorkerProxy(serialSab);
  (self as unknown as { chirpWebSerial: WebSerialWorkerProxy }).chirpWebSerial =
    serialProxy;

  post({ type: "progress", label: "Pyodide yükleniyor" });
  pyodide = await loadPyodide();

  const bundle = await fetchBundle(bundleUrl);
  post({ type: "progress", label: "Paket Pyodide FS'ine yazılıyor" });
  pyodide.FS.mkdirTree("/home/pyodide");
  pyodide.FS.writeFile("/home/pyodide/chirp_pkg.tar", bundle);

  post({ type: "progress", label: "CHIRP açılıyor" });
  await pyodide.runPythonAsync(`
import tarfile, sys, os
os.makedirs('/home/pyodide', exist_ok=True)
with tarfile.open('/home/pyodide/chirp_pkg.tar') as tf:
    tf.extractall('/home/pyodide')
# Order matters: shims first so 'import serial' inside CHIRP resolves
# to our shim, not pyodide's missing-package fallback.
for p in ('/home/pyodide/shims', '/home/pyodide'):
    if p not in sys.path:
        sys.path.insert(0, p)
`);

  post({ type: "progress", label: "Sürücüler yükleniyor" });
  const info = await pyodide.runPythonAsync(`
import json
from chirp_web import boot
result = boot.startup()
json.dumps(result)
`);

  const parsed = JSON.parse(info) as {
    version: string;
    driversLoaded: string[];
    driverCount: number;
  };

  // Cache the RPC dispatcher proxy. We `eval` `rpc.dispatch` to get the
  // function object directly as a JsProxy — no need to stash it in a
  // global beforehand.
  rpcDispatch = await pyodide.runPythonAsync(`
from chirp_web import rpc
rpc.dispatch
`);

  post({
    type: "ready",
    version: parsed.version,
    driversLoaded: parsed.driversLoaded,
    driverCount: parsed.driverCount,
    bundleSha,
    pyodideVersion: pyodide.version,
  });
}

// ----------------------------------------------------------- RPC

function reifyCallbacks(args: unknown[]): unknown[] {
  // Replace `{__callbackId: N}` placeholders with real JS functions
  // that postMessage a `progressCall` back to the main thread.
  return args.map((a) => {
    if (
      a &&
      typeof a === "object" &&
      "__callbackId" in (a as Record<string, unknown>) &&
      typeof (a as { __callbackId: unknown }).__callbackId === "number"
    ) {
      const cbId = (a as { __callbackId: number }).__callbackId;
      return (...cbArgs: unknown[]) => {
        post({ type: "progressCall", callbackId: cbId, args: cbArgs });
      };
    }
    return a;
  });
}

async function handleCall(
  id: number,
  method: string,
  args: unknown[],
): Promise<void> {
  if (!rpcDispatch) {
    post({
      type: "callResult",
      id,
      ok: false,
      error: { message: "Runtime not ready (rpcDispatch missing)" },
    });
    return;
  }

  try {
    const reified = reifyCallbacks(args);
    // pyodide.ffi converts JS args (Array, Uint8Array, etc.) automatically
    // when crossing into Python. `dispatch` itself unwraps via to_py().
    let result = rpcDispatch(method, reified);
    // Awaiting a sync function is a no-op; if a future api method becomes
    // async (`async def`), Pyodide returns a Promise we can await here.
    if (result && typeof (result as any).then === "function") {
      result = await result;
    }

    // Pyodide returns Python objects as JsProxy. Coerce to plain JS so
    // postMessage's structured clone works. `toJs` is the canonical
    // converter; dict_converter ensures plain objects (not Map).
    const proxy: any = result;
    let coerced: any;
    if (proxy && typeof proxy.toJs === "function") {
      coerced = proxy.toJs({ dict_converter: Object.fromEntries });
      proxy.destroy?.();
    } else {
      coerced = proxy;
    }

    // If result is a Uint8Array, transfer its buffer for zero-copy.
    const transfer =
      coerced instanceof Uint8Array ? [coerced.buffer] : undefined;

    post({ type: "callResult", id, ok: true, result: coerced }, transfer);
  } catch (err) {
    const e = err as Error & { type?: string };
    post({
      type: "callResult",
      id,
      ok: false,
      error: { message: e.message ?? String(err), traceback: e.stack },
    });
  }
}

self.onmessage = async (ev: MessageEvent<WorkerInbound>) => {
  const msg = ev.data;
  try {
    if (msg.type === "init") {
      await init(msg.bundleUrl, msg.bundleSha, msg.serialSab);
    } else if (msg.type === "ping") {
      post({ type: "pong" });
    } else if (msg.type === "call") {
      await handleCall(msg.id, msg.method, msg.args);
    }
  } catch (err) {
    const e = err as Error;
    post({ type: "error", message: e.message, stack: e.stack });
  }
};
