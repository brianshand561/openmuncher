# OpenMuncher Integration & Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the CLI from Plan 1 to the backend from Plan 2 and add the public-facing leaderboard rendering. End state: every `openmuncher` invocation HMAC-signs a telemetry event and POSTs it; the response's global counter is shown in the stats footer; an hourly GitHub Action regenerates the README's leaderboard table from the API; CI validates PRs; npm publish runs on tag.

**Architecture:**
- New CLI module `telemetry.ts` builds a `MunchEvent`, HMAC-signs the canonical body bytes with a build-time secret, POSTs to the configured endpoint with one silent retry, returns `{ globalTokens, globalCostUsd }` or `null` (offline). Wired into `runMunch` so the orchestrator returns global values; `index.ts` passes them to `renderStats`.
- New workspace `@openmuncher/readme-updater` is a small Node script: fetch → render markdown table → splice between `<!-- LEADERBOARD:START -->` / `END` markers in `README.md`. Stays exit-0 even on no-op; the workflow uses `git diff --quiet` to decide whether to commit.
- Three new GitHub Actions workflows: `ci.yml` on PR, `update-leaderboard.yml` hourly on `main`, `publish-cli.yml` on tag.
- Build-time HMAC inlining: the publish workflow rewrites a constants file with the value of `OPENMUNCHER_HMAC_KEY` (GitHub Secret) before bundling, so the published bundle has the secret baked in.

**Tech Stack:** TypeScript, vitest, Node `fetch`/`undici` for HTTP, GitHub Actions.

**Spec reference:** `docs/superpowers/specs/2026-05-05-openmuncher-design.md` — implements **CLI run flow step 8** (telemetry POST + global counter return), **Telemetry security & abuse handling → HMAC signing**, **Leaderboard rendering**, and the remaining workflows (`ci.yml`, `update-leaderboard.yml`, `publish-cli.yml`).

**Plan 1/2 inheritance:** This plan builds on a working CLI (`openmuncher`) that produces a `MunchResult` and renders stats with `globalTokens: null`, and a deployed (or deployable) backend at `https://api.openmuncher.dev` exposing `POST /munch` and `GET /leaderboard`. The HMAC secret is in AWS Secrets Manager (production) or `process.env.OPENMUNCHER_HMAC_KEY` (test/dev).

---

## Pre-flight

- The HMAC secret value must be available as `OPENMUNCHER_HMAC_KEY` GitHub Secret (used by `publish-cli.yml` at bundle time). Locally, set the env var or use the dev fallback.
- The deployed API endpoint URL must be known. For local dev tests we use `http://localhost:18000` (mock server).

---

## File map

| Path | Purpose |
|------|---------|
| `packages/cli/src/build-info.ts` | Build-time constants: HMAC_SECRET, INGEST_URL. Default values are dev placeholders; replaced at publish time by the workflow. |
| `packages/cli/src/telemetry.ts` | Build event from MunchResult, HMAC sign, POST with retry, parse response |
| `packages/cli/src/munch.ts` (modify) | Call telemetry after computing result; thread global into MunchResult |
| `packages/cli/src/index.ts` (modify) | Pass result.globalTokens / globalCostUsd into renderStats |
| `packages/cli/test/telemetry.test.ts` | TDD coverage with mock fetch |
| `packages/readme-updater/package.json` | `@openmuncher/readme-updater` workspace |
| `packages/readme-updater/tsconfig.json` | extends base |
| `packages/readme-updater/src/index.ts` | bin script |
| `packages/readme-updater/src/render.ts` | markdown table generator |
| `packages/readme-updater/test/render.test.ts` | TDD coverage |
| `packages/readme-updater/test/index.test.ts` | end-to-end with fixture README |
| `.github/workflows/ci.yml` | typecheck + test on PR |
| `.github/workflows/update-leaderboard.yml` | hourly cron updates README |
| `.github/workflows/publish-cli.yml` | on tag v*: bake secret + npm publish |

---

## Task 1: Build-info module (placeholder constants)

**Files:**
- Create: `packages/cli/src/build-info.ts`

This module owns the constants the publish workflow rewrites. In dev/test it provides defaults that route to a local mock server. The publish workflow replaces it (via `sed`) with a version containing the real production values before `tsup build`.

- [ ] **Step 1: Create `packages/cli/src/build-info.ts`** with EXACTLY:

```ts
/**
 * Build-time constants. Default values target local dev / tests.
 * The publish workflow (.github/workflows/publish-cli.yml) regenerates this file with
 * production values before bundling, so the published bundle ships with real secrets.
 *
 * DO NOT IMPORT process.env IN THIS FILE — that defeats the build-time inlining.
 */

export const HMAC_SECRET = 'dev-secret-not-for-production';
export const INGEST_URL = 'http://localhost:18000/munch';
```

- [ ] **Step 2: Typecheck**

```
cd /Users/brian/Repos/OpenMuncher && npm run typecheck
```

Expected: clean.

- [ ] **Step 3: Commit**

```
git add packages/cli/src/build-info.ts
git commit -m "feat(cli): build-info constants for telemetry"
```

---

## Task 2: Telemetry module (TDD)

