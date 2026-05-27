import { db } from "./indexeddb";

export async function getPref<T = unknown>(key: string, fallback: T): Promise<T> {
  const row = await db.prefs.get(key);
  return (row?.value as T) ?? fallback;
}

export async function setPref(key: string, value: unknown): Promise<void> {
  await db.prefs.put({ key, value });
}
