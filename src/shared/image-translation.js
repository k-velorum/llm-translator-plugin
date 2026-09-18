export const IMAGE_TRANSLATION_PROMPT = 'この画像に含まれるテキストを読み取り、日本語に翻訳してください。翻訳結果のみを出力してください。テキストが見当たらない場合は「翻訳対象のテキストが見つかりませんでした。」とだけ出力してください。';

// 画像は最初のユーザー入力だけに添付し、後続の追加指示はそのまま維持する。
export function imageConversationMessages(messages, imageContent) {
  const history = messages || [{ role: 'user', content: IMAGE_TRANSLATION_PROMPT }];
  return history.map((message, index) => index === 0
    ? { ...message, content: imageContent(message.content) }
    : message);
}
