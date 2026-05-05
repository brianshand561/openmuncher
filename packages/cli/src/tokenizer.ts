import { createRequire } from 'node:module';
import type { ModelId } from '@openmuncher/shared';

const require = createRequire(import.meta.url);

interface Options {
  /** Bypass real tokenizers and use char/4 estimator. Used in tests and for graceful fallback. */
  forceEstimator?: boolean;
}

/** Per-model GPT/o encoding. Anthropic models use their own tokenizer (no entry here). */
const GPT_ENCODING: Partial<Record<ModelId, 'cl100k_base' | 'o200k_base'>> = {
  'gpt-5': 'o200k_base',
  'gpt-4o': 'o200k_base',
  'o1': 'o200k_base',
};

function estimate(text: string): number {
  return Math.ceil(text.length / 4);
}

let claudeTokenizer: { countTokens: (s: string) => number } | undefined;
const gptEncodings = new Map<string, { encode: (s: string) => Uint32Array }>();

const warned = new Set<string>();
function warnOnce(key: string, err: unknown): void {
  if (warned.has(key)) return;
  warned.add(key);
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`[openmuncher] ${key} tokenizer unavailable, using estimator: ${msg}\n`);
}

function loadClaude() {
  if (claudeTokenizer) return claudeTokenizer;
  const mod = require('@anthropic-ai/tokenizer') as {
    countTokens: (s: string) => number;
  };
  claudeTokenizer = mod;
  return claudeTokenizer;
}

function loadGpt(encoding: 'cl100k_base' | 'o200k_base') {
  const cached = gptEncodings.get(encoding);
  if (cached) return cached;
  const mod = require('tiktoken') as { get_encoding: (n: string) => { encode: (s: string) => Uint32Array } };
  const enc = mod.get_encoding(encoding);
  gptEncodings.set(encoding, enc);
  return enc;
}

export function countTokens(text: string, model: ModelId, opts: Options = {}): number {
  if (text.length === 0) return 0;
  if (opts.forceEstimator) return estimate(text);
  if (model.startsWith('claude-')) {
    try {
      return loadClaude().countTokens(text);
    } catch (err) {
      warnOnce('claude', err);
      return estimate(text);
    }
  }
  const gptEnc = GPT_ENCODING[model];
  if (gptEnc) {
    try {
      return loadGpt(gptEnc).encode(text).length;
    } catch (err) {
      warnOnce('gpt', err);
      return estimate(text);
    }
  }
  return estimate(text);
}
