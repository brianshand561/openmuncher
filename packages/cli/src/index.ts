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

  // Print the payload first — this is what the host LLM consumes.
  process.stdout.write(result.payloadText);

  // Animation (TTY-only; auto-skips inside Claude Code's bash tool).
  await runAnimation({ disabled: !argv.animation });

  // Stats footer.
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
    // Plan 1 has no backend; global is offline.
    globalTokens: null,
    globalCostUsd: null,
  });
  process.stdout.write(rendered);
}

main().catch((err) => {
  process.stderr.write(`openmuncher: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
