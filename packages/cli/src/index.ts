import { parseArgs } from 'node:util';
import { homedir } from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { runMunch, type MunchArgs, type Intensity } from './munch.js';
import { askNickname } from './prompts.js';
import { runAnimation } from './animation.js';
import { renderStats } from './stats-renderer.js';
import type { ModelId } from '@openmuncher/shared';
import { KNOWN_MODELS } from '@openmuncher/shared';

const VALID_INTENSITIES: ReadonlyArray<Intensity> = ['light', 'medium', 'heavy', 'nuclear'];

interface ParsedArgs {
  tokens?: number;
  model?: ModelId;
  intensity?: Intensity;
  animation: boolean;
  /** True when the user passed any burn-related flag (or `munch` subcommand). */
  isCli: boolean;
}

function parse(): ParsedArgs {
  const positional = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const explicitMunch = positional[0] === 'munch';

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

  const hasBurnFlag = tokens !== undefined || model !== undefined || intensity !== undefined;
  const isCli = explicitMunch || hasBurnFlag;

  return { tokens, model, intensity, animation: !values['no-animation'], isCli };
}

/**
 * No burn flags → launch the Electron desktop tray app. The desktop app
 * itself runs with no arguments after the spawn point. We use createRequire
 * to resolve electron at runtime even though we're an ESM bundle.
 */
function launchDesktop(): void {
  const require = createRequire(import.meta.url);
  // electron's `main` exports the path to its launcher executable.
  const electronPath = require('electron') as string;
  const here = dirname(fileURLToPath(import.meta.url));
  // Bundled file lives in dist/index.js; desktop assets live in ../desktop.
  const desktopMain = join(here, '..', 'desktop', 'main', 'index.js');
  const child = spawn(electronPath, [desktopMain], {
    stdio: 'inherit',
    detached: false,
  });
  child.on('close', (code) => process.exit(code ?? 0));
}

async function runCli(argv: ParsedArgs) {
  const result = await runMunch({
    home: homedir(),
    env: process.env,
    argv: { tokens: argv.tokens, model: argv.model, intensity: argv.intensity },
    askNickname,
  });

  process.stdout.write(result.payloadText);
  await runAnimation({ disabled: !argv.animation, mascot: result.mascot });

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
    mascot: result.mascot,
  });
  process.stdout.write(rendered);
}

async function main() {
  const argv = parse();
  if (argv.isCli) {
    await runCli(argv);
  } else {
    launchDesktop();
  }
}

main().catch((err) => {
  process.stderr.write(`openmuncher: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
