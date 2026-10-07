const fs = require('node:fs');

const origRealpathSync = fs.realpathSync;
const safeRealpathSync = function (p, options) {
  try {
    return fs.realpathSync.native(p, options);
  } catch {
    try {
      return origRealpathSync(p, options);
    } catch {
      return typeof p === 'string' ? p : String(p);
    }
  }
};
for (const prop of Object.getOwnPropertyNames(origRealpathSync)) {
  try {
    safeRealpathSync[prop] = origRealpathSync[prop];
  } catch {}
}
fs.realpathSync = safeRealpathSync;

if (fs.promises && fs.promises.realpath) {
  const origPromisesRealpath = fs.promises.realpath;
  fs.promises.realpath = async function (p, options) {
    try {
      return await fs.promises.realpath.native(p, options);
    } catch {
      try {
        return await origPromisesRealpath(p, options);
      } catch {
        return typeof p === 'string' ? p : String(p);
      }
    }
  };
}
