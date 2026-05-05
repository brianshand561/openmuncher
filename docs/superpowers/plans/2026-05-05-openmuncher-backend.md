# OpenMuncher Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a deployable AWS serverless backend for OpenMuncher: two Lambdas (`ingest` and `leaderboard`) behind Lambda Function URLs, fronted by CloudFront with WAF, persisting to a single DynamoDB table with sharded counters and an inverted index for top-N. End state: `cdk synth` produces a valid stack, all unit + integration tests pass against DynamoDB Local, and a `deploy-infra.yml` GitHub workflow exists for OIDC-auth deploys.

**Architecture:** AWS CDK in TypeScript. Single-table DynamoDB (entities: Event, User aggregate, Counter shard, Ban entry; one GSI on `USERS`/`leaderboardTokens`). Lambdas import `@openmuncher/shared` for types/pricing/cost (consumed via tsup-style bundling baked into CDK's NodejsFunction). HMAC-signed requests (secret stored in Secrets Manager, injected into Lambda env at deploy). CloudFront in front of both Function URLs with WAF Web ACL (managed common rules + rate-based throttle).

**Tech Stack:** AWS CDK v2 TypeScript, `aws-lambda` types, `@aws-sdk/client-dynamodb` + `@aws-sdk/lib-dynamodb`, `aws-sdk-client-mock` for unit tests, DynamoDB Local (Docker) for integration tests, vitest, esbuild via `aws-cdk-lib/aws-lambda-nodejs`.

**Spec reference:** `docs/superpowers/specs/2026-05-05-openmuncher-design.md` — implements the **Backend** and **Telemetry security & abuse handling** sections. CLI telemetry wiring and README leaderboard rendering remain in Plan 3.

**Plan 1 inheritance:** This plan assumes Plan 1 has shipped. The repo has `@openmuncher/shared` exporting `MunchEvent`, `IngestResponse`, `LeaderboardResponse`, `LeaderboardEntry`, `KNOWN_MODELS`, `PRICING`, `priceFor`, `computeCost`. The wire-contract `computeCost` formula is **bit-stable** by design — the ingest Lambda will recompute and equality-check.

---

## Pre-flight

These are not part of any task; do them before starting:

- Docker installed and running (DynamoDB Local integration tests need it). `docker --version` should succeed.
- AWS CLI configured for the target sandbox account if you intend to `cdk deploy`. Not required for testing.
- AWS CDK CLI: `npm install -g aws-cdk` (or use `npx cdk` from inside the repo).

---

## File map

What this plan creates:

| Path | Purpose |
|------|---------|
| `packages/infra/package.json` | `@openmuncher/infra` workspace |
| `packages/infra/tsconfig.json` | extends base, references `../shared` |
| `packages/infra/cdk.json` | CDK app config |
| `packages/infra/bin/openmuncher.ts` | CDK app entrypoint |
| `packages/infra/lib/openmuncher-stack.ts` | the CDK stack |
| `packages/infra/lib/keys.ts` | DynamoDB key/index name constants (shared between stack and Lambdas) |
| `packages/infra/lambda/shared/hmac.ts` | HMAC verify with `crypto.timingSafeEqual` |
| `packages/infra/lambda/shared/validate.ts` | request body validation (shape + sanity bounds + cost recompute) |
| `packages/infra/lambda/shared/dynamo.ts` | low-level dynamo client wrapper |
| `packages/infra/lambda/shared/ban-cache.ts` | ban-list scan + 60s in-memory cache |
| `packages/infra/lambda/shared/rate-limit.ts` | per-user 1-min rolling counter |
| `packages/infra/lambda/shared/counter-shard.ts` | random shard pick + read-all-and-sum |
| `packages/infra/lambda/ingest/index.ts` | POST /munch handler |
| `packages/infra/lambda/leaderboard/index.ts` | GET /leaderboard handler |
| `packages/infra/test/hmac.test.ts` | TDD coverage |
| `packages/infra/test/validate.test.ts` | TDD coverage |
| `packages/infra/test/ban-cache.test.ts` | TDD coverage |
| `packages/infra/test/rate-limit.test.ts` | TDD coverage |
| `packages/infra/test/counter-shard.test.ts` | TDD coverage |
| `packages/infra/test/ingest.test.ts` | unit, with `aws-sdk-client-mock` |
| `packages/infra/test/leaderboard.test.ts` | unit, with `aws-sdk-client-mock` |
| `packages/infra/test/integration.test.ts` | DynamoDB Local end-to-end |
| `packages/infra/test/cdk.test.ts` | `cdk synth` snapshot |
| `.github/workflows/deploy-infra.yml` | OIDC-auth deploy on main + manual |

Out-of-scope for this plan: CLI telemetry wiring, readme-updater, ci.yml, publish-cli.yml workflows. Those land in Plan 3.

---

## Task 1: Infra package skeleton

**Files:**
- Create: `packages/infra/package.json`
- Create: `packages/infra/tsconfig.json`
- Create: `packages/infra/cdk.json`
- Create: `packages/infra/.gitignore`
- Create: `packages/infra/bin/openmuncher.ts`
- Create: `packages/infra/lib/openmuncher-stack.ts` (placeholder)

- [ ] **Step 1: Create `packages/infra/package.json`**

```json
{
  "name": "@openmuncher/infra",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "typecheck": "tsc --noEmit",
    "synth": "cdk synth",
    "deploy": "cdk deploy --all --require-approval never"
  },
  "dependencies": {
    "@openmuncher/shared": "*",
    "aws-cdk-lib": "^2.150.0",
    "constructs": "^10.3.0",
    "@aws-sdk/client-dynamodb": "^3.600.0",
    "@aws-sdk/lib-dynamodb": "^3.600.0"
  },
  "devDependencies": {
    "@types/aws-lambda": "^8.10.140",
    "aws-cdk": "^2.150.0",
    "aws-sdk-client-mock": "^4.0.0"
  }
}
```

- [ ] **Step 2: Create `packages/infra/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": ".",
    "outDir": "dist",
    "types": ["node"]
  },
  "include": ["bin/**/*", "lib/**/*", "lambda/**/*"],
  "references": [{ "path": "../shared" }]
}
```

- [ ] **Step 3: Create `packages/infra/cdk.json`**

```json
{
  "app": "npx tsx bin/openmuncher.ts",
  "watch": {
    "include": ["**"],
    "exclude": ["README.md", "cdk*.json", "**/*.d.ts", "**/*.js", "tsconfig.json", "package*.json", "yarn.lock", "node_modules", "test"]
  },
  "context": {
    "@aws-cdk/core:newStyleStackSynthesis": true,
    "@aws-cdk/core:bootstrapQualifier": "hnb659fds"
  }
}
```

- [ ] **Step 4: Create `packages/infra/.gitignore`**

```
cdk.out/
dist/
*.tsbuildinfo
```

- [ ] **Step 5: Create `packages/infra/bin/openmuncher.ts`**

```ts
#!/usr/bin/env node
import { App } from 'aws-cdk-lib';
import { OpenMuncherStack } from '../lib/openmuncher-stack.js';

const app = new App();
new OpenMuncherStack(app, 'OpenMuncherStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
  },
});
```

- [ ] **Step 6: Create `packages/infra/lib/openmuncher-stack.ts` (placeholder — populated in Task 11)**

```ts
import { Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';

export class OpenMuncherStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);
    // Resources defined in Task 11.
  }
}
```

- [ ] **Step 7: Install**

```
cd /Users/brian/Repos/OpenMuncher && npm install
```

Expected: workspace `@openmuncher/infra` is symlinked, all deps resolve. Note: `aws-cdk-lib` and `aws-cdk` together are large (~50MB+).

- [ ] **Step 8: Typecheck**

```
npm run typecheck
```

Expected: clean across all 3 workspaces.

- [ ] **Step 9: Commit**

```
git add packages/infra package.json package-lock.json
git commit -m "feat(infra): create @openmuncher/infra workspace skeleton"
```

---

## Task 2: DynamoDB key constants

**Files:**
- Create: `packages/infra/lib/keys.ts`

This module is shared between the CDK stack (which uses these names to wire the table) and the Lambda code (which uses them in queries). One source of truth.

- [ ] **Step 1: Create `packages/infra/lib/keys.ts`**

```ts
export const TABLE_NAME = 'openmuncher';

export const TOP_USERS_INDEX = 'top-users-index';

export const COUNTER_SHARDS = 10;

export const KEYS = {
  event: (eventId: string) => ({ pk: `EVENT#${eventId}`, sk: 'EVENT' }),
  userAgg: (nickname: string) => ({ pk: `USER#${nickname}`, sk: 'AGG' }),
  counterShard: (shard: number) => ({ pk: 'COUNTER#GLOBAL', sk: `SHARD#${shard}` }),
  banned: (nickname: string) => ({ pk: `BANNED#${nickname}`, sk: 'BAN' }),
} as const;

