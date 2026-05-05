# OpenMuncher — Design

**Status:** Draft
**Date:** 2026-05-05
**Author:** Brian Shand

## One-line pitch

OpenMuncher is a CLI that, when run inside Claude Code / Windsurf / any agent-on-a-terminal, deliberately wastes the host LLM's tokens for spectacle, reports the cost, and submits the burn to a public leaderboard rendered into this repo's README.

## Goals

- Make the cost of AI tokens visible and absurd.
- Provide a single-command burn primitive (after a one-time first-run prompt) that runs inside any agentic CLI host.
- Aggregate global waste statistics and a top-wasters leaderboard, published in this repo's `README.md`.
- Stay funny.

## Non-goals (v1)

- Standalone web frontend or hosted dashboard.
- Multi-provider API key management. The CLI does not call any LLM directly; the host agent does.
- Cryptographic proof-of-burn or trust-minimized leaderboard.
- Account auth (GitHub OAuth, sign-in). Nicknames are honor-system.
- Achievement badges, shareable summary cards, per-model leaderboard splits — captured as data, deferred for surfacing.
- Mac/Windows/Linux installer. Distribution is npm only.

## Burn mechanism

OpenMuncher does **not** hold an API key. It runs as a subprocess of the host agent (Claude Code, Windsurf, etc.) which already has a key. The CLI causes burn by emitting output the host must consume:

1. **Inflate input tokens.** The CLI prints a large junk payload (lorem ipsum, redundant instructions, structured-shaped nonsense, decorative ASCII) sized to the chosen intensity. The host LLM ingests it as tool output on the next turn.
2. **Inflate output tokens.** The payload includes a header instruction ordering the host LLM to expand verbosely, refuse to summarize, and produce a minimum word count of follow-up commentary. The host LLM obliges and burns its own output budget.

Because we never see the host's actual API call, output tokens are *estimated* (instructed-minimum × overshoot constant) and labelled `(est.)` in all stats and telemetry.

## CLI

### Distribution

- npm package, single workspace `@openmuncher/cli`, published as `openmuncher`.
- Install: `npm install -g openmuncher`.
- One-shot. No companion plugin or skill.

### Run flow

When the user invokes `openmuncher`:

1. **Load config** from `~/.openmuncher/config.json`. If absent, run **first-run prompt**:
   - "🪵 OpenMuncher — first run. Suggest a leaderboard nickname (your GitHub username is fine):"
   - Empty input → `anonymous`.
   - Save `{ nickname, deviceId: <uuid v4> }`.
2. **Detect host model.** Read environment variables in order:
   `OPENMUNCHER_MODEL`, `CLAUDE_CODE_MODEL`, `ANTHROPIC_MODEL`, `WINDSURF_MODEL`, `CURSOR_MODEL`.
   Fall back to `claude-opus-4-7` ("we assume you're using the most expensive model, because that's funnier").
   `--model <id>` flag overrides.
3. **Pick intensity.** Default: random in 5,000–25,000 input tokens.
   `--intensity=light|medium|heavy|nuclear` → fixed bands 2K / 10K / 50K / 200K.
   `--tokens=N` → exact target.
4. **Generate burn payload** with these components:
   - Header instruction block ordering verbose expansion (≥ 2,000-word follow-up).
   - Body of mixed nonsense (lorem ipsum, fake redundant instructions, JSON-shaped gibberish, ASCII tree-trunk decorations) sized via tokenizer-driven loop until target ± 5%.
5. **Tokenize** with the right backend per model:
   - `claude-*` → `@anthropic-ai/tokenizer`
   - `gpt-*` / `o*` → `tiktoken`
   - else → char/4 estimator
   Produces exact `inputTokens`.
6. **Estimate** `outputTokensEst` as `instructed_min_words × TOKENS_PER_WORD × OVERSHOOT`. Constants pinned: `TOKENS_PER_WORD = 1.35`, `OVERSHOOT = 1.3`. (e.g., 2,000-word minimum → 2,000 × 1.35 × 1.3 ≈ 3,510 tokens.) Labelled `(est.)` everywhere.
7. **Render to stdout**:
   - The full burn payload (so the host LLM consumes it).
   - ASCII woodchipper animation (~800 ms; skipped when stdout is non-TTY or `--no-animation`).
   - Stats footer:
     - Model
     - Input tokens + cost
     - Output tokens (est.) + cost (est.)
     - Total cost
     - Waste rating (arbitrary 0–10 funny score)
     - Absurd conversions (trees, coffees, GPU seconds, ocean mL)
     - Lifetime totals (from local config / cached server response)
     - Global counter (returned by ingest endpoint)
8. **Telemetry POST** to `https://api.openmuncher.dev/munch`. Fire-and-forget, 2 s timeout, one silent retry, then drop. Never blocks user-visible output. Response carries the new global total to display next time.

