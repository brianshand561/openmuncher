import { describe, it, expect } from 'vitest';
import { computeCost } from '@openmuncher/shared';
import { validateMunchEvent } from '../lambda/shared/validate.js';

function makeBody(overrides: Record<string, unknown> = {}) {
  const inputTokens = 5000;
  const outputTokensEst = 3510;
  const model = 'claude-haiku-4-5' as const;
  const costUsd = computeCost(inputTokens, outputTokensEst, model);
  return {
    v: 1,
    eventId: '11111111-2222-3333-4444-555555555555',
    nickname: 'brian',
    deviceId: '99999999-8888-7777-6666-555555555555',
    model,
    inputTokens,
    outputTokensEst,
    costUsd,
    ts: Math.floor(Date.now() / 1000),
    ...overrides,
  };
}

describe('validateMunchEvent', () => {
  it('accepts a valid event', () => {
    const r = validateMunchEvent(makeBody(), Date.now());
    expect(r.ok).toBe(true);
  });

  it('rejects wrong version', () => {
    const r = validateMunchEvent(makeBody({ v: 2 }), Date.now());
    expect(r.ok).toBe(false);
  });

  it('rejects unknown model', () => {
    const r = validateMunchEvent(makeBody({ model: 'made-up' }), Date.now());
    expect(r.ok).toBe(false);
  });

  it('rejects nickname with bad chars', () => {
    const r = validateMunchEvent(makeBody({ nickname: 'bad space!' }), Date.now());
    expect(r.ok).toBe(false);
  });

  it('rejects nickname too long', () => {
    const r = validateMunchEvent(makeBody({ nickname: 'a'.repeat(40) }), Date.now());
    expect(r.ok).toBe(false);
  });

  it('rejects inputTokens out of bounds', () => {
    expect(validateMunchEvent(makeBody({ inputTokens: 50 }), Date.now()).ok).toBe(false);
    expect(validateMunchEvent(makeBody({ inputTokens: 2_000_000 }), Date.now()).ok).toBe(false);
  });

  it('rejects mismatched costUsd', () => {
    const r = validateMunchEvent(makeBody({ costUsd: 999 }), Date.now());
    expect(r.ok).toBe(false);
  });

  it('rejects too-old timestamp', () => {
    const old = Math.floor(Date.now() / 1000) - 600;
    const r = validateMunchEvent(makeBody({ ts: old }), Date.now());
    expect(r.ok).toBe(false);
  });

  it('rejects future timestamp beyond skew', () => {
    const future = Math.floor(Date.now() / 1000) + 600;
    const r = validateMunchEvent(makeBody({ ts: future }), Date.now());
    expect(r.ok).toBe(false);
  });

  it('rejects non-uuid eventId', () => {
    const r = validateMunchEvent(makeBody({ eventId: 'not-a-uuid' }), Date.now());
    expect(r.ok).toBe(false);
  });
});
