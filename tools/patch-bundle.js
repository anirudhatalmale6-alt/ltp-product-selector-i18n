#!/usr/bin/env node
/*
 * patch-bundle.js - apply the one-line hook to the Product Selector bundle.
 *
 *   node tools/patch-bundle.js <bundle.js> [-o out.js] [--fix-encoding] [--dry-run]
 *
 * Rewrites the hard-coded locale map
 *
 *     var b = { en: h.default, ro: m.default, tr: v.default };
 *
 * into
 *
 *     var b = window.LTPI18n.register({ en: ..., ro: ..., tr: ... },
 *                                     { format: n(81), buildFormattingTokensRegExp: n(135),
 *                                       fallbackDateLocale: n(224) });
 *
 * Works on the minified bundle and on a beautified copy. The input file is
 * never modified in place unless -o points back at it.
 *
 * --fix-encoding is for the rare case where the translation DATA is genuinely
 * double-encoded. Run tools/audit.js first: if it reports damage outside the
 * dictionaries too, the file you have was mangled by a beautifier and you want
 * the original, not this flag.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { repairDeep } = require('./lib/mojibake');
const B = require('./lib/bundle');

function die(msg) { console.error('ERROR: ' + msg); process.exit(1); }

function fixEncoding(source) {
  let out = source.replace(/"((?:[^"\\]|\\.)*)"/g, (whole, body) => {
    const fixed = repairDeep(body);
    return fixed === body ? whole : '"' + fixed + '"';
  });
  out = out.replace(/'((?:[^'\\]|\\.)*)'/g, (whole, body) => {
    const fixed = repairDeep(body);
    return fixed === body ? whole : "'" + fixed + "'";
  });
  return out;
}

function buildHook(source, map) {
  const en = map.entries.find(e => e.code === 'en');
  if (!en) die('the locale map has no "en" entry');
  const ids = B.findDateEngineIds(source, en.expr);
  if (!ids || ids.buildRegExp === null) {
    die('could not resolve the date-fns modules from the English wrapper');
  }
  const pairs = map.entries.map(e => e.code + ': ' + e.expr).join(', ');
  return {
    text: 'var ' + map.varName + ' = window.LTPI18n.register({ ' + pairs + ' }, ' +
      '{ format: n(' + ids.format + '), buildFormattingTokensRegExp: n(' + ids.buildRegExp + '), ' +
      'fallbackDateLocale: n(' + ids.enDateLocale + ') });',
    ids,
  };
}

function patch(source) {
  const changes = [];
  if (/LTPI18n\s*\.\s*register/.test(source)) {
    changes.push('locale map: already patched, left alone');
    return { source, changes };
  }
  const map = B.findLocaleMap(source);
  if (!map) {
    die('could not find the locale map `var X = { en: .., ro: .., ... }`.\n' +
        '       Check that this is the Product Selector bundle.');
  }
  const hook = buildHook(source, map);
  const out = source.slice(0, map.index) + hook.text + source.slice(map.index + map.length);
  changes.push('locale map: hooked via LTPI18n.register ' +
    '(built-in: ' + map.entries.map(e => e.code).join(', ') + '; ' +
    'format=n(' + hook.ids.format + '), buildRegExp=n(' + hook.ids.buildRegExp + '), ' +
    'enDateLocale=n(' + hook.ids.enDateLocale + '))');
  return { source: out, changes };
}

function main() {
  const argv = process.argv.slice(2);
  const flags = new Set(argv.filter(a => a.startsWith('--')));
  const oIdx = argv.indexOf('-o');
  const output = oIdx !== -1 ? argv[oIdx + 1] : null;
  const positional = argv.filter((a, i) =>
    !a.startsWith('--') && a !== '-o' && !(oIdx !== -1 && i === oIdx + 1));
  const input = positional[0];

  if (!input) die('usage: node tools/patch-bundle.js <bundle.js> [-o out.js] [--fix-encoding] [--dry-run]');
  if (!fs.existsSync(input)) die('no such file: ' + input);

  const original = fs.readFileSync(input, 'utf8');
  let { source, changes } = patch(original);

  if (flags.has('--fix-encoding')) {
    const before = source;
    source = fixEncoding(source);
    changes.push(before === source
      ? 'encoding: nothing to repair'
      : 'encoding: repaired double-encoded text inside string literals');
  }

  console.log('patch-bundle.js');
  console.log('  input : ' + path.resolve(input));
  changes.forEach(c => console.log('  - ' + c));

  if (flags.has('--dry-run')) { console.log('  (dry run - nothing written)'); return; }
  if (source === original) { console.log('  no changes needed'); return; }

  const out = output || input.replace(/\.js$/, '') + '.patched.js';
  fs.writeFileSync(out, source);
  console.log('  output: ' + path.resolve(out));
}

if (require.main === module) main();
module.exports = { patch, fixEncoding, buildHook };
