import { describe, it, expect } from 'vitest';
import { renderStats, type StatsInput } from '../src/stats-renderer.js';

const FIXTURE: StatsInput = {
  model: 'claude-opus-4-7',
  inputTokens: 17_432,
  inputCostUsd: 0.2615,
  outputTokensEst: 3_510,
  outputCostUsdEst: 0.2633,
  totalCostUsd: 0.5248,
  rating: { score: 7.2, label: 'Mildly Irresponsible' },
  conversions: { trees: 0.4, coffees: 1.3, gpuSeconds: 47, oceanMl: 0.02 },
  lifetimeTokens: 2_100_034,
  lifetimeCostUsd: 48.71,
  globalTokens: 893_421_044,
  globalCostUsd: 19_847.12,
};

describe('renderStats', () => {
  it('produces the expected fixed shape', () => {
    const out = renderStats(FIXTURE, { color: false });
    expect(out).toMatchInlineSnapshot(`
      "
      🪵 MUNCH COMPLETE 🪵
      Model:       claude-opus-4-7
      Input:         17,432 tokens   ($0.2615)
      Output:        ~3,510 tokens   ($0.2633 est.)
      Total cost:  ~$0.52
      Waste rating: 7.2/10 — "Mildly Irresponsible"

      Equivalent to:
        🌳 0.4 trees emotionally impacted
        ☕ 1.3 coffees incinerated
        ⚙️  47 seconds of GPU suffering
        🌊 0.02 mL of ocean evaporated

      Lifetime: 2,100,034 tokens · $48.71
      Global:   893,421,044 tokens · $19847.12
      "
    `);
  });

  it('marks output cost as (est.)', () => {
    const out = renderStats(FIXTURE, { color: false });
    expect(out).toMatch(/est\./);
  });

  it('includes the global counter', () => {
    const out = renderStats(FIXTURE, { color: false });
    expect(out).toContain('893,421,044');
  });

  it('shows "(offline)" when global is null', () => {
    const out = renderStats(
      { ...FIXTURE, globalTokens: null, globalCostUsd: null },
      { color: false },
    );
    expect(out).toContain('(offline)');
  });
});
