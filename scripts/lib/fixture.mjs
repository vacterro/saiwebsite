/** Disposable, fully isolated site copies for integration and scale measurements. */
import { cpSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';

export function createSiteFixture(source=process.cwd()) {
  const root=mkdtempSync(join(tmpdir(),'sai-site-fixture-'));
  for (const folder of ['src','public','scripts','tests']) cpSync(join(source,folder),join(root,folder),{recursive:true});
  for (const file of ['package.json','package-lock.json','astro.config.mjs','tsconfig.json','playwright.config.mjs','.gitignore','README.md','OPERATOR.md','THIRD_PARTY_NOTICES.md','LICENSE']) if (existsSync(join(source,file))) cpSync(join(source,file),join(root,file));
  mkdirSync(join(root,'.saipen'));
  for (const file of ['STATE.md','BOARD.md','LOG.md','IDENTITY.md']) if (existsSync(join(source,'.saipen',file))) cpSync(join(source,'.saipen',file),join(root,'.saipen',file));
  symlinkSync(resolve(source,'node_modules'),join(root,'node_modules'),process.platform==='win32'?'junction':'dir');
  return root;
}

export function removeSiteFixture(root) {
  const parent=realpathSync(tmpdir()), target=realpathSync(root), rel=relative(parent,target);
  if (!rel || rel.startsWith('..') || !basename(target).startsWith('sai-site-fixture-')) throw new Error(`[unsafe-fixture-cleanup] ${root}`);
  rmSync(target,{recursive:true});
}
