import { KNOWN_MODELS, type ModelId } from '@openmuncher/shared';

const ENV_VAR_ORDER = [
  'OPENMUNCHER_MODEL',
  'CLAUDE_CODE_MODEL',
  'ANTHROPIC_MODEL',
  'WINDSURF_MODEL',
  'CURSOR_MODEL',
] as const;

const FALLBACK: ModelId = 'claude-opus-4-7';

function isKnown(s: string | undefined): s is ModelId {
  return !!s && (KNOWN_MODELS as readonly string[]).includes(s);
}

export function detectModel(env: NodeJS.ProcessEnv = process.env): ModelId {
  for (const name of ENV_VAR_ORDER) {
    const v = env[name];
    if (isKnown(v)) return v;
  }
  return FALLBACK;
}
