import {
  callChromePromptRuntime,
  translateBatchStructuredWithChromePromptRuntime,
  translateWithChromePromptRuntime
} from '../../chrome-prompt-client.js';

async function translate(text, settings, requestOptions = {}) {
  return translateWithChromePromptRuntime(text, settings, requestOptions);
}

async function translateBatchStructured(texts, settings, requestOptions = {}) {
  return translateBatchStructuredWithChromePromptRuntime(texts, settings, requestOptions);
}

function stream(action, payload, settings, handlers, requestOptions) {
  return callChromePromptRuntime(action, { ...payload, settings }, {
    ...requestOptions, onDelta: handlers?.onDelta, onStatus: handlers?.onStatus || requestOptions?.onStatus
  });
}

export default {
  translate,
  translateStream: (text, settings, handlers, options) => stream('translateStream', { text, messages: options?.messages }, settings, handlers, options),
  translateImageStream: (imageInput, settings, handlers, options) => stream('translateImageStream', { imageInput, messages: options?.messages }, settings, handlers, options),
  translateBatchStructuredStream: (texts, settings, handlers, options) => stream('translateBatchStructuredStream', { texts }, settings, handlers, options),
  translateImage: (imageInput, settings, requestOptions = {}) =>
    callChromePromptRuntime('translateImage', { imageInput, settings, messages: requestOptions.messages }, requestOptions),
  translateBatchStructured
};
