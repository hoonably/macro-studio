let database;
function open() {
  return database ||= new Promise((resolve, reject) => {
    const request = indexedDB.open('macro-studio-scripts', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('state');
    request.onsuccess = () => { request.result.onversionchange = () => { request.result.close(); database = null; }; resolve(request.result); };
    request.onerror = () => { database = null; reject(request.error); };
  });
}
export async function readLocal(key) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const request = db.transaction('state').objectStore('state').get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function writeLocal(values, ...guard) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('state', 'readwrite'), store = transaction.objectStore('state');
    let stale = false;
    const save = () => { for (const [key, value] of Object.entries(values)) value === undefined ? store.delete(key) : store.put(value, key); };
    if (guard.length) {
      const request = store.get('resetEpoch');
      request.onsuccess = () => {
        if (request.result !== guard[0]) { stale = true; transaction.abort(); }
        else save();
      };
    } else save();
    transaction.oncomplete = () => resolve();
    transaction.onabort = transaction.onerror = () => reject(stale ? new Error('개인 설정이 초기화되었습니다. 이 화면을 새로고침한 뒤 폴더를 연결하세요.') : transaction.error || new Error('스크립트 저장에 실패했습니다.'));
  });
}
export async function resetLocal() {
  const db = await open();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('state', 'readwrite'), store = transaction.objectStore('state');
    store.clear();
    // Stale directory-picker results must not restore the deleted folder handle.
    store.put(crypto.randomUUID(), 'resetEpoch');
    transaction.oncomplete = () => resolve();
    transaction.onabort = transaction.onerror = () => reject(transaction.error || new Error('개인 스크립트 저장소를 지우지 못했습니다.'));
  });
}
