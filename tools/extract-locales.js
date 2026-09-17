#!/usr/bin/env node
/*
 * extract-locales.js - pull the translation dictionaries out of the bundle
 * into plain JSON files.
 *
 *   node tools/extract-locales.js <bundle.js> [-d locales/] [--repair]
 *
 * Every dictionary is written out, including any that are present but not
 * wired into the locale map - those are reported explicitly, because an
 * unwired dictionary is dead weight that renders as English.
 *
 * --repair undoes double-encoding on the way out. Only use it when
 * tools/audit.js says the damage is confined to the dictionaries; if the whole
 * file was transcoded by a beautifier, extract from the original instead.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { repairTree } = require('./lib/mojibake');
const B = require('./lib/bundle');

function die(msg) { console.error('ERROR: ' + msg); process.exit(1); }

const KNOWN_PLURALS = {
  en: 'nplurals=2; plural=(n != 1);',
  de: 'nplurals=2; plural=(n != 1);',
  nl: 'nplurals=2; plural=(n != 1);',
  it: 'nplurals=2; plural=(n != 1);',
  es: 'nplurals=2; plural=(n != 1);',
  tr: 'nplurals=2; plural=(n != 1);',
  hu: 'nplurals=2; plural=(n != 1);',
  el: 'nplurals=2; plural=(n != 1);',
  bg: 'nplurals=2; plural=(n != 1);',
  fr: 'nplurals=2; plural=(n > 1);',
  pt: 'nplurals=2; plural=(n > 1);',
  ro: 'nplurals=3; plural=(n==1 ? 0 : n==0 || (n!=1 && n%100>=1 && n%100<=19) ? 1 : 2);',
  pl: 'nplurals=3; plural=(n==1 ? 0 : n%10>=2 && n%10<=4 && (n%100<12 || n%100>14) ? 1 : 2);',
  cs: 'nplurals=3; plural=(n==1) ? 0 : (n>=2 && n<=4) ? 1 : 2;',
  sk: 'nplurals=3; plural=(n==1) ? 0 : (n>=2 && n<=4) ? 1 : 2;',
  ru: 'nplurals=3; plural=(n%10==1 && n%100!=11 ? 0 : n%10>=2 && n%10<=4 && (n%100<12 || n%100>14) ? 1 : 2);',
  uk: 'nplurals=3; plural=(n%10==1 && n%100!=11 ? 0 : n%10>=2 && n%10<=4 && (n%100<12 || n%100>14) ? 1 : 2);',
  hr: 'nplurals=3; plural=(n%10==1 && n%100!=11 ? 0 : n%10>=2 && n%10<=4 && (n%100<12 || n%100>14) ? 1 : 2);',
};

function main() {
  const argv = process.argv.slice(2);
  const flags = new Set(argv.filter(a => a.startsWith('--')));
  const dIdx = argv.indexOf('-d');
  const outDir = dIdx !== -1 ? argv[dIdx + 1] : path.join(process.cwd(), 'locales');
  const input = argv.filter((a, i) =>
    !a.startsWith('-') && !(dIdx !== -1 && i === dIdx + 1))[0];

  if (!input) die('usage: node tools/extract-locales.js <bundle.js> [-d locales/] [--repair]');
  if (!fs.existsSync(input)) die('no such file: ' + input);

  const source = fs.readFileSync(input, 'utf8');
  const dicts = B.findDictionaries(source);
  if (!dicts.length) die('no translation dictionaries found in this bundle');

  fs.mkdirSync(outDir, { recursive: true });
  console.log('extract-locales.js');
  console.log('  bundle : ' + path.resolve(input));
  console.log('  out dir: ' + path.resolve(outDir));
  console.log('  repair : ' + (flags.has('--repair') ? 'ON' : 'off (text copied verbatim)'));
  console.log('');

  for (const { id, dict, lang } of dicts) {
    const code = String(lang).split('_')[0];
    const messages = flags.has('--repair') ? repairTree(dict) : dict;
    const wired = B.isReferenced(source, id);

    let changed = 0;
    if (flags.has('--repair')) {
      for (const k of Object.keys(dict)) {
        if (JSON.stringify(dict[k]) !== JSON.stringify(messages[k])) changed++;
      }
    }

    const expected = KNOWN_PLURALS[code];
    const actual = dict[''].plural_forms;
    const pluralWrong = expected && actual !== expected;
    if (pluralWrong) messages[''].plural_forms = expected;

    const out = {
      code,
      name: lang,
      messages,
      _note: 'Extracted from ' + path.basename(input) + ', module ' + id + '.',
    };
    fs.writeFileSync(path.join(outDir, code + '.json'), JSON.stringify(out, null, 2) + '\n');

    console.log('  ' + code.padEnd(6) + 'module ' + String(id).padEnd(5) +
      (Object.keys(dict).length - 1) + ' phrases' +
      (wired ? '' : '   <-- NOT WIRED INTO THE LOCALE MAP (renders as English)'));
    if (changed) console.log('         repaired encoding in ' + changed + ' entries');
    if (pluralWrong) {
      console.log('         plural rule corrected for "' + code + '"');
      console.log('           was: ' + actual);
      console.log('           now: ' + expected);
    }
  }
}

main();
