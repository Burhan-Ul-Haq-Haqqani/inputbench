const DB_NAME = 'inputbench_media_db';
const DB_VERSION = 1;
const STORE_NAME = 'assets';

export type MediaAssetKey = 'custom_background' | 'wave_decoration' | 'shuffle_ball';

export interface StoredMediaAsset {
  dataUrl: string;
  fileName: string;
  mimeType: string;
  updatedAt: number;
}

function openMediaDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Failed to open media DB'));
  });
}

export async function saveMediaAsset(
  key: MediaAssetKey,
  asset: StoredMediaAsset
): Promise<void> {
  const db = await openMediaDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(asset, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Failed to save asset'));
  });
  db.close();
}

export async function loadMediaAsset(
  key: MediaAssetKey
): Promise<StoredMediaAsset | null> {
  try {
    const db = await openMediaDb();
    const result = await new Promise<StoredMediaAsset | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(key);
      req.onsuccess = () => resolve((req.result as StoredMediaAsset | undefined) ?? null);
      req.onerror = () => reject(req.error ?? new Error('Failed to read asset'));
    });
    db.close();
    return result;
  } catch {
    return null;
  }
}

export async function deleteMediaAsset(key: MediaAssetKey): Promise<void> {
  try {
    const db = await openMediaDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Failed to delete asset'));
    });
    db.close();
  } catch {
    // Ignore storage cleanup errors silently
  }
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Invalid file data'));
      }
    };
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}
