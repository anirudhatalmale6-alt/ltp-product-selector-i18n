#!/usr/bin/env node
/*
 * make-sheet.js - produce a spreadsheet for a translator to fill in.
 *
 *   node tools/make-sheet.js <bundle.js> -o german.csv [--from locales/pl.json]
 *
 * Column A is the English text the app asks for (do not edit).
 * Column B is where the translation goes.
 * Column C flags any placeholders that must be preserved.
 *
 * --from pre-fills column B from an existing locale, useful for revising a
 * language rather than starting fresh.
 *
 * Opens in Excel, Numbers or Google Sheets. Feed it back through
 * tools/sheet-to-locale.js.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const B = require('./lib/bundle');
const csv = require('./lib/csv');

function die(msg) { console.error('ERROR: ' + msg); process.exit(1); }

const argv = process.argv.slice(2);
const oIdx = argv.indexOf('-o');
const fIdx = argv.indexOf('--from');
const output = oIdx !== -1 ? argv[oIdx + 1] : null;
const from = fIdx !== -1 ? argv[fIdx + 1] : null;
const input = argv.filter((a, i) =>
  !a.startsWith('-') &&
  !(oIdx !== -1 && i === oIdx + 1) &&
  !(fIdx !== -1 && i === fIdx + 1))[0];

if (!input || !output) die('usage: node tools/make-sheet.js <bundle.js> -o <out.csv> [--from locale.json]');
if (!fs.existsSync(input)) die('no such file: ' + input);

const source = fs.readFileSync(input, 'utf8');
const dicts = B.findDictionaries(source);
const english = dicts.find(d => String(d.lang).indexOf('en') === 0);
if (!english) die('could not find the English dictionary in this bundle');

let prefill = {};
if (from) {
  if (!fs.existsSync(from)) die('no such file: ' + from);
  const j = JSON.parse(fs.readFileSync(from, 'utf8'));
  prefill = j.messages || {};
}

// The English dictionary is NOT the full list of translatable phrases: English
// falls through to the source string, so a phrase can be translated in other
// languages without ever appearing in the English dictionary ("Loading..." is
// in ro/tr/pl but not in en). Use the union of every dictionary.
const enKeys = new Set(Object.keys(english.dict).filter(k => k !== ''));
const union = new Map();   // key -> which languages already have it
for (const d of dicts) {
  for (const k of Object.keys(d.dict)) {
    if (k === '') continue;
    if (!union.has(k)) union.set(k, []);
    union.get(k).push(String(d.lang).split('_')[0]);
  }
}
const keys = [...enKeys, ...[...union.keys()].filter(k => !enKeys.has(k))];

const rows = [['English (do not edit)', 'Translation', 'Placeholders to keep', 'Notes']];
for (const k of keys) {
  const ph = (k.match(/\{[0-9]\}/g) || []).join(' ');
  const existing = prefill[k] && prefill[k][0] ? prefill[k][0] : '';
  const note = enKeys.has(k) ? '' :
    'not in the English dictionary; translated in ' + union.get(k).join('/');
  rows.push([k, existing, ph, note]);
}

fs.writeFileSync(output, csv.write(rows));

console.log('make-sheet.js');
console.log('  bundle : ' + path.resolve(input));
console.log('  phrases: ' + keys.length);
if (from) console.log('  prefill: ' + path.resolve(from));
console.log('  output : ' + path.resolve(output));
console.log('');
console.log('  Give this to the translator. They fill column B only.');
console.log('  Rows with something in column C must keep those markers -');
console.log('  they are replaced with the year, registration number, etc.');
