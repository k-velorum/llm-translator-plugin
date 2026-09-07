import { afterEach, describe, expect, it, vi } from 'vitest';
import { updateModelInfo } from '../src/popup/model-info.js';

function element() {
  return { textContent: '', children: [],
    get firstChild() { return this.children[0]; },
    appendChild(child) { this.children.push(child); },
    removeChild(child) { this.children.splice(this.children.indexOf(child), 1); }
  };
}
function setup() {
  const pricing = element();
  const info = element();
  vi.stubGlobal('document', { createElement: element,
    getElementById: id => ({ 'openai-model-pricing': pricing, 'openai-model-info': info })[id] });
  return { pricing, info };
}
afterEach(() => vi.unstubAllGlobals());

describe('モデルの料金表示', () => {
  it('単価を100万トークンあたりのドルに換算し、詳細情報と分けて表示する', () => {
    const { pricing, info } = setup();
    updateModelInfo('openai', { id: 'paid', context_length: 128000,
      pricing: { prompt: '0.00000015', completion: '0.0000006' } });
    expect(pricing.textContent).toBe('入力 $0.15 / 出力 $0.6（100万トークンあたり）');
    expect(info.children.map(child => child.textContent)).toEqual(['モデル: paid', 'コンテキスト長: 128000']);
  });
  it('明示的な0だけを0ドルとし、片側未取得を無料扱いしない', () => {
    const { pricing } = setup();
    updateModelInfo('openai', { id: 'free', pricing: { prompt: '0' } });
    expect(pricing.textContent).toBe('入力 $0（100万トークンあたり）');
  });
  it.each([undefined, {}, { prompt: '' }, { prompt: ' ' }, { prompt: null },
    { prompt: false }, { prompt: 'unknown' }, { prompt: '-1' }, { prompt: Infinity }])(
    '取得できない料金 %j に切り替わると古い料金を消す', value => {
      const { pricing } = setup();
      updateModelInfo('openai', { id: 'paid', pricing: { prompt: 0.001 } });
      updateModelInfo('openai', { id: 'manual', pricing: value });
      expect(pricing.textContent).toBe('');
    });
  it('選択解除時には料金と詳細の両方を消す', () => {
    const { pricing, info } = setup();
    updateModelInfo('openai', { id: 'paid', pricing: { prompt: 0.001 } });
    updateModelInfo('openai', undefined);
    expect(pricing.textContent).toBe('');
    expect(info.children).toEqual([]);
  });
  it('小さな正の単価を0ドルに丸めない', () => {
    const { pricing } = setup();
    updateModelInfo('openai', { id: 'cheap', pricing: { prompt: '0.000000000000001' } });
    expect(pricing.textContent).toContain('$0.000000001');
  });
});
