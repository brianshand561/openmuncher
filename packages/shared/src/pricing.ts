import type { ModelId, ModelPrice } from './types.js';

export const PRICING: Readonly<Record<ModelId, ModelPrice>> = {
  'claude-opus-4-7':    { inputPerMillion: 15.0,  outputPerMillion: 75.0 },
  'claude-sonnet-4-6':  { inputPerMillion: 3.0,   outputPerMillion: 15.0 },
  'claude-haiku-4-5':   { inputPerMillion: 0.80,  outputPerMillion: 4.0  },
  'gpt-5':              { inputPerMillion: 10.0,  outputPerMillion: 30.0 },
  'gpt-4o':             { inputPerMillion: 2.50,  outputPerMillion: 10.0 },
  'o1':                 { inputPerMillion: 15.0,  outputPerMillion: 60.0 },
};

export function priceFor(model: ModelId): ModelPrice {
  return PRICING[model];
}
