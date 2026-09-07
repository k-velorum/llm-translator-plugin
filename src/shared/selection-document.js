import { normalizeTranslationPolicy } from './translation-policy.js';

export function selectionDocumentSettings(settings) {
  return { ...settings, translationSystemPrompt: normalizeTranslationPolicy(settings.translationSystemPrompt) + '\n' +
    'Translate the following HTML fragment into Japanese, unless the translation policy above explicitly requests another language. Use the full context of its complete sentences. ' +
    'Preserve ALL tags and id attributes exactly. Translate each element\'s original text inside that SAME id; never swap meanings between IDs. ' +
    'You may reorder inline elements within the same parent for natural grammar, but preserve nesting and paragraph order. ' +
    'Return ONLY the translated fragment. Do not add attributes, elements, explanations, or code fences.' };
}

function escapeText(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function serializeSelectionDocument(paragraphs) {
  function serialize(children) {
    return children.map(item => {
      if (typeof item === 'string') return escapeText(item);
      const match = /^([a-z][a-z0-9-]*?)(\d+)$/.exec(item.id);
      if (!match) throw Error('Invalid element ID');
      const tag = match[1];
      return ['br', 'hr'].includes(tag) ? `<${tag} id="${item.id}"/>`
        : `<${tag} id="${item.id}">${serialize(item.children)}</${tag}>`;
    }).join('');
  }
  return paragraphs.map(paragraph => `<p id="p${paragraph.id}">${serialize(paragraph.children)}</p>`).join('\n');
}

function decodeText(text) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' };
  return text.replace(/&(amp|lt|gt|quot|apos|nbsp|#\d+|#x[0-9a-f]+);/gi, (original, entity) => {
    if (entity[0] !== '#') return named[entity.toLowerCase()];
    const code = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : original;
  });
}

// 小さなタグ文法だけを解析する。生成HTMLをDOMへ挿入したり、属性を適用したりしない。
export function parseSelectionDocument(text) {
  const source = text.trim().replace(/^```(?:html|xml)?\s*\n([\s\S]*?)\n```$/i, '$1');
  const paragraphs = [], stack = [];
  let offset = 0;
  for (const match of source.matchAll(/<[^>]*>|[^<]+/g)) {
    if (match.index !== offset) throw Error('Invalid fragment');
    offset += match[0].length;
    const token = match[0];
    if (!token.startsWith('<')) {
      if (stack.length) stack.at(-1).item.children.push(decodeText(token));
      else if (token.trim()) throw Error('Unexpected text outside paragraphs');
    } else parseTag(token, stack, paragraphs);
    if (stack.length > 50) throw Error('Too deeply nested');
  }
  if (offset !== source.length || stack.length || !paragraphs.length) throw Error('Incomplete fragment');
  return paragraphs;
}

function parseTag(token, stack, paragraphs) {
  const close = /^<\/([a-z][a-z0-9-]*)\s*>$/i.exec(token);
  if (close) {
    if (stack.pop()?.tag !== close[1].toLowerCase()) throw Error('Mismatched closing tag');
    return;
  }
  const open = /^<([a-z][a-z0-9-]*)\s+id=(?:"([a-z][a-z0-9-]*)"|'([a-z][a-z0-9-]*)')\s*(\/?)>$/i.exec(token);
  if (!open) throw Error('Unsupported tag or attribute');
  const tag = open[1].toLowerCase(), id = open[2] || open[3];
  if (!id.startsWith(tag) || !/^\d+$/.test(id.slice(tag.length))) throw Error('Invalid element ID');
  const item = { id: stack.length ? id : Number(id.slice(1)), children: [] };
  if (stack.length) stack.at(-1).item.children.push(item);
  else {
    if (tag !== 'p') throw Error('Expected paragraph');
    paragraphs.push(item);
  }
  if (!['br', 'hr'].includes(tag)) {
    if (open[4]) throw Error('Unexpected self-closing element');
    stack.push({ tag, item });
  }
}

export function selectionDocumentText(paragraphs) {
  function flatten(children, depth = 0) {
    if (!Array.isArray(children) || depth > 50) return '';
    return children.map(item => typeof item === 'string' ? item : flatten(item?.children, depth + 1)).join('');
  }
  return paragraphs.map(paragraph => flatten(paragraph.children)).join('\n\n');
}
