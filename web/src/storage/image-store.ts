import { db, StoredImage } from "./indexeddb";

function uuid(): string {
  // crypto.randomUUID is available in all modern Chromium-based browsers
  // (which we already require for WebSerial); fall back for tests.
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2);
}

export interface SaveImageInput {
  filename: string;
  driverId: string;
  vendor: string;
  model: string;
  variant: string;
  data: Uint8Array;
  id?: string;
}

export async function saveImage(input: SaveImageInput): Promise<StoredImage> {
  const id = input.id ?? uuid();
  const now = Date.now();
  const existing = await db.images.get(id);
  const record: StoredImage = {
    id,
    filename: input.filename,
    driverId: input.driverId,
    vendor: input.vendor,
    model: input.model,
    variant: input.variant,
    data: new Blob([input.data as BlobPart]),
    size: input.data.byteLength,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await db.images.put(record);
  return record;
}

export async function loadImageBytes(id: string): Promise<Uint8Array | null> {
  const record = await db.images.get(id);
  if (!record) return null;
  const buf = await record.data.arrayBuffer();
  return new Uint8Array(buf);
}

export async function listRecentImages(limit = 10): Promise<StoredImage[]> {
  return db.images
    .orderBy("updatedAt")
    .reverse()
    .limit(limit)
    .toArray();
}

export async function deleteImage(id: string): Promise<void> {
  await db.images.delete(id);
}