### Config file

`~/.openmuncher/config.json`:

```json
{
  "nickname": "brian",
  "deviceId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "lifetimeTokens": 2_100_034,
  "lifetimeCostUsd": 48.71,
  "lastGlobalTokens": 893_421_044,
  "lastGlobalCostUsd": 19_847.12
}
```

## Backend

### Topology

```
client → CloudFront (WAF Web ACL) → Lambda Function URL → Lambda → DynamoDB
```

Two Lambdas:

| Method | Path | Lambda |
|--------|------|--------|
| POST   | `/munch` | `ingest` |
| GET    | `/leaderboard?limit=20` | `leaderboard` |

CloudFront fronts both Function URLs from day 1. WAF Web ACL: AWS managed Common Rule Set + Known Bad Inputs + a rate-based rule (2,000 req / 5 min per IP).

Custom domain `api.openmuncher.dev` via ACM cert is **deferred**; v1 ships on `*.cloudfront.net`.

### POST /munch

Request body:

```json
{
  "v": 1,
  "eventId": "<uuid v4>",
  "nickname": "brian",
  "deviceId": "<uuid v4>",
  "model": "claude-opus-4-7",
  "inputTokens": 17432,
  "outputTokensEst": 3510,
  "costUsd": 0.5249,
  "ts": 1746460800
}
```

Header: `X-OM-Sig: <hex hmac-sha256(secret, raw_body_bytes)>`.

The signed bytes are exactly the HTTP request body bytes as transmitted, with no canonicalization on either side. The server hashes the raw bytes it received; the client hashes the bytes it is about to send. This avoids ambiguity around JSON whitespace, key ordering, or Unicode normalization.

Response:

```json
{ "ok": true, "globalTokens": 893421044, "globalCostUsd": 19847.12 }
```

### GET /leaderboard

Response:

```json
{
  "globalTokens": 1847392108,
  "globalCostUsd": 42180.91,
  "topUsers": [
    { "nickname": "brian", "totalTokens": 12847213, "totalCostUsd": 384.21, "munchCount": 412 },
    ...
  ],
  "generatedAt": "2026-05-05T14:00:00Z"
}
```

CloudFront caches this for 60 s.

### DynamoDB schema — single table `openmuncher`

On-demand billing. Point-in-time recovery on.

| Entity | PK | SK | Attributes |
|--------|----|----|------------|
| Event | `EVENT#<eventId>` | `EVENT` | nickname, model, inputTokens, outputTokensEst, costUsd, ts, deviceId. TTL 90 d. |
| User aggregate | `USER#<nickname>` | `AGG` | totalTokens, totalCostUsd, munchCount, leaderboardTokens, leaderboardDate, lastMunchTs, rateWindow, rateCount |
| Counter shard | `COUNTER#GLOBAL` | `SHARD#<0..9>` | tokens, costUsd |
| Ban entry | `BANNED#<nickname>` | `BAN` | reason, ts |

GSI `top-users-index`:
- PK = `"USERS"` (constant)
- SK = `leaderboardTokens` (numeric, descending sort on query)
- Projection: nickname, totalTokens, totalCostUsd, munchCount

This GSI exists only on `USER#*` items. Constant PK is acceptable because writes to it are bounded by (unique users × munch frequency), well under DynamoDB partition limits.

The **counter shard** approach kills the global-counter hot-key problem: the CLI's update goes to a random shard 0–9; reads sum all 10 in parallel via `BatchGetItem`.

### ingest Lambda flow

1. Verify HMAC (`crypto.timingSafeEqual`). Mismatch → 401.
2. Validate body shape and bounds:
   - `v == 1`
   - `nickname` matches `^[a-zA-Z0-9._-]{1,39}$`
   - `model` in known model list (server-side allow-list)
   - `inputTokens` in [100, 1_000_000]
   - `outputTokensEst` in [0, 2_000_000]
   - `costUsd` in [0, 1000]
   - `costUsd` equals `round((inputTokens × inputPrice + outputTokensEst × outputPrice) / 1_000_000, 6)` using the server's pricing table for `model`. Exact match required (no tolerance) — both sides perform the same rounded computation. Mismatch indicates a tampered client.
   - `ts` within 5 minutes of server time
   On failure → 400.
3. Check ban list (point-read on `BANNED#<nickname>`, cache in Lambda warm container for 60 s). If banned, still record event (audit) but do not update aggregates.
4. Application-level rate-limit check on `USER#<nickname>` aggregate. `rateWindow` is the integer epoch-minute bucket; `rateCount` is the number of events in that bucket.
   - Compute `currentBucket = floor(serverTime / 60)`.
   - Conditional update with two branches (one `UpdateItem` with a single `ConditionExpression` per branch, executed via try/catch):
     a. **Same bucket:** condition `rateWindow = :currentBucket AND rateCount < 60` → `ADD rateCount 1`. If condition fails because `rateCount >= 60`, return 429.
     b. **New bucket:** condition `attribute_not_exists(rateWindow) OR rateWindow < :currentBucket` → `SET rateWindow = :currentBucket, rateCount = 1`.
   - The two branches are tried in order; whichever succeeds is the effective update.
