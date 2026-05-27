import { ChirpRuntime } from "./runtime";

// Single ChirpRuntime per page. Components import this directly instead
// of threading the instance through React context — the singleton is
// fine because we always have exactly one Pyodide worker.
export const runtime = new ChirpRuntime();
