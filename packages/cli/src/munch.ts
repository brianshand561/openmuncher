import { randomUUID } from 'node:crypto';
import type { ModelId, MunchEvent } from '@openmuncher/shared';
import { computeCost } from '@openmuncher/shared';
import { detectModel } from './model-detector.js';
import { countTokens } from './tokenizer.js';
import { generatePayload } from './payload-generator.js';
import { tokensToConversions, wasteRating } from './conversions.js';
import { loadConfig, saveConfig, type Config } from './config.js';
import { sendTelemetry } from './telemetry.js';
import { HMAC_SECRET, INGEST_URL } from './build-info.js';

const TOKENS_PER_WORD = 1.35;
const OVERSHOOT = 1.3;
const INSTRUCTED_MIN_WORDS = 2000;

const INTENSITY_BANDS = {
  light: 2000,
  medium: 10_000,
  heavy: 50_000,
  nuclear: 200_000,
} as const;

export type Intensity = keyof typeof INTENSITY_BANDS;

export interface MunchArgs {
  tokens?: number;
  model?: ModelId;
  intensity?: Intensity;
  animation?: boolean;
}

export interface RunMunchOptions {
  home: string;
  env: NodeJS.ProcessEnv;
  argv: MunchArgs;
  askNickname: () => Promise<string>;
  seed?: string;
  /** Test seam: when set, telemetry uses this URL instead of the build-time INGEST_URL. */
  telemetryUrl?: string;
  /** Test seam: when set, telemetry uses this fetch instead of the global. */
  fetchFn?: typeof fetch;
}

export interface MunchResult {
  model: ModelId;
  inputTokens: number;
  outputTokensEst: number;
  inputCostUsd: number;
  outputCostUsdEst: number;
  totalCostUsd: number;
  rating: { score: number; label: string };
  conversions: ReturnType<typeof tokensToConversions>;
  payloadText: string;
  config: Config;
  globalTokens: number | null;
  globalCostUsd: number | null;
}

function pickTarget(args: MunchArgs): number {
  if (args.tokens) return args.tokens;
  if (args.intensity) return INTENSITY_BANDS[args.intensity];
  return 5000 + Math.floor(Math.random() * 20_001);
}

export async function runMunch(opts: RunMunchOptions): Promise<MunchResult> {
  let config = loadConfig(opts.home);
  if (!config) {
    const nickname = await opts.askNickname();
    config = {
      nickname,
      deviceId: randomUUID(),
      lifetimeTokens: 0,
      lifetimeCostUsd: 0,
      lastGlobalTokens: 0,
      lastGlobalCostUsd: 0,
    };
    saveConfig(opts.home, config);
  }

  const model: ModelId = opts.argv.model ?? detectModel(opts.env);
  const target = pickTarget(opts.argv);
  const seed = opts.seed ?? randomUUID();

  const { text } = generatePayload({
    targetInputTokens: target,
    model,
    seed,
    instructedMinWords: INSTRUCTED_MIN_WORDS,
  });

  const inputTokens = countTokens(text, model);
  const outputTokensEst = Math.round(INSTRUCTED_MIN_WORDS * TOKENS_PER_WORD * OVERSHOOT);
  const inputCostUsd = computeCost(inputTokens, 0, model);
  const outputCostUsdEst = computeCost(0, outputTokensEst, model);
  const totalCostUsd = computeCost(inputTokens, outputTokensEst, model);

  const event: MunchEvent = {
    v: 1,
    eventId: randomUUID(),
    nickname: config.nickname,
    deviceId: config.deviceId,
    model,
    inputTokens,
    outputTokensEst,
    costUsd: totalCostUsd,
    ts: Math.floor(Date.now() / 1000),
  };

  const ingest = await sendTelemetry(event, {
    url: opts.telemetryUrl ?? INGEST_URL,
    secret: HMAC_SECRET,
    fetchFn: opts.fetchFn,
  });

  const updated: Config = {
    ...config,
    lifetimeTokens: config.lifetimeTokens + inputTokens + outputTokensEst,
    lifetimeCostUsd: round6(config.lifetimeCostUsd + totalCostUsd),
    lastGlobalTokens: ingest?.globalTokens ?? config.lastGlobalTokens,
    lastGlobalCostUsd: ingest?.globalCostUsd ?? config.lastGlobalCostUsd,
  };
  saveConfig(opts.home, updated);

  return {
    model,
    inputTokens,
    outputTokensEst,
    inputCostUsd,
    outputCostUsdEst,
    totalCostUsd,
    rating: wasteRating(totalCostUsd),
    conversions: tokensToConversions(inputTokens + outputTokensEst, totalCostUsd),
    payloadText: text,
    config: updated,
    globalTokens: ingest === null ? (config.lastGlobalTokens || null) : ingest.globalTokens,
    globalCostUsd: ingest === null ? (config.lastGlobalCostUsd || null) : ingest.globalCostUsd,
  };
}

function round6(n: number) { return Math.round(n * 1_000_000) / 1_000_000; }
