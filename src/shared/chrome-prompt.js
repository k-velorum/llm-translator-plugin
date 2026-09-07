export const NANO_LOAD_TIMEOUT_MS = 180000;
export const NANO_DOWNLOAD_TIMEOUT_MS = 20 * 60 * 1000;

export function nanoInputOptions(kind = 'text') {
  return {
    expectedInputs: [{ type: 'text', languages: ['en', 'ja'] }, ...(kind === 'image' ? [{ type: 'image' }] : [])],
    expectedOutputs: [{ type: 'text', languages: ['ja'] }]
  };
}

export async function nanoAvailability(kind = 'text') {
  if (!globalThis.LanguageModel) return 'unsupported';
  return LanguageModel.availability(nanoInputOptions(kind));
}

export function nanoError(name, message) {
  return Object.assign(new Error(message), { name });
}

export function assertNanoReady(availability, kind) {
  if (availability === 'downloadable' || availability === 'downloading') {
    throw nanoError('NanoPreparationRequired', 'Gemini Nano の初回準備が必要です。拡張の設定 → Chrome Gemini Nano →「モデルを準備」を開いてください。');
  }
  if (availability !== 'available') {
    throw nanoError('NanoUnavailable', `この Chrome の Gemini Nano は${kind === 'image' ? '画像入力' : 'テキスト入力'}を利用できません。Chrome と内蔵モデルの対応状況を確認してください。`);
  }
}

export function waitWithSignal(promise, signal) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason || new DOMException('中止しました', 'AbortError'));
    signal?.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal?.removeEventListener('abort', abort));
  });
}

// 最初のロードを共有する。生成セッションはリクエストごとに作り、会話を混在させない。
const pendingLoads = new Map();
export async function createReadyNanoSession(options, kind = 'text') {
  while (pendingLoads.has(kind)) {
    await waitWithSignal(pendingLoads.get(kind).catch(() => {}), options.signal);
  }
  options.signal?.throwIfAborted();
  const loading = (async () => {
    assertNanoReady(await nanoAvailability(kind), kind);
    options.signal?.throwIfAborted();
    const session = await LanguageModel.create({ ...options, ...nanoInputOptions(kind) });
    if (options.signal?.aborted) { session.destroy(); options.signal.throwIfAborted(); }
    return session;
  })();
  const ready = waitWithSignal(loading, options.signal);
  pendingLoads.set(kind, ready);
  try {
    return await ready;
  } catch (error) {
    if (options.signal?.aborted || error.name?.startsWith('Nano')) throw error;
    throw nanoError('NanoLoadError', `Gemini Nano のモデルを読み込めませんでした: ${error.message}`);
  } finally {
    if (pendingLoads.get(kind) === ready) pendingLoads.delete(kind);
  }
}
