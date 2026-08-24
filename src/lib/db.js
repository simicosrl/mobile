// Minimal promise-based IndexedDB wrapper. No external dependency —
// this is the only persistence layer the app needs (documents can carry
// base64 signature/photo data, which outgrows localStorage's quota).
const DB_NAME = 'simico-warehouse';
const DB_VERSION = 2;
const STORE_DOCS = 'documents';
const STORE_KV = 'kv';

let dbPromise = null;

// The store's real primary key, so two countries' documents can never
// collide/overwrite each other — the doc number alone isn't safe: it's
// server-reserved and country-scoped when online, but the *offline
// fallback* format (see lib/format.js docNumber) is just "WH-IN-000001" /
// "WH-OUT-000001" with no country in it at all, so a country's first
// fallback-numbered document would otherwise silently overwrite another
// country's record of the same bare `doc` string.
function docId(document) {
  return `${document.country || 'unknown'}::${document.doc}`;
}

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (event) => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_KV)) {
        db.createObjectStore(STORE_KV, { keyPath: 'key' });
      }
      if (event.oldVersion < 2 && db.objectStoreNames.contains(STORE_DOCS)) {
        // Migrate the existing store (keyed by bare `doc`) to one keyed by
        // the country-namespaced `id` above — read everything out on the
        // old store before replacing it, within this same upgrade
        // transaction (mirrors this app's other one-shot migrations, e.g.
        // AppContext.jsx's historyWipeV1/docSeqResetV2, just at the
        // storage layer instead of a kv flag).
        const oldStore = req.transaction.objectStore(STORE_DOCS);
        const getAllReq = oldStore.getAll();
        getAllReq.onsuccess = () => {
          const existing = getAllReq.result || [];
          db.deleteObjectStore(STORE_DOCS);
          const newStore = db.createObjectStore(STORE_DOCS, { keyPath: 'id' });
          for (const document of existing) {
            newStore.put({ ...document, id: docId(document) });
          }
        };
      } else if (!db.objectStoreNames.contains(STORE_DOCS)) {
        db.createObjectStore(STORE_DOCS, { keyPath: 'id' });
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
    const req = store.put({ ...document, id: docId(document) });
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function docGet(country, doc) {
  const store = await tx(STORE_DOCS, 'readonly');
  return new Promise((resolve, reject) => {
    const req = store.get(docId({ country, doc }));
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
