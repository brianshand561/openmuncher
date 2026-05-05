import { describe, it, expect } from 'vitest';
import { countTokens } from '../src/tokenizer.js';

describe('countTokens', () => {
  it('uses anthropic tokenizer for claude models', () => {
    const n = countTokens('hello world hello world', 'claude-opus-4-7');
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThan(20);
  });

  it('uses tiktoken for gpt-4o', () => {
    const n = countTokens('hello world hello world', 'gpt-4o');
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThan(20);
  });

  it('uses tiktoken for gpt-5', () => {
    const n = countTokens('hello world hello world', 'gpt-5');
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThan(20);
  });

  it('uses tiktoken for o1', () => {
    const n = countTokens('hello world hello world', 'o1');
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThan(20);
  });

  it('estimates char/4 when forceEstimator is set', () => {
    const text = 'x'.repeat(200);
    const n = countTokens(text, 'claude-opus-4-7', { forceEstimator: true });
    expect(n).toBe(50);
  });

  it('returns 0 for empty input', () => {
    expect(countTokens('', 'claude-opus-4-7')).toBe(0);
  });
});
