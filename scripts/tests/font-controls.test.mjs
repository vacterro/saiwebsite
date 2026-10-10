import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync,writeFileSync } from 'node:fs';
import { dirname,join,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSiteFixture,removeSiteFixture } from '../lib/fixture.mjs';

// A Windows checkout with core.autocrlf=true rewrote scripts/fonts/src/spleen-6x12.bdf
// (a text-format font source) and this suite failed on a fresh clone while the
// verified worktree passed. .gitattributes now pins the font sources byte-exact;
// this check fails the moment any checkout converts them again.
test('the checked-in font sources match their approved bytes in this checkout',()=>{
  const root=resolve(dirname(fileURLToPath(import.meta.url)),'..','..');
  const sources=JSON.parse(readFileSync(join(root,'scripts/fonts/sources.json'),'utf8'));
  for(const entry of [sources.ui.regular,sources.ui.bold,sources.code,sources.code.supplement]){
    const bytes=readFileSync(join(root,entry.file));
    const actual=createHash('sha256').update(bytes).digest('hex');
    assert.equal(actual,entry.sha256,`${entry.file} does not match sources.json: was it line-ending converted?`);
  }
});

test('the approved mono supplement source hash and coverage manifest cannot be forged',()=>{
  const root=createSiteFixture();try {
    const run=(script)=>spawnSync(process.execPath,[resolve(root,script)],{cwd:root,encoding:'utf8'});
    assert.equal(run('scripts/validate-licenses.mjs').status,0);
    const path=join(root,'scripts/fonts/sources.json'),sources=JSON.parse(readFileSync(path,'utf8'));sources.code.supplement.sha256='0'.repeat(64);writeFileSync(path,JSON.stringify(sources));
    const fail=run('scripts/validate-licenses.mjs');assert.notEqual(fail.status,0);assert.match(fail.stdout,/\[source\].*DejaVuSansMono.*SHA-256/);
    const coverage=join(root,'src/content-engine/i18n/font-coverage.json'),data=JSON.parse(readFileSync(coverage,'utf8'));data.faces[0].sha256='0'.repeat(64);writeFileSync(coverage,JSON.stringify(data));
    const actual=spawnSync(process.execPath,[resolve(root,'scripts/site.mjs'),'doctor','--json','--allow-stale'],{cwd:root,encoding:'utf8'});
    assert.notEqual(actual.status,0);assert.ok(JSON.parse(actual.stdout).broken.some((p)=>p.includes('font-coverage.json')));
  } finally {removeSiteFixture(root);}
});
