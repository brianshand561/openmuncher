import { createRequire } from 'node:module';
import type { ModelId } from '@openmuncher/shared';

const require = createRequire(import.meta.url);

interface Options {
  /** Bypass real tokenizers and use char/4 estimator. Used in tests and for graceful fallback. */
  forceEstimator?: boolean;
}

function estimate(text: string): number {
  return Math.ceil(text.length / 4);
}

let claudeTokenizer: { countTokens: (s: string) => number } | undefined;
let gptEncoding: { encode: (s: string) => Uint32Array } | undefined;

function loadClaude() {
  if (claudeTokenizer) return claudeTokenizer;
  const mod = require('@anthropic-ai/tokenizer') as {
    countTokens: (s: string) => number;
  };
  claudeTokenizer = mod;
  return claudeTokenizer;
}

function loadGpt() {
  if (gptEncoding) return gptEncoding;
  const mod = require('tiktoken') as { get_encoding: (n: string) => { encode: (s: string) => Uint32Array } };
  gptEncoding = mod.get_encoding('cl100k_base');
  return gptEncoding;
}

export function countTokens(text: string, model: ModelId, opts: Options = {}): number {
  if (text.length === 0) return 0;
  if (opts.forceEstimator) return estimate(text);
  try {
    if (model.startsWith('claude-')) return loadClaude().countTokens(text);
    if (model.startsWith('gpt-') || model.startsWith('o')) {
      return loadGpt().encode(text).length;
    }
  } catch {
    // Native binding miss, etc. — fall through.
  }
  return estimate(text);
}
