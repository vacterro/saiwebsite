/** Validate a canonical snapshot without interpreting new protocol semantics. */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const CANONICAL_FILES = {
  registry: 'saipen/REGISTRY.json',
  stateSchema: 'extensions/schemas/state.schema.json',
  adapters: 'extensions/adapters/registry.json',
};

export function validateCanonicalSnapshot(directory) {
  const problems = [];
  let meta;
  try { meta = JSON.parse(readFileSync(join(directory, 'meta.json'), 'utf8')); }
  catch (error) { return [`[canonical-meta] ${error.message}`]; }
  if (!/^[0-9a-f]{40}$/.test(meta.commit ?? '') || !/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(meta.version ?? '')) problems.push('[canonical-meta] expected a full Git commit and a semantic version');
  if (existsSync(join(directory,'documentation.json'))&&!meta.documentation) problems.push('[canonical-provenance] documentation: reference manifest is not pinned by meta.json');
  if (meta.documentation) {
    try {
      const text=readFileSync(join(directory,'documentation.json'),'utf8').replace(/\r\n/g,'\n');
      const doc=JSON.parse(text);
      if (meta.documentation.file!=='documentation.json' || createHash('sha256').update(text).digest('hex')!==meta.documentation.sha256) problems.push('[canonical-hash] documentation: reference manifest differs from its pinned SHA-256');
      if (doc.schemaVersion!==1 || doc.commit!==meta.commit || doc.version!==meta.version || !doc.files || !Object.keys(doc.files).length || Array.isArray(doc.files) || Object.values(doc.files).some((r)=>!r||!/^[0-9a-f]{64}$/.test(r.sha256 ?? ''))) problems.push('[canonical-schema] documentation: invalid pinned reference identities');
    } catch(error) {problems.push(`[canonical-file] documentation: ${error.message}`);}
  }
  for (const [key, source] of Object.entries(CANONICAL_FILES)) {
    try {
      const bytes = readFileSync(join(directory, `${key}.json`));
      const digest = (value) => createHash('sha256').update(value).digest('hex');
      const record = meta.files?.[key];
      if (record?.source !== source || !/^[0-9a-f]{64}$/.test(record?.sha256 ?? '')) problems.push(`[canonical-provenance] ${key}: missing or unexpected source identity`);
      if (![digest(bytes), digest(bytes.toString('utf8').replace(/\r\n/g, '\n'))].includes(record?.sha256)) problems.push(`[canonical-hash] ${key}: bytes differ from the pinned SHA-256`);
      const doc = JSON.parse(bytes.toString('utf8'));
      const object = (x) => x && typeof x === 'object' && !Array.isArray(x);
      const strings=(x)=>Array.isArray(x)&&x.length>0&&x.every((v)=>typeof v==='string'&&v.length>0);
      if (key === 'registry' && (!Number.isInteger(doc.schema_version) || !object(doc.phases) || !object(doc.commands) || !object(doc.state) || !Array.isArray(doc.error_codes))) problems.push('[canonical-schema] registry: required machine-source structure is missing');
      if(key==='registry'&&(!strings(doc.phases?.all)||!object(doc.phases?.valid_transitions)||!strings(doc.commands?.saipen)||!strings(doc.state?.known_fields)||!strings(doc.error_codes)))problems.push('[canonical-schema] registry: phase, command and STATE consumer contracts are invalid');
      if (key === 'stateSchema' && (doc.type !== 'object' || !object(doc.properties) || !Array.isArray(doc.required) || typeof doc.$schema !== 'string')) problems.push('[canonical-schema] stateSchema: expected an object JSON Schema');
      if (key === 'adapters' && (!Number.isInteger(doc.schema_version) || !Array.isArray(doc.adapters) || doc.adapters.some((a) => !object(a) || typeof a.id !== 'string' || typeof a.name !== 'string'))) problems.push('[canonical-schema] adapters: expected versioned adapter records');
    } catch (error) { problems.push(`[canonical-file] ${key}: ${error.message}`); }
  }
  return problems;
}
