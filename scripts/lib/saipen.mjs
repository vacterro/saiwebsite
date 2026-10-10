/** Resolve the genuine bound launcher. Never copy or emulate a SAIPEN runtime. */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

function launch(path, args, root) {
  const configured=Number(process.env.SAIPEN_EXEC_TIMEOUT_MS ?? 300000);
  const timeout=Number.isSafeInteger(configured)&&configured>=1000&&configured<=43200000?configured:300000;
  if (process.platform !== 'win32' || !path.endsWith('.cmd')) return spawnSync(path,args,{cwd:root,encoding:'utf8',timeout});
  // cmd expands these characters even inside some quoted argument forms.
  // Complex task text must use SAIPEN's file/hex carriers instead.
  if ([path,...args].some((s)=>/["%\^!&|<>\r\n]/.test(s))) return {status:2,stdout:'',stderr:'[saipen-transport] use a supported --file or --hex carrier for special shell characters'};
  const command=`""${path}" ${args.map((s)=>`"${s}"`).join(' ')}"`;
  return spawnSync(process.env.ComSpec ?? join(process.env.SystemRoot ?? 'C:/Windows','System32/cmd.exe'),['/d','/s','/c',command],{cwd:root,encoding:'utf8',windowsVerbatimArguments:true,timeout});
}

export function discoverSaipen({root=process.cwd(),env=process.env}={}) {
  root=resolve(root);
  const state=join(root,'.saipen/STATE.md');
  const bound=existsSync(state)?/^saipen_home:\s*["']?([^"'\r\n]+)["']?\s*$/m.exec(readFileSync(state,'utf8'))?.[1]?.trim():null;
  const candidates=[env.SAIPEN_LAUNCHER,...[env.SAIPEN_HOME,bound,env.SAIPEN_SKILL_HOME].filter(Boolean).map((home)=>join(home,'bin',process.platform==='win32'?'saipen.cmd':'saipen'))].filter(Boolean);
  const attempts=[];
  for (const candidate of [...new Set(candidates)]) {
    const path=resolve(candidate);
    if (!existsSync(path)) {attempts.push({path,code:'NOT_ACCESSIBLE'});continue;}
    const ran=launch(path,['host','entry','--json'],root);
    let entry;
    try {entry=JSON.parse(ran.stdout ?? '');} catch {attempts.push({path,code:'INVALID_RUNTIME_REPLY',exitCode:ran.status,detail:ran.stderr?.trim()});continue;}
    if (ran.status!==0 || !entry.ok || !entry.runtime_identity?.version) {attempts.push({path,code:entry.code ?? 'RUNTIME_REFUSED',exitCode:ran.status});continue;}
    return {available:true,code:'SAIPEN_CLI_AVAILABLE',launcher:path,version:entry.runtime_identity.version,executionCapable:entry.command_allowed===true,hostAdmission:entry.host_admission,degraded:entry.degraded ?? [],boundHome:bound,transport:entry.transport,attempts};
  }
  return {available:false,code:'SAIPEN_CLI_UNAVAILABLE',host:process.platform,executionCapable:false,boundHome:bound,attempts,requiredAction:'Install SAIPEN with its supported host adapter in this execution environment; supply SAIPEN_HOME or SAIPEN_LAUNCHER and use the genuine rebind operation if the persisted home is inaccessible.'};
}

export function invokeSaipen(args,{root=process.cwd(),discovery=discoverSaipen({root})}={}) {
  if (!discovery.available || !discovery.executionCapable) return {status:2,stdout:'',stderr:JSON.stringify(discovery)};
  return launch(discovery.launcher,args,resolve(root));
}
