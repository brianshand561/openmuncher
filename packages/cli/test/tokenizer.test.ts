import { describe, it, expect } from 'vitest';
import { countTokens } from '../src/tokenizer.js';

describe('countTokens', () => {
  it('uses anthropic tokenizer for claude models', () => {
    const n = countTokens('hello world hello world', 'claude-opus-4-7');
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThan(20);
  });

  it('uses tiktoken for gpt models', () => {
    const n = countTokens('hello world hello world', 'gpt-4o');
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThan(20);
  });

  it('estimates char/4 when tokenizer fails to load (synthetic case)', () => {
    // 200-char input → 50-token estimate
    const text = 'x'.repeat(200);
    // Force the estimator path by passing a model id whose tokenizer we route to char/4.
    // We expose `countTokensWithEstimator` for this; alternative: make countTokens accept a `forceEstimator` flag.
    const n = countTokens(text, 'claude-opus-4-7', { forceEstimator: true });
    expect(n).toBe(50);
  });

  it('returns 0 for empty input', () => {
    expect(countTokens('', 'claude-opus-4-7')).toBe(0);
  });
});
