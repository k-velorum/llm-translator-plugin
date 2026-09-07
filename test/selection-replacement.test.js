import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { translateSelectionReplacement, cancelSelectionReplacement } from '../src/background/selection-replacement.js';
import { translateText } from '../src/background/api.js';
import { collectSettings, loadSettings } from '../src/popup/settings-form.js';
import { DEFAULT_SETTINGS } from '../src/background/settings.js';
import { translateAndNotify } from '../src/background/selection-translation.js';
import { parseSelectionDocument, serializeSelectionDocument, selectionDocumentText } from '../src/shared/selection-document.js';

vi.mock('../src/background/api.js', () => ({ translateText: vi.fn(), formatErrorDetails: error => error.message }));
const settings = { apiProvider: 'lmstudio', selectionTranslationMode: 'replace' };
const paragraphs = [{ id: 0, children: ['Learn ', {id:'a0',children:['culture']}, ' today.'] }];
const translated = [{ id: 0, children: ['今日、', {id:'a0',children:['文化']}, 'を学ぼう。'] }];
let send;
beforeEach(() => {
  vi.clearAllMocks();
  translateText.mockResolvedValue(serializeSelectionDocument(translated));
  send = vi.fn(async (_tab, message) => {
    if (message.action === 'prepareSelectionReplacement') return { requestId: 'selection', paragraphs };
    if (message.action === 'finishSelectionReplacement') return { ok: true };
  });
  vi.stubGlobal('chrome', { tabs: { sendMessage: send } });
});
afterEach(() => vi.unstubAllGlobals());

describe('contextual selection translation', () => {
  it('routes the saved mode and sends the entire selection with HTML identities in one request', async () => {
    globalThis.chrome.storage = { sync: { get: (defaults, callback) => callback({ ...defaults, ...settings }) } };
    await translateAndNotify(1, 'Learn culture today.', 7, 'contextmenu');
    expect(translateText).toHaveBeenCalledTimes(1);
    expect(translateText.mock.calls[0][0]).toBe(serializeSelectionDocument(paragraphs));
    expect(translateText.mock.calls[0][1].translationSystemPrompt).toContain('full context');
    expect(send).toHaveBeenLastCalledWith(1, {
      action:'finishSelectionReplacement',requestId:'selection',translations:translated,error:''
    }, {frameId:7});
  });
  it('translates unsupported selections as plain text in the popup', async () => {
    send.mockResolvedValueOnce({reason:'unsupported'});
    translateText.mockResolvedValue('訳');
    await translateSelectionReplacement(1, 'Whole selection', 0, settings);
    expect(translateText.mock.calls[0][0]).toBe('Whole selection');
    expect(translateText.mock.calls[0][1]).toBe(settings);
    expect(send.mock.calls.at(-1)[1]).toMatchObject({translatedText:'訳',notice:'unsupported'});
  });
  it('reports invalid model output without applying text to the page', async () => {
    translateText.mockResolvedValue('not JSON');
    send.mockImplementation(async (_tab, message) => message.action === 'prepareSelectionReplacement'
      ? {requestId:'selection',paragraphs} : {reason:message.error});
    await translateSelectionReplacement(1, 'Text', 0, settings);
    expect(send.mock.calls.find(call => call[1].action === 'finishSelectionReplacement')[1].error).toBeTruthy();
    expect(send.mock.calls.at(-1)[1].action).toBe('showTranslation');
  });
  it('shows plain translated text when DOM mapping validation fails', async () => {
    send.mockResolvedValueOnce({requestId:'selection',paragraphs}).mockResolvedValueOnce({reason:'page changed'});
    await translateSelectionReplacement(1, 'Text', 0, settings);
    expect(send.mock.calls.at(-1)[1]).toMatchObject({translatedText:'今日、文化を学ぼう。',notice:'page changed'});
  });
  it('ignores superseded results', async () => {
    send.mockResolvedValueOnce({requestId:'selection',paragraphs}).mockResolvedValueOnce({ignored:true});
    await translateSelectionReplacement(1, 'Text', 0, settings);
    expect(send).toHaveBeenCalledTimes(2);
  });
  it('cancels and does not apply delayed output', async () => {
    let release;
    translateText.mockImplementation(() => new Promise(resolve => { release = resolve; }));
    const running = translateSelectionReplacement(1, 'Text', 0, settings);
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    expect(cancelSelectionReplacement('selection')).toBe(true);
    release(serializeSelectionDocument(translated));
    await running;
    expect(send).toHaveBeenCalledTimes(1);
    expect(translateText.mock.calls[0][2].signal.aborted).toBe(true);
  });
  it('uses the existing path if content is unavailable', async () => {
    send.mockRejectedValue(Error('no receiver'));
    expect(await translateSelectionReplacement(1, 'Text', 0, settings)).toBe(false);
    expect(translateText).not.toHaveBeenCalled();
  });
  it('accepts fenced fragments without rendering markup as HTML', () => {
    const parsed = parseSelectionDocument('```html\n'+serializeSelectionDocument(translated)+'\n```');
    expect(selectionDocumentText(parsed)).toBe('今日、文化を学ぼう。');
  });
});

describe('selection display setting', () => {
  it.each([undefined, 'popup', 'replace', 'unknown'])('restores and saves mode %s', async mode => {
    const elements = { apiProviderSelect: {}, selectionTranslationModeSelect: {} };
    vi.stubGlobal('chrome', { runtime: {}, storage: { sync: { get: (_keys, cb) => cb({ selectionTranslationMode: mode }) } } });
    await loadSettings(elements);
    const expected = mode === 'replace' ? 'replace' : 'popup';
    expect(elements.selectionTranslationModeSelect.value).toBe(expected);
    expect(collectSettings(elements).selectionTranslationMode).toBe(expected);
    expect(DEFAULT_SETTINGS.selectionTranslationMode).toBe('popup');
  });
});

describe('selection fragment wire format', () => {
  it('round-trips nested elements, literal markup and ampersands', () => {
    const value = [{id:0,children:['<literal> & ',{id:'strong0',children:['bold ',{id:'a1',children:['link']}]},{id:'br2',children:[]}]}];
    expect(parseSelectionDocument(serializeSelectionDocument(value))).toEqual(value);
  });
  it.each([
    '<p id="p0"><a id="a0">missing close</p>',
    '<p id="p0"><a id="a0" href="javascript:bad()">link</a></p>',
    '<p id="p0"><script>alert(1)</script></p>',
    '<p id="p0">text</p>unexpected',
    '<p id="p0">text</p><',
    '<p id="p0"><a id="span0">wrong tag</a></p>'
  ])('rejects malformed or expanded markup: %s', value => {
    expect(() => parseSelectionDocument(value)).toThrow();
  });
  it('decodes escaped text once without treating it as elements', () => {
    const value = parseSelectionDocument('<p id="p0">&lt;script&gt; &amp;lt; &#x65e5;</p>');
    expect(value[0].children).toEqual(['<script> &lt; 日']);
  });
});
