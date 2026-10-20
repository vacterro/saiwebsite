/**
 * M51 acceptance surface (T-45). The roadmap M51 clauses are mechanical:
 *   - all 33 are registry entries;
 *   - each locale exposes completion/current/stale statistics;
 *   - missing translations never silently masquerade as translated content.
 * They are demonstrated over the ENGINEERING registry
 * (locale-expansion.proposed.json, status PROPOSED_NOT_OPERATOR_APPROVED),
 * which is deliberately NOT the operator's production language set: M51 says
 * "Do not freeze the exact 33-language list until the operator chooses it".
 * So these tests assert the mechanism, never that any locale is enabled or
 * that the production registry changed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { localeStatistics, measureScalePlan, proposedRegistry, statisticsProblems } from '../../src/content-engine/i18n/scale.mjs';
import { loadStore, unitReport } from '../../src/content-engine/i18n/store.mjs';
import { loadCoverage } from '../../src/content-engine/i18n/engine-ext.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function storeOverProposal(root = ROOT) {
  const registry = JSON.parse(readFileSync(join(root, 'src/content-engine/registry/pages.json'), 'utf8'));
  const sourceIds = JSON.parse(readFileSync(join(root, 'src/content-engine/registry/sources.json'), 'utf8')).sources.map((s) => s.id);
  const { localesDoc } = proposedRegistry(root);
  return loadStore({ root, registry, sourceIds, overrides: { localesDoc } });
}

test('M51: every proposed non-canonical locale is a registry entry exposing completion/current/stale statistics', () => {
  const store = storeOverProposal();
  const coverage = loadCoverage(ROOT);
  const stats = localeStatistics(store, coverage, unitReport(store));
  const { proposal } = proposedRegistry(ROOT);
  const expected = proposal.locales.map((p) => p.id).filter((id) => id !== store.localesDoc.canonical);
  assert.deepEqual(stats.map((s) => s.locale).sort(), [...expected].sort());
  assert.equal(stats.length, 32, 'the 33-locale proposal minus the canonical locale');
  for (const s of stats) {
    assert.equal(s.registryEntry, true);
    assert.equal(typeof s.completion, 'number');
    assert.equal(typeof s.publicationCompletion, 'number');
    assert.equal(typeof s.counts.CURRENT, 'number');
    assert.equal(typeof s.counts.STALE, 'number');
    assert.equal(typeof s.counts.MISSING, 'number');
    assert.equal(s.enabled, false, 'the proposal enables no locale');
  }
});

test('M51 red control: a MISSING unit can never masquerade as renderable coverage', () => {
  const store = storeOverProposal();
  const stats = localeStatistics(store, loadCoverage(ROOT), unitReport(store));
  const { proposal } = proposedRegistry(ROOT);
  const canonical = store.localesDoc.canonical;
  // The honest surface is clean.
  assert.deepEqual(statisticsProblems(stats, proposal, canonical), []);
  // Inflating one locale's completion so its MISSING units count as translated
  // (de has 300 required, 0 renderable) is caught.
  const tampered = stats.map((s) => (s.locale === 'de' ? { ...s, completion: 100 } : s));
  const problems = statisticsProblems(tampered, proposal, canonical);
  assert.ok(problems.some((p) => /masquerad/.test(p)), problems.join('\n'));
});

test('M51 red control: dropping a locale from the statistics surface is caught', () => {
  const store = storeOverProposal();
  const stats = localeStatistics(store, loadCoverage(ROOT), unitReport(store));
  const { proposal } = proposedRegistry(ROOT);
  const dropped = stats.filter((s) => s.locale !== 'de');
  const problems = statisticsProblems(dropped, proposal, store.localesDoc.canonical);
  assert.ok(problems.some((p) => /not a registry entry with statistics/.test(p)), problems.join('\n'));
});

test('M51: the measured plan passes its own mechanical gate and never changes the production registry', () => {
  const report = measureScalePlan(ROOT);
  assert.equal(report.status, 'PASS', report.problems.join('\n'));
  assert.equal(report.productionRegistryChanged, false);
  assert.equal(report.m51.operatorSelected, false);
  assert.equal(report.m51.statistics.length, 32);
  assert.equal(report.purpose, 'PROPOSED_NOT_OPERATOR_APPROVED');
});
