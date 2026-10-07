/**
 * Generated-content contract (content-system roadmap M36). Node only.
 *
 * `registry/generated.json` lists every generated artifact, its generator and
 * how its integrity is proven. This module checks the integrity kinds that do
 * not need a rebuild:
 *
 *   manifest-list    manifest[list][] = { file, sha256 } under base/
 *   manifest-map     manifest[map] = { key: sha256 | { sha256 } }, file from fileTemplate
 *   manifest-fields  manifest[field] = { file, sha256 } for each named field
 *   provenance       manifest has every required (dotted) field
 *   regenerate       content-engine manifests; freshness is decided by recomputing them
 *
 * A hash mismatch means the artifact was edited by hand or its manifest was
 * not regenerated with it: either way the build no longer represents its
 * declared generator.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sha256 } from '../sources/lock.mjs';

export const INTEGRITY_KINDS = ['manifest-list', 'manifest-map', 'manifest-fields', 'provenance', 'regenerate'];
const INPUT = /^(source:[a-z0-9.-]+|registry:[a-z]+|dist)$/;

export function validateGenerated(doc, sourceIds) {
  const problems = [];
  if (!doc || !Array.isArray(doc.artifacts)) return ['[malformed] generated.json: expected { artifacts: [] }'];
  const seen = new Set();
  for (const a of doc.artifacts) {
    const where = `generated ${a?.id}`;
    for (const f of ['id', 'paths', 'generator', 'inputs', 'integrity']) if (!(f in (a ?? {}))) problems.push(`[missing-field] ${where}: no "${f}"`);
    if (seen.has(a.id)) problems.push(`[duplicate-id] ${where}: declared twice`);
    seen.add(a.id);
    if (!/^npm run [a-z0-9:.-]+$/.test(a.generator ?? '')) problems.push(`[malformed] ${where}: generator must be "npm run <script>"`);
    if (!INTEGRITY_KINDS.includes(a.integrity?.kind)) problems.push(`[bad-enum] ${where}: integrity.kind "${a.integrity?.kind}"`);
    for (const input of a.inputs ?? []) {
      if (!INPUT.test(input)) problems.push(`[malformed] ${where}: input "${input}"`);
      else if (input.startsWith('source:') && !sourceIds.includes(input.slice(7))) problems.push(`[unknown-source] ${where}: ${input} is not declared`);
    }
  }
  return problems;
}

const get = (obj, dotted) => dotted.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);

function matches(path, expected) {
  const bytes = readFileSync(path);
  if (sha256(bytes) === expected) return true;
  // Text files may carry CRLF in a Windows checkout; the manifest hashes the LF bytes.
  return sha256(bytes.toString('utf8').replace(/\r\n/g, '\n')) === expected;
}

/** Problems for one artifact; empty means its integrity holds. `regenerate` kinds return []. */
export function checkIntegrity(artifact, root = '.', manifestOverride = undefined) {
  const at = (p) => join(root, p);
  const problems = [];
  const where = artifact.id;
  for (const p of artifact.paths) if (!existsSync(at(p))) problems.push(`[generated-missing] ${where}: ${p} does not exist`);
  const spec = artifact.integrity;
  if (spec.kind === 'regenerate' || problems.length) return problems;
  if (!existsSync(at(spec.manifest))) return [`[generated-missing] ${where}: manifest ${spec.manifest} does not exist`];
  const manifest = manifestOverride ?? JSON.parse(readFileSync(at(spec.manifest), 'utf8'));

  const pairs = [];
  if (spec.kind === 'manifest-list') {
    for (const item of get(manifest, spec.list) ?? []) pairs.push([item.file, item.sha256]);
    if (!pairs.length) problems.push(`[generated-manifest] ${where}: ${spec.manifest} lists no ${spec.list}`);
  } else if (spec.kind === 'manifest-map') {
    for (const [key, value] of Object.entries(get(manifest, spec.map) ?? {})) {
      pairs.push([spec.fileTemplate.replace('{key}', key), typeof value === 'string' ? value : value?.sha256]);
    }
  } else if (spec.kind === 'manifest-fields') {
    for (const field of spec.fields) {
      const item = get(manifest, field);
      if (!item?.file || !item?.sha256) problems.push(`[generated-manifest] ${where}: ${spec.manifest} has no ${field}.file/sha256`);
      else pairs.push([item.file, item.sha256]);
    }
  } else if (spec.kind === 'provenance') {
    for (const field of spec.require) if (get(manifest, field) === undefined) problems.push(`[generated-provenance] ${where}: ${spec.manifest} lacks ${field}`);
  }
  for (const [file, expected] of pairs) {
    const path = at(join(spec.base, file));
    if (!existsSync(path)) problems.push(`[generated-missing] ${where}: ${spec.base}/${file} declared in ${spec.manifest} does not exist`);
    else if (!expected || !matches(path, expected)) problems.push(`[generated-drift] ${where}: ${spec.base}/${file} does not match its recorded SHA-256 (hand-edited, or regenerate with ${artifact.generator})`);
  }
  return problems;
}
