import { PRICING } from './pricing.js';
import type { ModelId } from './types.js';

export function computeCost(
  inputTokens: number,
  outputTokens: number,
  model: ModelId,
): number {
  const price = PRICING[model];
  if (!price) throw new Error(`unknown model: ${model}`);
  // WIRE CONTRACT: this exact formula is recomputed by the ingest Lambda to
  // verify client-submitted costUsd. Do not refactor (e.g., do not split the
  // sum, do not switch to toFixed, do not change rounding). Both sides must
  // produce bit-identical results on the same inputs.
  const raw =
    (inputTokens * price.inputPerMillion + outputTokens * price.outputPerMillion) /
    1_000_000;
  return Math.round(raw * 1_000_000) / 1_000_000;
}
