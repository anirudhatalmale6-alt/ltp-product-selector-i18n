/*
 * verify.js - static checks against a bundle, with no browser required.
 *
 *   node test/verify.js <bundle.js>
 *
 * This loads the real webpack modules out of the bundle (the React entry point
 * is deferred, nothing renders) and asserts what the localisation layer looks
 * like. The runtime proof - that a newly added language actually resolves
 * through the bundle's own Provider - lives in test/browser-verify.py, because
 * React needs a real DOM.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const bundlePath = process.argv[2];
if (!bundlePath) {
  console.error('usage: node test/verify.js <bundle.js>');
  process.exit(1);
}

let pass = 0, fail = 0;
function checkTrue(name, cond, detail) {
  if (cond) pass++; else fail++;
  console.log('  ' + (cond ? 'PASS' : 'FAIL') + '  ' + name + (cond ? '' : '   ' + (detail || '')));
}

function loadBundle(file) {
  let src = fs.readFileSync(file, 'utf8');
  const replaced = src
    .replace('n((n.s = 238));', 'globalThis.__req = n; globalThis.__runEntry = function () { return n((n.s = 238)); };')
    .replace('n(n.s=238);', 'globalThis.__req=n;globalThis.__runEntry=function(){return n(n.s=238);};');
  if (replaced === src) throw new Error('could not defer the entry point in ' + file);

  const sandbox = {
    console, setTimeout, clearTimeout, setInterval, clearInterval,
    Promise, Date, Math, JSON, RegExp, Error, Object, Array, String, Number, Boolean, Function,
    unescape, escape, encodeURIComponent, decodeURIComponent,
    navigator: { userAgent: 'node', language: 'en-GB' },
    document: {
      createElement: () => ({ style: {}, setAttribute() {}, getElementsByTagName: () => [] }),
      documentElement: { style: {} }, getElementsByTagName: () => [],
      addEventListener() {}, removeEventListener() {}, cookie: ''
    },
    location: { href: 'https://example.test/', pathname: '/', search: '' },
  };
  sandbox.window = sandbox; sandbox.global = sandbox; sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(replaced, sandbox, { filename: path.basename(file), timeout: 60000 });
  return sandbox;
}

function interop(m) { return m && m.__esModule ? m.default : m; }
function gettext(localeData, key) {
  const hit = localeData.messages && localeData.messages[key];
  return hit ? hit[0] : key;
}

const src = fs.readFileSync(bundlePath, 'utf8');
const sandbox = loadBundle(bundlePath);
const req = sandbox.__req;

console.log('\n== locale wiring ==');

// Resolve the wrapper module ids straight from the locale map, so this test
// keeps working if the bundle is rebuilt and modules are renumbered.
const mapRe = /\{\s*en\s*:\s*([\w$]+)\.default\s*,\s*ro\s*:\s*([\w$]+)\.default\s*,\s*tr\s*:\s*([\w$]+)\.default\s*\}/;
const m = mapRe.exec(src);
checkTrue('locale map found in the bundle', !!m);

const wrapperIds = {};
if (m) {
  ['en', 'ro', 'tr'].forEach((code, i) => {
    const w = new RegExp(m[i + 1] + '\\s*=\\s*[\\w$]+\\(\\s*n\\(\\s*(\\d+)\\s*\\)\\s*\\)').exec(src);
    if (w) wrapperIds[code] = Number(w[1]);
  });
}
checkTrue('all three wrappers resolved', Object.keys(wrapperIds).length === 3, JSON.stringify(wrapperIds));

const data = {};
for (const code of Object.keys(wrapperIds)) data[code] = interop(req(wrapperIds[code]));

for (const code of Object.keys(data)) {
  console.log('  ' + code + ' (module ' + wrapperIds[code] + '): ' +
    Object.keys(data[code].messages).length + ' entries, ' +
    '"Product Selector" -> ' + gettext(data[code], 'Product Selector'));
}
checkTrue('Romanian is translated', gettext(data.ro, 'Product Selector') === 'Selectie produs');
checkTrue('Turkish is translated', gettext(data.tr, 'Product Selector') !== 'Product Selector');
checkTrue('English falls through to the source string',
  gettext(data.en, 'Product Selector') === 'Product Selector');

console.log('\n== unwired dictionaries ==');
// A dictionary module that nothing requires is dead weight: the language it
// contains renders as English, silently, because Provider.getLocaleFromProps
// does `return localeData[locale] ? locale : "en"`.
const arrA = src.indexOf('})([');
const arrB = src.lastIndexOf(']);');
const mods = eval('(' + src.slice(arrA + 3, arrB + 1) + ')');
const orphans = [];
for (let id = 0; id < mods.length; id++) {
  const body = mods[id].toString();
  if (!/t\.exports\s*=\s*\{/.test(body) || !/"":\s*\{/.test(body)) continue;
  const mm = { exports: {} };
  try { eval('(' + body + ')')(mm, mm.exports, () => ({})); } catch (e) { continue; }
  if (!mm.exports[''] || !mm.exports['']['lang']) continue;
  if (!new RegExp('n\\(\\s*' + id + '\\s*\\)').test(src)) {
    orphans.push({ id, lang: mm.exports['']['lang'], entries: Object.keys(mm.exports).length });
  }
}
if (orphans.length) {
  orphans.forEach(o => console.log('  module ' + o.id + ' holds "' + o.lang + '" (' + o.entries +
    ' entries) but nothing requires it -> renders as English'));
} else {
  console.log('  none - every dictionary in the bundle is reachable');
}

console.log('\n== fallback behaviour ==');
checkTrue('Provider falls back to English for unknown locales',
  /return\s+\w+\[\w+\]\s*\?\s*\w+\s*:\s*"en"/.test(src));
checkTrue('Provider supports lazy (function) locales',
  /"function"\s*==\s*typeof/.test(src));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (orphans.length) console.log(orphans.length + ' unwired dictionary/dictionaries reported above');
process.exit(fail ? 1 : 0);
