#!/usr/bin/env node
/**
 * Run the mandatory dist-served browser matrix from the single
 * authoritative registry (BROWSER_MATRIX_SPECS in
 * scripts/release-candidate.mjs). No hand-maintained spec list here:
 * adding a suite to the registry automatically adds it to `test:matrix`.
 * Extra CLI args are forwarded to Playwright (e.g. --project=chromium).
 * Engine selection comes from playwright.config testMatch: pixel-perfect
 * and media-delivery run Chromium AND WebKit, the rest Chromium only.
 */
import { spawnSync } from 'node:child_process';
import { BROWSER_MATRIX_SPECS } from './release-candidate.mjs';

const r = spawnSync('npx', ['playwright', 'test', ...BROWSER_MATRIX_SPECS, ...process.argv.slice(2)], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
process.exit(r.status ?? 1);
