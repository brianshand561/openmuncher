import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { sendTelemetry } from '../src/telemetry.js';
import type { MunchEvent } from '@openmuncher/shared';

const SECRET = 'test-secret';
const URL = 'https://example.test/munch';

const EVENT: MunchEvent = {
  v: 1,
  eventId: '11111111-2222-3333-4444-555555555555',
  nickname: 'brian',
  deviceId: '99999999-8888-7777-6666-555555555555',
  model: 'claude-haiku-4-5',
  inputTokens: 5000,
  outputTokensEst: 3510,
  costUsd: 0.018,
  ts: 1746460800,
};

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('sendTelemetry', () => {
  it('POSTs the canonical JSON body with an HMAC signature header', async () => {
    let capturedBody: string | undefined;
    let capturedSig: string | undefined;
    const fakeFetch = vi.fn(async (_url: string, init: RequestInit) => {
      capturedBody = init.body as string;
      capturedSig = (init.headers as Record<string, string>)['x-om-sig'];
      return new Response(JSON.stringify({ ok: true, globalTokens: 100, globalCostUsd: 1.5 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    const r = await sendTelemetry(EVENT, { url: URL, secret: SECRET, fetchFn: fakeFetch });

    expect(fakeFetch).toHaveBeenCalledTimes(1);
    expect(capturedBody).toBeTruthy();
    const expectedSig = createHmac('sha256', SECRET).update(capturedBody!).digest('hex');
    expect(capturedSig).toBe(expectedSig);
    expect(r).not.toBeNull();
    expect(r!.globalTokens).toBe(100);
    expect(r!.globalCostUsd).toBe(1.5);
  });

  it('returns null when fetch throws on both attempts', async () => {
    const fakeFetch = vi.fn(async () => {
      throw new Error('network down');
    });
    const r = await sendTelemetry(EVENT, { url: URL, secret: SECRET, fetchFn: fakeFetch });
    expect(fakeFetch).toHaveBeenCalledTimes(2);
    expect(r).toBeNull();
  });

  it('retries once and succeeds the second time', async () => {
    let n = 0;
    const fakeFetch = vi.fn(async () => {
      n++;
      if (n === 1) throw new Error('first try fails');
      return new Response(JSON.stringify({ ok: true, globalTokens: 7, globalCostUsd: 0.07 }), {
        status: 200,
      });
    });
    const r = await sendTelemetry(EVENT, { url: URL, secret: SECRET, fetchFn: fakeFetch });
    expect(fakeFetch).toHaveBeenCalledTimes(2);
    expect(r).not.toBeNull();
    expect(r!.globalTokens).toBe(7);
  });

  it('returns null on non-2xx response', async () => {
    const fakeFetch = vi.fn(async () =>
      new Response(JSON.stringify({ ok: false, error: 'bad sig' }), { status: 401 }),
    );
    const r = await sendTelemetry(EVENT, { url: URL, secret: SECRET, fetchFn: fakeFetch });
    expect(fakeFetch).toHaveBeenCalledTimes(2);
    expect(r).toBeNull();
  });
});
