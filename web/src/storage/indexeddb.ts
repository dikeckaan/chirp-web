import Dexie, { Table } from "dexie";

/**
 * IndexedDB schema for CHIRP-Web.
 *
 * `images` — every .img the user opens (auto-stored on open, replaceable
 * on save). Keyed by an opaque GUID; the filename is just metadata.
 *
 * `modules` — community .py modules uploaded via Module Loader. Keyed
 * by the SHA-256 of the source.
 *
 * `prefs` — small key/value store (theme, last-open id, etc.).
 */
export interface StoredImage {
  id: string;
  filename: string;
  driverId: string;
  vendor: string;
  model: string;
  variant: string;
  data: Blob;
  size: number;
  createdAt: number;
  updatedAt: number;
}

export interface StoredModule {
  sha256: string;
  filename: string;
  data: Blob;
  loadedAt: number;
  newDrivers: { id: string; name: string }[];
}

export interface PrefEntry {
  key: string;
  value: unknown;
}

class ChirpDB extends Dexie {
  images!: Table<StoredImage, string>;
  modules!: Table<StoredModule, string>;
  prefs!: Table<PrefEntry, string>;

  constructor() {
    super("chirp-web");
    this.version(1).stores({
      images: "id, filename, driverId, updatedAt",
      modules: "sha256, filename, loadedAt",
      prefs: "key",
    });
  }
}

export const db = new ChirpDB();

/** Friendly error for an exhausted storage quota. */
export class StorageQuotaError extends Error {
  constructor() {
    super(
      "Tarayıcı depolama alanı dolu — yer açmak için eski image " +
        "veya modülleri silin.",
    );
    this.name = "StorageQuotaError";
  }
}

function isQuotaError(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  // Dexie surfaces the underlying DOMException name; also match the
  // message defensively across browsers.
  return e.name === "QuotaExceededError" || /quota/i.test(e.message);
}

/** Run an IndexedDB write, translating quota failures into a clear error. */
export async function putWithQuota<T>(op: () => Promise<T>): Promise<T> {
  try {
    return await op();
  } catch (e) {
    if (isQuotaError(e)) throw new StorageQuotaError();
    throw e;
  }
}
