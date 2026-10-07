/**
 * Style lint (WINTAGE_WEB_CONTRACT §27, SAIPEN UI.md iron laws).
 *
 * A deliberately small line/rule scanner, not a CSS parser: it reads every
 * stylesheet under src/styles and every <style> block in src/**\/*.astro and
 * rejects the declarations that would break the visual law. Each rule names
 * the defect it prevents; the pixel-perfect browser gate is the proof, this
 * lint is the early, cheap, file:line warning.
 *
 *   radius        border-radius other than 0 / var(--radius)
 *   shadow        box-shadow / text-shadow other than none / var(...)
 *   blur          filter: blur / backdrop-filter other than none / var(...)
 *   opacity       opacity below 1 (UI.md iron law 2: zero transparency)
 *   motion        a transition or animation with a real duration
 *   hex           a hex colour literal (colour comes only from theme packs)
 *   em-units      em/rem lengths: they produce fractional pixel geometry
 *   decoration    text-decoration underline (use the 1px border underline)
 *   face          a font-size without the matching pixel face and line height
 *
 * Exit 1 on any finding. `// lint-allow: <rule> <reason>` on the line above a
 * declaration exempts it, and the reason is printed so it stays reviewable.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

function files(dir, exts, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) files(full, exts, out);
    else if (exts.some((ext) => name.endsWith(ext))) out.push(full);
  }
  return out;
}

/** Yield { file, line, text } for CSS lines, including <style> blocks in .astro. */
function cssLines(file) {
  const raw = readFileSync(file, 'utf8').split(/\r?\n/);
  const out = [];
  let inStyle = file.endsWith('.css');
  raw.forEach((text, index) => {
    if (!file.endsWith('.css')) {
      if (/<style[\s>]/.test(text)) {
        inStyle = !/<style[^>]*is:inline[^>]*set:html/.test(text);
        return;
      }
      if (/<\/style>/.test(text)) {
        inStyle = false;
        return;
      }
    }
    if (inStyle) out.push({ file, line: index + 1, text, prev: raw[index - 1] ?? '' });
  });
  return out;
}

/** Rules see one declaration: the property name and its trimmed value. */
const RULES = [
  { id: 'radius', test: (p, v) => p === 'border-radius' && !/^(0|var\(--radius\))$/.test(v) },
  { id: 'shadow', test: (p, v) => /^(box|text)-shadow$/.test(p) && !/^(none|var\(--[\w-]+\))$/.test(v) },
  { id: 'blur', test: (p, v) => /^(-webkit-)?(backdrop-)?filter$/.test(p) && !/^(none|var\(--[\w-]+\))$/.test(v) },
  { id: 'opacity', test: (p, v) => p === 'opacity' && parseFloat(v) < 1 },
  {
    id: 'motion',
    test: (p, v) => /^(transition|animation)(-duration)?$/.test(p) && /\d*\.?\d+m?s/.test(v) && !/var\(--motion/.test(v),
  },
  { id: 'hex', test: (p, v) => /#[0-9a-fA-F]{3,8}/.test(v.replace(/url\([^)]*\)/g, '')) },
  { id: 'em-units', test: (p, v) => !p.startsWith('--') && /(^|[^\w-])\d*\.?\d+r?em/.test(v) },
  { id: 'decoration', test: (p, v) => /^text-decoration(-line)?$/.test(p) && /underline/.test(v) },
];

/** Strip comments across lines, keeping line numbers. */
function stripComments(lines) {
  let open = false;
  return lines.map((entry) => {
    let text = entry.text;
    let out = '';
    let i = 0;
    while (i < text.length) {
      if (open) {
        const end = text.indexOf('*/', i);
        if (end === -1) { i = text.length; break; }
        open = false;
        i = end + 2;
      } else {
        const start = text.indexOf('/*', i);
        if (start === -1) { out += text.slice(i); break; }
        out += text.slice(i, start);
        open = true;
        i = start + 2;
      }
    }
    return { ...entry, code: out };
  });
}

const findings = [];
const allowed = [];

const targets = [...files('src/styles', ['.css']), ...files('src', ['.astro'])];
for (const file of targets) {
  const lines = stripComments(cssLines(file));
  for (const { line, text, prev, code } of lines) {
    for (const decl of code.split(';')) {
      const m = decl.replace(/^.*[{}]/, "").match(/^\s*([\w-]+)\s*:\s*(.+?)\s*(!important)?\s*$/);
      if (!m) continue;
      const [, prop, value] = m;
      for (const rule of RULES) {
        if (!rule.test(prop, value)) continue;
        const allow = prev.match(new RegExp(`lint-allow:\\s*${rule.id}\\s+(.+?)\\s*(\\*/)?$`));
        if (allow) allowed.push(`${file}:${line} [${rule.id}] allowed: ${allow[1]}`);
        else findings.push(`${file}:${line} [${rule.id}] ${text.trim()}`);
      }
    }
  }

  // face: every rule body that sets font-size must also set the pixel face and
  // a line height, because each face is correct at exactly one size.
  const body = lines.map((l) => l.text).join('\n');
  const ruleBodies = body.matchAll(/([^{}]*)\{([^{}]*)\}/g);
  for (const [, selector, declarations] of ruleBodies) {
    if (!/font-size\s*:/.test(declarations)) continue;
    if (/@font-face/.test(selector)) continue;
    const size = declarations.match(/font-size\s*:\s*var\(--size-(\w+)\)/);
    const family = /font-family\s*:\s*var\(--face-/.test(declarations);
    const height = /line-height\s*:/.test(declarations);
    if (!size || !family || !height) {
      findings.push(
        `${file} [face] "${selector.trim().split('\n').pop()}" sets font-size without ${
          !size ? 'a ladder token' : !family ? 'its pixel face' : 'an integer line-height'
        }`,
      );
    }
  }
}

for (const line of allowed) console.log(`  ${line}`);
if (findings.length) {
  for (const line of findings) console.log(`  FAIL ${line}`);
  console.log(`\nFAILED: ${findings.length} style-law violation(s) in ${targets.length} files`);
  process.exit(1);
}
console.log(`OK: ${targets.length} files, no style-law violations`);
