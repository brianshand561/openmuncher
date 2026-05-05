import { describe, it, expect } from 'vitest';
import { tokensToConversions, wasteRating } from '../src/conversions.js';

describe('tokensToConversions', () => {
  it('returns the expected fields for a fixed input', () => {
    const r = tokensToConversions(50_000, 1.5);
    expect(r.trees).toBeGreaterThan(0);
    expect(r.coffees).toBeGreaterThan(0);
    expect(r.gpuSeconds).toBeGreaterThan(0);
    expect(r.oceanMl).toBeGreaterThan(0);
  });

  it('scales linearly with tokens', () => {
    const a = tokensToConversions(10_000, 0.1);
    const b = tokensToConversions(20_000, 0.2);
    expect(b.gpuSeconds).toBeCloseTo(a.gpuSeconds * 2, 5);
  });
});

describe('wasteRating', () => {
  it('rates near-zero burns low', () => {
    const { score, label } = wasteRating(0.001);
    expect(score).toBeLessThan(2);
    expect(label).toMatch(/.+/);
  });

  it('rates large burns high', () => {
    const { score, label } = wasteRating(50);
    expect(score).toBeGreaterThan(8);
    expect(label).toMatch(/.+/);
  });

  it('clamps at 10', () => {
    const { score } = wasteRating(10_000);
    expect(score).toBe(10);
  });
});