/** GSI partition key value. Constant — all aggregates share it; sort by leaderboardTokens DESC. */
export const TOP_USERS_PK = 'USERS';
```

- [ ] **Step 2: Typecheck**

```
npm run typecheck
```

Expected: clean.

- [ ] **Step 3: Commit**

```
git add packages/infra/lib/keys.ts
git commit -m "feat(infra): DynamoDB key/index constants"
```

---

## Task 3: HMAC verify (TDD)

**Files:**
- Create: `packages/infra/test/hmac.test.ts`
- Create: `packages/infra/lambda/shared/hmac.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { verifyHmac } from '../lambda/shared/hmac.js';

const SECRET = 'test-secret';
const sign = (body: string) => createHmac('sha256', SECRET).update(body).digest('hex');

describe('verifyHmac', () => {
  it('accepts a valid signature', () => {
    const body = '{"x":1}';
    expect(verifyHmac(body, sign(body), SECRET)).toBe(true);
  });

  it('rejects a wrong signature', () => {
    expect(verifyHmac('{"x":1}', sign('{"x":2}'), SECRET)).toBe(false);
  });

  it('rejects malformed hex', () => {
    expect(verifyHmac('{"x":1}', 'not-hex', SECRET)).toBe(false);
  });

  it('rejects empty signature', () => {
    expect(verifyHmac('{"x":1}', '', SECRET)).toBe(false);
  });

  it('uses constant-time compare (does not throw on length mismatch)', () => {
    expect(() => verifyHmac('{"x":1}', 'abcd', SECRET)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run, FAIL**

```
npm test -- hmac
```

Expected: FAIL — module missing.

- [ ] **Step 3: Implement `packages/infra/lambda/shared/hmac.ts`**

```ts
import { createHmac, timingSafeEqual } from 'node:crypto';

export function verifyHmac(rawBody: string, signature: string, secret: string): boolean {
  if (!signature) return false;
  const expectedHex = createHmac('sha256', secret).update(rawBody).digest('hex');
  // timingSafeEqual requires equal-length buffers; bail early on mismatch.
  if (signature.length !== expectedHex.length) return false;
  let providedBuf: Buffer;
  let expectedBuf: Buffer;
  try {
    providedBuf = Buffer.from(signature, 'hex');
    expectedBuf = Buffer.from(expectedHex, 'hex');
  } catch {
    return false;
  }
  // Buffer.from with 'hex' silently truncates on invalid chars; verify length matches expectation.
  if (providedBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(providedBuf, expectedBuf);
}
```

- [ ] **Step 4: Run, PASS**

```
npm test -- hmac
```

Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```
git add packages/infra
git commit -m "feat(infra): HMAC verify with constant-time compare"
```

---

## Task 4: Request validation (TDD)

**Files:**
- Create: `packages/infra/test/validate.test.ts`
- Create: `packages/infra/lambda/shared/validate.ts`

The validator enforces shape + sanity bounds + recomputed cost match. Returns `{ ok: true, event }` on success or `{ ok: false, error }` on failure. The recomputed-cost check uses the wire-contract formula from `@openmuncher/shared`'s `computeCost`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { computeCost } from '@openmuncher/shared';
import { validateMunchEvent } from '../lambda/shared/validate.js';

function makeBody(overrides: Record<string, unknown> = {}) {
  const inputTokens = 5000;
  const outputTokensEst = 3510;
  const model = 'claude-haiku-4-5' as const;
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
    ...overrides,
  };
}

describe('validateMunchEvent', () => {
  it('accepts a valid event', () => {
    const r = validateMunchEvent(makeBody(), Date.now());
    expect(r.ok).toBe(true);
  });

  it('rejects wrong version', () => {
    const r = validateMunchEvent(makeBody({ v: 2 }), Date.now());
    expect(r.ok).toBe(false);
  });

  it('rejects unknown model', () => {
    const r = validateMunchEvent(makeBody({ model: 'made-up' }), Date.now());
    expect(r.ok).toBe(false);
  });

  it('rejects nickname with bad chars', () => {
    const r = validateMunchEvent(makeBody({ nickname: 'bad space!' }), Date.now());
    expect(r.ok).toBe(false);
  });

  it('rejects nickname too long', () => {
    const r = validateMunchEvent(makeBody({ nickname: 'a'.repeat(40) }), Date.now());
    expect(r.ok).toBe(false);
  });

  it('rejects inputTokens out of bounds', () => {
    expect(validateMunchEvent(makeBody({ inputTokens: 50 }), Date.now()).ok).toBe(false);
    expect(validateMunchEvent(makeBody({ inputTokens: 2_000_000 }), Date.now()).ok).toBe(false);
  });

  it('rejects mismatched costUsd', () => {
    const r = validateMunchEvent(makeBody({ costUsd: 999 }), Date.now());
    expect(r.ok).toBe(false);
  });

  it('rejects too-old timestamp', () => {
    const old = Math.floor(Date.now() / 1000) - 600; // 10 min ago
    const r = validateMunchEvent(makeBody({ ts: old }), Date.now());
    expect(r.ok).toBe(false);
  });

  it('rejects future timestamp beyond skew', () => {
    const future = Math.floor(Date.now() / 1000) + 600;
    const r = validateMunchEvent(makeBody({ ts: future }), Date.now());
    expect(r.ok).toBe(false);
  });

  it('rejects non-uuid eventId', () => {
    const r = validateMunchEvent(makeBody({ eventId: 'not-a-uuid' }), Date.now());
    expect(r.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run, FAIL**

```
npm test -- validate
```

- [ ] **Step 3: Implement `packages/infra/lambda/shared/validate.ts`**

```ts
import { KNOWN_MODELS, computeCost, type MunchEvent, type ModelId } from '@openmuncher/shared';

export type ValidateResult =
  | { ok: true; event: MunchEvent }
  | { ok: false; error: string };

const NICKNAME_RE = /^[a-zA-Z0-9._-]{1,39}$/;
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const TS_SKEW_SECONDS = 5 * 60;

const INPUT_MIN = 100;
const INPUT_MAX = 1_000_000;
const OUTPUT_MIN = 0;
const OUTPUT_MAX = 2_000_000;
const COST_MIN = 0;
const COST_MAX = 1000;

function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null;
}

function isInt(n: unknown, min: number, max: number): boolean {
  return typeof n === 'number' && Number.isFinite(n) && Number.isInteger(n) && n >= min && n <= max;
}

function isFiniteNum(n: unknown, min: number, max: number): boolean {
  return typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max;
}

export function validateMunchEvent(body: unknown, serverNowMs: number): ValidateResult {
  if (!isObj(body)) return { ok: false, error: 'body not an object' };

  if (body.v !== 1) return { ok: false, error: 'unsupported version' };
  if (typeof body.eventId !== 'string' || !UUID_RE.test(body.eventId)) return { ok: false, error: 'invalid eventId' };
  if (typeof body.nickname !== 'string' || !NICKNAME_RE.test(body.nickname)) return { ok: false, error: 'invalid nickname' };
  if (typeof body.deviceId !== 'string' || !UUID_RE.test(body.deviceId)) return { ok: false, error: 'invalid deviceId' };
  if (typeof body.model !== 'string' || !(KNOWN_MODELS as readonly string[]).includes(body.model)) {
    return { ok: false, error: 'invalid model' };
  }
  if (!isInt(body.inputTokens, INPUT_MIN, INPUT_MAX)) return { ok: false, error: 'inputTokens out of range' };
  if (!isInt(body.outputTokensEst, OUTPUT_MIN, OUTPUT_MAX)) return { ok: false, error: 'outputTokensEst out of range' };
  if (!isFiniteNum(body.costUsd, COST_MIN, COST_MAX)) return { ok: false, error: 'costUsd out of range' };
  if (!isInt(body.ts, 0, Number.MAX_SAFE_INTEGER)) return { ok: false, error: 'invalid ts' };

  const serverNowSec = Math.floor(serverNowMs / 1000);
  if (Math.abs(serverNowSec - body.ts) > TS_SKEW_SECONDS) {
    return { ok: false, error: 'ts outside skew window' };
  }

  // Wire-contract: recompute cost from inputTokens/outputTokensEst/model and require exact match.
  const model = body.model as ModelId;
  const expected = computeCost(body.inputTokens, body.outputTokensEst, model);
  if (body.costUsd !== expected) {
    return { ok: false, error: 'costUsd does not match recomputed cost' };
  }

  return {
    ok: true,
    event: {
      v: 1,
      eventId: body.eventId,
      nickname: body.nickname,
      deviceId: body.deviceId,
      model,
      inputTokens: body.inputTokens,
      outputTokensEst: body.outputTokensEst,
      costUsd: body.costUsd,
      ts: body.ts,
    },
  };
}
```

- [ ] **Step 4: Run, PASS**

```
npm test -- validate
```

Expected: 10 tests pass.

- [ ] **Step 5: Commit**

```
git add packages/infra
git commit -m "feat(infra): event validator with shape + bounds + cost recompute"
```

---

## Task 5: Counter shard helper (TDD)

**Files:**
- Create: `packages/infra/test/counter-shard.test.ts`
- Create: `packages/infra/lambda/shared/counter-shard.ts`

The counter helper picks a random shard for writes and reads all shards in parallel (BatchGetItem) and sums.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
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
    // sum 100+200+...+1000 = 5500
    expect(r.tokens).toBe(5500);
    // sum 0.5+1.0+...+5.0 = 27.5
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
```

- [ ] **Step 2: Run, FAIL**

```
npm test -- counter-shard
```

- [ ] **Step 3: Implement `packages/infra/lambda/shared/counter-shard.ts`**

```ts
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
```

- [ ] **Step 4: Run, PASS**

```
npm test -- counter-shard
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```
git add packages/infra
git commit -m "feat(infra): counter shard pick + read helpers"
```

---

## Task 6: Ban cache (TDD)

**Files:**
- Create: `packages/infra/test/ban-cache.test.ts`
- Create: `packages/infra/lambda/shared/ban-cache.ts`

The cache reads a banned-nickname set on cold start and refreshes every 60s. Used by leaderboard (filter) and ingest (still records events but not aggregates).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBClient, ScanCommand } from '@aws-sdk/client-dynamodb';
import { BanCache } from '../lambda/shared/ban-cache.js';

const ddbMock = mockClient(DynamoDBClient);

beforeEach(() => {
  ddbMock.reset();
});

describe('BanCache', () => {
  it('returns false for never-loaded nickname after first load with empty result', async () => {
    ddbMock.on(ScanCommand).resolves({ Items: [] });
    const cache = new BanCache(new DynamoDBClient({}), 60_000);
    expect(await cache.isBanned('brian')).toBe(false);
  });

  it('returns true for a banned nickname', async () => {
    ddbMock.on(ScanCommand).resolves({
      Items: [{ pk: { S: 'BANNED#evil' }, sk: { S: 'BAN' } }],
    });
    const cache = new BanCache(new DynamoDBClient({}), 60_000);
    expect(await cache.isBanned('evil')).toBe(true);
    expect(await cache.isBanned('brian')).toBe(false);
  });

  it('refreshes after TTL expires', async () => {
    let scanCount = 0;
    ddbMock.on(ScanCommand).callsFake(() => {
      scanCount++;
      return { Items: scanCount === 1 ? [] : [{ pk: { S: 'BANNED#newban' }, sk: { S: 'BAN' } }] };
    });
    const cache = new BanCache(new DynamoDBClient({}), 100); // 100ms TTL
    expect(await cache.isBanned('newban')).toBe(false);
    await new Promise((r) => setTimeout(r, 150));
    expect(await cache.isBanned('newban')).toBe(true);
    expect(scanCount).toBe(2);
  });

  it('does not refresh within TTL', async () => {
    let scanCount = 0;
    ddbMock.on(ScanCommand).callsFake(() => {
      scanCount++;
      return { Items: [] };
    });
    const cache = new BanCache(new DynamoDBClient({}), 60_000);
    await cache.isBanned('a');
    await cache.isBanned('b');
    await cache.isBanned('c');
    expect(scanCount).toBe(1);
  });
});
```

- [ ] **Step 2: Run, FAIL**

```
npm test -- ban-cache
```

- [ ] **Step 3: Implement `packages/infra/lambda/shared/ban-cache.ts`**

```ts
import { DynamoDBClient, ScanCommand } from '@aws-sdk/client-dynamodb';
import { TABLE_NAME } from '../../lib/keys.js';

export class BanCache {
  private bans = new Set<string>();
  private lastLoadedAt = 0;

  constructor(
    private readonly client: DynamoDBClient,
    private readonly ttlMs: number,
  ) {}

  async isBanned(nickname: string): Promise<boolean> {
    if (Date.now() - this.lastLoadedAt > this.ttlMs) {
      await this.load();
    }
    return this.bans.has(nickname);
  }

  private async load(): Promise<void> {
    const out = await this.client.send(
      new ScanCommand({
        TableName: TABLE_NAME,
        FilterExpression: 'begins_with(pk, :prefix)',
        ExpressionAttributeValues: { ':prefix': { S: 'BANNED#' } },
        ProjectionExpression: 'pk',
      }),
    );
    const next = new Set<string>();
    for (const item of out.Items ?? []) {
      const pk = item.pk?.S;
      if (pk && pk.startsWith('BANNED#')) next.add(pk.slice('BANNED#'.length));
    }
    this.bans = next;
    this.lastLoadedAt = Date.now();
  }
}
```

- [ ] **Step 4: Run, PASS**

```
npm test -- ban-cache
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```
git add packages/infra
git commit -m "feat(infra): ban-list cache with 60s refresh"
```

---

## Task 7: Rate-limit module (TDD)

**Files:**
- Create: `packages/infra/test/rate-limit.test.ts`
- Create: `packages/infra/lambda/shared/rate-limit.ts`

The rate limiter applies a per-(nickname) 60-events/minute cap via a conditional `UpdateItem` on the user aggregate. Two branches: same minute bucket (try to ADD rateCount with `rateCount < 60` condition) or new bucket (replace bucket and reset count to 1).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBClient, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { checkAndBumpRateLimit } from '../lambda/shared/rate-limit.js';

const ddbMock = mockClient(DynamoDBClient);

beforeEach(() => {
  ddbMock.reset();
});

describe('checkAndBumpRateLimit', () => {
  const now = 1_700_000_000_000; // ms; bucket = floor(now/60_000)

  it('succeeds for new bucket (first call)', async () => {
    let calls = 0;
    ddbMock.on(UpdateItemCommand).callsFake(() => {
      calls++;
      // first call (same-bucket branch) fails with conditional check; second (new-bucket) succeeds
      if (calls === 1) {
        const e = new Error('ConditionalCheckFailedException');
        e.name = 'ConditionalCheckFailedException';
        throw e;
      }
      return {};
    });
    const r = await checkAndBumpRateLimit(new DynamoDBClient({}), 'brian', now);
    expect(r.ok).toBe(true);
    expect(calls).toBe(2);
  });

  it('succeeds for same bucket within cap', async () => {
    ddbMock.on(UpdateItemCommand).resolves({}); // first call (same-bucket) succeeds
    const r = await checkAndBumpRateLimit(new DynamoDBClient({}), 'brian', now);
    expect(r.ok).toBe(true);
  });

  it('rejects when same-bucket cap exceeded', async () => {
    let calls = 0;
    ddbMock.on(UpdateItemCommand).callsFake(() => {
      calls++;
      const e = new Error('ConditionalCheckFailedException');
      e.name = 'ConditionalCheckFailedException';
      throw e;
    });
    const r = await checkAndBumpRateLimit(new DynamoDBClient({}), 'brian', now);
    // Both same-bucket and new-bucket UpdateItems fail → over cap.
    expect(r.ok).toBe(false);
    expect(calls).toBe(2);
  });
});
```

- [ ] **Step 2: Run, FAIL**

```
npm test -- rate-limit
```

- [ ] **Step 3: Implement `packages/infra/lambda/shared/rate-limit.ts`**

```ts
import {
  DynamoDBClient,
  UpdateItemCommand,
  ConditionalCheckFailedException,
} from '@aws-sdk/client-dynamodb';
import { KEYS, TABLE_NAME } from '../../lib/keys.js';

const PER_MINUTE_CAP = 60;

export interface RateLimitResult {
  ok: boolean;
}

export async function checkAndBumpRateLimit(
  client: DynamoDBClient,
  nickname: string,
  nowMs: number,
): Promise<RateLimitResult> {
  const bucket = Math.floor(nowMs / 60_000);
  const k = KEYS.userAgg(nickname);

  // Branch A: same bucket and below cap → ADD rateCount 1.
  try {
    await client.send(
      new UpdateItemCommand({
        TableName: TABLE_NAME,
        Key: { pk: { S: k.pk }, sk: { S: k.sk } },
        UpdateExpression: 'ADD rateCount :one',
        ConditionExpression: 'rateWindow = :bucket AND rateCount < :cap',
        ExpressionAttributeValues: {
          ':one': { N: '1' },
          ':bucket': { N: String(bucket) },
          ':cap': { N: String(PER_MINUTE_CAP) },
        },
      }),
    );
    return { ok: true };
  } catch (err) {
    if (!(err instanceof ConditionalCheckFailedException)) throw err;
    // Branch A failed: either different bucket (rotate) or capped (give up).
  }

  // Branch B: new bucket — set rateWindow=bucket, rateCount=1.
  try {
    await client.send(
      new UpdateItemCommand({
        TableName: TABLE_NAME,
        Key: { pk: { S: k.pk }, sk: { S: k.sk } },
        UpdateExpression: 'SET rateWindow = :bucket, rateCount = :one',
        ConditionExpression: 'attribute_not_exists(rateWindow) OR rateWindow < :bucket',
        ExpressionAttributeValues: {
          ':one': { N: '1' },
          ':bucket': { N: String(bucket) },
        },
      }),
    );
    return { ok: true };
  } catch (err) {
    if (!(err instanceof ConditionalCheckFailedException)) throw err;
    // Branch B failed: same bucket but capped (Branch A's cap path) → reject.
    return { ok: false };
  }
}
```

- [ ] **Step 4: Run, PASS**

```
npm test -- rate-limit
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```
git add packages/infra
git commit -m "feat(infra): per-nickname rate limit with conditional update branches"
```

---

## Task 8: Ingest Lambda (TDD)

**Files:**
- Create: `packages/infra/test/ingest.test.ts`
- Create: `packages/infra/lambda/ingest/index.ts`

The ingest handler is the integrator. Flow: HMAC verify → parse + validate → ban check → rate-limit check → TransactWriteItems (Event + UserAgg + CounterShard) → read all shards → respond. Idempotent on duplicate eventId via `attribute_not_exists(pk)` on the Event Put. Lambda uses `process.env.HMAC_SECRET` (injected by CDK at deploy).

The handler signature: `(event: APIGatewayProxyEventV2)` → `APIGatewayProxyResultV2`. We mock the underlying DynamoDB calls.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
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
  // Ban scan returns empty.
  ddbMock.on(ScanCommand).resolves({ Items: [] });
  // Rate-limit Branch A (same bucket within cap) succeeds.
  ddbMock.on(UpdateItemCommand).resolves({});
  // TransactWrite succeeds.
  ddbMock.on(TransactWriteItemsCommand).resolves({});
  // BatchGet returns one shard with values.
  ddbMock.on(BatchGetItemCommand).resolves({
    Responses: {
      openmuncher: [
        { pk: { S: 'COUNTER#GLOBAL' }, sk: { S: 'SHARD#0' }, tokens: { N: '12345' }, costUsd: { N: '6.78' } },
      ],
    },
  });
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
    ddbMock.on(TransactWriteItemsCommand).rejects(
      new ConditionalCheckFailedException({ $metadata: {}, message: 'dup' }),
    );
    ddbMock.on(BatchGetItemCommand).resolves({
      Responses: { openmuncher: [{ pk: { S: 'COUNTER#GLOBAL' }, sk: { S: 'SHARD#0' }, tokens: { N: '0' }, costUsd: { N: '0' } }] },
    });
    const res = await handler(evt(makeBody()));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body!).ok).toBe(true);
  });

  it('returns 429 when rate-limited', async () => {
    ddbMock.on(ScanCommand).resolves({ Items: [] });
    ddbMock.on(UpdateItemCommand).rejects(
      new ConditionalCheckFailedException({ $metadata: {}, message: 'over cap' }),
    );
    const res = await handler(evt(makeBody()));
    expect(res.statusCode).toBe(429);
  });
});
```

- [ ] **Step 2: Run, FAIL**

```
npm test -- ingest
```

- [ ] **Step 3: Implement `packages/infra/lambda/ingest/index.ts`**

```ts
import {
  DynamoDBClient,
  TransactWriteItemsCommand,
  ConditionalCheckFailedException,
} from '@aws-sdk/client-dynamodb';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { verifyHmac } from '../shared/hmac.js';
import { validateMunchEvent } from '../shared/validate.js';
import { BanCache } from '../shared/ban-cache.js';
import { checkAndBumpRateLimit } from '../shared/rate-limit.js';
import { pickShard, readGlobalCounter } from '../shared/counter-shard.js';
import { KEYS, TABLE_NAME } from '../../lib/keys.js';

const ddb = new DynamoDBClient({});
const banCache = new BanCache(ddb, 60_000);

const LEADERBOARD_DAILY_CAP = 10_000_000;

function reply(statusCode: number, body: object): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const secret = process.env.HMAC_SECRET;
  if (!secret) return reply(500, { ok: false, error: 'server misconfigured' });

  const sig = event.headers['x-om-sig'] ?? event.headers['X-OM-Sig'];
  const raw = event.body ?? '';
  if (typeof sig !== 'string' || !verifyHmac(raw, sig, secret)) {
    return reply(401, { ok: false, error: 'bad signature' });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return reply(400, { ok: false, error: 'invalid json' });
  }

  const validated = validateMunchEvent(parsed, Date.now());
  if (!validated.ok) return reply(400, { ok: false, error: validated.error });
  const ev = validated.event;

  const banned = await banCache.isBanned(ev.nickname);

  // Rate limit (skipped for banned users — they can flood their own audit log freely).
  if (!banned) {
    const rl = await checkAndBumpRateLimit(ddb, ev.nickname, Date.now());
    if (!rl.ok) return reply(429, { ok: false, error: 'rate limited' });
  }

  const shard = pickShard();
  const eventKey = KEYS.event(ev.eventId);
  const userKey = KEYS.userAgg(ev.nickname);
  const counterKey = KEYS.counterShard(shard);

  const todayUtc = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  const totalTokens = ev.inputTokens + ev.outputTokensEst;

  const transactItems: TransactWriteItemsCommand['input']['TransactItems'] = [
    {
      Put: {
        TableName: TABLE_NAME,
        Item: {
          pk: { S: eventKey.pk },
          sk: { S: eventKey.sk },
          nickname: { S: ev.nickname },
          model: { S: ev.model },
          inputTokens: { N: String(ev.inputTokens) },
          outputTokensEst: { N: String(ev.outputTokensEst) },
          costUsd: { N: String(ev.costUsd) },
          ts: { N: String(ev.ts) },
          deviceId: { S: ev.deviceId },
        },
        ConditionExpression: 'attribute_not_exists(pk)',
      },
    },
    {
      Update: {
        TableName: TABLE_NAME,
        Key: { pk: { S: counterKey.pk }, sk: { S: counterKey.sk } },
        UpdateExpression: 'ADD tokens :t, costUsd :c',
        ExpressionAttributeValues: {
          ':t': { N: String(totalTokens) },
          ':c': { N: String(ev.costUsd) },
        },
      },
    },
  ];

  if (!banned) {
    transactItems.push({
      Update: {
        TableName: TABLE_NAME,
        Key: { pk: { S: userKey.pk }, sk: { S: userKey.sk } },
        // Increment totals always; cap leaderboardTokens at the daily cap.
        UpdateExpression:
          'ADD totalTokens :t, totalCostUsd :c, munchCount :one ' +
          'SET lastMunchTs = :ts, ' +
          'leaderboardDate = if_not_exists(leaderboardDate, :today), ' +
          'leaderboardTokens = if_not_exists(leaderboardTokens, :zero), ' +
          // GSI partition key constant on the user aggregate.
          'gsiPk = :gsiPk',
        ExpressionAttributeValues: {
          ':t': { N: String(totalTokens) },
          ':c': { N: String(ev.costUsd) },
          ':one': { N: '1' },
          ':ts': { N: String(ev.ts) },
          ':today': { S: todayUtc },
          ':zero': { N: '0' },
          ':gsiPk': { S: 'USERS' },
        },
      },
    });

    // Second update to bump leaderboardTokens within the cap.
    transactItems.push({
      Update: {
        TableName: TABLE_NAME,
        Key: { pk: { S: userKey.pk }, sk: { S: userKey.sk } },
        UpdateExpression:
          'SET leaderboardDate = :today, ' +
          'leaderboardTokens = ' +
          'if_not_exists(leaderboardTokens, :zero) + ' +
          ':t',
        ConditionExpression:
          'attribute_not_exists(leaderboardDate) OR leaderboardDate <> :today OR leaderboardTokens < :cap',
        ExpressionAttributeValues: {
          ':today': { S: todayUtc },
          ':zero': { N: '0' },
          ':t': { N: String(totalTokens) },
          ':cap': { N: String(LEADERBOARD_DAILY_CAP) },
        },
      },
    });
  }

  try {
    await ddb.send(new TransactWriteItemsCommand({ TransactItems: transactItems }));
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) {
      // Most common: duplicate eventId. Treat as success.
      // Less common: leaderboard cap update conditional failed (over daily cap).
      // Either way, the event was either already recorded or is recorded for audit; return current totals.
    } else {
      console.error('transact write failed', err);
      return reply(503, { ok: false, error: 'storage error' });
    }
  }

  const counter = await readGlobalCounter(ddb);
  return reply(200, { ok: true, globalTokens: counter.tokens, globalCostUsd: counter.costUsd });
};
```

- [ ] **Step 4: Run, PASS**

```
npm test -- ingest
```

Expected: 5 tests pass.

If a test fails because of how `ConditionalCheckFailedException` is thrown by aws-sdk-client-mock, adapt the test's error construction (the AWS SDK class signature has changed across versions — if `new ConditionalCheckFailedException({ $metadata: {}, message: 'dup' })` doesn't compile, use `Object.assign(new Error('dup'), { name: 'ConditionalCheckFailedException' })` instead and verify the handler still detects it via `instanceof`).

- [ ] **Step 5: Commit**

```
git add packages/infra
git commit -m "feat(infra): ingest Lambda handler"
```

---

## Task 9: Leaderboard Lambda (TDD)

**Files:**
- Create: `packages/infra/test/leaderboard.test.ts`
- Create: `packages/infra/lambda/leaderboard/index.ts`

Flow: parse `?limit=N` → Query GSI `top-users-index` desc → filter banned → BatchGet counter shards → respond.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  DynamoDBClient,
  QueryCommand,
  ScanCommand,
  BatchGetItemCommand,
} from '@aws-sdk/client-dynamodb';
import { handler } from '../lambda/leaderboard/index.js';

const ddbMock = mockClient(DynamoDBClient);

beforeEach(() => {
  ddbMock.reset();
});

function evt(query: Record<string, string> = {}) {
  return { queryStringParameters: query, headers: {} } as any;
}

describe('leaderboard handler', () => {
  it('returns top users + global counter', async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [
        {
          pk: { S: 'USER#alice' },
          nickname: { S: 'alice' },
          totalTokens: { N: '100000' },
          totalCostUsd: { N: '5.50' },
          munchCount: { N: '20' },
        },
        {
          pk: { S: 'USER#bob' },
          nickname: { S: 'bob' },
          totalTokens: { N: '50000' },
          totalCostUsd: { N: '2.50' },
          munchCount: { N: '10' },
        },
      ],
    });
    ddbMock.on(ScanCommand).resolves({ Items: [] }); // no bans
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
```

