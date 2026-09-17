#!/usr/bin/env node
/*
 * patch-bundle.js - apply the one-line hook to the Product Selector bundle.
 *
 *   node tools/patch-bundle.js <bundle.js> [-o out.js] [--fix-encoding] [--dry-run]
 *
 * It rewrites the hard-coded locale map
 *
 *     var b = { en: h.default, ro: m.default, tr: v.default };
 *
 * into
 *
 *     var b = window.LTPI18n.register({ en: ..., ro: ..., tr: ... },
 *                                     { format: n(81), buildFormattingTokensRegExp: n(135),
 *                                       fallbackDateLocale: n(224) });
 *
 * Works on the readable build and on the minified one (whitespace-insensitive).
 * The input file is never modified in place unless -o points back at it.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { repairDeep } = require('./lib/mojibake');

function die(msg) { console.error('ERROR: ' + msg); process.exit(1); }

// Match `var X = { en: A, ro: B, tr: C };` with any identifiers and any spacing,
// so the same patch works before and after minification.
const MAP_RE = /var\s+([A-Za-z_$][\w$]*)\s*=\s*\{\s*en\s*:\s*([^,{}]+?)\s*,\s*ro\s*:\s*([^,{}]+?)\s*,\s*tr\s*:\s*([^,{}]+?)\s*\}\s*;/;

// ---------------------------------------------------------------- module index
//
// Pull the source of each top-level webpack module by evaluating the module
// array. This is authoritative - no brace counting, no indentation guessing.
let MODULE_SOURCES = null;
function moduleSources(source) {
  if (MODULE_SOURCES) return MODULE_SOURCES;
  const a = source.indexOf('})([');
  const b = source.lastIndexOf(']);');
  if (a < 0 || b < 0) { MODULE_SOURCES = []; return MODULE_SOURCES; }
  let arr;
  try {
    arr = eval('(' + source.slice(a + 3, b + 1) + ')');
  } catch (e) {
    MODULE_SOURCES = [];
    return MODULE_SOURCES;
  }
  MODULE_SOURCES = arr.map(f => f.toString());
  return MODULE_SOURCES;
}

function moduleBody(source, id) {
  return moduleSources(source)[Number(id)] || null;
}

// The module that builds { formatters, formattingTokensRegExp } requires
// buildFormattingTokensRegExp as its only dependency.
function findBuildRegExpId(source) {
  const all = moduleSources(source);
  for (let i = 0; i < all.length; i++) {
    if (/formattingTokensRegExp:\s*\w+\(/.test(all[i])) {
      const inner = /var\s+(\w+)\s*=\s*n\(\s*(\d+)\s*\)/.exec(all[i]);
      if (inner) return inner[2];
    }
  }
  return null;
}

// Resolve the webpack module ids for date-fns `format`, the token-regexp builder
// and the English date locale, by reading the English locale wrapper module.
// Reading them (instead of hard-coding) means a rebuild that renumbers modules
// still patches correctly.
function findDateEngineIds(source, enExpr) {
  const varName = String(enExpr).split('.')[0].trim();
  const wrapRe = new RegExp(varName + '\\s*=\\s*[A-Za-z_$][\\w$]*\\(\\s*n\\(\\s*(\\d+)\\s*\\)\\s*\\)');
  const w = wrapRe.exec(source);
  if (!w) die('could not resolve the English locale wrapper module id from `' + enExpr + '`');
  const wrapperId = w[1];

  const body = moduleBody(source, wrapperId);
  if (!body) die('could not read module ' + wrapperId + ' from the bundle');

  // Inside the wrapper: r = s(n(81)) -> date-fns format, o = s(n(224)) -> en locale
  const ids = Array.from(body.matchAll(/n\(\s*(\d+)\s*\)/g)).map(x => x[1]);
  if (ids.length < 2) die('module ' + wrapperId + ' does not look like a locale wrapper');

  const buildRegExpId = findBuildRegExpId(source);
  if (!buildRegExpId) die('could not locate the buildFormattingTokensRegExp module');

  return { format: ids[0], enDateLocale: ids[1], buildRegExp: buildRegExpId, wrapperId };
}

// Repair double-encoded text, but only inside string literals so code is safe.
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

// --------------------------------------------------------------------- main
function main() {
  const argv = process.argv.slice(2);
  const flags = new Set(argv.filter(a => a.startsWith('--')));
  const oIdx = argv.indexOf('-o');
  const output = oIdx !== -1 ? argv[oIdx + 1] : null;
  // skip flags, the -o switch itself, and (only when -o is present) its value
  const positional = argv.filter((a, i) =>
    !a.startsWith('--') && a !== '-o' && !(oIdx !== -1 && i === oIdx + 1));
  const input = positional[0];

  if (!input) die('usage: node tools/patch-bundle.js <bundle.js> [-o out.js] [--fix-encoding] [--dry-run]');
  if (!fs.existsSync(input)) die('no such file: ' + input);

  let src = fs.readFileSync(input, 'utf8');
  const original = src;
  const changes = [];

  // 1. locale map
  if (/LTPI18n\s*\.\s*register/.test(src)) {
    changes.push('locale map: already patched, left alone');
  } else {
    const m = MAP_RE.exec(src);
    if (!m) {
      die('could not find the locale map `var X = { en: .., ro: .., tr: .. };`.\n' +
          '       If the bundle was rebuilt with a different language set, update MAP_RE in this script.');
    }
    const ids = findDateEngineIds(src, m[2]);
    const replacement =
      'var ' + m[1] + ' = window.LTPI18n.register(' +
      '{ en: ' + m[2] + ', ro: ' + m[3] + ', tr: ' + m[4] + ' }, ' +
      '{ format: n(' + ids.format + '), buildFormattingTokensRegExp: n(' + ids.buildRegExp + '), ' +
      'fallbackDateLocale: n(' + ids.enDateLocale + ') });';
    src = src.slice(0, m.index) + replacement + src.slice(m.index + m[0].length);
    changes.push('locale map: hooked via LTPI18n.register ' +
                 '(format=n(' + ids.format + '), buildRegExp=n(' + ids.buildRegExp + '), ' +
                 'enDateLocale=n(' + ids.enDateLocale + '), from wrapper module ' + ids.wrapperId + ')');
  }

  // 2. encoding
  if (flags.has('--fix-encoding')) {
    const before = src;
    src = fixEncoding(src);
    changes.push(before === src
      ? 'encoding: nothing to repair'
      : 'encoding: repaired double-encoded text inside string literals');
  }

  console.log('patch-bundle.js');
  console.log('  input : ' + path.resolve(input));
  changes.forEach(c => console.log('  - ' + c));

  if (flags.has('--dry-run')) {
    console.log('  (dry run - nothing written)');
    return;
  }
  if (src === original) {
    console.log('  no changes needed');
    return;
  }
  const out = output || input.replace(/\.js$/, '') + '.patched.js';
  fs.writeFileSync(out, src);
  console.log('  output: ' + path.resolve(out));
}

main();
