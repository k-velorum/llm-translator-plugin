const keyFor = (tabId, frameId) => `selectionConversation:${tabId}:${frameId}`;

// service worker の休止後も継続できるよう、各フレームの最新会話だけをセッションに保持する。
// 接続設定（認証情報を含む）は content script へ渡さない。
export async function createSelectionConversation(tabId, frameId, text, settings) {
  const conversation = { id: crypto.randomUUID(), settings, messages: [{ role: 'user', content: text }] };
  await chrome.storage.session.set({ [keyFor(tabId, frameId)]: conversation });
  return conversation;
}

export async function loadSelectionConversation(tabId, frameId, id) {
  const key = keyFor(tabId, frameId);
  const conversation = (await chrome.storage.session.get(key))[key];
  if (!id || conversation?.id !== id) throw new Error('会話が終了しています。文章を選択して翻訳し直してください。');
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
  if (conversation?.id === id) await chrome.storage.session.remove(key);
}

export async function discardSelectionConversationsForTab(tabId) {
  const stored = await chrome.storage.session.get(null);
  const keys = Object.keys(stored).filter(key => key.startsWith(`selectionConversation:${tabId}:`));
  if (keys.length) await chrome.storage.session.remove(keys);
}
