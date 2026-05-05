import type { LeaderboardResponse } from '@openmuncher/shared';

const fmt = (n: number) => n.toLocaleString('en-US');
const dollars = (n: number) =>
  `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const RANK_ICONS = ['🥇', '🥈', '🥉'];

function rankIcon(idx: number): string {
  return RANK_ICONS[idx] ?? `${idx + 1}.`;
}

export function renderLeaderboardBlock(data: LeaderboardResponse): string {
  const lines: string[] = [];
  lines.push('<!-- This block is auto-generated. Do not edit. -->');
  if (data.topUsers.length === 0) {
    lines.push('');
    lines.push('*No munches yet. Be the first.*');
  } else {
    lines.push('');
    lines.push('| Rank | Wastrel | Tokens Burned | Money Incinerated | Munches |');
    lines.push('|------|---------|---------------|-------------------|---------|');
    for (let i = 0; i < data.topUsers.length; i++) {
      const u = data.topUsers[i]!;
      lines.push(
        `| ${rankIcon(i)} | ${u.nickname} | ${fmt(u.totalTokens)} | ${dollars(u.totalCostUsd)} | ${fmt(u.munchCount)} |`,
      );
    }
  }
  lines.push('');
  lines.push(
    `**Global counter:** ${fmt(data.globalTokens)} tokens · ${dollars(data.globalCostUsd)} incinerated.`,
  );
  lines.push(`*Last updated: ${data.generatedAt}*`);
  return lines.join('\n');
}