**Files:**
- Create: `packages/cli/test/telemetry.test.ts`
- Create: `packages/cli/src/telemetry.ts`

Telemetry: HMAC-sign the canonical JSON body bytes (the exact bytes we send), POST with a 2s timeout, one silent retry on failure, return `IngestResponse | null`. Tests use `vi.fn()` for fetch.

- [ ] **Step 1: Write the failing test**

`packages/cli/test/telemetry.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { sendTelemetry } from '../src/telemetry.js';
import type { MunchEvent } from '@openmuncher/shared';

const SECRET = 'test-secret';
const URL = 'https://example.test/munch';

const EVENT: MunchEvent = {
  v: 1,
  eventId: '11111111-2222-3333-4444-555555555555',
  nickname: 'brian',
  deviceId: '99999999-8888-7777-6666-555555555555',
  model: 'claude-haiku-4-5',
  inputTokens: 5000,
  outputTokensEst: 3510,
  costUsd: 0.018,
  ts: 1746460800,
};

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('sendTelemetry', () => {
  it('POSTs the canonical JSON body with an HMAC signature header', async () => {
    let capturedBody: string | undefined;
    let capturedSig: string | undefined;
    const fakeFetch = vi.fn(async (_url: string, init: RequestInit) => {
      capturedBody = init.body as string;
      capturedSig = (init.headers as Record<string, string>)['x-om-sig'];
      return new Response(JSON.stringify({ ok: true, globalTokens: 100, globalCostUsd: 1.5 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    const r = await sendTelemetry(EVENT, { url: URL, secret: SECRET, fetchFn: fakeFetch });

    expect(fakeFetch).toHaveBeenCalledTimes(1);
    expect(capturedBody).toBeTruthy();
    const expectedSig = createHmac('sha256', SECRET).update(capturedBody!).digest('hex');
    expect(capturedSig).toBe(expectedSig);
    expect(r).not.toBeNull();
    expect(r!.globalTokens).toBe(100);
    expect(r!.globalCostUsd).toBe(1.5);
  });

  it('returns null when fetch throws on both attempts', async () => {
    const fakeFetch = vi.fn(async () => {
      throw new Error('network down');
    });
    const r = await sendTelemetry(EVENT, { url: URL, secret: SECRET, fetchFn: fakeFetch });
    expect(fakeFetch).toHaveBeenCalledTimes(2);
    expect(r).toBeNull();
  });

  it('retries once and succeeds the second time', async () => {
    let n = 0;
    const fakeFetch = vi.fn(async () => {
      n++;
      if (n === 1) throw new Error('first try fails');
      return new Response(JSON.stringify({ ok: true, globalTokens: 7, globalCostUsd: 0.07 }), {
        status: 200,
      });
    });
    const r = await sendTelemetry(EVENT, { url: URL, secret: SECRET, fetchFn: fakeFetch });
    expect(fakeFetch).toHaveBeenCalledTimes(2);
    expect(r).not.toBeNull();
    expect(r!.globalTokens).toBe(7);
  });

  it('returns null on non-2xx response', async () => {
    const fakeFetch = vi.fn(async () =>
      new Response(JSON.stringify({ ok: false, error: 'bad sig' }), { status: 401 }),
    );
    const r = await sendTelemetry(EVENT, { url: URL, secret: SECRET, fetchFn: fakeFetch });
    expect(fakeFetch).toHaveBeenCalledTimes(2); // retried then gave up
    expect(r).toBeNull();
  });
});
```

- [ ] **Step 2: Run, FAIL**

```
npm test -- telemetry
```

- [ ] **Step 3: Implement `packages/cli/src/telemetry.ts`**

```ts
import { createHmac } from 'node:crypto';
import type { MunchEvent, IngestResponse } from '@openmuncher/shared';

const TIMEOUT_MS = 2000;

export interface TelemetryOptions {
  url: string;
  secret: string;
  /** Test seam. Defaults to the global fetch. */
  fetchFn?: typeof fetch;
}

export async function sendTelemetry(
  event: MunchEvent,
  opts: TelemetryOptions,
): Promise<IngestResponse | null> {
  const fetchFn = opts.fetchFn ?? fetch;
  const body = JSON.stringify(event);
  const sig = createHmac('sha256', opts.secret).update(body).digest('hex');

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      let res: Response;
      try {
        res = await fetchFn(opts.url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-om-sig': sig,
          },
          body,
          signal: ctrl.signal,
        });
      } finally {
        clearTimeout(timer);
      }
      if (!res.ok) continue; // try once more, then give up
      const json = (await res.json()) as IngestResponse;
      return json;
    } catch {
      // network error / abort — try again
    }
  }
  return null;
}
```

- [ ] **Step 4: Run, PASS**

