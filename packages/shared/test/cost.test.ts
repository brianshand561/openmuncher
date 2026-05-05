import { describe, it, expect } from 'vitest';
import { computeCost } from '../src/cost.js';

describe('computeCost', () => {
  it('computes cost from a known model', () => {
    // claude-opus-4-7: $15/M input, $75/M output
    // 1,000,000 input + 1,000,000 output = $90 exact
    expect(computeCost(1_000_000, 1_000_000, 'claude-opus-4-7')).toBe(90);
  });

  it('weights input and output prices independently', () => {
    // claude-opus-4-7: $15/M input, $75/M output. Asymmetric so a swap is detectable.
    expect(computeCost(1_000_000, 0, 'claude-opus-4-7')).toBe(15);
    expect(computeCost(0, 1_000_000, 'claude-opus-4-7')).toBe(75);
  });

  it('rounds to 6 decimal places', () => {
    // 1 input token at $15/M = 0.000015. Output 0. Result: 0.000015 (exact at 6dp).
    expect(computeCost(1, 0, 'claude-opus-4-7')).toBe(0.000015);
  });

  it('handles zero tokens', () => {
    expect(computeCost(0, 0, 'claude-opus-4-7')).toBe(0);
  });

  it('throws for an unknown model', () => {
    // @ts-expect-error testing runtime guard
    expect(() => computeCost(100, 100, 'made-up-model')).toThrow();
  });
});
