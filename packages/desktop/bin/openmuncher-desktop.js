#!/usr/bin/env node
/**
 * Thin Node shim that hands control to Electron.
 * The published package brings electron as a dep; we resolve the binary from there.
 */
const { spawn } = require('node:child_process');
const path = require('node:path');

const electronBin = require('electron');
const projectRoot = path.resolve(__dirname, '..');

const child = spawn(electronBin, [projectRoot, ...process.argv.slice(2)], {
  stdio: 'inherit',
  windowsHide: false,
});

child.on('close', (code) => process.exit(code ?? 0));
