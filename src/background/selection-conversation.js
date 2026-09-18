import { saveConversationImage, deleteConversationImage } from './conversation-images.js';
const keyFor = (tabId, frameId) => `selectionConversation:${tabId}:${frameId}`;

// service worker の休止後も継続できるよう、各フレームの最新会話だけをセッションに保持する。
// 接続設定（認証情報を含む）は content script へ渡さない。
export async function createSelectionConversation(tabId, frameId, text, settings, imageInput) {
  const key = keyFor(tabId, frameId);
  const previous = (await chrome.storage.session.get(key))[key];
  const conversation = { id: crypto.randomUUID(), settings, messages: [{ role: 'user', content: text }], kind: imageInput ? 'image' : 'selection' };
  if (imageInput) await saveConversationImage(conversation.id, imageInput);
  try { await chrome.storage.session.set({ [key]: conversation }); }
  catch (error) {
    if (imageInput) await deleteConversationImage(conversation.id);
    throw error;
  }
  if (previous?.kind === 'image') await deleteConversationImage(previous.id);
  return conversation;
}

export async function loadSelectionConversation(tabId, frameId, id) {
  const key = keyFor(tabId, frameId);
  const conversation = (await chrome.storage.session.get(key))[key];
  if (!id || conversation?.id !== id) throw new Error('会話が終了しています。対象を翻訳し直してください。');
  return conversation;
}

export async function saveSelectionAnswer(tabId, frameId, conversation, answer, instruction) {
  if (typeof answer !== 'string' || !answer.trim()) throw new Error('回答が空でした。もう一度お試しください。');
  const current = await loadSelectionConversation(tabId, frameId, conversation.id);
  const messages = [...conversation.messages];
  if (instruction) messages.push({ role: 'user', content: instruction });
  messages.push({ role: 'assistant', content: answer });
  await chrome.storage.session.set({ [keyFor(tabId, frameId)]: { ...current, messages } });
}

export function buildConversationRequest(conversation, instruction) {
  if (typeof instruction !== 'string' || !instruction.trim()) throw new Error('追加の指示を入力してください。');
  return {
    input: instruction,
    messages: [...conversation.messages, { role: 'user', content: instruction }],
    settings: conversation.settings
  };
}

export async function discardSelectionConversation(tabId, frameId, id) {
  const key = keyFor(tabId, frameId);
  const conversation = (await chrome.storage.session.get(key))[key];
  if (conversation?.id === id) {
    await chrome.storage.session.remove(key);
    if (conversation.kind === 'image') await deleteConversationImage(id);
  }
}

export async function discardSelectionConversationsForTab(tabId) {
  const stored = await chrome.storage.session.get(null);
  const keys = Object.keys(stored).filter(key => key.startsWith(`selectionConversation:${tabId}:`));
  if (keys.length) {
    await chrome.storage.session.remove(keys);
    await Promise.all(keys.filter(key => stored[key].kind === 'image').map(key => deleteConversationImage(stored[key].id)));
  }
}
