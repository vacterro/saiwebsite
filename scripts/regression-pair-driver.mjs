// T-31 regression-pair driver.
//
// The executed pair runs in an isolated sandbox with no dev server, so the
// browser suite needs its own build: this driver builds the site from the
// sandbox bytes and then runs the Playwright suite against it. The build cache
// and output land outside the execution context, so measuring the pair never
// mutates the bytes under test. stdout carries only the Playwright JSON
// report, whatever the suite's exit status, so the caller always parses a
// completed run.
import { execFileSync } from 'node:child_process';
import { build } from 'astro';

const node = process.execPath;
const quiet = { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' };

const run = (args) => {
  try {
    return execFileSync(node, args, quiet);
  } catch (error) {
    return error.stdout ?? '';
  }
};

// The build's own logger writes to stdout, which would corrupt the JSON report
// printed below, so it is swallowed here.
const write = process.stdout.write.bind(process.stdout);
process.stdout.write = () => true;
try {
  await build({ root: process.cwd(), cacheDir: '.build-cache', logLevel: 'error' });
} finally {
  process.stdout.write = write;
}
const report = run([
  'node_modules/playwright/cli.js',
  'test',
  'tests/support.spec.mjs',
  '--project=chromium',
  '--reporter=json',
]);
process.stdout.write(report);
// A completed run reports its own failures: the caller needs both the JSON
// totals and a nonzero exit for the failing half of a measured pair.
try {
  if (JSON.parse(report).stats.unexpected > 0) process.exitCode = 1;
} catch {
  process.exitCode = 1;
}
