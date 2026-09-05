import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const source = readFileSync(new URL('../src/content/page-translation.js', import.meta.url), 'utf8');

// DOMへの適用条件・世代管理を検証するための最小DOM。描画はブラウザでも別途確認する。
function element() {
  return {
    style: {}, dataset: {}, children: [], textContent: '',
    setAttribute() {},
    appendChild(child) { this.children.push(child); child.parentNode = this; },
    removeChild(child) { this.children = this.children.filter((c) => c !== child); child.parentNode = null; },
    querySelector(selector) {
      const id = selector.slice(1);
      for (const child of this.children) {
        if (child.id === id) return child;
        const found = child.querySelector?.(selector);
        if (found) return found;
      }
      return null;
    }
  };
}

function setup(texts = [' one ', 'two']) {
  const body = element();
  const nodes = texts.map((nodeValue) => ({
    nodeValue, isConnected: true,
    parentElement: { closest: () => null, isContentEditable: false }
  }));
  const window = {};
  const send = vi.fn(() => true);
  runInNewContext(source, {
    window, document: { body, createElement: element }, crypto: webcrypto,
    DOMUtils: { getTextNodes: () => nodes },
    styles: {}, applyStyles: () => {}, createLoadingSpinner: element,
    safeSendMessage: send, console, setTimeout, clearTimeout, setInterval, clearInterval
  });
  return { api: window.LLMT.pageTranslation, body, nodes, send };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('ページ翻訳の対象判定', () => {
  it.each([
    '123,456.78%', '２０２６／０９／０６', '… → ★ 😀', ' \n ',
    'これは日本語です。', 'カタカナ・メニュー', 'ﾒﾆｭｰ', 'ばなな', '𠮷野家です'
  ])('翻訳不要なテキストを送信対象から除外する: %s', (text) => {
    const { api } = setup([text]);
    expect(api.capturePageTextSnapshot().texts).toEqual([]);
  });

  it.each([
    '設定', '中文翻译', 'English', '日本語とEnglish', '日本語とＥｎｇｌｉｓｈ',
    'café', '한국어', 'مرحبا', 'Привет', '日本語と한국어'
  ])('他言語や判定できないテキストを対象に残す: %s', (text) => {
    const { api } = setup([text]);
    expect(api.capturePageTextSnapshot().texts).toEqual([text]);
  });

  it('除外項目を挟んでも反映位置と再実行時の原文を維持する', () => {
    const { api, nodes } = setup(['123', 'hello', 'こんにちは', 'world', '★']);
    const { texts, snapshotId } = api.capturePageTextSnapshot();
    expect(texts).toEqual(['hello', 'world']);
    expect(api.applyPageTranslationChunk(snapshotId, 1, ['せかい'])).toEqual({ ok: true });
    expect(api.applyPageTranslationChunk(snapshotId, 0, ['こんにちは'])).toEqual({ ok: true });
    expect(nodes.map((node) => node.nodeValue)).toEqual(['123', 'こんにちは', 'こんにちは', 'せかい', '★']);
    expect(api.capturePageTextSnapshot().texts).toEqual(['hello', 'world']);
    nodes[1].nodeValue = 'ページが更新されました';
    expect(api.capturePageTextSnapshot().texts).toEqual(['world']);
  });
});

describe('ページ翻訳のDOMと操作パネル', () => {
  it('原文の前後空白を保ち、再実行では元の文章を取り出す', () => {
    const { api, nodes } = setup();
    const { snapshotId } = api.capturePageTextSnapshot();
    expect(api.applyPageTranslationChunk(snapshotId, 0, ['一', null])).toEqual({ ok: true });
    expect(nodes.map((n) => n.nodeValue)).toEqual([' 一 ', 'two']);
    expect(api.capturePageTextSnapshot().texts).toEqual([' one ', 'two']);
  });

  it('変更・切断されたノードを書き換えず、反映失敗を返す', () => {
    const { api, nodes } = setup();
    const { snapshotId } = api.capturePageTextSnapshot();
    nodes[0].nodeValue = 'new article';
    nodes[1].isConnected = false;
    expect(api.applyPageTranslationChunk(snapshotId, 0, ['一', '二']).ok).toBe(false);
    expect(nodes.map((n) => n.nodeValue)).toEqual(['new article', 'two']);
  });

  it('古いsnapshotの訳文・パネル更新・閉じる通知を無視する', () => {
    const { api, nodes, body } = setup();
    const old = api.capturePageTextSnapshot();
    const latest = api.capturePageTextSnapshot();
    expect(latest.snapshotId).not.toBe(old.snapshotId);
    expect(api.applyPageTranslationChunk(old.snapshotId, 0, ['wrong']).ok).toBe(false);
    api.showPageTranslationControls({ snapshotId: old.snapshotId, status: 'completed' });
    api.hidePageTranslationControls(old.snapshotId);
    expect(body.querySelector('#llm-page-translation-controls')).not.toBeNull();
    expect(nodes[0].nodeValue).toBe(' one ');
  });

  it('停止は即座にパネルを閉じ、遅延結果でも復活させない', () => {
    const { api, body, send } = setup();
    const { snapshotId } = api.capturePageTextSnapshot();
    body.querySelector('#llm-page-translation-stop').onclick();
    expect(body.querySelector('#llm-page-translation-controls')).toBeNull();
    expect(send).toHaveBeenCalledWith({ action: 'cancelPageTranslation', snapshotId }, expect.any(Function));
    api.showPageTranslationControls({ snapshotId, status: 'running' });
    expect(body.querySelector('#llm-page-translation-controls')).toBeNull();
    expect(api.applyPageTranslationChunk(snapshotId, 0, ['late']).ok).toBe(false);
  });

  it('状態照会にも応答がない場合は中断表示にして再試行を出す', async () => {
    const { api, body } = setup();
    api.capturePageTextSnapshot();
    await vi.advanceTimersByTimeAsync(20000);
    expect(body.querySelector('#llm-page-translation-status').textContent).toBe('中断');
    expect(body.querySelector('#llm-page-translation-retry').style.display).toBe('inline-block');
  });

  it('partial通知後に古い照会がタイムアウトしても中断へ戻さない', async () => {
    const { api, body } = setup();
    const { snapshotId } = api.capturePageTextSnapshot();
    await vi.advanceTimersByTimeAsync(10000);
    api.showPageTranslationControls({ snapshotId, status: 'partial', failedItems: 1 });
    await vi.advanceTimersByTimeAsync(10000);
    expect(body.querySelector('#llm-page-translation-status').textContent).toBe('一部失敗');
  });

  it('worker停止後のチェックポイント応答を再試行可能な表示にする', async () => {
    const { api, body, send } = setup();
    const { snapshotId } = api.capturePageTextSnapshot();
    send.mockImplementation((message, callback) => {
      callback({ ok: true, snapshotId: message.snapshotId, status: 'partial', processedItems: 1, totalItems: 2 });
      return true;
    });
    await vi.advanceTimersByTimeAsync(10000);
    expect(send).toHaveBeenCalledWith({ action: 'getPageTranslationStatus', snapshotId }, expect.any(Function));
    expect(body.querySelector('#llm-page-translation-status').textContent).toBe('一部失敗');
    expect(body.querySelector('#llm-page-translation-progress').textContent).toContain('50%');
  });
});
