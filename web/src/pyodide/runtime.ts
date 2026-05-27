// Main-thread bridge to the Pyodide worker.
//
// Lifecycle is owned by the app shell. This module:
//   - spawns the worker,
//   - relays init progress / readiness via callbacks,
//   - exposes a Promise-based RPC API to the rest of the app.

import type { WorkerInbound, WorkerOutbound } from "./messages";
import type {
  DriverInfo,
  RadioHandle,
  MemoryDict,
  SettingsTreeNode,
} from "./types";
import { WebSerialBridge } from "../webserial/bridge";
import { createSAB } from "../webserial/shared-buffer";

export interface RuntimeCallbacks {
  onProgress: (label: string) => void;
  onReady: (info: {
    version: string;
    driversLoaded: string[];
    driverCount: number;
    bundleSha: string;
    pyodideVersion: string;
  }) => void;
  onError: (message: string, stack?: string) => void;
}

const BUNDLE_URL = "/chirp-bundle/chirp_pkg.tar";
const BUNDLE_SHA_URL = "/chirp-bundle/chirp_pkg.sha256";

interface PendingCall {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  callbackIds: number[];
}

type ProgressCallback = (...args: unknown[]) => void;

export class ChirpRuntime {
  private worker: Worker | null = null;
  private nextCallId = 1;
  private pending = new Map<number, PendingCall>();
  private ready = false;

  private nextCallbackId = 1;
  private callbacks = new Map<number, ProgressCallback>();

  // Lazily created — only when the user actually opens a serial port.
  // We share the same SAB with the worker on init so the shim is ready
  // the moment a clone-download flow starts.
  private serialBridge: WebSerialBridge | null = null;
  private serialSab: SharedArrayBuffer | null = null;

  // Stored to enable hard-reset without the caller re-supplying.
  private lastCallbacks: RuntimeCallbacks | null = null;

  // ----------------------------------------------------- init / lifecycle
  async init(cb: RuntimeCallbacks): Promise<void> {
    if (this.worker) return;
    this.lastCallbacks = cb;

    cb.onProgress("Worker başlatılıyor");
    this.worker = new Worker(new URL("./worker.ts", import.meta.url), {
      type: "module",
    });

    // SAB must be created before the worker boots so the shim's
    // `chirpWebSerial` proxy can latch onto it.
    if (typeof SharedArrayBuffer === "undefined") {
      cb.onError(
        "SharedArrayBuffer kullanılamıyor — sayfa cross-origin isolated değil. " +
          "(COOP/COEP header'larını kontrol et.)",
      );
      return;
    }
    this.serialSab = createSAB();
    this.serialBridge = new WebSerialBridge(this.serialSab);
    this.serialBridge.start();

    this.worker.onmessage = (ev: MessageEvent<WorkerOutbound>) => {
      const msg = ev.data;
      switch (msg.type) {
        case "progress":
          cb.onProgress(msg.label);
          break;
        case "ready":
          this.ready = true;
          cb.onReady({
            version: msg.version,
            driversLoaded: msg.driversLoaded,
            driverCount: msg.driverCount,
            bundleSha: msg.bundleSha,
            pyodideVersion: msg.pyodideVersion,
          });
          break;
        case "error":
          cb.onError(msg.message, msg.stack);
          break;
        case "callResult":
          this.resolveCall(msg);
          break;
        case "progressCall": {
          const fn = this.callbacks.get(msg.callbackId);
          if (fn) fn(...msg.args);
          break;
        }
      }
    };

    this.worker.onerror = (ev) => {
      cb.onError(ev.message ?? "Worker error", ev.error?.stack);
    };

    let bundleSha = "unknown";
    try {
      const shaRes = await fetch(BUNDLE_SHA_URL);
      if (shaRes.ok) bundleSha = (await shaRes.text()).trim();
    } catch {
      // Non-fatal — used only for display.
    }

    const initMsg: WorkerInbound = {
      type: "init",
      bundleUrl: BUNDLE_URL,
      bundleSha,
      serialSab: this.serialSab!,
    };
    this.worker.postMessage(initMsg);
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    this.ready = false;
    for (const [, p] of this.pending) {
      p.reject(new Error("Runtime disposed"));
    }
    this.pending.clear();
    this.callbacks.clear();
    this.serialBridge?.dispose();
    this.serialBridge = null;
    this.serialSab = null;
  }

  /** Terminate worker + serial bridge and bring up a fresh runtime.
   *  Used by the clone dialog to cancel an in-flight sync_in / sync_out
   *  without forcing a full page reload. */
  async hardReset(): Promise<void> {
    const cb = this.lastCallbacks;
    if (!cb) {
      throw new Error("Runtime henüz init edilmedi");
    }
    this.dispose();
    await this.init(cb);
  }

