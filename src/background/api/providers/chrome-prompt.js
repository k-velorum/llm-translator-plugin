import {
  translateBatchStructuredWithChromePromptRuntime,
  translateWithChromePromptRuntime
} from '../../chrome-prompt-client.js';

async function translate(text, settings, requestOptions = {}) {
  return translateWithChromePromptRuntime(text, settings, requestOptions);
}

async function translateBatchStructured(texts, settings, requestOptions = {}) {
  return translateBatchStructuredWithChromePromptRuntime(texts, settings, requestOptions);
}

export default {
  translate,
  translateBatchStructured
};