```
npm test -- telemetry
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```
git add packages/cli
git commit -m "feat(cli): HMAC-signed telemetry POST with retry"
```

---

## Task 3: Wire telemetry into runMunch

**Files:**
- Modify: `packages/cli/src/munch.ts`
- Modify: `packages/cli/test/munch.test.ts`

Add the telemetry call inside `runMunch` after the local computation completes. Thread `globalTokens` / `globalCostUsd` into `MunchResult` so `index.ts` can hand them to `renderStats`. Also persist `lastGlobalTokens` / `lastGlobalCostUsd` into config for next-run "offline" display.

- [ ] **Step 1: Update `packages/cli/src/munch.ts` — replace its content with EXACTLY:**

```ts
import { randomUUID } from 'node:crypto';
import type { ModelId, MunchEvent } from '@openmuncher/shared';
import { computeCost } from '@openmuncher/shared';
import { detectModel } from './model-detector.js';
import { countTokens } from './tokenizer.js';
import { generatePayload } from './payload-generator.js';
import { tokensToConversions, wasteRating } from './conversions.js';
import { loadConfig, saveConfig, type Config } from './config.js';
import { sendTelemetry } from './telemetry.js';
import { HMAC_SECRET, INGEST_URL } from './build-info.js';

const TOKENS_PER_WORD = 1.35;
const OVERSHOOT = 1.3;
const INSTRUCTED_MIN_WORDS = 2000;

const INTENSITY_BANDS = {
  light: 2000,
  medium: 10_000,
  heavy: 50_000,
  nuclear: 200_000,
} as const;

export type Intensity = keyof typeof INTENSITY_BANDS;

export interface MunchArgs {
  tokens?: number;
  model?: ModelId;
  intensity?: Intensity;
  animation?: boolean;
}

export interface RunMunchOptions {
  home: string;
  env: NodeJS.ProcessEnv;
  argv: MunchArgs;
  askNickname: () => Promise<string>;
  seed?: string;
  /** Test seam: when set, telemetry uses this URL instead of the build-time INGEST_URL. */
  telemetryUrl?: string;
  /** Test seam: when set, telemetry uses this fetch instead of the global. */
  fetchFn?: typeof fetch;
}

export interface MunchResult {
  model: ModelId;
  inputTokens: number;
  outputTokensEst: number;
  inputCostUsd: number;
  outputCostUsdEst: number;
  totalCostUsd: number;
  rating: { score: number; label: string };
  conversions: ReturnType<typeof tokensToConversions>;
  payloadText: string;
  config: Config;
  globalTokens: number | null;
  globalCostUsd: number | null;
}

function pickTarget(args: MunchArgs): number {
  if (args.tokens) return args.tokens;
  if (args.intensity) return INTENSITY_BANDS[args.intensity];
  return 5000 + Math.floor(Math.random() * 20_001);
}

export async function runMunch(opts: RunMunchOptions): Promise<MunchResult> {
  let config = loadConfig(opts.home);
  if (!config) {
    const nickname = await opts.askNickname();
    config = {
      nickname,
      deviceId: randomUUID(),
      lifetimeTokens: 0,
      lifetimeCostUsd: 0,
      lastGlobalTokens: 0,
      lastGlobalCostUsd: 0,
    };
    saveConfig(opts.home, config);
  }

  const model: ModelId = opts.argv.model ?? detectModel(opts.env);
  const target = pickTarget(opts.argv);
  const seed = opts.seed ?? randomUUID();

  const { text } = generatePayload({
    targetInputTokens: target,
    model,
    seed,
    instructedMinWords: INSTRUCTED_MIN_WORDS,
  });

  const inputTokens = countTokens(text, model);
  const outputTokensEst = Math.round(INSTRUCTED_MIN_WORDS * TOKENS_PER_WORD * OVERSHOOT);
  const inputCostUsd = computeCost(inputTokens, 0, model);
  const outputCostUsdEst = computeCost(0, outputTokensEst, model);
  const totalCostUsd = computeCost(inputTokens, outputTokensEst, model);

  // Build telemetry event (must match the validator's wire-contract recompute exactly).
  const event: MunchEvent = {
    v: 1,
    eventId: randomUUID(),
    nickname: config.nickname,
    deviceId: config.deviceId,
    model,
    inputTokens,
    outputTokensEst,
    costUsd: totalCostUsd,
    ts: Math.floor(Date.now() / 1000),
  };

  const ingest = await sendTelemetry(event, {
    url: opts.telemetryUrl ?? INGEST_URL,
    secret: HMAC_SECRET,
    fetchFn: opts.fetchFn,
  });

  const globalTokens = ingest?.globalTokens ?? config.lastGlobalTokens ?? null;
  const globalCostUsd = ingest?.globalCostUsd ?? config.lastGlobalCostUsd ?? null;

  const updated: Config = {
    ...config,
    lifetimeTokens: config.lifetimeTokens + inputTokens + outputTokensEst,
    lifetimeCostUsd: round6(config.lifetimeCostUsd + totalCostUsd),
    lastGlobalTokens: ingest?.globalTokens ?? config.lastGlobalTokens,
    lastGlobalCostUsd: ingest?.globalCostUsd ?? config.lastGlobalCostUsd,
  };
  saveConfig(opts.home, updated);

  return {
    model,
    inputTokens,
    outputTokensEst,
    inputCostUsd,
    outputCostUsdEst,
    totalCostUsd,
    rating: wasteRating(totalCostUsd),
    conversions: tokensToConversions(inputTokens + outputTokensEst, totalCostUsd),
    payloadText: text,
    config: updated,
    globalTokens: ingest === null ? (config.lastGlobalTokens || null) : ingest.globalTokens,
    globalCostUsd: ingest === null ? (config.lastGlobalCostUsd || null) : ingest.globalCostUsd,
  };
}