- [ ] **Step 2: Run, FAIL**

```
npm test -- leaderboard
```

- [ ] **Step 3: Implement `packages/infra/lambda/leaderboard/index.ts`**

```ts
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
      ScanIndexForward: false, // descending by leaderboardTokens
      Limit: limit,
    }),
  );

  const candidates: LeaderboardEntry[] = (queryOut.Items ?? []).map((item) => ({
    nickname: item.nickname?.S ?? '',
    totalTokens: Number(item.totalTokens?.N ?? '0'),
    totalCostUsd: Number(item.totalCostUsd?.N ?? '0'),
    munchCount: Number(item.munchCount?.N ?? '0'),
  }));

  // Filter banned users.
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
```

- [ ] **Step 4: Run, PASS**

```
npm test -- leaderboard
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```
git add packages/infra
git commit -m "feat(infra): leaderboard Lambda handler"
```

---

## Task 10: Integration test against DynamoDB Local

**Files:**
- Create: `packages/infra/test/integration.test.ts`

Run a real DynamoDB Local in Docker and exercise the full ingest → aggregate → leaderboard flow. The test starts and stops the container itself so CI works without external setup.

This test is slow (~10s) and requires Docker. Skip gracefully if Docker isn't available.

- [ ] **Step 1: Create `packages/infra/test/integration.test.ts`**

```ts
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
      if (e instanceof ResourceNotFoundException) return; // ready, table just doesn't exist yet
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
    // Stop a previous container if it's lingering (no error if absent).
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

    // brian: 2 events, alice: 1.
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
    expect(body.topUsers[0].nickname).toBe('brian'); // higher leaderboardTokens
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

    const b = await ingestHandler(ev()); // same eventId
    expect(b.statusCode).toBe(200);
    const bTotal = JSON.parse(b.body!).globalTokens;

    // Should be unchanged — duplicate event was rejected on the Put condition.
    expect(bTotal).toBe(aTotal);
  });
});
```

- [ ] **Step 2: Add `execa` as a devDependency**

Edit `packages/infra/package.json` `devDependencies` to add:

```
"execa": "^9.0.0"
```

Run from repo root:

```
npm install
```

- [ ] **Step 3: Run the integration test**

```
npm test -- integration
```

Expected: 2 tests pass (or whole describe block skipped if Docker isn't running). Total runtime ~15s (container start ~5s, table create ~1s, two test bodies ~1-2s each).

If a test fails:
- Container failed to start: STOP and report Docker logs (`docker logs om-ddb-local`).
- DescribeTable times out: increase the wait loop in `waitForDdb`.
- Conditional check unexpected: examine the actual table state via `aws dynamodb scan --endpoint-url http://localhost:18000 --table-name openmuncher --no-cli-pager`.

