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
  outputDir: process.env.SAI_TEST_OUTPUT ?? './test-results',
  // Baseline immutability: every run snapshots tests/baselines/ first;
  // the setup's returned teardown fails the run when normal verification
  // mutates it. Explicit refresh (test:visual:update, i.e.
  // --update-snapshots) is exempt by design.
  globalSetup: './tests/baseline-immutability.setup.mjs',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: [['list']],
  snapshotPathTemplate: '{testDir}/baselines/{arg}{ext}',
  use: {
    baseURL: process.env.SAI_TEST_BASE_URL ?? 'http://127.0.0.1:4321',
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
  // control) -- plus the media-delivery contract, so Cosmos bytes are
  // proven served and decoded on both engines, never inferred from one.
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'webkit', use: { browserName: 'webkit' }, testMatch: /(pixel-perfect|media-delivery)\.spec\.mjs/ },
  ],
  // Standalone isolation: the server is always owned by this run
  // (reuseExistingServer: false), so a foreign or stale preview that
  // happens to occupy port 4321 can never silently stand in for the
  // freshly built site under test — the run fails to start instead of
  // validating unrelated bytes. An unowned listener is never killed;
  // concurrent runs collide on the fixed port and fail loudly. Point
  // SAI_TEST_BASE_URL at an explicit host to take ownership yourself
  // (the FULL release factory does exactly this with a dynamic port
  // plus a digest attestation in tests/candidate-host.spec.mjs).
  webServer: process.env.SAI_TEST_BASE_URL ? undefined : {
    command: 'npm run preview -- --port 4321 --host 127.0.0.1',
    url: 'http://127.0.0.1:4321/',
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