function round6(n: number) { return Math.round(n * 1_000_000) / 1_000_000; }
```

- [ ] **Step 2: Update `packages/cli/test/munch.test.ts` — replace its content with EXACTLY:**

```ts
import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runMunch } from '../src/munch.js';

function fakeFetch(globalTokens = 999_999, globalCostUsd = 12.34): typeof fetch {
  return (async () =>
    new Response(JSON.stringify({ ok: true, globalTokens, globalCostUsd }), { status: 200 })) as typeof fetch;
}

function failingFetch(): typeof fetch {
  return (async () => { throw new Error('offline'); }) as typeof fetch;
}

describe('runMunch', () => {
  it('returns a fully populated result and includes server global counter', async () => {
    const home = mkdtempSync(join(tmpdir(), 'om-'));
    const result = await runMunch({
      home,
      env: { CLAUDE_CODE_MODEL: 'claude-haiku-4-5' },
      argv: { tokens: 3000, model: undefined, intensity: undefined, animation: false },
      askNickname: vi.fn().mockResolvedValue('brian'),
      seed: 'unit-test',
      telemetryUrl: 'https://example.test/munch',
      fetchFn: fakeFetch(),
    });
    expect(result.model).toBe('claude-haiku-4-5');
    expect(result.inputTokens).toBeGreaterThan(2700);
    expect(result.inputTokens).toBeLessThan(3300);
    expect(result.payloadText.toLowerCase()).toContain('do not summarize');
    expect(result.config.nickname).toBe('brian');
    expect(result.globalTokens).toBe(999_999);
    expect(result.globalCostUsd).toBe(12.34);
    expect(result.config.lastGlobalTokens).toBe(999_999);
  });

  it('reuses an existing config without prompting', async () => {
    const home = mkdtempSync(join(tmpdir(), 'om-'));
    const fs = await import('node:fs');
    fs.mkdirSync(join(home, '.openmuncher'), { recursive: true });
    fs.writeFileSync(
      join(home, '.openmuncher', 'config.json'),
      JSON.stringify({
        nickname: 'existing',
        deviceId: '11111111-1111-1111-1111-111111111111',
        lifetimeTokens: 0,
        lifetimeCostUsd: 0,
        lastGlobalTokens: 555,
        lastGlobalCostUsd: 5.55,
      }),
    );
    const ask = vi.fn();
    const result = await runMunch({
      home,
      env: {},
      argv: { tokens: 2000, model: undefined, intensity: undefined, animation: false },
      askNickname: ask,
      seed: 'unit-test-2',
      telemetryUrl: 'https://example.test/munch',
      fetchFn: fakeFetch(2_000_000, 50),
    });
    expect(ask).not.toHaveBeenCalled();
    expect(result.config.nickname).toBe('existing');
    expect(result.globalTokens).toBe(2_000_000);
  });

  it('falls back to last cached global on telemetry failure', async () => {
    const home = mkdtempSync(join(tmpdir(), 'om-'));
    const fs = await import('node:fs');
    fs.mkdirSync(join(home, '.openmuncher'), { recursive: true });
    fs.writeFileSync(
      join(home, '.openmuncher', 'config.json'),
      JSON.stringify({
        nickname: 'cached-user',
        deviceId: '11111111-1111-1111-1111-111111111111',
        lifetimeTokens: 0,
        lifetimeCostUsd: 0,
        lastGlobalTokens: 1234,
        lastGlobalCostUsd: 9.99,
      }),
    );
    const result = await runMunch({
      home,
      env: {},
      argv: { tokens: 2000, model: undefined, intensity: undefined, animation: false },
      askNickname: vi.fn(),
      seed: 'offline-test',
      telemetryUrl: 'https://example.test/munch',
      fetchFn: failingFetch(),
    });
    expect(result.globalTokens).toBe(1234);
    expect(result.globalCostUsd).toBe(9.99);
  });

  it('updates lifetime totals after a run', async () => {
    const home = mkdtempSync(join(tmpdir(), 'om-'));
    const result = await runMunch({
      home,
      env: {},
      argv: { tokens: 2000, model: undefined, intensity: undefined, animation: false },
      askNickname: vi.fn().mockResolvedValue('brian'),
      seed: 'unit-test-3',
      telemetryUrl: 'https://example.test/munch',
      fetchFn: fakeFetch(),
    });
    expect(result.config.lifetimeTokens).toBe(result.inputTokens + result.outputTokensEst);
    expect(result.config.lifetimeCostUsd).toBeCloseTo(result.totalCostUsd, 6);
  });
});
```

- [ ] **Step 3: Run all tests**

```
npm test
```

Expected: all tests pass (the four munch tests + everything else from Plan 1/2). Ingest unit tests still pass because they don't go through `runMunch`.

- [ ] **Step 4: Typecheck**

```
npm run typecheck
```

Expected: clean.

- [ ] **Step 5: Commit**

```
git add packages/cli
git commit -m "feat(cli): wire telemetry POST into runMunch"
```

---

## Task 4: Update bin entrypoint to surface global counter

**Files:**
- Modify: `packages/cli/src/index.ts`

The `index.ts` previously passed `globalTokens: null, globalCostUsd: null` to `renderStats`. Now it should pass the values from `result.globalTokens` / `result.globalCostUsd`.

- [ ] **Step 1: Replace `packages/cli/src/index.ts`** with EXACTLY:

```ts
import { parseArgs } from 'node:util';
import { homedir } from 'node:os';
import { runMunch, type MunchArgs, type Intensity } from './munch.js';
import { askNickname } from './prompts.js';
import { runAnimation } from './animation.js';
import { renderStats } from './stats-renderer.js';
import type { ModelId } from '@openmuncher/shared';
import { KNOWN_MODELS } from '@openmuncher/shared';

