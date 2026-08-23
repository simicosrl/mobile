// Minimal promise-based IndexedDB wrapper. No external dependency —
// this is the only persistence layer the app needs (documents can carry
// base64 signature/photo data, which outgrows localStorage's quota).
const DB_NAME = 'simico-warehouse';
const DB_VERSION = 1;
const STORE_DOCS = 'documents';
const STORE_KV = 'kv';

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_DOCS)) {
        db.createObjectStore(STORE_DOCS, { keyPath: 'doc' });
      }
      if (!db.objectStoreNames.contains(STORE_KV)) {
        db.createObjectStore(STORE_KV, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(storeName, mode) {
  return openDB().then((db) => db.transaction(storeName, mode).objectStore(storeName));
}

export async function kvGet(key, fallback = undefined) {
  const store = await tx(STORE_KV, 'readonly');
  return new Promise((resolve, reject) => {
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result ? req.result.value : fallback);
    req.onerror = () => reject(req.error);
  });
}

export async function kvSet(key, value) {
  const store = await tx(STORE_KV, 'readwrite');
  return new Promise((resolve, reject) => {
    const req = store.put({ key, value });
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function docsGetAll() {
  const store = await tx(STORE_DOCS, 'readonly');
  return new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function docPut(document) {
  const store = await tx(STORE_DOCS, 'readwrite');
  return new Promise((resolve, reject) => {
    const req = store.put(document);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function docGet(doc) {
  const store = await tx(STORE_DOCS, 'readonly');
  return new Promise((resolve, reject) => {
    const req = store.get(doc);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export async function docsClearAll() {
  const store = await tx(STORE_DOCS, 'readwrite');
  return new Promise((resolve, reject) => {
    const req = store.clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}
