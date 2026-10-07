import { defineConfig } from '@playwright/test';

/**
 * Browser gates for SAI_WEBSITE.
 *
 * Serves the BUILT site through `astro preview`, so both suites measure exactly
 * what ships (`npm run build` first). One worker, Chromium only, fixed 1280x720
 * viewport at DPR 1: the reference condition the visual baselines are captured
 * in, and the reason a screenshot diff here means something.
 *
 *   npm run test:runtime      theme runtime contract (persistence, pre-paint,
 *                             fallback, nested-scope isolation, no-JS)
 *   npm run test:visual       deterministic screenshot baselines
 */
export default defineConfig({
  testDir: './tests',
  outputDir: './test-results',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: [['list']],
  snapshotPathTemplate: '{testDir}/baselines/{arg}{ext}',
  use: {
    baseURL: 'http://127.0.0.1:4321',
    browserName: 'chromium',
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    colorScheme: 'dark',
    locale: 'en-US',
    timezoneId: 'UTC',
    reducedMotion: 'reduce',
    screenshot: 'off',
    video: 'off',
    trace: 'off',
  },
  // Chromium runs every suite. WebKit also runs the pixel-perfect gate: a
  // second rendering engine with its own compositing and text pipeline, and
  // the one that visibly smooths sub-pixel-transformed text (the gate's
  // control).
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'webkit', use: { browserName: 'webkit' }, testMatch: /pixel-perfect\.spec\.mjs/ },
  ],
  webServer: {
    command: 'npm run preview -- --port 4321 --host 127.0.0.1',
    url: 'http://127.0.0.1:4321/',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
