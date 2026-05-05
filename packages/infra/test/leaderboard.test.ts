import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  DynamoDBClient,
  QueryCommand,
  ScanCommand,
  BatchGetItemCommand,
} from '@aws-sdk/client-dynamodb';

const ddbMock = mockClient(DynamoDBClient);

let handler: any;

beforeEach(async () => {
  ddbMock.reset();
  vi.resetModules();
  ({ handler } = await import('../lambda/leaderboard/index.js'));
});

function evt(query: Record<string, string> = {}) {
  return { queryStringParameters: query, headers: {} } as any;
}

describe('leaderboard handler', () => {
  it('returns top users + global counter', async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [
        { pk: { S: 'USER#alice' }, nickname: { S: 'alice' }, totalTokens: { N: '100000' }, totalCostUsd: { N: '5.50' }, munchCount: { N: '20' } },
        { pk: { S: 'USER#bob' }, nickname: { S: 'bob' }, totalTokens: { N: '50000' }, totalCostUsd: { N: '2.50' }, munchCount: { N: '10' } },
      ],
    });
    ddbMock.on(ScanCommand).resolves({ Items: [] });
    ddbMock.on(BatchGetItemCommand).resolves({
      Responses: {
        openmuncher: [
          { pk: { S: 'COUNTER#GLOBAL' }, sk: { S: 'SHARD#0' }, tokens: { N: '999' }, costUsd: { N: '0.5' } },
        ],
      },
    });
    const res = await handler(evt({ limit: '10' }));
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body!);
    expect(body.topUsers).toHaveLength(2);
    expect(body.topUsers[0].nickname).toBe('alice');
    expect(body.globalTokens).toBe(999);
    expect(body.globalCostUsd).toBeCloseTo(0.5, 6);
    expect(typeof body.generatedAt).toBe('string');
  });

  it('filters banned users from the result', async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [
        { pk: { S: 'USER#evil' }, nickname: { S: 'evil' }, totalTokens: { N: '1000' }, totalCostUsd: { N: '1' }, munchCount: { N: '1' } },
        { pk: { S: 'USER#alice' }, nickname: { S: 'alice' }, totalTokens: { N: '500' }, totalCostUsd: { N: '0.5' }, munchCount: { N: '1' } },
      ],
    });
    ddbMock.on(ScanCommand).resolves({
      Items: [{ pk: { S: 'BANNED#evil' }, sk: { S: 'BAN' } }],
    });
    ddbMock.on(BatchGetItemCommand).resolves({
      Responses: { openmuncher: [{ pk: { S: 'COUNTER#GLOBAL' }, sk: { S: 'SHARD#0' }, tokens: { N: '0' }, costUsd: { N: '0' } }] },
    });
    const res = await handler(evt({ limit: '10' }));
    const body = JSON.parse(res.body!);
    expect(body.topUsers.map((u: { nickname: string }) => u.nickname)).toEqual(['alice']);
  });

  it('caps limit at 100', async () => {
    let queryArgs: any = null;
    ddbMock.on(QueryCommand).callsFake((args) => {
      queryArgs = args;
      return { Items: [] };
    });
    ddbMock.on(ScanCommand).resolves({ Items: [] });
    ddbMock.on(BatchGetItemCommand).resolves({ Responses: { openmuncher: [] } });
    await handler(evt({ limit: '99999' }));
    expect(queryArgs.Limit).toBe(100);
  });

  it('defaults to limit 20 if not given', async () => {
    let queryArgs: any = null;
    ddbMock.on(QueryCommand).callsFake((args) => {
      queryArgs = args;
      return { Items: [] };
    });
    ddbMock.on(ScanCommand).resolves({ Items: [] });
    ddbMock.on(BatchGetItemCommand).resolves({ Responses: { openmuncher: [] } });
    await handler(evt());
    expect(queryArgs.Limit).toBe(20);
  });
});
