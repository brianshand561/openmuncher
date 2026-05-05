/**
 * Build-time constants. Default values target local dev / tests.
 * The publish workflow (.github/workflows/publish-cli.yml) regenerates this file with
 * production values before bundling, so the published bundle ships with real secrets.
 *
 * DO NOT IMPORT process.env IN THIS FILE — that defeats the build-time inlining.
 */

export const HMAC_SECRET = 'dev-secret-not-for-production';
export const INGEST_URL = 'http://localhost:18000/munch';
