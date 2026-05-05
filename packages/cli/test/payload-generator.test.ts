import { describe, it, expect } from 'vitest';
import { generatePayload } from '../src/payload-generator.js';
import { countTokens } from '../src/tokenizer.js';

describe('generatePayload', () => {
  it('produces a payload within ±5% of the target', () => {
    const target = 5000;
    const { text } = generatePayload({
      targetInputTokens: target,
      model: 'claude-opus-4-7',
      seed: 'fixture-seed-1',
    });
    const actual = countTokens(text, 'claude-opus-4-7');
    expect(actual).toBeGreaterThanOrEqual(target * 0.95);
    expect(actual).toBeLessThanOrEqual(target * 1.05);
  });

  it('produces a header instructing verbose expansion', () => {
    const { text } = generatePayload({
      targetInputTokens: 2000,
      model: 'claude-opus-4-7',
      seed: 'fixture-seed-2',
    });
    expect(text.toLowerCase()).toContain('do not summarize');
    expect(text.toLowerCase()).toContain('expand');
  });

  it('reports the instructed minimum word count for output estimation', () => {
    const result = generatePayload({
      targetInputTokens: 2000,
      model: 'claude-opus-4-7',
      seed: 'fixture-seed-3',
    });
    expect(result.instructedMinWords).toBe(2000);
  });

  it('is deterministic for the same seed', () => {
    const a = generatePayload({ targetInputTokens: 3000, model: 'claude-opus-4-7', seed: 's1' });
    const b = generatePayload({ targetInputTokens: 3000, model: 'claude-opus-4-7', seed: 's1' });
    expect(a.text).toBe(b.text);
  });
});
