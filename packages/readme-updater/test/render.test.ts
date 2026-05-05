import { describe, it, expect } from 'vitest';
import { renderLeaderboardBlock } from '../src/render.js';
import type { LeaderboardResponse } from '@openmuncher/shared';

const FIXTURE: LeaderboardResponse = {
  globalTokens: 1_847_392_108,
  globalCostUsd: 42_180.91,
  topUsers: [
    { nickname: 'brian', totalTokens: 12_847_213, totalCostUsd: 384.21, munchCount: 412 },
    { nickname: 'alice', totalTokens: 4_001_002, totalCostUsd: 100.0, munchCount: 50 },
    { nickname: 'bob', totalTokens: 1_234_567, totalCostUsd: 30.5, munchCount: 12 },
  ],
  generatedAt: '2026-05-05T14:00:00.000Z',
};

describe('renderLeaderboardBlock', () => {
  it('produces a stable snapshot for known input', () => {
    expect(renderLeaderboardBlock(FIXTURE)).toMatchInlineSnapshot(`
      "<!-- This block is auto-generated. Do not edit. -->

      | Rank | Wastrel | Tokens Burned | Money Incinerated | Munches |
      |------|---------|---------------|-------------------|---------|
      | 🥇 | brian | 12,847,213 | $384.21 | 412 |
      | 🥈 | alice | 4,001,002 | $100.00 | 50 |
      | 🥉 | bob | 1,234,567 | $30.50 | 12 |

      **Global counter:** 1,847,392,108 tokens · $42,180.91 incinerated.
      *Last updated: 2026-05-05T14:00:00.000Z*"
    `);
  });

  it('renders rank emojis for top 3', () => {
    const out = renderLeaderboardBlock(FIXTURE);
    expect(out).toContain('🥇');
    expect(out).toContain('🥈');
    expect(out).toContain('🥉');
  });

  it('renders thousands separators on numbers', () => {
    const out = renderLeaderboardBlock(FIXTURE);
    expect(out).toContain('12,847,213');
    expect(out).toContain('1,847,392,108');
    expect(out).toContain('$42,180.91');
  });

  it('handles an empty leaderboard', () => {
    const out = renderLeaderboardBlock({
      globalTokens: 0,
      globalCostUsd: 0,
      topUsers: [],
      generatedAt: '2026-05-05T14:00:00.000Z',
    });
    expect(out).toContain('No munches yet');
  });

  it('is deterministic — same input produces same output', () => {
    const a = renderLeaderboardBlock(FIXTURE);
    const b = renderLeaderboardBlock(FIXTURE);
    expect(a).toBe(b);
  });
});
