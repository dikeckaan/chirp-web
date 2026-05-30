import { db, StoredModule, putWithQuota } from "./indexeddb";

export async function saveModule(
  filename: string,
  data: Uint8Array,
  sha256: string,
  newDrivers: { id: string; name: string }[],
): Promise<StoredModule> {
  const record: StoredModule = {
    sha256,
    filename,
    data: new Blob([data as BlobPart]),
    loadedAt: Date.now(),
    newDrivers,
  };
  await putWithQuota(() => db.modules.put(record));
  return record;
}

export async function listModules(): Promise<StoredModule[]> {
  return db.modules.orderBy("loadedAt").reverse().toArray();
}

export async function getModule(sha256: string): Promise<StoredModule | null> {
  return (await db.modules.get(sha256)) ?? null;
}

export async function deleteModule(sha256: string): Promise<void> {
  await db.modules.delete(sha256);
}

export async function loadModuleBytes(
  sha256: string,
): Promise<Uint8Array | null> {
  const record = await db.modules.get(sha256);
  if (!record) return null;
  const buf = await record.data.arrayBuffer();
  return new Uint8Array(buf);
}
