import { KNOWN_MODELS, computeCost, type MunchEvent, type ModelId } from '@openmuncher/shared';

export type ValidateResult =
  | { ok: true; event: MunchEvent }
  | { ok: false; error: string };

const NICKNAME_RE = /^[a-zA-Z0-9._-]{1,39}$/;
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const TS_SKEW_SECONDS = 5 * 60;

const INPUT_MIN = 100;
const INPUT_MAX = 1_000_000;
const OUTPUT_MIN = 0;
const OUTPUT_MAX = 2_000_000;
const COST_MIN = 0;
const COST_MAX = 1000;

function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null;
}

function isInt(n: unknown, min: number, max: number): boolean {
  return typeof n === 'number' && Number.isFinite(n) && Number.isInteger(n) && n >= min && n <= max;
}

function isFiniteNum(n: unknown, min: number, max: number): boolean {
  return typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max;
}

export function validateMunchEvent(body: unknown, serverNowMs: number): ValidateResult {
  if (!isObj(body)) return { ok: false, error: 'body not an object' };

  if (body.v !== 1) return { ok: false, error: 'unsupported version' };
  if (typeof body.eventId !== 'string' || !UUID_RE.test(body.eventId)) return { ok: false, error: 'invalid eventId' };
  if (typeof body.nickname !== 'string' || !NICKNAME_RE.test(body.nickname)) return { ok: false, error: 'invalid nickname' };
  if (typeof body.deviceId !== 'string' || !UUID_RE.test(body.deviceId)) return { ok: false, error: 'invalid deviceId' };
  if (typeof body.model !== 'string' || !(KNOWN_MODELS as readonly string[]).includes(body.model)) {
    return { ok: false, error: 'invalid model' };
  }
  if (!isInt(body.inputTokens, INPUT_MIN, INPUT_MAX)) return { ok: false, error: 'inputTokens out of range' };
  if (!isInt(body.outputTokensEst, OUTPUT_MIN, OUTPUT_MAX)) return { ok: false, error: 'outputTokensEst out of range' };
  if (!isFiniteNum(body.costUsd, COST_MIN, COST_MAX)) return { ok: false, error: 'costUsd out of range' };
  if (!isInt(body.ts, 0, Number.MAX_SAFE_INTEGER)) return { ok: false, error: 'invalid ts' };

  const serverNowSec = Math.floor(serverNowMs / 1000);
  if (Math.abs(serverNowSec - body.ts) > TS_SKEW_SECONDS) {
    return { ok: false, error: 'ts outside skew window' };
  }

  const model = body.model as ModelId;
  const expected = computeCost(body.inputTokens, body.outputTokensEst, model);
  if (body.costUsd !== expected) {
    return { ok: false, error: 'costUsd does not match recomputed cost' };
  }

  return {
    ok: true,
    event: {
      v: 1,
      eventId: body.eventId,
      nickname: body.nickname,
      deviceId: body.deviceId,
      model,
      inputTokens: body.inputTokens,
      outputTokensEst: body.outputTokensEst,
      costUsd: body.costUsd,
      ts: body.ts,
    },
  };
}