const VALID_INTENSITIES: ReadonlyArray<Intensity> = ['light', 'medium', 'heavy', 'nuclear'];

function parse(): MunchArgs & { animation: boolean } {
  const { values } = parseArgs({
    options: {
      tokens: { type: 'string' },
      model: { type: 'string' },
      intensity: { type: 'string' },
      'no-animation': { type: 'boolean', default: false },
    },
    strict: false,
  });

  const tokens = values.tokens ? Number(values.tokens) : undefined;
  if (tokens !== undefined && (!Number.isFinite(tokens) || tokens <= 0)) {
    throw new Error(`--tokens must be a positive number, got: ${values.tokens}`);
  }

  let model: ModelId | undefined;
  if (values.model) {
    if (!(KNOWN_MODELS as readonly string[]).includes(values.model as string)) {
      throw new Error(`--model must be one of: ${KNOWN_MODELS.join(', ')}`);
    }
    model = values.model as ModelId;
  }

  let intensity: Intensity | undefined;
  if (values.intensity) {
    if (!VALID_INTENSITIES.includes(values.intensity as Intensity)) {
      throw new Error(`--intensity must be one of: ${VALID_INTENSITIES.join(', ')}`);
    }
    intensity = values.intensity as Intensity;
  }

  return { tokens, model, intensity, animation: !values['no-animation'] };
}

async function main() {
  const argv = parse();
  const result = await runMunch({
    home: homedir(),
    env: process.env,
    argv: { tokens: argv.tokens, model: argv.model, intensity: argv.intensity },
    askNickname,
  });

  process.stdout.write(result.payloadText);
  await runAnimation({ disabled: !argv.animation });

  const rendered = renderStats({
    model: result.model,
    inputTokens: result.inputTokens,
    inputCostUsd: result.inputCostUsd,
    outputTokensEst: result.outputTokensEst,
    outputCostUsdEst: result.outputCostUsdEst,
    totalCostUsd: result.totalCostUsd,
    rating: result.rating,
    conversions: result.conversions,
    lifetimeTokens: result.config.lifetimeTokens,
    lifetimeCostUsd: result.config.lifetimeCostUsd,
    globalTokens: result.globalTokens,
    globalCostUsd: result.globalCostUsd,
  });
  process.stdout.write(rendered);
}

