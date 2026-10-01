const DATABASE_NAME = 'stoyangu-offline-v1';
const OBJECT_STORE = 'responses';
const LOCAL_PREFIX = 'stoyangu-offline-v1:';
const LOCAL_MAX_BYTES = 300_000;

type Entry = { key: string; value: unknown; savedAt: number };

let databasePromise: Promise<IDBDatabase | null> | null = null;
const memoryCache = new Map<string, unknown>();

function openDatabase(): Promise<IDBDatabase | null> {
  if (databasePromise) return databasePromise;
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);

  databasePromise = new Promise((resolve) => {
    try {
      const request = indexedDB.open(DATABASE_NAME, 1);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(OBJECT_STORE)) database.createObjectStore(OBJECT_STORE, { keyPath: 'key' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return databasePromise;
}

export async function readOfflineData<T>(key: string): Promise<T | undefined> {
  if (memoryCache.has(key)) return memoryCache.get(key) as T;
  try {
    const database = await openDatabase();
    if (database) {
      const entry = await new Promise<Entry | undefined>((resolve) => {
        const transaction = database.transaction(OBJECT_STORE, 'readonly');
        const request = transaction.objectStore(OBJECT_STORE).get(key);
        request.onsuccess = () => resolve(request.result as Entry | undefined);
        request.onerror = () => resolve(undefined);
      });
      if (entry) {
        memoryCache.set(key, entry.value);
        return entry.value as T;
      }
    }
  } catch { /* Fall through to the small localStorage fallback. */ }

  try {
    const raw = localStorage.getItem(`${LOCAL_PREFIX}${key}`);
    if (!raw) return undefined;
    const entry = JSON.parse(raw) as Entry;
    if (!entry || entry.key !== key || !('value' in entry)) return undefined;
    memoryCache.set(key, entry.value);
    return entry.value as T;
  } catch {
    return undefined;
  }
}

export async function writeOfflineData(key: string, value: unknown): Promise<void> {
  memoryCache.set(key, value);
  const entry: Entry = { key, value, savedAt: Date.now() };
  try {
    const database = await openDatabase();
    if (database) {
      const saved = await new Promise<boolean>((resolve) => {
        const transaction = database.transaction(OBJECT_STORE, 'readwrite');
        transaction.objectStore(OBJECT_STORE).put(entry);
        transaction.oncomplete = () => resolve(true);
        transaction.onerror = () => resolve(false);
        transaction.onabort = () => resolve(false);
      });
      if (saved) return;
    }
  } catch { /* Try localStorage when IndexedDB is unavailable. */ }

  try {
    const serialized = JSON.stringify(entry);
    if (serialized.length <= LOCAL_MAX_BYTES) localStorage.setItem(`${LOCAL_PREFIX}${key}`, serialized);
  } catch { /* Private mode or quota limits: online requests still work. */ }
}

export async function clearOfflineData(): Promise<void> {
  memoryCache.clear();
  try {
    const database = await openDatabase();
    if (database) {
      await new Promise<void>((resolve) => {
        const transaction = database.transaction(OBJECT_STORE, 'readwrite');
        transaction.objectStore(OBJECT_STORE).clear();
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => resolve();
        transaction.onabort = () => resolve();
      });
    }
  } catch { /* Still clear the fallback. */ }
  try {
    for (const key of Object.keys(localStorage)) if (key.startsWith(LOCAL_PREFIX)) localStorage.removeItem(key);
  } catch { /* Private mode. */ }
}
