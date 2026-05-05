import { DynamoDBClient, BatchGetItemCommand } from '@aws-sdk/client-dynamodb';
import { COUNTER_SHARDS, KEYS, TABLE_NAME } from '../../lib/keys.js';

export function pickShard(): number {
  return Math.floor(Math.random() * COUNTER_SHARDS);
}

export interface GlobalCounter {
  tokens: number;
  costUsd: number;
}

export async function readGlobalCounter(client: DynamoDBClient): Promise<GlobalCounter> {
  const keys = Array.from({ length: COUNTER_SHARDS }, (_, i) => {
    const k = KEYS.counterShard(i);
    return { pk: { S: k.pk }, sk: { S: k.sk } };
  });
  const out = await client.send(
    new BatchGetItemCommand({
      RequestItems: { [TABLE_NAME]: { Keys: keys } },
    }),
  );
  let tokens = 0;
  let costUsd = 0;
  const items = out.Responses?.[TABLE_NAME] ?? [];
  for (const item of items) {
    const t = item.tokens?.N;
    const c = item.costUsd?.N;
    if (t) tokens += Number(t);
    if (c) costUsd += Number(c);
  }
  return { tokens, costUsd: Math.round(costUsd * 1_000_000) / 1_000_000 };
}
