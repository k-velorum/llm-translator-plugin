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

function setup(texts = [' one ', 'two'], parents = []) {
  const body = element();
  const nodes = texts.map((nodeValue, i) => ({
    nodeValue, isConnected: true,
    parentElement: parents[i] || { closest: () => null, isContentEditable: false }
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

// テスト用の祖先チェーン。実際のCSSセレクタの動作はブラウザーでも確認する。
function semanticParent(tag, role = '', parent = null) {
  return {
    tag, role, parent, isContentEditable: false,
    closest(selector) {
      for (let ancestor = this; ancestor; ancestor = ancestor.parent) {
        const matched = selector.split(',').some((part) => {
          const token = part.trim();
          const roleMatch = token.match(/^\[role~="([^"]+)"\]$/);
          return roleMatch ? ancestor.role.split(/\s+/).includes(roleMatch[1]) : ancestor.tag === token;
        });
        if (matched) return ancestor;
      }
      return null;
    }
  };
}

describe('ページ翻訳の意味的な優先度', () => {
  it.each([['main', ''], ['article', ''], ['div', 'main'], ['div', 'article']])(
    '%s role=%sの子孫を通常領域より先にする', (tag, role) => {
      const { api } = setup(['normal', 'body'], [
        semanticParent('div'), semanticParent('span', '', semanticParent(tag, role))
      ]);
      expect(api.capturePageTextSnapshot().texts).toEqual(['body', 'normal']);
    }
  );

  it.each([['nav', ''], ['aside', ''], ['menu', ''],
    ...['navigation', 'complementary', 'menu', 'menubar', 'listbox', 'toolbar', 'search'].map(role => ['div', role])
  ])('本文内の%s role=%sも後回しにして対象に残す', (tag, role) => {
    const main = semanticParent('main');
    const { api } = setup(['helper', 'normal', 'body'], [
      semanticParent('span', '', semanticParent(tag, role, main)), semanticParent('div'), main
    ]);
    expect(api.capturePageTextSnapshot().texts).toEqual(['body', 'normal', 'helper']);
  });

  it('同順位のDOM順を保ち、補助領域内のarticleも後回しにする', () => {
    const { api } = setup(['nav-a', 'normal-a', 'main-a', 'nav-b', 'main-b', 'normal-b'], [
      semanticParent('nav'), semanticParent('header'), semanticParent('main'),
      semanticParent('article', '', semanticParent('aside')), semanticParent('article'), semanticParent('section')
    ]);
    expect(api.capturePageTextSnapshot().texts)
      .toEqual(['main-a', 'main-b', 'normal-a', 'normal-b', 'nav-a', 'nav-b']);
  });

  it('意味的な役割がない場合は順序を変えず、既存の除外も維持する', () => {
    const { api } = setup(['normal-a', '123', 'code', 'これは日本語です', 'normal-b'], [
      semanticParent('div'), semanticParent('main'), semanticParent('code', '', semanticParent('main')),
      semanticParent('nav'), semanticParent('section')
    ]);
    expect(api.capturePageTextSnapshot().texts).toEqual(['normal-a', 'normal-b']);
  });

  it('並べ替え後のチャンク・再試行・再実行で元ノードへの対応を保つ', () => {
    const main = semanticParent('main');
    const nav = semanticParent('nav');
    const { api, nodes } = setup([' nav ', 'normal', ' body ', 'menu'], [nav, semanticParent('div'), main,
      semanticParent('div', 'menu', main)]);
    const first = api.capturePageTextSnapshot();
    expect(first.texts).toEqual([' body ', 'normal', ' nav ', 'menu']);
    // 完了順序が逆でも、失敗項目のnullを挟んでも位置は動かない。
    api.applyPageTranslationChunk(first.snapshotId, 2, ['案内', 'メニュー']);
    api.applyPageTranslationChunk(first.snapshotId, 0, ['本文', null]);
    expect(nodes.map(node => node.nodeValue)).toEqual([' 案内 ', 'normal', ' 本文 ', 'メニュー']);
    api.applyPageTranslationChunk(first.snapshotId, 0, [null, '通常']);
    expect(nodes.map(node => node.nodeValue)).toEqual([' 案内 ', '通常', ' 本文 ', 'メニュー']);
    const next = api.capturePageTextSnapshot();
    expect(next.texts).toEqual(first.texts);
    expect(api.applyPageTranslationChunk(first.snapshotId, 0, ['stale']).ok).toBe(false);
    api.applyPageTranslationChunk(next.snapshotId, 0, ['本文再訳']);
    expect(nodes[2].nodeValue).toBe(' 本文再訳 ');
  });

  it('翻訳中に役割が変わってもsnapshotの対応を変えない', () => {
    const main = semanticParent('main');
    const normal = semanticParent('div');
    const { api, nodes } = setup(['normal', 'body'], [normal, main]);
    const first = api.capturePageTextSnapshot();
    normal.tag = 'main';
    main.tag = 'nav';
    api.applyPageTranslationChunk(first.snapshotId, 0, ['本文']);
    expect(nodes.map(node => node.nodeValue)).toEqual(['normal', '本文']);
    expect(api.capturePageTextSnapshot().texts).toEqual(['normal', 'body']);
  });
});

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
