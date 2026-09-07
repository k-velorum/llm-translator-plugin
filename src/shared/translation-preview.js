// プレビュー専用。途中の構造化出力を本文へ反映するためには使用しない。
export function structuredBatchPreview(source) {
  const texts = [];
  for (const match of source.matchAll(/\[\s*\d+\s*,\s*"((?:[^"\\]|\\[\s\S])*)/g)) {
    // 分割されたエスケープシーケンスは、次の差分が届くまで表示しない。
    const prefix = match[1].replace(/\\u[\da-f]{0,3}$/i, '').replace(/\\$/, '');
    try { texts.push(JSON.parse(`"${prefix}"`)); } catch (_) {}
  }
  return texts.join('\n\n');
}

// UIへ送る頻度と量を制限する。生成の再試行時は空文字で前のプレビューを消す。
export function createPreviewReporter(send, signal) {
  let lastSentAt = -Infinity;
  return async (text, { status = false } = {}) => {
    if (!send || signal?.aborted) return;
    const now = Date.now();
    if (!status && text && now - lastSentAt < 100) return;
    lastSentAt = status ? -Infinity : now;
    await send(text.slice(-1200));
  };
}
