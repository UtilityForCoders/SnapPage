// Almacenamiento de capturas en IndexedDB (compartido entre el service worker y las páginas de la extensión).
const DB_NAME = 'snappage';
const STORE = 'captures';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const result = fn(tx.objectStore(STORE));
    tx.oncomplete = () => { db.close(); resolve(result && 'result' in result ? result.result : undefined); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

export const saveCapture = (record) => run('readwrite', (s) => { s.put(record); });
export const getCapture = (id) => run('readonly', (s) => s.get(id));
export const deleteCapture = (id) => run('readwrite', (s) => { s.delete(id); });

// Conserva solo las últimas `keep` capturas para no llenar el disco.
export async function pruneOld(keep = 5) {
  const keys = await run('readonly', (s) => s.getAllKeys());
  const old = keys.sort().slice(0, Math.max(0, keys.length - keep));
  if (old.length) await run('readwrite', (s) => old.forEach((k) => s.delete(k)));
}
