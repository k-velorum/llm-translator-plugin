// 最大8MBの画像をBase64でstorage.sessionに入れると10MBの総容量を超えるため、画像だけをIndexedDBに分離する。
function imageStore(operation, key, value) {
  return new Promise((resolve, reject) => {
    const opening = indexedDB.open('llmt-conversation-images', 1);
    opening.onupgradeneeded = () => opening.result.createObjectStore('images');
    opening.onerror = () => reject(opening.error);
    opening.onsuccess = () => {
      const db = opening.result;
      const transaction = db.transaction('images', operation === 'get' ? 'readonly' : 'readwrite');
      const store = transaction.objectStore('images');
      const request = operation === 'put' ? store.put(value, key) : operation === 'clear' ? store.clear() : store[operation](key);
      transaction.oncomplete = () => { db.close(); resolve(request.result); };
      transaction.onabort = () => { db.close(); reject(transaction.error || request.error); };
    };
  });
}

export const saveConversationImage = (id, image) => imageStore('put', id, image);
export const deleteConversationImage = id => imageStore('delete', id);
export const clearConversationImages = () => imageStore('clear');
export async function loadConversationImage(id) {
  const image = await imageStore('get', id);
  if (!image) throw new Error('会話の元画像が見つかりません。画像を翻訳し直してください。');
  return image;
}