main().catch((err) => {
  process.stderr.write(`openmuncher: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
```

- [ ] **Step 2: Build and typecheck**

```
cd /Users/brian/Repos/OpenMuncher && npm run typecheck && npm run -w @openmuncher/cli build
```

Both should succeed.

- [ ] **Step 3: Commit**

```
git add packages/cli
git commit -m "feat(cli): pass global counter from telemetry to stats footer"
```

---

## Task 5: README updater package skeleton

**Files:**
- Create: `packages/readme-updater/package.json`
- Create: `packages/readme-updater/tsconfig.json`
- Create: `packages/readme-updater/src/index.ts` (placeholder; populated in Task 7)

- [ ] **Step 1: Create `packages/readme-updater/package.json`**

```json
{
  "name": "@openmuncher/readme-updater",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "tsx src/index.ts",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@openmuncher/shared": "*"
  }
}
```

- [ ] **Step 2: Create `packages/readme-updater/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "types": ["node"]
  },
  "include": ["src/**/*"],
  "references": [{ "path": "../shared" }]
}
```

- [ ] **Step 3: Create `packages/readme-updater/src/index.ts`** with the placeholder:

```ts
export {};
```

- [ ] **Step 4: Install + typecheck**

```
cd /Users/brian/Repos/OpenMuncher && npm install && npm run typecheck
```

Both clean.

- [ ] **Step 5: Commit**

```
git add packages/readme-updater package.json package-lock.json
git commit -m "feat(readme-updater): create @openmuncher/readme-updater workspace"
```

---

## Task 6: Markdown render module (TDD)

**Files:**
- Create: `packages/readme-updater/test/render.test.ts`
- Create: `packages/readme-updater/src/render.ts`

The renderer takes a `LeaderboardResponse` and produces the markdown block that lives between the `<!-- LEADERBOARD:START -->` / `END` markers. Must be deterministic given identical input (so the workflow can detect no-ops via `git diff`).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { renderLeaderboardBlock } from '../src/render.js';
import type { LeaderboardResponse } from '@openmuncher/shared';

const FIXTURE: LeaderboardResponse = {
  globalTokens: 1_847_392_108,
  globalCostUsd: 42_180.91,
  topUsers: [
    { nickname: 'brian', totalTokens: 12_847_213, totalCostUsd: 384.21, munchCount: 412 },
    { nickname: 'alice', totalTokens: 4_001_002, totalCostUsd: 100.0, munchCount: 50 },
    { nickname: 'bob', totalTokens: 1_234_567, totalCostUsd: 30.5, munchCount: 12 },
  ],
  generatedAt: '2026-05-05T14:00:00.000Z',
};

describe('renderLeaderboardBlock', () => {
  it('produces a stable snapshot for known input', () => {
    expect(renderLeaderboardBlock(FIXTURE)).toMatchInlineSnapshot();
  });

  it('renders rank emojis for top 3', () => {
    const out = renderLeaderboardBlock(FIXTURE);
    expect(out).toContain('🥇');
    expect(out).toContain('🥈');
    expect(out).toContain('🥉');
  });

  it('renders thousands separators on numbers', () => {
    const out = renderLeaderboardBlock(FIXTURE);
    expect(out).toContain('12,847,213');
    expect(out).toContain('1,847,392,108');
    expect(out).toContain('$42,180.91');
  });

  it('handles an empty leaderboard', () => {
    const out = renderLeaderboardBlock({
      globalTokens: 0,
      globalCostUsd: 0,
      topUsers: [],
      generatedAt: '2026-05-05T14:00:00.000Z',
    });
    expect(out).toContain('No munches yet');
  });

  it('is deterministic — same input produces same output', () => {
    const a = renderLeaderboardBlock(FIXTURE);
    const b = renderLeaderboardBlock(FIXTURE);
    expect(a).toBe(b);
  });
});
```

- [ ] **Step 2: Run, FAIL**

```
npm test -- render
```

- [ ] **Step 3: Implement `packages/readme-updater/src/render.ts`**

```ts
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
```

- [ ] **Step 4: Run with `-u`**

```
npm test -- render -u
```

Expected: snapshot fills in, all 5 tests pass.

- [ ] **Step 5: Re-run without `-u`**

```
npm test -- render
```

Expected: 5 tests pass.

- [ ] **Step 6: Commit**

```
git add packages/readme-updater
git commit -m "feat(readme-updater): markdown renderer for leaderboard block"
```

---

## Task 7: Updater entrypoint (TDD)

**Files:**
- Create: `packages/readme-updater/test/index.test.ts`
- Modify: `packages/readme-updater/src/index.ts`

The script: read URL from `LEADERBOARD_URL` env var, fetch, render, splice into a README.md path passed via `README_PATH` env var (defaults to repo-root README.md).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { updateReadme } from '../src/index.js';
import type { LeaderboardResponse } from '@openmuncher/shared';

const FIXTURE: LeaderboardResponse = {
  globalTokens: 100,
  globalCostUsd: 1,
  topUsers: [{ nickname: 'a', totalTokens: 10, totalCostUsd: 1, munchCount: 1 }],
  generatedAt: '2026-05-05T14:00:00.000Z',
};

const README_TEMPLATE = `# Test
Foo bar

<!-- LEADERBOARD:START -->
*old content*
<!-- LEADERBOARD:END -->

Trailing.
`;

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'om-readme-'));
});

function fakeFetch(payload: LeaderboardResponse): typeof fetch {
  return (async () => new Response(JSON.stringify(payload), { status: 200 })) as typeof fetch;
}

describe('updateReadme', () => {
  it('replaces the leaderboard block in-place', async () => {
    const path = join(dir, 'README.md');
    writeFileSync(path, README_TEMPLATE);
    await updateReadme({
      readmePath: path,
      leaderboardUrl: 'https://example.test/leaderboard',
      fetchFn: fakeFetch(FIXTURE),
    });
    const out = readFileSync(path, 'utf8');
    expect(out).toContain('<!-- LEADERBOARD:START -->');
    expect(out).toContain('<!-- LEADERBOARD:END -->');
    expect(out).toContain('a'); // nickname rendered
    expect(out).not.toContain('*old content*');
    expect(out.startsWith('# Test')).toBe(true);
    expect(out.endsWith('Trailing.\n')).toBe(true);
  });

  it('throws if start marker is missing', async () => {
    const path = join(dir, 'README.md');
    writeFileSync(path, '# Test\nNo markers\n');
    await expect(
      updateReadme({
        readmePath: path,
        leaderboardUrl: 'https://example.test/leaderboard',
        fetchFn: fakeFetch(FIXTURE),
      }),
    ).rejects.toThrow(/marker/i);
  });

  it('throws on non-2xx fetch', async () => {
    const path = join(dir, 'README.md');
    writeFileSync(path, README_TEMPLATE);
    const failingFetch = (async () => new Response('nope', { status: 500 })) as typeof fetch;
    await expect(
      updateReadme({
        readmePath: path,
        leaderboardUrl: 'https://example.test/leaderboard',
        fetchFn: failingFetch,
      }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run, FAIL**

```
npm test -- packages/readme-updater
```

- [ ] **Step 3: Replace `packages/readme-updater/src/index.ts`** with EXACTLY:

```ts
import { readFileSync, writeFileSync } from 'node:fs';
import type { LeaderboardResponse } from '@openmuncher/shared';
import { renderLeaderboardBlock } from './render.js';

const START_MARKER = '<!-- LEADERBOARD:START -->';
const END_MARKER = '<!-- LEADERBOARD:END -->';

export interface UpdateOptions {
  readmePath: string;
  leaderboardUrl: string;
  fetchFn?: typeof fetch;
}

export async function updateReadme(opts: UpdateOptions): Promise<void> {
  const fetchFn = opts.fetchFn ?? fetch;
  const res = await fetchFn(opts.leaderboardUrl);
  if (!res.ok) {
    throw new Error(`leaderboard fetch failed: ${res.status}`);
  }
  const data = (await res.json()) as LeaderboardResponse;
  const block = renderLeaderboardBlock(data);

  const current = readFileSync(opts.readmePath, 'utf8');
  const startIdx = current.indexOf(START_MARKER);
  const endIdx = current.indexOf(END_MARKER);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    throw new Error('LEADERBOARD start/end marker not found in README');
  }
  const next =
    current.slice(0, startIdx + START_MARKER.length) +
    '\n' +
    block +
    '\n' +
    current.slice(endIdx);
  writeFileSync(opts.readmePath, next, 'utf8');
}

async function main() {
  const url = process.env.LEADERBOARD_URL;
  if (!url) {
    process.stderr.write('LEADERBOARD_URL env var required\n');
    process.exit(2);
  }
  const path = process.env.README_PATH ?? 'README.md';
  await updateReadme({ readmePath: path, leaderboardUrl: url });
}

// Run main only when executed directly (not when imported by tests).
const isMain = (() => {
  try {
    const argv1 = process.argv[1];
    if (!argv1) return false;
    return import.meta.url === new URL(`file://${argv1}`).href;
  } catch {
    return false;
  }
})();
if (isMain) {
  main().catch((err) => {
    process.stderr.write(`readme-updater: ${err?.message ?? err}\n`);
    process.exit(1);
  });
}
```

- [ ] **Step 4: Run, PASS**

```
npm test -- packages/readme-updater
```

Expected: 3 tests pass (in this file) + 5 from render.test.ts = 8 tests in the package.

- [ ] **Step 5: Commit**

```
git add packages/readme-updater
git commit -m "feat(readme-updater): fetch + splice entrypoint"
```

---

## Task 8: ci.yml workflow

**Files:**
- Create: `.github/workflows/ci.yml`

PR validation: typecheck + tests across all workspaces. Skips Docker integration since GitHub-hosted runners support it but it adds runtime — keep it for the deploy workflow rather than every PR.

- [ ] **Step 1: Create `.github/workflows/ci.yml`** with EXACTLY:

```yaml
name: ci

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

permissions:
  contents: read

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run typecheck
      - name: Run unit tests (excluding integration)
        run: npx vitest run --exclude '**/integration.test.ts'
      - name: Build CLI
        run: npm run -w @openmuncher/cli build
```

- [ ] **Step 2: Commit**

```
git add .github/workflows/ci.yml
git commit -m "ci: typecheck + tests + build on PR/main"
```

---

## Task 9: update-leaderboard.yml workflow

**Files:**
- Create: `.github/workflows/update-leaderboard.yml`

Hourly cron + manual dispatch. Fetches the leaderboard, runs the updater, commits if changed.

- [ ] **Step 1: Create `.github/workflows/update-leaderboard.yml`** with EXACTLY:

```yaml
name: update-leaderboard

on:
  schedule:
    - cron: '0 * * * *'
  workflow_dispatch:

permissions:
  contents: write

concurrency:
  group: update-leaderboard
  cancel-in-progress: true

jobs:
  update:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          token: ${{ secrets.GITHUB_TOKEN }}

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - run: npm ci

      - name: Update README
        env:
          LEADERBOARD_URL: ${{ vars.LEADERBOARD_URL }}
          README_PATH: README.md
        run: npm run -w @openmuncher/readme-updater start

      - name: Commit if changed
        run: |
          if git diff --quiet README.md; then
            echo "No leaderboard changes."
            exit 0
          fi
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add README.md
          git commit -m "chore: leaderboard $(date -u +%Y-%m-%dT%H:%M)"
          git push
```

(Uses a GitHub Actions repository variable `LEADERBOARD_URL`, set to the production CloudFront URL once Plan 2's stack is deployed.)

- [ ] **Step 2: Commit**

```
git add .github/workflows/update-leaderboard.yml
git commit -m "ci: hourly leaderboard README updater"
```

---

## Task 10: publish-cli.yml workflow

**Files:**
- Create: `.github/workflows/publish-cli.yml`

On tag `v*`: bake HMAC secret + ingest URL into `build-info.ts`, build, npm publish.

- [ ] **Step 1: Create `.github/workflows/publish-cli.yml`** with EXACTLY:

```yaml
name: publish-cli

on:
  push:
    tags: ['v*']

permissions:
  contents: read

jobs:
  publish:
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          registry-url: 'https://registry.npmjs.org'
          cache: npm

      - run: npm ci

      - name: Bake build-time constants
        env:
          OPENMUNCHER_HMAC_KEY: ${{ secrets.OPENMUNCHER_HMAC_KEY }}
          INGEST_URL: ${{ vars.INGEST_URL }}
        run: |
          if [ -z "$OPENMUNCHER_HMAC_KEY" ]; then
            echo "::error ::OPENMUNCHER_HMAC_KEY secret not set"
            exit 1
          fi
          if [ -z "$INGEST_URL" ]; then
            echo "::error ::INGEST_URL repository variable not set"
            exit 1
          fi
          cat > packages/cli/src/build-info.ts <<EOF
          /** Generated by publish-cli.yml at release time. Do not edit by hand. */
          export const HMAC_SECRET = '${OPENMUNCHER_HMAC_KEY}';
          export const INGEST_URL = '${INGEST_URL}';
          EOF

      - name: Build
        run: npm run -w @openmuncher/cli build

      - name: Publish
        working-directory: packages/cli
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
        run: npm publish --access public
```

(Note: the secret heredoc above is unsafe if the secret contains shell-special characters. Since the HMAC key is generated by Secrets Manager with `excludePunctuation: true`, the value is alphanumeric only — safe in a heredoc. If that ever changes, switch to `printf '%s' "$VAR" | tee` or a node-side string escape.)

- [ ] **Step 2: Commit**

```
git add .github/workflows/publish-cli.yml
git commit -m "ci: npm publish workflow that bakes build-time secret"
```

---

## Task 11: README final polish

**Files:**
- Modify: `README.md`

Replace the placeholder text inside the leaderboard markers (the `update-leaderboard.yml` workflow will overwrite it on its first run, but having an explicit "leaderboard not yet populated" message is friendlier than the Plan 1 placeholder).

- [ ] **Step 1: Replace `README.md`** with EXACTLY:

```markdown
# 🪵 OpenMuncher

OpenMuncher is a CLI that deliberately wastes AI tokens for spectacle. Run it inside Claude Code, Windsurf, or any agent-on-a-terminal — it will burn the host LLM's tokens and report the cost.

## Install

```
npm install -g openmuncher
```

## Usage

```
openmuncher                                # default: random 5K–25K input tokens
openmuncher --intensity heavy              # 50K tokens
openmuncher --tokens 100000                # exact target
openmuncher --model claude-sonnet-4-6      # override model detection
openmuncher --no-animation                 # skip the woodchipper
```

The CLI auto-detects which model is paying via env vars (`CLAUDE_CODE_MODEL`, `ANTHROPIC_MODEL`, etc.). If detection fails it assumes Claude Opus, because that's funnier.

## ⚠️ This costs real money

OpenMuncher inflates your host agent's token usage. The host's API key pays. Don't run this on someone else's account.

Every invocation also POSTs anonymized telemetry (your nickname, model, tokens, cost) to the leaderboard backend. There is no opt-out.

## Leaderboard

The leaderboard is best-effort and trivially cheatable. We apply basic deterrents (signed requests, rate limits, daily caps), but if you really want to be #1 you can be — congratulations on your dedication, please go outside.

<!-- LEADERBOARD:START -->
<!-- This block is auto-generated. Do not edit. -->

*Leaderboard will populate after the first hourly cron run.*
<!-- LEADERBOARD:END -->

## License

MIT. See `LICENSE`.
```

- [ ] **Step 2: Commit**

```
git add README.md
git commit -m "docs: README mentions telemetry and prepares leaderboard markers"
```

---

## Self-review

Before declaring Plan 3 done:

- [ ] All 11 tasks committed.
- [ ] `npm test` from repo root passes (everything across all 4 workspaces).
- [ ] `npm run typecheck` passes.
- [ ] `npm run -w @openmuncher/cli build` succeeds.
- [ ] LEADERBOARD markers in README.md are intact.
- [ ] Spec coverage:
  - Telemetry POST + HMAC sign: ✅ Task 2
  - runMunch surfaces global counter: ✅ Task 3
  - Stats footer shows global counter (already wired in P1; just no longer null): ✅ Task 4
  - README leaderboard rendering: ✅ Tasks 6, 7
  - GitHub Actions: ci.yml ✅ Task 8, update-leaderboard.yml ✅ Task 9, publish-cli.yml ✅ Task 10, deploy-infra.yml ✅ from Plan 2

---

## What's next (post-Plan 3)

- Manual `cdk deploy` from a sandbox AWS account to verify the full system.
- Set the `OPENMUNCHER_HMAC_KEY` GitHub Secret to the value of the deployed Secrets Manager secret. Set `LEADERBOARD_URL` and `INGEST_URL` repo variables to the CloudFront URLs.
- Tag `v0.1.0` to trigger first publish.
- Validate end-to-end: install `openmuncher` in a fresh Claude Code session, run, observe stats footer, watch the next hourly README update.
