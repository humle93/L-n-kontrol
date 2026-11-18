// Simpel IndexedDB-lagring af lønsedler (kun tal – ingen PDF).
const DB = 'lonkontrol', STORE = 'slips';
let dbp;
function open() {
  dbp ||= new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
async function tx(mode, fn) {
  const d = await open();
  return new Promise((res, rej) => {
    const t = d.transaction(STORE, mode);
    const out = fn(t.objectStore(STORE));
    t.oncomplete = () => res(out?.result ?? out);
    t.onerror = () => rej(t.error);
  });
}
export const all = () => tx('readonly', (s) => s.getAll());
export const get = (id) => tx('readonly', (s) => s.get(id));
export const put = (v) => tx('readwrite', (s) => s.put(v));
export const remove = (id) => tx('readwrite', (s) => s.delete(id));
