// Browser probes over the PUBLIC CANDIDATE served with local static host
// semantics (npm run test:candidate). Complements
// scripts/tests/release-smoke.test.mjs (HTTP level): a real Chromium loads
// the projected candidate at a desktop and a mobile viewport and fails on
// console errors, failed asset loads, horizontal overflow, or a reachable
// internal route. Result label: LOCAL_STATIC_HOST_PASS scope only — no real
// hosting provider is exercised here.
import { test, expect } from '@playwright/test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { projectPublicCandidate } from '../scripts/release-public.mjs';
import { ROOT, resolveServedCandidateDir, startStaticServer } from '../scripts/release-smoke.mjs';
import { computeDigest } from '../scripts/release-candidate.mjs';

let server = null;
let base = null;
let candidateDir = null;
let disposableDir = null;

test.beforeAll(async () => {
  // Factory mode (SAI_CANDIDATE_DIR set): serve the exact staged candidate
  // the release factory is about to promote -- never a fresh projection.
  // Standalone mode: project dist/ into a disposable copy as before.
  const resolved = resolveServedCandidateDir(process.env);
  if (resolved.factoryProvided) {
    candidateDir = resolved.dir;
  } else {
    const src = join(ROOT, 'dist');
    expect(existsSync(join(src, 'index.html')), 'dist/ is missing — run npm run build first').toBe(true);
    disposableDir = mkdtempSync(join(tmpdir(), 'sai-candidate-host-'));
    projectPublicCandidate({ srcDir: src, destDir: disposableDir, root: ROOT });
    candidateDir = disposableDir;
  }
  // Artifact attestation: when the factory names the expected staged
  // digest, the served bytes must match it -- a PASS from any other
  // directory cannot authorize promotion.
  if (process.env.SAI_EXPECT_SHA) {
    const served = computeDigest(candidateDir);
    expect(served.sha256, `served candidate ${candidateDir} does not match the staged digest`).toBe(process.env.SAI_EXPECT_SHA);
  }
  const started = await startStaticServer(candidateDir);
  server = started.server;
  base = started.base;
});

test.afterAll(async () => {
  if (server) {
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
  if (disposableDir) rmSync(disposableDir, { recursive: true, force: true });
});

function trackPage(page) {
  const consoleErrors = [];
  const failedRequests = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(String(err)));
  page.on('requestfailed', (req) => failedRequests.push(`${req.url()} (${req.failure()?.errorText ?? 'failed'})`));
  page.on('response', (res) => {
    if (res.status() >= 400 && /\.(css|js|mjs|woff2?|png|svg|ico)(\?|$)/.test(res.url())) {
      failedRequests.push(`${res.url()} (${res.status()})`);
    }
  });
  return { consoleErrors, failedRequests };
}

async function expectNoOverflow(page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, 'horizontal overflow detected').toBeLessThanOrEqual(1);
}

test('desktop: homepage renders from the candidate with clean console and assets', async ({ page }) => {
  const watch = trackPage(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  const res = await page.goto(`${base}/`, { waitUntil: 'networkidle' });
  expect(res?.status()).toBe(200);
  await expect(page.locator('h1').first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await expectNoOverflow(page);
  expect(watch.failedRequests, watch.failedRequests.join('\n')).toEqual([]);
  expect(watch.consoleErrors, watch.consoleErrors.join('\n')).toEqual([]);
});

test('mobile: homepage and docs route fit 390x844 without overflow or errors', async ({ page }) => {
  const watch = trackPage(page);
  await page.setViewportSize({ width: 390, height: 844 });
  const res = await page.goto(`${base}/docs/getting-started/introduction/`, { waitUntil: 'networkidle' });
  expect(res?.status()).toBe(200);
  await expect(page.locator('h1').first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await expectNoOverflow(page);
  await page.goto(`${base}/`, { waitUntil: 'networkidle' });
  await expectNoOverflow(page);
  expect(watch.failedRequests, watch.failedRequests.join('\n')).toEqual([]);
  expect(watch.consoleErrors, watch.consoleErrors.join('\n')).toEqual([]);
});

test('internal routes are unreachable from the candidate in a browser', async ({ page }) => {
  for (const route of ['/debug/components/', '/qps-ploc/', '/qps-ploc/search-index.json']) {
    const res = await page.goto(`${base}${route}`);
    expect(res?.status(), `${route} must not be served`).toBe(404);
  }
});