Do NOT alter the handler implementation to make integration tests pass. Report back.

- [ ] **Step 4: Commit**

```
git add packages/infra package.json package-lock.json
git commit -m "test(infra): DynamoDB Local integration tests"
```

---

## Task 11: CDK stack

**Files:**
- Modify: `packages/infra/lib/openmuncher-stack.ts`

The CDK stack defines:
- DynamoDB table (single-table, on-demand billing, point-in-time recovery, GSI)
- Two NodejsFunction Lambdas (ingest, leaderboard) with `@openmuncher/shared` bundled inline (`bundling.externalModules` empty)
- Lambda Function URLs (auth NONE, since CloudFront sits in front)
- HMAC secret (Secrets Manager) → injected into ingest Lambda env
- CloudFront distribution with two origins (one per function URL), WAF Web ACL attached
- WAF Web ACL: managed common rules + rate-based rule (2000 req / 5min per IP)
- Stack outputs for the CloudFront distribution domain

- [ ] **Step 1: Replace `packages/infra/lib/openmuncher-stack.ts`** with EXACTLY:

```ts
import {
  Stack,
  StackProps,
  RemovalPolicy,
  CfnOutput,
  Duration,
} from 'aws-cdk-lib';
import { Construct } from 'constructs';
import {
  AttributeType,
  BillingMode,
  Table,
  ProjectionType,
} from 'aws-cdk-lib/aws-dynamodb';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Runtime, FunctionUrlAuthType, FunctionUrl, HttpMethod } from 'aws-cdk-lib/aws-lambda';
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import {
  Distribution,
  AllowedMethods,
  CachePolicy,
  OriginRequestPolicy,
  ViewerProtocolPolicy,
  CachedMethods,
} from 'aws-cdk-lib/aws-cloudfront';
import { FunctionUrlOrigin } from 'aws-cdk-lib/aws-cloudfront-origins';
import { CfnWebACL, CfnWebACLAssociation } from 'aws-cdk-lib/aws-wafv2';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { TABLE_NAME, TOP_USERS_INDEX } from './keys.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class OpenMuncherStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // ========== DynamoDB ==========
    const table = new Table(this, 'Table', {
      tableName: TABLE_NAME,
      partitionKey: { name: 'pk', type: AttributeType.STRING },
      sortKey: { name: 'sk', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: true,
      removalPolicy: RemovalPolicy.RETAIN,
      timeToLiveAttribute: 'ttl',
    });
    table.addGlobalSecondaryIndex({
      indexName: TOP_USERS_INDEX,
      partitionKey: { name: 'gsiPk', type: AttributeType.STRING },
      sortKey: { name: 'leaderboardTokens', type: AttributeType.NUMBER },
      projectionType: ProjectionType.ALL,
    });

    // ========== HMAC secret ==========
    const hmacSecret = new Secret(this, 'HmacSecret', {
      secretName: 'openmuncher/hmac',
      description: 'HMAC key shared between CLI and ingest Lambda',
      generateSecretString: {
        passwordLength: 64,
        excludePunctuation: true,
        includeSpace: false,
      },
    });

    // ========== Lambdas ==========
    const lambdaCommonProps = {
      runtime: Runtime.NODEJS_20_X,
      memorySize: 256,
      timeout: Duration.seconds(10),
      bundling: {
        // Inline @openmuncher/shared and AWS SDKs are provided by the runtime.
        externalModules: ['@aws-sdk/*'],
        target: 'node20',
        format: 'esm' as const,
        mainFields: ['module', 'main'],
        banner: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
      },
    };

    const ingestFn = new NodejsFunction(this, 'IngestFn', {
      ...lambdaCommonProps,
      entry: join(__dirname, '../lambda/ingest/index.ts'),
      handler: 'handler',
      environment: {
        TABLE_NAME,
        HMAC_SECRET_ARN: hmacSecret.secretArn,
      },
    });
    // The Lambda needs the secret VALUE in env; use a deploy-time Secrets injection pattern.
    // Simplest: read from Secrets Manager at runtime on cold start. We do this via env injection
    // by setting HMAC_SECRET to the unsafe-plaintext value at deploy time — but that's a leak.
    // Better: grant the function read access and have it fetch on cold start. For Plan 2 we keep it
    // simple and inject the secret value as a Lambda env var via a custom resource. For now we
    // grant read to the secret and let the handler fetch at cold start in Plan 3.
    hmacSecret.grantRead(ingestFn);
    table.grantReadWriteData(ingestFn);

    const leaderboardFn = new NodejsFunction(this, 'LeaderboardFn', {
      ...lambdaCommonProps,
      entry: join(__dirname, '../lambda/leaderboard/index.ts'),
      handler: 'handler',
      environment: { TABLE_NAME },
    });
    table.grantReadData(leaderboardFn);

    // ========== Function URLs ==========
    const ingestUrl = new FunctionUrl(this, 'IngestUrl', {
      function: ingestFn,
      authType: FunctionUrlAuthType.NONE, // CloudFront fronts; HMAC is the auth.
    });
    const leaderboardUrl = new FunctionUrl(this, 'LeaderboardUrl', {
      function: leaderboardFn,
      authType: FunctionUrlAuthType.NONE,
    });

    // ========== WAF Web ACL ==========
    const webAcl = new CfnWebACL(this, 'WebAcl', {
      defaultAction: { allow: {} },
      scope: 'CLOUDFRONT',
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        metricName: 'OpenMuncherWebAcl',
        sampledRequestsEnabled: true,
      },
      rules: [
        {
          name: 'AWSManagedCommon',
          priority: 0,
          overrideAction: { none: {} },
          statement: {
            managedRuleGroupStatement: { vendorName: 'AWS', name: 'AWSManagedRulesCommonRuleSet' },
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: 'AWSManagedCommon',
            sampledRequestsEnabled: true,
          },
        },
        {
          name: 'AWSManagedKnownBad',
          priority: 1,
          overrideAction: { none: {} },
          statement: {
            managedRuleGroupStatement: { vendorName: 'AWS', name: 'AWSManagedRulesKnownBadInputsRuleSet' },
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: 'AWSManagedKnownBad',
            sampledRequestsEnabled: true,
          },
        },
        {
          name: 'RateLimit',
          priority: 2,
          action: { block: {} },
          statement: {
            rateBasedStatement: {
              limit: 2000,
              aggregateKeyType: 'IP',
            },
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: 'RateLimit',
            sampledRequestsEnabled: true,
          },
        },
      ],
    });

    // ========== CloudFront ==========
    const distribution = new Distribution(this, 'Distribution', {
      defaultBehavior: {
        origin: new FunctionUrlOrigin(leaderboardUrl),
        allowedMethods: AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        cachedMethods: CachedMethods.CACHE_GET_HEAD_OPTIONS,
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: CachePolicy.CACHING_OPTIMIZED,
        originRequestPolicy: OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
      },
      additionalBehaviors: {
        '/munch': {
          origin: new FunctionUrlOrigin(ingestUrl),
          allowedMethods: AllowedMethods.ALLOW_ALL,
          viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: CachePolicy.CACHING_DISABLED,
          originRequestPolicy: OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        },
      },
      webAclId: webAcl.attrArn,
      comment: 'OpenMuncher API edge',
    });

    // ========== Outputs ==========
    new CfnOutput(this, 'ApiDomain', { value: distribution.distributionDomainName });
    new CfnOutput(this, 'IngestUrl', { value: ingestUrl.url });
    new CfnOutput(this, 'LeaderboardUrlOut', { value: leaderboardUrl.url });
    new CfnOutput(this, 'HmacSecretArn', { value: hmacSecret.secretArn });
  }
}
```

