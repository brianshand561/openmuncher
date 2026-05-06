import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node20',
  outDir: 'dist',
  clean: true,
  banner: { js: '#!/usr/bin/env node' },
  noExternal: ['@openmuncher/shared'],
  // Electron is loaded at runtime via createRequire, not bundled.
  external: ['electron'],
});
