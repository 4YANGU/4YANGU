export type ComposerDraft = { step: 'video' | 'photo' | 'details'; name: string; price: string; colors: string[]; sizes: string[]; hasColors: boolean; hasSizes: boolean; note: string; files: File[]; savedAt: number };
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('stoyangu-composer-v12', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('drafts');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function readDraft(key: string): Promise<ComposerDraft | null> {
  const db = await openDb();
  try { return await new Promise((resolve, reject) => { const request = db.transaction('drafts').objectStore('drafts').get(key); request.onsuccess = () => resolve(request.result || null); request.onerror = () => reject(request.error); }); }
  finally { db.close(); }
}
export async function writeDraft(key: string, draft: ComposerDraft | null): Promise<void> {
  const db = await openDb();
  try { await new Promise<void>((resolve, reject) => { const tx = db.transaction('drafts', 'readwrite'); if (draft) tx.objectStore('drafts').put(draft, key); else tx.objectStore('drafts').delete(key); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); }); }
  finally { db.close(); }
}
