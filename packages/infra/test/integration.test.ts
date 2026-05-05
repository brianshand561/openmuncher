import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execa } from 'execa';
import { createHmac } from 'node:crypto';
import {
  DynamoDBClient,
  CreateTableCommand,
  DescribeTableCommand,
  ResourceNotFoundException,
} from '@aws-sdk/client-dynamodb';
import { computeCost } from '@openmuncher/shared';
import { handler as ingestHandler } from '../lambda/ingest/index.js';
import { handler as leaderboardHandler } from '../lambda/leaderboard/index.js';
import { TABLE_NAME, TOP_USERS_INDEX } from '../lib/keys.js';

const PORT = 18000;
const ENDPOINT = `http://localhost:${PORT}`;
const SECRET = 'integration-secret';

const CONTAINER = 'om-ddb-local';

async function dockerAvailable(): Promise<boolean> {
  try {
    await execa('docker', ['version'], { timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

function client() {
  return new DynamoDBClient({
    endpoint: ENDPOINT,
    region: 'us-east-1',
    credentials: { accessKeyId: 'fake', secretAccessKey: 'fake' },
  });
}

async function waitForDdb(c: DynamoDBClient): Promise<void> {
  for (let i = 0; i < 30; i++) {
    try {
      await c.send(new DescribeTableCommand({ TableName: TABLE_NAME }));
      return;
    } catch (e) {
      if (e instanceof ResourceNotFoundException) return;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error('DynamoDB Local did not become ready');
}

async function createTable(c: DynamoDBClient): Promise<void> {
  await c.send(
    new CreateTableCommand({
      TableName: TABLE_NAME,
      AttributeDefinitions: [
        { AttributeName: 'pk', AttributeType: 'S' },
        { AttributeName: 'sk', AttributeType: 'S' },
        { AttributeName: 'gsiPk', AttributeType: 'S' },
        { AttributeName: 'leaderboardTokens', AttributeType: 'N' },
      ],
      KeySchema: [
        { AttributeName: 'pk', KeyType: 'HASH' },
        { AttributeName: 'sk', KeyType: 'RANGE' },
      ],
      GlobalSecondaryIndexes: [
        {
          IndexName: TOP_USERS_INDEX,
          KeySchema: [
            { AttributeName: 'gsiPk', KeyType: 'HASH' },
            { AttributeName: 'leaderboardTokens', KeyType: 'RANGE' },
          ],
          Projection: { ProjectionType: 'ALL' },
        },
      ],
      BillingMode: 'PAY_PER_REQUEST',
    }),
  );
}

const skip = !(await dockerAvailable());

describe.skipIf(skip)('integration: ingest → leaderboard', () => {
  beforeAll(async () => {
    await execa('docker', ['rm', '-f', CONTAINER], { reject: false });
    await execa('docker', [
      'run', '-d', '--rm',
      '--name', CONTAINER,
      '-p', `${PORT}:8000`,
      'amazon/dynamodb-local:latest',
      '-jar', 'DynamoDBLocal.jar', '-inMemory',
    ]);
    const c = client();
    await waitForDdb(c);
    await createTable(c);
    process.env.HMAC_SECRET = SECRET;
    process.env.AWS_REGION = 'us-east-1';
    process.env.AWS_ACCESS_KEY_ID = 'fake';
    process.env.AWS_SECRET_ACCESS_KEY = 'fake';
    process.env.AWS_ENDPOINT_URL_DYNAMODB = ENDPOINT;
  }, 60_000);

  afterAll(async () => {
    await execa('docker', ['rm', '-f', CONTAINER], { reject: false });
  });

  it('records two events and surfaces totals on the leaderboard', async () => {
    const inputTokens = 5000;
    const outputTokensEst = 3510;
    const model = 'claude-haiku-4-5';
    const costUsd = computeCost(inputTokens, outputTokensEst, model);

    function event(eventId: string, nickname: string) {
      const body = {
        v: 1,
        eventId,
        nickname,
        deviceId: '99999999-8888-7777-6666-555555555555',
        model,
        inputTokens,
        outputTokensEst,
        costUsd,
        ts: Math.floor(Date.now() / 1000),
      };
      const raw = JSON.stringify(body);
      const sig = createHmac('sha256', SECRET).update(raw).digest('hex');
      return { headers: { 'x-om-sig': sig }, body: raw } as any;
    }

    const r1 = await ingestHandler(event('11111111-2222-3333-4444-555555555555', 'brian'));
    expect(r1.statusCode).toBe(200);
    const r2 = await ingestHandler(event('22222222-2222-3333-4444-555555555555', 'brian'));
    expect(r2.statusCode).toBe(200);
    const r3 = await ingestHandler(event('33333333-2222-3333-4444-555555555555', 'alice'));
    expect(r3.statusCode).toBe(200);

    const lb = await leaderboardHandler({ queryStringParameters: { limit: '10' }, headers: {} } as any);
    expect(lb.statusCode).toBe(200);
    const body = JSON.parse(lb.body!);
    expect(body.globalTokens).toBe((inputTokens + outputTokensEst) * 3);
    expect(body.topUsers).toHaveLength(2);
    expect(body.topUsers[0].nickname).toBe('brian');
    expect(body.topUsers[0].munchCount).toBe(2);
    expect(body.topUsers[1].nickname).toBe('alice');
  });

  it('idempotently absorbs a duplicate eventId', async () => {
    const inputTokens = 5000;
    const outputTokensEst = 3510;
    const model = 'claude-haiku-4-5';
    const costUsd = computeCost(inputTokens, outputTokensEst, model);
    const eventId = '44444444-2222-3333-4444-555555555555';

    function ev() {
      const body = {
        v: 1, eventId, nickname: 'charlie',
        deviceId: '99999999-8888-7777-6666-555555555555',
        model, inputTokens, outputTokensEst, costUsd,
        ts: Math.floor(Date.now() / 1000),
      };
      const raw = JSON.stringify(body);
      const sig = createHmac('sha256', SECRET).update(raw).digest('hex');
      return { headers: { 'x-om-sig': sig }, body: raw } as any;
    }

    const a = await ingestHandler(ev());
    expect(a.statusCode).toBe(200);
    const aTotal = JSON.parse(a.body!).globalTokens;

    const b = await ingestHandler(ev());
    expect(b.statusCode).toBe(200);
    const bTotal = JSON.parse(b.body!).globalTokens;

    expect(bTotal).toBe(aTotal);
  });
});
