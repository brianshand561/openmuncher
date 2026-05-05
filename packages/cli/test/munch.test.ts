import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runMunch } from '../src/munch.js';

function fakeFetch(globalTokens = 999_999, globalCostUsd = 12.34): typeof fetch {
  return (async () =>
    new Response(JSON.stringify({ ok: true, globalTokens, globalCostUsd }), { status: 200 })) as typeof fetch;
}

function failingFetch(): typeof fetch {
  return (async () => { throw new Error('offline'); }) as typeof fetch;
}

describe('runMunch', () => {
  it('returns a fully populated result and includes server global counter', async () => {
    const home = mkdtempSync(join(tmpdir(), 'om-'));
    const result = await runMunch({
      home,
      env: { CLAUDE_CODE_MODEL: 'claude-haiku-4-5' },
      argv: { tokens: 3000, model: undefined, intensity: undefined, animation: false },
      askNickname: vi.fn().mockResolvedValue('brian'),
      seed: 'unit-test',
      telemetryUrl: 'https://example.test/munch',
      fetchFn: fakeFetch(),
    });
    expect(result.model).toBe('claude-haiku-4-5');
    expect(result.inputTokens).toBeGreaterThan(2700);
    expect(result.inputTokens).toBeLessThan(3300);
    expect(result.payloadText.toLowerCase()).toContain('do not summarize');
    expect(result.config.nickname).toBe('brian');
    expect(result.globalTokens).toBe(999_999);
    expect(result.globalCostUsd).toBe(12.34);
    expect(result.config.lastGlobalTokens).toBe(999_999);
  });

  it('reuses an existing config without prompting', async () => {
    const home = mkdtempSync(join(tmpdir(), 'om-'));
    const fs = await import('node:fs');
    fs.mkdirSync(join(home, '.openmuncher'), { recursive: true });
    fs.writeFileSync(
      join(home, '.openmuncher', 'config.json'),
      JSON.stringify({
        nickname: 'existing',
        deviceId: '11111111-1111-1111-1111-111111111111',
        lifetimeTokens: 0,
        lifetimeCostUsd: 0,
        lastGlobalTokens: 555,
        lastGlobalCostUsd: 5.55,
      }),
    );
    const ask = vi.fn();
    const result = await runMunch({
      home,
      env: {},
      argv: { tokens: 2000, model: undefined, intensity: undefined, animation: false },
      askNickname: ask,
      seed: 'unit-test-2',
      telemetryUrl: 'https://example.test/munch',
      fetchFn: fakeFetch(2_000_000, 50),
    });
    expect(ask).not.toHaveBeenCalled();
    expect(result.config.nickname).toBe('existing');
    expect(result.globalTokens).toBe(2_000_000);
  });

  it('falls back to last cached global on telemetry failure', async () => {
    const home = mkdtempSync(join(tmpdir(), 'om-'));
    const fs = await import('node:fs');
    fs.mkdirSync(join(home, '.openmuncher'), { recursive: true });
    fs.writeFileSync(
      join(home, '.openmuncher', 'config.json'),
      JSON.stringify({
        nickname: 'cached-user',
        deviceId: '11111111-1111-1111-1111-111111111111',
        lifetimeTokens: 0,
        lifetimeCostUsd: 0,
        lastGlobalTokens: 1234,
        lastGlobalCostUsd: 9.99,
      }),
    );
    const result = await runMunch({
      home,
      env: {},
      argv: { tokens: 2000, model: undefined, intensity: undefined, animation: false },
      askNickname: vi.fn(),
      seed: 'offline-test',
      telemetryUrl: 'https://example.test/munch',
      fetchFn: failingFetch(),
    });
    expect(result.globalTokens).toBe(1234);
    expect(result.globalCostUsd).toBe(9.99);
  });

  it('updates lifetime totals after a run', async () => {
    const home = mkdtempSync(join(tmpdir(), 'om-'));
    const result = await runMunch({
      home,
      env: {},
      argv: { tokens: 2000, model: undefined, intensity: undefined, animation: false },
      askNickname: vi.fn().mockResolvedValue('brian'),
      seed: 'unit-test-3',
      telemetryUrl: 'https://example.test/munch',
      fetchFn: fakeFetch(),
    });
    expect(result.config.lifetimeTokens).toBe(result.inputTokens + result.outputTokensEst);
    expect(result.config.lifetimeCostUsd).toBeCloseTo(result.totalCostUsd, 6);
  });
});
