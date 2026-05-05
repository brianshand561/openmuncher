import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBClient, BatchGetItemCommand } from '@aws-sdk/client-dynamodb';
import { pickShard, readGlobalCounter } from '../lambda/shared/counter-shard.js';
import { COUNTER_SHARDS } from '../lib/keys.js';

const ddbMock = mockClient(DynamoDBClient);

beforeEach(() => {
  ddbMock.reset();
});

describe('pickShard', () => {
  it('returns an integer in [0, COUNTER_SHARDS)', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 200; i++) seen.add(pickShard());
    for (const s of seen) {
      expect(Number.isInteger(s)).toBe(true);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThan(COUNTER_SHARDS);
    }
  });
});

describe('readGlobalCounter', () => {
  it('sums tokens and costUsd across all shards', async () => {
    ddbMock.on(BatchGetItemCommand).resolves({
      Responses: {
        openmuncher: Array.from({ length: COUNTER_SHARDS }, (_, i) => ({
          pk: { S: 'COUNTER#GLOBAL' },
          sk: { S: `SHARD#${i}` },
          tokens: { N: String((i + 1) * 100) },
          costUsd: { N: String((i + 1) * 0.5) },
        })),
      },
    });
    const client = new DynamoDBClient({});
    const r = await readGlobalCounter(client);
    expect(r.tokens).toBe(5500);
    expect(r.costUsd).toBeCloseTo(27.5, 6);
  });

  it('handles missing shards as zero', async () => {
    ddbMock.on(BatchGetItemCommand).resolves({ Responses: { openmuncher: [] } });
    const client = new DynamoDBClient({});
    const r = await readGlobalCounter(client);
    expect(r.tokens).toBe(0);
    expect(r.costUsd).toBe(0);
  });
});