  // -------------------------------------------------- WebSerial accessors
  get serial(): WebSerialBridge {
    if (!this.serialBridge) {
      throw new Error("Serial bridge initialized değil");
    }
    return this.serialBridge;
  }

  // ----------------------------------------------------------------- rpc
  private resolveCall(
    msg: Extract<WorkerOutbound, { type: "callResult" }>,
  ): void {
    const pending = this.pending.get(msg.id);
    if (!pending) return;
    this.pending.delete(msg.id);
    // Clean up any callbacks registered for this call.
    for (const cbId of pending.callbackIds) {
      this.callbacks.delete(cbId);
    }
    if (msg.ok) {
      pending.resolve(msg.result);
    } else {
      pending.reject(new Error(msg.error.message));
    }
  }

  private call<T>(method: string, ...args: unknown[]): Promise<T> {
    if (!this.worker || !this.ready) {
      return Promise.reject(new Error("Runtime not ready"));
    }
    const id = this.nextCallId++;
    return new Promise<T>((resolve, reject) => {
      // Replace any function arg with a callback placeholder, register
      // the real fn locally so we can dispatch progressCall messages.
      const callbackIds: number[] = [];
      const wired = args.map((a) => {
        if (typeof a === "function") {
          const cbId = this.nextCallbackId++;
          this.callbacks.set(cbId, a as ProgressCallback);
          callbackIds.push(cbId);
          return { __callbackId: cbId };
        }
        return a;
      });

      this.pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
        callbackIds,
      });

      const transfer: Transferable[] = [];
      for (const a of wired) {
        if (a instanceof Uint8Array) transfer.push(a.buffer);
      }
      const msg: WorkerInbound = { type: "call", id, method, args: wired };
      this.worker!.postMessage(msg, transfer);
    });
  }

  // --------------------------------------------------- typed API surface
  listDrivers(): Promise<DriverInfo[]> {
    return this.call("list_drivers");
  }

  openImage(data: Uint8Array, filename: string): Promise<RadioHandle> {
    return this.call("open_image_bytes", data, filename);
  }

  saveImage(handle: number): Promise<Uint8Array> {
    return this.call("save_image_bytes", handle);
  }

  newRadio(driverId: string): Promise<RadioHandle> {
    return this.call("new_radio", driverId);
  }

  closeRadio(handle: number): Promise<void> {
    return this.call("close_radio", handle);
  }

  getMemory(handle: number, number: number): Promise<MemoryDict> {
    return this.call("get_memory", handle, number);
  }

  getMemoryRange(
    handle: number,
    start: number,
    end: number,
  ): Promise<MemoryDict[]> {
    return this.call("get_memory_range", handle, start, end);
  }

  setMemory(handle: number, mem: Partial<MemoryDict>): Promise<string[]> {
    return this.call("set_memory", handle, mem);
  }

  eraseMemory(handle: number, number: number): Promise<void> {
    return this.call("erase_memory", handle, number);
  }

  getSettingsTree(handle: number): Promise<SettingsTreeNode> {
    return this.call("get_settings_tree", handle);
  }

  applySettings(handle: number, tree: SettingsTreeNode): Promise<void> {
    return this.call("apply_settings", handle, tree);
  }

  // ----------------------------------------------------------------- CSV
  exportCsv(handle: number): Promise<Uint8Array> {
    return this.call("export_csv", handle);
  }

  importCsv(
    handle: number,
    data: Uint8Array,
  ): Promise<{ imported: number; skipped: number; warnings: string[] }> {
    return this.call("import_csv", handle, data);
  }

  // ------------------------------------------------------------- modules
  loadModule(
    filename: string,
    source: Uint8Array,
  ): Promise<{
    sha256: string;
    modname: string;
    filename: string;
    loadedAt: number;
    newDrivers: { id: string; name: string; vendor: string; model: string }[];
  }> {
    return this.call("load_module", filename, source);
  }

  unloadModule(modname: string): Promise<void> {
    return this.call("unload_module", modname);
  }

  // ------------------------------------------------------------- clone
  cloneIn(
    driverId: string,
    portHandle: number,
    onProgress?: (cur: number, max: number, msg: string) => void,
  ): Promise<RadioHandle> {
    return this.call("clone_in", driverId, portHandle, onProgress);
  }

  cloneOut(
    handle: number,
    portHandle: number,
    onProgress?: (cur: number, max: number, msg: string) => void,
  ): Promise<void> {
    return this.call("clone_out", handle, portHandle, onProgress);
  }
}
