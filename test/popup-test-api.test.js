import { afterEach, describe, expect, it, vi } from 'vitest';
import { invalidateTestResult, testApi } from '../src/popup/test-api.js';

function element(value = '') {
  return { value, textContent: '', classList: { add: vi.fn(), remove: vi.fn() } };
}
function elements() {
  return { testTextArea: element('hello'), testButton: element(), testStatus: element(),
    testResult: element(), testErrorDetails: element(), testErrorBody: element() };
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('編集中の設定で動作確認', () => {
  it('確認中に設定を変更した場合は古い設定の成功を表示しない', async () => {
    let respond;
    vi.stubGlobal('chrome', { runtime: { sendMessage: (_message, cb) => { respond = cb; } } });
    const ui = elements();
    const running = testApi(ui, { apiProvider: 'cerebras', cerebrasApiKey: 'key', cerebrasModel: 'old' });
    invalidateTestResult(ui);
    respond({ result: 'old translation' });
    await running;
    expect(ui.testResult.classList.remove).not.toHaveBeenCalled();
    expect(ui.testStatus.textContent).not.toContain('接続できます');
    expect(ui.testButton.disabled).toBe(false);
  });

  it('保存済み設定を読み直さず、編集中のプロバイダー・モデル・指示を使う', async () => {
    const sendMessage = vi.fn((_message, cb) => cb({ result: 'こんにちは' }));
    vi.stubGlobal('chrome', { runtime: { sendMessage } });
    const ui = elements();
    await testApi(ui, { apiProvider: 'cerebras', cerebrasApiKey: 'draft-key',
      cerebrasModel: 'draft-model', translationSystemPrompt: '日本語に翻訳' });
    expect(sendMessage.mock.calls[0][0]).toMatchObject({ text: 'hello', settings: {
      apiProvider: 'cerebras', cerebrasModel: 'draft-model', cerebrasApiKey: 'draft-key', translationSystemPrompt: '日本語に翻訳'
    } });
    expect(ui.testResult.textContent).toBe('こんにちは');
    expect(ui.testButton.disabled).toBe(false);
  });

  it('エラーの詳細は訳文欄と分け、折りたたんで表示する', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('chrome', { runtime: { sendMessage: (_message, cb) => cb({ error: {
      status: 402, message: 'Insufficient credits', details: 'trace detail'
    } }) } });
    const ui = elements();
    await testApi(ui, { apiProvider: 'cerebras', cerebrasApiKey: 'key', cerebrasModel: 'model' });
    expect(ui.testStatus.textContent).toContain('請求設定');
    expect(ui.testErrorBody.textContent).toBe('trace detail');
    expect(ui.testErrorDetails.open).toBe(false);
    expect(ui.testResult.classList.remove).not.toHaveBeenCalled();
  });
});
