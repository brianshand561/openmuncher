import { PRICING } from './pricing.js';
import type { ModelId } from './types.js';

export function computeCost(
  inputTokens: number,
  outputTokens: number,
  model: ModelId,
): number {
  const price = PRICING[model];
  if (!price) throw new Error(`unknown model: ${model}`);
  const raw =
    (inputTokens * price.inputPerMillion + outputTokens * price.outputPerMillion) /
    1_000_000;
  return Math.round(raw * 1_000_000) / 1_000_000;
}