- [ ] **Step 2: Update the ingest Lambda to fetch the HMAC secret from Secrets Manager on cold start**

The earlier ingest handler reads `process.env.HMAC_SECRET` directly. The CDK stack now passes `HMAC_SECRET_ARN` instead and grants Secrets Manager read. Update `packages/infra/lambda/ingest/index.ts` to support both: prefer `HMAC_SECRET` (set in tests), fall back to fetching from Secrets Manager via `HMAC_SECRET_ARN`. Add a top-of-module memo so the secret is fetched once per cold start.

Replace the imports at the top of `packages/infra/lambda/ingest/index.ts`:

```ts
import {
  DynamoDBClient,
  TransactWriteItemsCommand,
  ConditionalCheckFailedException,
} from '@aws-sdk/client-dynamodb';
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { verifyHmac } from '../shared/hmac.js';
import { validateMunchEvent } from '../shared/validate.js';
import { BanCache } from '../shared/ban-cache.js';
import { checkAndBumpRateLimit } from '../shared/rate-limit.js';
import { pickShard, readGlobalCounter } from '../shared/counter-shard.js';
import { KEYS, TABLE_NAME } from '../../lib/keys.js';
```

Add this helper near the top of the module (after the `const ddb = new DynamoDBClient({});` line):

```ts
const secrets = new SecretsManagerClient({});
let cachedSecret: string | undefined;

async function getHmacSecret(): Promise<string | undefined> {
  if (cachedSecret) return cachedSecret;
  const inline = process.env.HMAC_SECRET;
  if (inline) {
    cachedSecret = inline;
    return cachedSecret;
  }
  const arn = process.env.HMAC_SECRET_ARN;
  if (!arn) return undefined;
  const out = await secrets.send(new GetSecretValueCommand({ SecretId: arn }));
  cachedSecret = out.SecretString;
  return cachedSecret;
}
```

