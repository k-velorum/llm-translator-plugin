import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const source = readFileSync(new URL('../src/content/ui.js', import.meta.url), 'utf8');
function element(tagName = 'div') {
  return {
    tagName, style: {}, children: [], attributes: {}, listeners: {},
    set textContent(value) { this.text = value; this.children = []; },
    get textContent() { return this.text || ''; },
    append(...children) { this.children.push(...children); },
    setAttribute(key, value) { this.attributes[key] = value; },
    removeAttribute(key) { delete this.attributes[key]; },
    addEventListener(key, fn) { this.listeners[key] = fn; }
  };
}
function setup() {
  const window = { location: { reload: vi.fn() } };
  runInNewContext(source, { window, document: { createElement: element } });
  return { window, api: window.LLMT.ui, target: element() };
}

describe('翻訳の失敗表示', () => {
  it('接続切れは復旧案内と再読み込みボタンを表示し、勝手に再読み込みしない', () => {
    const { api, target, window } = setup();
    api.renderTranslationError(target, '翻訳エラー: 拡張との接続が切れました。このページを再読み込みしてから翻訳してください。');
    expect(target.children[0].textContent).toBe('翻訳できませんでした');
    expect(target.attributes.role).toBe('alert');
    const button = target.children.find((child) => child.tagName === 'button');
    expect(window.location.reload).not.toHaveBeenCalled();
    button.listeners.click({ preventDefault() {}, stopPropagation() {} });
    expect(window.location.reload).toHaveBeenCalledOnce();
  });

  it('APIエラー本文は折りたたみ、対処方法を通常表示する', () => {
    const { api, target } = setup();
    api.renderTranslationError(target, '翻訳エラー: API Error: Payment Required (402) - Insufficient credits\n残高・請求設定を確認してください。');
    expect(target.children[1].textContent).toBe('残高・請求設定を確認してください。');
    const details = target.children.find((child) => child.tagName === 'details');
    expect(details.attributes.open).toBeUndefined();
    expect(details.children[1].textContent).toContain('Insufficient credits');
    expect(target.children.some((child) => child.tagName === 'button')).toBe(false);
  });

  it('後続の成功表示ではエラーUIを消し、モデル出力をHTMLにしない', () => {
    const { api, target } = setup();
    api.renderTranslationError(target, '<img src=x onerror=alert(1)>');
    api.applyTranslationTextState(target, '<b>訳文</b>', false);
    expect(target.textContent).toBe('<b>訳文</b>');
    expect(target.children).toEqual([]);
    expect(target.attributes.role).toBeUndefined();
  });
});
