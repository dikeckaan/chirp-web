// Mirror of `chirp_web.api` return shapes. Keep these in sync with
// `python/chirp_web/api.py` and the codecs.

export interface DriverInfo {
  id: string;
  name: string;
  vendor: string;
  model: string;
  variant: string;
  isLive: boolean;
  isClone: boolean;
  supportsNew: boolean;
  memsize: number;
}

export interface RadioHandle {
  handle: number;
  vendor: string;
  model: string;
  variant: string;
  memoryBounds: [number, number];
  hasSettings: boolean;
  hasBank: boolean;
  hasName: boolean;
  isClone: boolean;
  isLive: boolean;
  validModes: string[];
  validTmodes: string[];
  validDuplexes: string[];
  validPowerLevels: string[];
  validTuningSteps: number[];
  validBands: [number, number][];
}

export interface MemoryExtra {
  name: string;
  shortname: string;
  value: unknown;
}

export interface MemoryDict {
  number: number;
  empty: boolean;
  freq: number;
  name: string;
  rtone: number;
  ctone: number;
  dtcs: number;
  rx_dtcs: number;
  tmode: string;
  cross_mode: string;
  dtcs_polarity: string;
  skip: string;
  power: string | null;
  duplex: string;
  offset: number;
  mode: string;
  tuning_step: number;
  comment: string;
  extra: MemoryExtra[];
}

export interface SettingsTreeNode {
  type: "group" | "setting";
  name: string;
  shortname: string;
  isRoot?: boolean;
  children?: SettingsTreeNode[];
  values?: SettingsValue[];
}

export type SettingsValue =
  | { kind: "boolean"; value: boolean }
  | { kind: "integer"; value: number; min: number; max: number; step: number }
  | { kind: "float"; value: number; min: number; max: number; resolution: number }
  | { kind: "list"; value: string; options: string[] }
  | { kind: "map"; value: unknown; options: [string, unknown][] }
  | { kind: "string"; value: string; maxLength: number; minLength: number }
  | { kind: "unknown"; value: string };
