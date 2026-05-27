import { create } from "zustand";
import type {
  RadioHandle,
  MemoryDict,
  DriverInfo,
} from "../pyodide/types";

export type RuntimeStatus = "idle" | "loading" | "ready" | "error";

export interface RuntimeInfo {
  version: string;
  driversLoaded: string[];
  driverCount: number;
  bundleSha?: string;
  pyodideVersion?: string;
}

export interface OpenRadio {
  info: RadioHandle;
  // Filename/storage info — null for unsaved-new radios.
  filename: string | null;
  storedId: string | null;
  memories: MemoryDict[];
  dirty: boolean;
  validationErrors: Record<number, string[]>;
}

interface AppState {
  status: RuntimeStatus;
  progressLabel: string;
  runtime: RuntimeInfo | null;
  error: string | null;

  drivers: DriverInfo[];
  openRadio: OpenRadio | null;

  setStatus: (s: RuntimeStatus) => void;
  setProgress: (label: string) => void;
  setRuntime: (info: RuntimeInfo) => void;
  setError: (err: string | null) => void;

  setDrivers: (drivers: DriverInfo[]) => void;
  setOpenRadio: (radio: OpenRadio | null) => void;
  setMemories: (memories: MemoryDict[]) => void;
  updateMemory: (memory: MemoryDict) => void;
  setDirty: (dirty: boolean) => void;
  setValidationErrors: (
    number: number,
    errors: string[],
  ) => void;
}

export const useAppStore = create<AppState>((set) => ({
  status: "idle",
  progressLabel: "",
  runtime: null,
  error: null,

  drivers: [],
  openRadio: null,

  setStatus: (status) => set({ status }),
  setProgress: (progressLabel) => set({ progressLabel }),
  setRuntime: (runtime) => set({ runtime, status: "ready", error: null }),
  setError: (error) => set({ error, status: error ? "error" : "idle" }),

  setDrivers: (drivers) => set({ drivers }),
  setOpenRadio: (openRadio) => set({ openRadio }),
  setMemories: (memories) =>
    set((s) =>
      s.openRadio ? { openRadio: { ...s.openRadio, memories } } : s,
    ),
  updateMemory: (memory) =>
    set((s) => {
      if (!s.openRadio) return s;
      const memories = s.openRadio.memories.slice();
      const idx = memories.findIndex((m) => m.number === memory.number);
      if (idx >= 0) memories[idx] = memory;
      else memories.push(memory);
      return {
        openRadio: { ...s.openRadio, memories, dirty: true },
      };
    }),
  setDirty: (dirty) =>
    set((s) =>
      s.openRadio ? { openRadio: { ...s.openRadio, dirty } } : s,
    ),
  setValidationErrors: (number, errors) =>
    set((s) => {
      if (!s.openRadio) return s;
      const validationErrors = { ...s.openRadio.validationErrors };
      if (errors.length === 0) delete validationErrors[number];
      else validationErrors[number] = errors;
      return { openRadio: { ...s.openRadio, validationErrors } };
    }),
}));
