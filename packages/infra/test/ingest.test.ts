import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { createHmac } from 'node:crypto';
import {
  DynamoDBClient,
  TransactWriteItemsCommand,
  ConditionalCheckFailedException,
  ScanCommand,
  UpdateItemCommand,
  BatchGetItemCommand,
} from '@aws-sdk/client-dynamodb';
import { computeCost } from '@openmuncher/shared';
import { handler } from '../lambda/ingest/index.js';

const ddbMock = mockClient(DynamoDBClient);
const SECRET = 'test-secret';

beforeEach(() => {
  ddbMock.reset();
  process.env.HMAC_SECRET = SECRET;
});

function makeBody() {
  const inputTokens = 5000;
  const outputTokensEst = 3510;
  const model = 'claude-haiku-4-5';
  const costUsd = computeCost(inputTokens, outputTokensEst, model);
  return {
    v: 1,
    eventId: '11111111-2222-3333-4444-555555555555',
    nickname: 'brian',
    deviceId: '99999999-8888-7777-6666-555555555555',
    model,
    inputTokens,
    outputTokensEst,
    costUsd,
    ts: Math.floor(Date.now() / 1000),
  };
}

function sign(body: string) {
  return createHmac('sha256', SECRET).update(body).digest('hex');
}

function evt(body: object, sigOverride?: string) {
  const raw = JSON.stringify(body);
  return {
    headers: { 'x-om-sig': sigOverride ?? sign(raw) },
    body: raw,
  } as any;
}

function setupHappyPath() {
  ddbMock.on(ScanCommand).resolves({ Items: [] });
  ddbMock.on(UpdateItemCommand).resolves({});
  ddbMock.on(TransactWriteItemsCommand).resolves({});
  ddbMock.on(BatchGetItemCommand).resolves({
    Responses: {
      openmuncher: [
        { pk: { S: 'COUNTER#GLOBAL' }, sk: { S: 'SHARD#0' }, tokens: { N: '12345' }, costUsd: { N: '6.78' } },
      ],
    },
  });
}

function ccfe(message: string): Error {
  const e = new Error(message);
  e.name = 'ConditionalCheckFailedException';
  return e;
}

describe('ingest handler', () => {
  it('returns 200 on a valid request', async () => {
    setupHappyPath();
    const res = await handler(evt(makeBody()));
    expect(res.statusCode).toBe(200);
    const parsed = JSON.parse(res.body!);
    expect(parsed.ok).toBe(true);
    expect(parsed.globalTokens).toBe(12345);
    expect(parsed.globalCostUsd).toBeCloseTo(6.78, 2);
  });

  it('returns 401 on bad HMAC', async () => {
    setupHappyPath();
    const res = await handler(evt(makeBody(), 'deadbeef'.repeat(8)));
    expect(res.statusCode).toBe(401);
  });

  it('returns 400 on invalid body', async () => {
    setupHappyPath();
    const body = { ...makeBody(), v: 99 };
    const res = await handler(evt(body));
    expect(res.statusCode).toBe(400);
  });

  it('returns 200 idempotently on duplicate eventId (conditional check failure)', async () => {
    ddbMock.on(ScanCommand).resolves({ Items: [] });
    ddbMock.on(UpdateItemCommand).resolves({});
    ddbMock.on(TransactWriteItemsCommand).rejects(ccfe('dup'));
    ddbMock.on(BatchGetItemCommand).resolves({
      Responses: { openmuncher: [{ pk: { S: 'COUNTER#GLOBAL' }, sk: { S: 'SHARD#0' }, tokens: { N: '0' }, costUsd: { N: '0' } }] },
    });
    const res = await handler(evt(makeBody()));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body!).ok).toBe(true);
  });

  it('returns 429 when rate-limited', async () => {
    ddbMock.on(ScanCommand).resolves({ Items: [] });
    ddbMock.on(UpdateItemCommand).rejects(ccfe('over cap'));
    const res = await handler(evt(makeBody()));
    expect(res.statusCode).toBe(429);
  });
});
