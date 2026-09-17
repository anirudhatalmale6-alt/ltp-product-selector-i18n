/*
 * verify.js - static checks against a bundle, no browser required.
 *
 *   node test/verify.js <bundle.js>
 *
 * Works on the minified bundle and on a beautified copy. The runtime proof -
 * that a newly added language actually resolves through the app's own Provider
 * - lives in test/verify-build.py, because React needs a real DOM.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const B = require('../tools/lib/bundle');

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

const src = fs.readFileSync(bundlePath, 'utf8');

console.log('\n== bundle structure ==');
const loaded = B.loadModules(src);
checkTrue('module array readable', !!loaded);
if (!loaded) { console.log('\n' + pass + ' passed, ' + fail + ' failed'); process.exit(1); }
console.log('  ' + loaded.modules.length + ' modules, entry point ' + loaded.entryId);

console.log('\n== locale wiring ==');
const map = B.findLocaleMap(src);
checkTrue('locale map found', !!map);
if (map) {
  console.log('  ' + map.match.trim());
  const en = map.entries.find(e => e.code === 'en');
  checkTrue('map contains "en"', !!en);

  const ids = en ? B.findDateEngineIds(src, en.expr) : null;
  checkTrue('date-fns modules resolved from the English wrapper',
    !!ids && ids.buildRegExp !== null, JSON.stringify(ids));
  if (ids) {
    console.log('  format=n(' + ids.format + ')  buildRegExp=n(' + ids.buildRegExp +
      ')  enDateLocale=n(' + ids.enDateLocale + ')  wrapper=' + ids.wrapperId);
  }
}

console.log('\n== dictionaries ==');
const dicts = B.findDictionaries(src);
checkTrue('dictionaries found', dicts.length > 0);
const orphans = [];
for (const d of dicts) {
  const wired = B.isReferenced(src, d.id);
  const phrases = Object.keys(d.dict).length - 1;
  console.log('  ' + String(d.lang).padEnd(7) + 'module ' + String(d.id).padEnd(5) +
    phrases + ' phrases' + (wired ? '' : '   <-- UNWIRED, renders as English'));
  if (!wired) orphans.push(d);
}

console.log('\n== fallback behaviour ==');
// `localeData[locale] ? locale : "en"` - minified or not.
checkTrue('Provider falls back to English for unknown locales',
  /return\s+\w+\[\w+\]\s*\?\s*\w+\s*:\s*"en"/.test(src));
checkTrue('Provider supports lazy (function) locales',
  /"function"\s*==\s*typeof/.test(src));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (orphans.length) {
  console.log(orphans.length + ' unwired dictionary/dictionaries: ' +
    orphans.map(o => o.lang + ' (module ' + o.id + ')').join(', '));
}
process.exit(fail ? 1 : 0);
