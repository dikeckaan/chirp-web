// Message types exchanged between the main thread and the Pyodide
// worker. Keep them tight — the worker has no compile-time access to
// React state, so everything we want to surface to the UI must come
// through here.

export type WorkerInbound =
  | {
      type: "init";
      bundleUrl: string;
      pyodideIndexUrl: string;
      bundleSha: string;
      serialSab: SharedArrayBuffer;
    }
  | { type: "ping" }
  | { type: "call"; id: number; method: string; args: unknown[] };

export type WorkerOutbound =
  | { type: "progress"; label: string }
  | {
      type: "ready";
      version: string;
      driversLoaded: string[];
      driverCount: number;
      bundleSha: string;
      pyodideVersion: string;
    }
  | { type: "error"; message: string; stack?: string }
  | { type: "pong" }
  | {
      type: "callResult";
      id: number;
      ok: true;
      result: unknown;
    }
  | {
      type: "callResult";
      id: number;
      ok: false;
      error: { message: string; traceback?: string };
    }
  | { type: "progressCall"; callbackId: number; args: unknown[] };

/**
 * Sentinel used in `call` args to mark a position where the worker
 * should install a callback proxy. Functions can't cross the worker
 * boundary directly; the main thread stores the real fn in a registry
 * keyed by `id`, and the worker forwards each invocation as a
 * `progressCall` message.
 */
export interface CallbackPlaceholder {
  __callbackId: number;
}

export function isCallbackPlaceholder(
  v: unknown,
): v is CallbackPlaceholder {
  return (
    typeof v === "object" &&
    v !== null &&
    "__callbackId" in v &&
    typeof (v as CallbackPlaceholder).__callbackId === "number"
  );
}
