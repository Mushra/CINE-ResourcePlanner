// Auto-save target: the working SQLite file lives here between explicit Open/Save-As actions,
// so a reload never loses work even if the user never touches the file system.

const DB_NAME = 'cine-resource-planner';
const STORE = 'files';
const AUTOSAVE_KEY = 'autosave.sqlite';

function openIndexedDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveAutosave(bytes: Uint8Array): Promise<void> {
  const db = await openIndexedDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(bytes, AUTOSAVE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function loadAutosave(): Promise<Uint8Array | null> {
  const db = await openIndexedDb();
  try {
    return await new Promise<Uint8Array | null>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(AUTOSAVE_KEY);
      req.onsuccess = () => resolve(req.result ? new Uint8Array(req.result as ArrayBuffer | Uint8Array) : null);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

// The autosave bytes have no name of their own, so the display name (shown in the topbar and
// restored across reloads) is tracked separately in localStorage, which is synchronous.
const FILE_NAME_KEY = 'cine-planner-filename';

export function getStoredFileName(): string | null {
  return localStorage.getItem(FILE_NAME_KEY);
}

export function setStoredFileName(name: string): void {
  localStorage.setItem(FILE_NAME_KEY, name);
}

export async function clearAutosave(): Promise<void> {
  const db = await openIndexedDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(AUTOSAVE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
