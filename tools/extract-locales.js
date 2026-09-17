#!/usr/bin/env node
/*
 * extract-locales.js - pull the translation dictionaries out of the bundle
 * into plain JSON files, repairing double-encoded text on the way.
 *
 *   node tools/extract-locales.js <bundle.js> [-d locales/]
 *
 * Every dictionary the bundle contains is written out, including any that are
 * present but not wired into the locale map (those are reported explicitly -
 * an unwired dictionary is dead weight and renders as English).
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { repairTree } = require('./lib/mojibake');

function die(msg) { console.error('ERROR: ' + msg); process.exit(1); }

// Well-known plural rules, used to flag headers that disagree with the language.
const KNOWN_PLURALS = {
  en: 'nplurals=2; plural=(n != 1);',
  de: 'nplurals=2; plural=(n != 1);',
  nl: 'nplurals=2; plural=(n != 1);',
  it: 'nplurals=2; plural=(n != 1);',
  es: 'nplurals=2; plural=(n != 1);',
  tr: 'nplurals=2; plural=(n != 1);',
  fr: 'nplurals=2; plural=(n > 1);',
  pt: 'nplurals=2; plural=(n > 1);',
  ro: 'nplurals=3; plural=(n==1 ? 0 : n==0 || (n!=1 && n%100>=1 && n%100<=19) ? 1 : 2);',
  pl: 'nplurals=3; plural=(n==1 ? 0 : n%10>=2 && n%10<=4 && (n%100<12 || n%100>14) ? 1 : 2);',
  cs: 'nplurals=3; plural=(n==1) ? 0 : (n>=2 && n<=4) ? 1 : 2;',
  sk: 'nplurals=3; plural=(n==1) ? 0 : (n>=2 && n<=4) ? 1 : 2;',
  ru: 'nplurals=3; plural=(n%10==1 && n%100!=11 ? 0 : n%10>=2 && n%10<=4 && (n%100<12 || n%100>14) ? 1 : 2);',
  uk: 'nplurals=3; plural=(n%10==1 && n%100!=11 ? 0 : n%10>=2 && n%10<=4 && (n%100<12 || n%100>14) ? 1 : 2);',
  hu: 'nplurals=2; plural=(n != 1);',
  el: 'nplurals=2; plural=(n != 1);',
  bg: 'nplurals=2; plural=(n != 1);',
  hr: 'nplurals=3; plural=(n%10==1 && n%100!=11 ? 0 : n%10>=2 && n%10<=4 && (n%100<12 || n%100>14) ? 1 : 2);',
};

function loadModules(source) {
  const a = source.indexOf('})([');
  const b = source.lastIndexOf(']);');
  if (a < 0 || b < 0) die('this does not look like the Product Selector webpack bundle');
  let arr;
  try { arr = eval('(' + source.slice(a + 3, b + 1) + ')'); }
  catch (e) { die('could not read the module array: ' + e.message); }
  return arr;
}

function main() {
  const argv = process.argv.slice(2);
  const dIdx = argv.indexOf('-d');
  const outDir = dIdx !== -1 ? argv[dIdx + 1] : path.join(process.cwd(), 'locales');
  const input = argv.filter((a, i) => !a.startsWith('-') && !(dIdx !== -1 && i === dIdx + 1))[0];

  if (!input) die('usage: node tools/extract-locales.js <bundle.js> [-d locales/]');
  if (!fs.existsSync(input)) die('no such file: ' + input);

  const source = fs.readFileSync(input, 'utf8');
  const mods = loadModules(source);

  // Which module ids are referenced as phrase dictionaries, and under which code?
  // The locale map names the wrapper modules; each wrapper requires its dictionary.
  const mapMatch = /\{\s*en\s*:\s*([\w$]+)\.default\s*,\s*ro\s*:\s*([\w$]+)\.default\s*,\s*tr\s*:\s*([\w$]+)\.default\s*\}/.exec(source);
  const wiredDictIds = new Set();
  if (mapMatch) {
    for (const varName of [mapMatch[1], mapMatch[2], mapMatch[3]]) {
      const w = new RegExp(varName + '\\s*=\\s*[\\w$]+\\(\\s*n\\(\\s*(\\d+)\\s*\\)\\s*\\)').exec(source);
      if (!w) continue;
      const body = mods[Number(w[1])] ? mods[Number(w[1])].toString() : '';
      const ids = Array.from(body.matchAll(/n\(\s*(\d+)\s*\)/g)).map(x => Number(x[1]));
      if (ids.length) wiredDictIds.add(ids[ids.length - 1]); // dictionary is the last require
    }
  }

  // A dictionary module is one whose exports is an object with a "" gettext header.
  const found = [];
  for (let id = 0; id < mods.length; id++) {
    const m = { exports: {} };
    let exp;
    try {
      const src = mods[id].toString();
      if (!/t\.exports\s*=\s*\{/.test(src) || !/"":\s*\{/.test(src)) continue;
      const fn = eval('(' + src + ')');
      fn(m, m.exports, () => ({}));
      exp = m.exports;
    } catch (e) { continue; }
    if (!exp || typeof exp !== 'object' || !exp['']) continue;
    found.push({ id, dict: exp });
  }

  if (!found.length) die('no translation dictionaries found in this bundle');

  fs.mkdirSync(outDir, { recursive: true });
  console.log('extract-locales.js');
  console.log('  bundle : ' + path.resolve(input));
  console.log('  out dir: ' + path.resolve(outDir));
  console.log('');

  for (const { id, dict } of found) {
    const header = dict[''] || {};
    const code = (header.lang || ('module' + id)).split('_')[0];
    const repaired = repairTree(dict);
    const wired = wiredDictIds.has(id);

    // count how many entries the repair actually changed
    let changed = 0;
    for (const k of Object.keys(dict)) {
      if (JSON.stringify(dict[k]) !== JSON.stringify(repaired[k])) changed++;
    }

    const expected = KNOWN_PLURALS[code];
    const actual = header.plural_forms;
    const pluralNote = expected && actual !== expected
      ? '  PLURAL RULE LOOKS WRONG for "' + code + '"\n' +
        '        in bundle: ' + actual + '\n' +
        '        expected : ' + expected
      : null;
    if (pluralNote) repaired[''].plural_forms = expected;

    const out = {
      code: code,
      name: header.lang,
      messages: repaired,
      _note: 'Extracted from ' + path.basename(input) + ' module ' + id + '.'
    };
    const file = path.join(outDir, code + '.json');
    fs.writeFileSync(file, JSON.stringify(out, null, 2) + '\n');

    console.log('  ' + code.padEnd(6) + ' module ' + String(id).padEnd(5) +
                Object.keys(dict).length + ' entries' +
                (wired ? '' : '   <-- NOT WIRED INTO THE LOCALE MAP (renders as English)'));
    if (changed) console.log('         repaired encoding in ' + changed + ' entries');
    if (pluralNote) console.log('     ' + pluralNote + '\n        -> corrected in ' + code + '.json');
  }
}

main();
