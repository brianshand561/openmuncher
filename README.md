# 🪵 OpenMuncher

OpenMuncher is a desktop tray app + CLI that deliberately wastes AI tokens for spectacle. Click the tray's munch button → OpenMuncher opens a terminal, starts Claude Code, and types in a token-burning command — Claude reads a giant junk payload as tool output, and your API key pays for it.

## Install

```
npm install -g openmuncher
```

(Bundles Electron, ~150MB.)

## Usage

**Desktop (default)**

```
openmuncher
```

A 🪵 appears in your menu bar. Click it → click the munch gif → tokens burn in Claude Code.

**CLI mode (any burn flag triggers it)**

```
openmuncher --intensity heavy              # 50K tokens
openmuncher --tokens 100000                # exact target
openmuncher --model claude-sonnet-4-6      # override model detection
openmuncher --no-animation                 # skip the woodchipper
openmuncher munch                          # explicit subcommand
```

The CLI is what gets run inside Claude Code when the desktop app types its keystrokes — so the same binary does both jobs. You can also invoke the CLI directly inside any agentic terminal session (Claude Code, Cursor, Windsurf, Gemini, etc.) for an immediate burn.

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
| 🥇 | brianshand561 | 229,650 | $4.64 | 7 |

**Global counter:** 238,160 tokens · $4.66 incinerated.
*Last updated: 2026-05-12T11:37:45.240Z*
<!-- LEADERBOARD:END -->

## License

MIT. See `LICENSE`.
