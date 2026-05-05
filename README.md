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

| Rank | Wastrel | Tokens Burned | Money Incinerated | Munches |
|------|---------|---------------|-------------------|---------|
| 🥇 | brianshand561 | 25,511 | $0.74 | 3 |
| 🥈 | brian | 8,510 | $0.02 | 1 |

**Global counter:** 34,021 tokens · $0.76 incinerated.
*Last updated: 2026-05-05T23:18:31.121Z*
<!-- LEADERBOARD:END -->

## License

MIT. See `LICENSE`.