In the handler body, replace `const secret = process.env.HMAC_SECRET;` with `const secret = await getHmacSecret();`.

- [ ] **Step 3: Add `@aws-sdk/client-secrets-manager` to deps**

Edit `packages/infra/package.json` `dependencies` add:

```
"@aws-sdk/client-secrets-manager": "^3.600.0"
```

Then `npm install` from repo root.

- [ ] **Step 4: Re-run unit tests to confirm ingest still passes**

```
npm test -- ingest
```

Expected: still 5 tests pass (the env-var path is unchanged for tests).

- [ ] **Step 5: Run cdk synth (from packages/infra)**

```
cd /Users/brian/Repos/OpenMuncher/packages/infra && npx cdk synth --quiet
```

Expected: prints CloudFormation template to stdout, exits 0. No errors. (Synth does not require AWS credentials.)

If synth fails:
- Module-resolution errors in NodejsFunction bundling: check `bundling.externalModules` and `mainFields`.
- Missing imports: typecheck first to surface them (`npm run typecheck`).
- WAF scope error: confirm `scope: 'CLOUDFRONT'` matches `webAclId` attached to a CloudFront distribution.

Do NOT skip synth — it's the primary contract test for the stack.

- [ ] **Step 6: Commit**

```
git add packages/infra package.json package-lock.json
git commit -m "feat(infra): CDK stack with DynamoDB + Lambdas + CloudFront + WAF"
```

