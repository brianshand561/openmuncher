import type { ModelId } from '@openmuncher/shared';
import type { Conversions } from './conversions.js';

export interface StatsInput {
  model: ModelId;
  inputTokens: number;
  inputCostUsd: number;
  outputTokensEst: number;
  outputCostUsdEst: number;
  totalCostUsd: number;
  rating: { score: number; label: string };
  conversions: Conversions;
  lifetimeTokens: number;
  lifetimeCostUsd: number;
  globalTokens: number | null;
  globalCostUsd: number | null;
}

const fmt = (n: number) => n.toLocaleString('en-US');
const dollars = (n: number) =>
  `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dollars4 = (n: number) => `$${n.toFixed(4)}`;

export function renderStats(s: StatsInput): string {
  const lines: string[] = [];
  lines.push('');
  lines.push('🪵 MUNCH COMPLETE 🪵');
  lines.push(`Model:       ${s.model}`);
  lines.push(`Input:       ${fmt(s.inputTokens).padStart(8)} tokens   (${dollars4(s.inputCostUsd)})`);
  lines.push(`Output:      ${('~' + fmt(s.outputTokensEst)).padStart(8)} tokens   (${dollars4(s.outputCostUsdEst)} est.)`);
  lines.push(`Total cost:  ~${dollars(s.totalCostUsd)}`);
  lines.push(`Waste rating: ${s.rating.score.toFixed(1)}/10 — "${s.rating.label}"`);
  lines.push('');
  lines.push('Equivalent to:');
  lines.push(`  🌳 ${s.conversions.trees} trees emotionally impacted`);
  lines.push(`  ☕ ${s.conversions.coffees} coffees incinerated`);
  lines.push(`  ⚙️  ${s.conversions.gpuSeconds} seconds of GPU suffering`);
  lines.push(`  🌊 ${s.conversions.oceanMl} mL of ocean evaporated`);
  lines.push('');
  lines.push(`Lifetime: ${fmt(s.lifetimeTokens)} tokens · ${dollars(s.lifetimeCostUsd)}`);
  if (s.globalTokens === null || s.globalCostUsd === null) {
    lines.push('Global:   (offline)');
  } else {
    lines.push(`Global:   ${fmt(s.globalTokens)} tokens · ${dollars(s.globalCostUsd)}`);
  }
  lines.push('');
  return lines.join('\n');
}
