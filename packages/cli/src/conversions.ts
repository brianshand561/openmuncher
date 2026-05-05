export interface Conversions {
  trees: number;
  coffees: number;
  gpuSeconds: number;
  oceanMl: number;
}

// Knobs are intentionally arbitrary — tone > precision (per spec).
const TREES_PER_TOKEN = 0.000_008;
const COFFEES_PER_DOLLAR = 0.85;
const GPU_SECONDS_PER_KTOKEN = 2.7;
const OCEAN_ML_PER_MTOKEN = 1.3;

export function tokensToConversions(totalTokens: number, costUsd: number): Conversions {
  return {
    trees: round1(totalTokens * TREES_PER_TOKEN),
    coffees: round1(costUsd * COFFEES_PER_DOLLAR),
    gpuSeconds: round1((totalTokens / 1000) * GPU_SECONDS_PER_KTOKEN),
    oceanMl: round2((totalTokens / 1_000_000) * OCEAN_ML_PER_MTOKEN),
  };
}

function round1(n: number) { return Math.round(n * 10) / 10; }
function round2(n: number) { return Math.round(n * 100) / 100; }

const RATING_LABELS = [
  'Eco-Friendly',
  'Mildly Wasteful',
  'Carelessly Spent',
  'Mildly Irresponsible',
  'Borderline Reckless',
  'Aggressively Inefficient',
  'Financially Irresponsible',
  'Notably Stupid',
  'Spectacularly Wasteful',
  'Truly Sublime',
  'Woodchipper Achieved',
];

export function wasteRating(costUsd: number): { score: number; label: string } {
  // Logarithmic scale: $0.01 → 0, $1 → 5, $10 → 7.5, $100 → 10.
  const raw = Math.log10(Math.max(costUsd, 0.001)) * 2.5 + 5;
  const score = Math.max(0, Math.min(10, Math.round(raw * 10) / 10));
  const label = RATING_LABELS[Math.min(10, Math.floor(score))]!;
  return { score, label };
}