5. `TransactWrite`:
   - `Put` Event with `attribute_not_exists(PK)` (idempotency on retried requests).
   - `Update` user aggregate with `ADD` clauses for totals + munchCount; `ADD leaderboardTokens` capped at daily 10M; rotate `leaderboardDate` if UTC day rolled over.
   - `Update` random Counter shard with `ADD` for tokens and costUsd.
6. `BatchGetItem` all 10 counter shards, sum, return as `globalTokens` / `globalCostUsd`.

`ConditionalCheckFailedException` on the Event put → return `{ ok: true }` with current totals (idempotent retry).

### leaderboard Lambda flow

1. Query GSI `top-users-index`, descending, `limit = min(requested, 100)`.
2. Filter out users present in the ban list (small set; loaded from a single Scan-on-cold-start, refreshed every 60 s).
3. `BatchGetItem` 10 counter shards, sum.
4. Return JSON. CloudFront cache: 60 s.

## Telemetry security & abuse handling

### HMAC signing

- Single shared secret stored in AWS Secrets Manager.
- Inlined into the published CLI bundle at build time from `OPENMUNCHER_HMAC_KEY` (GitHub secret).
- Lambda recomputes and compares with `crypto.timingSafeEqual`.
- Rotation: bump secret, ship a new CLI release; server may hold a small set of valid keys during overlap windows.
- **Threat model:** the secret is trivially extractable from the published bundle. We accept that. It deters drive-by curl, not committed cheaters.

### Replay & duplicate prevention

- Every event has a CLI-generated `eventId` (UUID v4).
- DynamoDB write uses `ConditionExpression: attribute_not_exists(PK)` on `EVENT#<eventId>` — retried requests with the same eventId are absorbed.
- Events older than 5 minutes by client `ts` are rejected.

### Sanity bounds

Listed under `ingest Lambda flow → step 2`.

### Rate limiting

- **WAF rate-based rule:** 2,000 req / 5 min per IP.
- **Application:** per-(deviceId, nickname) 1-minute rolling counter on the user aggregate; cap 60 events/min → 429.

### Anti-cheat soft caps

- Per-user `leaderboardTokens` capped at 10M tokens per UTC day. Excess is recorded in events but does not move the leaderboard.
- Manual ban list (`BANNED#<nickname>` items). Banned users continue to record events but are filtered from leaderboard reads.

### README transparency notice

The README will state plainly that the leaderboard is best-effort and trivially cheatable, and that we apply basic deterrents but anyone determined to be #1 can be — defusing the prize for griefers.

## Repo layout

```
OpenMuncher/
├── packages/
│   ├── cli/             # @openmuncher/cli — published as `openmuncher`
│   │   ├── src/
│   │   │   ├── index.ts                # bin entrypoint
│   │   │   ├── munch.ts                # orchestrates a single run
│   │   │   ├── payload-generator.ts
│   │   │   ├── tokenizer.ts            # @anthropic-ai/tokenizer + tiktoken + estimator
│   │   │   ├── model-detector.ts
│   │   │   ├── pricing.ts              # model id → $/1M tokens
│   │   │   ├── conversions.ts          # tokens → trees/coffees/GPU-seconds/ocean
│   │   │   ├── animation.ts            # ASCII woodchipper
│   │   │   ├── config.ts
│   │   │   ├── telemetry.ts            # HMAC + POST
│   │   │   └── prompts.ts              # first-run prompt
│   │   └── test/
│   ├── infra/           # AWS CDK app
│   │   ├── bin/openmuncher.ts
│   │   ├── lib/openmuncher-stack.ts
│   │   └── lambda/
│   │       ├── ingest/index.ts
│   │       └── leaderboard/index.ts
│   └── readme-updater/
│       └── src/index.ts
├── .github/workflows/
│   ├── update-leaderboard.yml          # hourly cron
│   ├── publish-cli.yml                 # on tag v*
│   ├── deploy-infra.yml                # on push to main + manual
│   └── ci.yml                          # on PR
├── README.md            # contains <!-- LEADERBOARD:START/END --> markers
└── package.json         # npm workspaces root
```

## Leaderboard rendering

`README.md` contains:

```markdown
<!-- LEADERBOARD:START -->
<!-- This block is auto-generated. Do not edit. -->
| Rank | Wastrel | Tokens Burned | Money Incinerated | Munches |
|------|---------|---------------|-------------------|---------|
| 🥇 1 | brian | 12,847,213 | $384.21 | 412 |
| ... |
**Global counter:** 1,847,392,108 tokens · $42,180.91 incinerated.
*Last updated: 2026-05-05 14:00 UTC*
<!-- LEADERBOARD:END -->
```