---

## Task 12: CDK synth snapshot test

**Files:**
- Create: `packages/infra/test/cdk.test.ts`

A lightweight assertion that the stack synthesizes and contains the expected resources. Not a fixture-locking snapshot (those churn) — just sanity checks.

- [ ] **Step 1: Create `packages/infra/test/cdk.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { OpenMuncherStack } from '../lib/openmuncher-stack.js';

describe('OpenMuncherStack', () => {
  const app = new App();
  const stack = new OpenMuncherStack(app, 'TestStack');
  const template = Template.fromStack(stack);

  it('declares a single DynamoDB table', () => {
    template.resourceCountIs('AWS::DynamoDB::Table', 1);
  });

  it('declares two Lambda functions', () => {
    template.resourceCountIs('AWS::Lambda::Function', 2);
  });

  it('declares two Lambda function URLs', () => {
    template.resourceCountIs('AWS::Lambda::Url', 2);
  });

  it('declares a CloudFront distribution with WAF attached', () => {
    template.resourceCountIs('AWS::CloudFront::Distribution', 1);
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: {
        WebACLId: { 'Fn::GetAtt': ['WebAcl', 'Arn'] },
      },
    });
  });

  it('declares a WAF Web ACL with CloudFront scope', () => {
    template.hasResourceProperties('AWS::WAFv2::WebACL', { Scope: 'CLOUDFRONT' });
  });

  it('declares an HMAC secret', () => {
    template.resourceCountIs('AWS::SecretsManager::Secret', 1);
  });

  it('outputs the CloudFront domain', () => {
    template.hasOutput('ApiDomain', {});
  });
});
```

