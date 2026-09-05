const STRUCTURED_RESPONSE_BUDGET_MULTIPLIER = 2.2;

export function estimateTranslatedLength(text) {
  const s = (typeof text === 'string' ? text : '').trim();
  if (!s.length) return 0;

  const len = s.length;
  const latin = (s.match(/[A-Za-z]/g) || []).length;
  const cjk = (s.match(/[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/g) || []).length;
  let ratio = 1.08;
  if (latin / len > 0.45) ratio = 1.18;
  else if (cjk / len > 0.45) ratio = 1.02;

  return Math.ceil((len * ratio) + 16);
}

export function splitTextByNaturalBoundaries(text, maxChars) {
  if (typeof text !== 'string' || text.length <= maxChars) return [text || ''];
  const out = [];
  const minPreferred = Math.max(1, Math.floor(maxChars * 0.6));

  const findBoundary = (src, start, end) => {
    const segment = src.slice(start, end);
    const patterns = [
      /[.!?。！？]+\s*/g,
      /\n{2,}/g,
      /[,，;；:：、]\s*/g,
      /\s+/g
    ];

    for (const re of patterns) {
      re.lastIndex = 0;
      let best = -1;
      let m;
      while ((m = re.exec(segment)) !== null) {
        const pos = m.index + m[0].length;
        if (pos > best) best = pos;
      }
      if (best >= minPreferred) return start + best;
    }
    return -1;
  };

  let i = 0;
  while (i < text.length) {
    const end = Math.min(text.length, i + maxChars);
    if (end >= text.length) {
      out.push(text.slice(i));
      break;
    }

    const boundary = findBoundary(text, i, end);
    if (boundary > i) {
      out.push(text.slice(i, boundary));
      i = boundary;
      continue;
    }

    out.push(text.slice(i, end));
    i = end;
  }

  return out.filter((s) => s.length > 0);
}

export function chunkByEstimatedOutputAndItems(items, maxChars, maxItems, sep, useStructuredOutput = false) {
  const chunks = [];
  let current = [];
  let currentInputLen = 0;
  let currentEstimatedOutputLen = 0;
  const sepLen = sep.length;
  const responseBudget = useStructuredOutput
    ? Math.max(2000, Math.floor(maxChars * STRUCTURED_RESPONSE_BUDGET_MULTIPLIER))
    : maxChars;
  const perItemOverhead = useStructuredOutput ? 32 : 0;
  // 構造化出力でも設定した項目数を守り、長い生成待ちを避ける。
  const effectiveMaxItems = maxItems;

  for (const s of items) {
    const sLen = s.length;
    const estimatedOut = estimateTranslatedLength(s) + perItemOverhead;
    const projectedInput = currentInputLen + (current.length ? sepLen : 0) + sLen;
    const projectedEstimatedOutput = currentEstimatedOutputLen + estimatedOut;
    const wouldExceedInput = current.length > 0 && projectedInput > maxChars;
    const wouldExceedOutput = current.length > 0 && projectedEstimatedOutput > responseBudget;
    const wouldExceedItems = current.length >= effectiveMaxItems;

    if (current.length > 0 && (wouldExceedInput || wouldExceedOutput || wouldExceedItems)) {
      chunks.push(current);
      current = [s];
      currentInputLen = sLen;
      currentEstimatedOutputLen = estimatedOut;
    } else {
      current.push(s);
      currentInputLen = projectedInput;
      currentEstimatedOutputLen = projectedEstimatedOutput;
    }
  }

  if (current.length) chunks.push(current);
  return chunks;
}
