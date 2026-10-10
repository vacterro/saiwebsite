// Fixture suite for the runEngineGate regression control.
//
// Deliberately NOT named *.test.mjs and NOT registered in ENGINE_SUITE_FILES,
// so resolveEngineSuites() (which enumerates only scripts/tests/*.test.mjs)
// never sees it. release-skip-accounting.test.mjs registers it explicitly and
// runs it through runEngineGate with a disposable artifact to prove:
//   1. the runner executes from ROOT (root-relative paths resolve), and
//   2. the selected build artifact reaches the suite through the
//      SAI_RELEASE_ARTIFACT_DIR contract rather than as the working directory.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

test('executes from the project root: root-relative paths resolve', () => {
  assert.ok(existsSync(join(process.cwd(), 'package.json')), `cwd is ${process.cwd()}`);
  assert.ok(existsSync(join(process.cwd(), 'scripts', 'release-candidate.mjs')));
});

test('receives the selected release artifact through the env contract', () => {
  const dir = process.env.SAI_RELEASE_ARTIFACT_DIR;
  assert.ok(dir && dir.trim() !== '', 'SAI_RELEASE_ARTIFACT_DIR must be set for the post-build gate');
  assert.ok(existsSync(join(dir, 'index.html')), `selected artifact has index.html (${dir})`);
});