- [ ] **Step 2: Run**

```
npm test -- cdk.test
```

Expected: 7 tests pass. (Synthesis happens once when the test module loads; assertions are fast.)

If a test fails because the WebACL ARN reference looks different from `Fn::GetAtt`: print the synthed template (`console.log(JSON.stringify(template.toJSON(), null, 2))` temporarily) and adapt the matcher.

- [ ] **Step 3: Commit**

```
git add packages/infra/test/cdk.test.ts
git commit -m "test(infra): CDK synth shape assertions"
```

---

## Task 13: Deploy workflow

**Files:**
- Create: `.github/workflows/deploy-infra.yml`

OIDC-auth GitHub Actions workflow that runs `cdk deploy` on push to main when infra changes, or on manual dispatch. No long-lived AWS keys.

- [ ] **Step 1: Create `.github/workflows/deploy-infra.yml`**

```yaml
name: deploy-infra

on:
  push:
    branches: [main]
    paths:
      - 'packages/infra/**'
      - 'packages/shared/**'
      - '.github/workflows/deploy-infra.yml'
  workflow_dispatch:

permissions:
  id-token: write
  contents: read

concurrency:
  group: deploy-infra
  cancel-in-progress: false

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - run: npm ci

      - name: Configure AWS credentials via OIDC
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.AWS_DEPLOY_ROLE_ARN }}
          aws-region: us-east-1

      - name: CDK deploy
        working-directory: packages/infra
        run: npx cdk deploy --all --require-approval never
```

- [ ] **Step 2: Commit**

```
git add .github
git commit -m "ci(infra): deploy workflow with OIDC auth"
```

---

## Self-review

Before declaring Plan 2 done:

- [ ] All 13 tasks committed.
- [ ] `npm test` from repo root passes (everything from Plan 1 still green + new Plan 2 tests).
- [ ] `npm run typecheck` passes.
- [ ] `cd packages/infra && npx cdk synth --quiet` succeeds.
- [ ] `npm test -- integration` either passes (Docker present) or skips cleanly (Docker absent).
- [ ] Spec coverage:
  - HMAC verify: ✅ Task 3
  - Validation (shape, bounds, cost recompute, ts skew): ✅ Task 4
  - Counter shard write/read: ✅ Tasks 5, 8
  - Ban cache: ✅ Task 6
  - Rate limit: ✅ Task 7
  - Ingest TransactWrite + idempotency + 429: ✅ Task 8
  - Leaderboard query GSI + filter banned + cap: ✅ Task 9
  - DynamoDB schema (single table + GSI + counter shards): ✅ Tasks 2, 11
  - CloudFront + WAF: ✅ Task 11
  - HMAC secret in Secrets Manager: ✅ Task 11
  - Deploy workflow: ✅ Task 13
  - Custom domain `api.openmuncher.dev`: deferred (spec says deferred for v1)

---

## What's next

After Plan 2 ships and `cdk deploy` is verified manually against a sandbox account:
- **Plan 3** — CLI telemetry module (HMAC sign + POST), wire into munch.ts so `runMunch` returns global counter values, `readme-updater` package, GitHub Actions for ci.yml / update-leaderboard.yml / publish-cli.yml. End state: full system live.
