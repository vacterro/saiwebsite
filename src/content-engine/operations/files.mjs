/** Shared, synchronous file transactions for operator commands. No browser code. */
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

export function withinRoot(root, path) {
  const base = resolve(root);
  const target = resolve(base, path);
  const rel = relative(base, target);
  if (!rel || rel === '..' || rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(rel)) throw new Error(`[unsafe-path] ${path} is outside the operation root or names the root itself`);
  let parent=target;
  while (!existsSync(parent)) parent=dirname(parent);
  const physical=relative(realpathSync(base),realpathSync(parent));
  if (physical==='..' || physical.startsWith(`..${process.platform==='win32'?'\\':'/'}`) || isAbsolute(physical)) throw new Error(`[unsafe-path] ${path} resolves through a link outside the operation root`);
  return target;
}

export function withMutationLock(root, action) {
  const lock = withinRoot(root, '.site-work/operation.lock');
  mkdirSync(dirname(lock), { recursive: true });
  try {
    mkdirSync(lock);
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error(`[operation-busy] ${lock}: another site operation holds the lock; inspect owner.json before recovering an abandoned lock`);
    throw error;
  }
  try {
    writeFileSync(`${lock}/owner.json`, JSON.stringify({ pid: process.pid, command: process.argv.slice(1) }) + '\n');
    return action();
  } finally {
    // Only the exact lock directory created above is removed.
    rmSync(lock, { recursive: true });
  }
}

/** Commit a set of files, restoring their original bytes if any write fails. */
export function writeTransaction(root, changes) {
  const entries = Object.entries(changes).map(([path, text]) => ({ path: withinRoot(root, path), text }));
  const before = new Map(entries.map(({ path }) => [path, existsSync(path) ? readFileSync(path) : null]));
  const temporary = [];
  try {
    for (const { path, text } of entries) {
      if (text === null) continue;
      mkdirSync(dirname(path), { recursive: true });
      const temp = `${path}.${process.pid}.site-tmp`;
      writeFileSync(temp, text, { flag: 'wx' });
      temporary.push(temp);
    }
    for (const { path, text } of entries) {
      if (text === null) { if (existsSync(path)) rmSync(path); }
      else renameSync(`${path}.${process.pid}.site-tmp`, path);
    }
  } catch (error) {
    for (const [path, bytes] of before) {
      if (bytes === null) { if (existsSync(path)) rmSync(path); }
      else writeFileSync(path, bytes);
    }
    throw error;
  } finally {
    for (const path of temporary) if (existsSync(path)) rmSync(path);
  }
}
