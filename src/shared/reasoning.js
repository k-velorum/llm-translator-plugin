const DEFAULT_OPTIONS = [['default', 'モデルの既定'], ['off', 'OFF'], ['on', 'ON']];
const EFFORT_OPTIONS = [['low', '低'], ['medium', '中'], ['high', '高']];

// APIごとの受け付け値に合わせる。モデル個別の対応範囲は提供元に依存する。
export const REASONING_OPTIONS = {
  custom: [['default', 'モデルの既定'], ['off', 'OFF'], ...EFFORT_OPTIONS],
  openrouter: [...DEFAULT_OPTIONS, ['minimal', '最小'], ...EFFORT_OPTIONS, ['xhigh', '最高']],
  cerebras: [...DEFAULT_OPTIONS, ...EFFORT_OPTIONS],
  zai: DEFAULT_OPTIONS,
  lmstudio: [...DEFAULT_OPTIONS, ...EFFORT_OPTIONS]
};

export function normalizeReasoning(provider, value) {
  return REASONING_OPTIONS[provider]?.some(([option]) => option === value) ? value : 'default';
}

export function getReasoningRequestOptions(provider, value) {
  const selected = normalizeReasoning(provider, value);
  if (selected === 'default') return {};

  if (provider === 'openrouter') {
    if (selected === 'off') return { reasoning: { enabled: false } };
    if (selected === 'on') return { reasoning: { enabled: true } };
    return { reasoning: { effort: selected } };
  }
  if (provider === 'zai') {
    return { thinking: { type: selected === 'off' ? 'disabled' : 'enabled' } };
  }
  const effort = { off: 'none', on: 'medium' }[selected] || selected;
  return { reasoning_effort: effort };
}
