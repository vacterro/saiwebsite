import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync,writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createSiteFixture,removeSiteFixture } from '../lib/fixture.mjs';
import { driftReport,intakeDrift } from '../lib/drift.mjs';
import { loadEngine } from '../../src/content-engine/engine.mjs';
import '../../src/content-engine/extensions.mjs';

test('drift intake has stable identity, preserves a report without CLI and deduplicates genuine board markers',()=>{
  const root=createSiteFixture();try {
    const e=loadEngine({root});e.sourceStates=[{id:'github.vacterro.releases',state:'STALE',now:{sha256:'a'.repeat(64)}}];
    const report=driftReport(e);assert.equal(driftReport(e).identity,report.identity);
    const unavailable={available:false,executionCapable:false,code:'SAIPEN_CLI_UNAVAILABLE'};
    let invoked=false;const invoke=()=>{invoked=true;return {status:0,stdout:'Should not happen'};};
    assert.equal(intakeDrift(report,{root,discovery:unavailable,invoke,dryRun:true}).status,'PREVIEW');assert.equal(invoked,false);
    const pending=intakeDrift(report,{root,discovery:unavailable,invoke});assert.equal(pending.status,'SAIPEN_CLI_UNAVAILABLE');assert.equal(invoked,false);assert.ok(readFileSync(join(root,pending.report),'utf8').includes(report.identity));
    const board=join(root,'.saipen/BOARD.md'),text=readFileSync(board,'utf8');
    // Disposable control data only; production lifecycle writes exclusively use the CLI.
    writeFileSync(board,text+`\n- [ ] T-999 [P2] Website source drift [${report.marker}]\n`);
    assert.equal(intakeDrift(report,{root,discovery:unavailable,invoke}).status,'ALREADY_TRACKED');assert.equal(invoked,false);
    const before=readFileSync(board,'utf8');assert.equal(intakeDrift({...report,meaningful:false},{root,discovery:unavailable,invoke}).status,'NO_DRIFT');assert.equal(readFileSync(board,'utf8'),before);
  } finally {removeSiteFixture(root);}
});