`packages/readme-updater` is a Node script that:

1. Fetches `/leaderboard`.
2. Renders the markdown table.
3. Reads `README.md`, replaces between markers, writes back.

The script always exits 0 on success. The workflow detects no-op runs via `git diff --quiet README.md` and skips the commit step in that case.

`.github/workflows/update-leaderboard.yml`:

- `schedule: '0 * * * *'` (hourly) + `workflow_dispatch`.
- Steps: checkout → setup-node → `npm ci` → `npm run -w @openmuncher/readme-updater start` → `git diff --quiet README.md || git commit && git push`.
- Default `GITHUB_TOKEN` with `contents: write` permission.
- Concurrency group: `update-leaderboard` (cancel in-progress).

## Other workflows

- **`publish-cli.yml`** — on tag `v*`: build, inline HMAC secret from `OPENMUNCHER_HMAC_KEY`, `npm publish --workspace @openmuncher/cli` with `NPM_TOKEN`.
- **`deploy-infra.yml`** — on push to `main` touching `packages/infra/**` or manual: OIDC auth to AWS, `cdk deploy`. No long-lived AWS keys.
- **`ci.yml`** — on PR: typecheck, lint, all-workspace tests.

## Testing strategy

| Layer | Tool | Coverage |
|-------|------|----------|
| Unit (CLI) | vitest | tokenizer wrapper picks correct backend per model; pricing math; payload generator hits target ± 5 %; conversion math; first-run prompt parsing; HMAC matches fixture |
| Unit (Lambda) | vitest + `aws-sdk-client-mock` | HMAC verify (good / bad / timing-safe), validation rejects out-of-bounds, dedup on duplicate eventId, counter shard write hits one shard, leaderboard merges shards correctly, banned user filtered |
| Integration (backend) | vitest + DynamoDB Local in Docker | Full ingest → aggregate → leaderboard flow; daily leaderboard cap rollover |
| Integration (CLI) | vitest with local mock HTTP server | First run writes config; second run reads it; telemetry POST shape; network-failure path; stdout snapshot |
| README updater | vitest | Snapshot rendered markdown for fixture; idempotent rewrite between markers |
| CDK | `cdk synth` snapshot test | Catches unintended infra changes in PRs |

End-to-end smoke (real AWS) is **deferred**; manual `cdk deploy` to a sandbox account fills that role for v1.

TDD per superpowers default: failing test first, then implementation. Use `superpowers:systematic-debugging` if tests stay red unexpectedly.

## Error handling philosophy

### CLI

- Telemetry POST timeout (2 s) → silent retry once → drop. User still sees stats; `Global:` shows last cached value or `(offline)`.
- Tokenizer load failure → fall back to char/4 estimator with a one-line warning.
- Config file unreadable / corrupt → warn, treat as first run, write fresh.
- Animation failure (narrow / non-TTY / Windows quirks) → silently skip, render plain stats.

### Lambda

- HMAC fail → 401.
- Validation fail → 400 with `{ok:false, error:"…"}`.
- `ConditionalCheckFailedException` (dedup) → treat as success, return current totals.
- DynamoDB throttle / timeout → 503, CLI silent retry once.
- Unhandled exception → 500, structured log with eventId, no PII.

## Scalability headroom

- Lambda Function URLs scale to Lambda concurrency (default 1,000 / region, raisable). At ~100 ms ingest duration, that's ~10K req/s — ~860M munches/day.
- DynamoDB on-demand auto-scales to 40K writes/sec/partition. Counter sharding (10×) provides 10× headroom on the global counter. Event writes shard naturally on `EVENT#<eventId>`.
- If a viral event saturates Lambda or floods abuse, CloudFront + WAF (already in topology) absorb at the edge.

## Open / deferred

- Custom domain `api.openmuncher.dev` (deferred; cosmetic).
- Achievements engine (deferred; new entity type and a background Lambda).
- Shareable summary cards (deferred; image renderer + Lambda layer).
- Per-model leaderboard (data captured, surface deferred).
- E2E smoke against real AWS (deferred; manual sandbox deploys cover it).

## Risks

- **HMAC secret extraction** — accepted; mitigation is rotation cadence + server-side bounds.
- **Tokenizer drift across model versions** — pin tokenizer dependency, add a calibration test that snapshots tokenized lengths for a fixed corpus per model id.
- **Hourly README commits flood git history** — mitigated by `update-leaderboard.yml` exiting 0 with no changes when leaderboard is identical to current README.
- **Banned user can still file events** — accepted; storage cost is negligible and the audit trail is useful.
