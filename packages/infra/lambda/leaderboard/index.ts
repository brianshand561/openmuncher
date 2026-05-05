import { DynamoDBClient, QueryCommand } from '@aws-sdk/client-dynamodb';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { BanCache } from '../shared/ban-cache.js';
import { readGlobalCounter } from '../shared/counter-shard.js';
import { TABLE_NAME, TOP_USERS_INDEX, TOP_USERS_PK } from '../../lib/keys.js';
import type { LeaderboardResponse, LeaderboardEntry } from '@openmuncher/shared';

const ddb = new DynamoDBClient({});
const banCache = new BanCache(ddb, 60_000);

function reply(statusCode: number, body: object): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'public, max-age=60',
    },
    body: JSON.stringify(body),
  };
}

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const requested = Number(event.queryStringParameters?.limit ?? '20');
  const limit = Math.min(100, Number.isFinite(requested) && requested > 0 ? Math.floor(requested) : 20);

  const queryOut = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: TOP_USERS_INDEX,
      KeyConditionExpression: 'gsiPk = :pk',
      ExpressionAttributeValues: { ':pk': { S: TOP_USERS_PK } },
      ScanIndexForward: false,
      Limit: limit,
    }),
  );

  const candidates: LeaderboardEntry[] = (queryOut.Items ?? []).map((item) => ({
    nickname: item.nickname?.S ?? '',
    totalTokens: Number(item.totalTokens?.N ?? '0'),
    totalCostUsd: Number(item.totalCostUsd?.N ?? '0'),
    munchCount: Number(item.munchCount?.N ?? '0'),
  }));

  const topUsers: LeaderboardEntry[] = [];
  for (const u of candidates) {
    const banned = await banCache.isBanned(u.nickname);
    if (!banned && u.nickname.length > 0) topUsers.push(u);
  }

  const counter = await readGlobalCounter(ddb);

  const body: LeaderboardResponse = {
    globalTokens: counter.tokens,
    globalCostUsd: counter.costUsd,
    topUsers,
    generatedAt: new Date().toISOString(),
  };

  return reply(200, body);
};
