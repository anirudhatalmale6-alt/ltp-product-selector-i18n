#!/usr/bin/env node
/*
 * make-sheet.js - produce a spreadsheet for translators to fill in.
 *
 *   # one language
 *   node tools/make-sheet.js <bundle.js> -o german.csv
 *   node tools/make-sheet.js <bundle.js> -o polish.csv --from locales/pl.json
 *
 *   # several languages in one sheet, one column each
 *   node tools/make-sheet.js <bundle.js> -o all.csv --languages cs,bg,nl,fr,it,es
 *
 * Layout:
 *   A  English (do not edit)
 *   B  Placeholders to keep
 *   C  Notes
 *   D+ one column per language
 *
 * Feed it back through tools/sheet-to-locale.js.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const B = require('./lib/bundle');
const csv = require('./lib/csv');

function die(msg) { console.error('ERROR: ' + msg); process.exit(1); }

const LANGUAGE_NAMES = {
  cs: 'Czech', bg: 'Bulgarian', nl: 'Dutch', fr: 'French', it: 'Italian',
  es: 'Spanish', de: 'German', pt: 'Portuguese', pl: 'Polish', ro: 'Romanian',
  tr: 'Turkish', ru: 'Russian', uk: 'Ukrainian', hu: 'Hungarian', el: 'Greek',
  sk: 'Slovak', hr: 'Croatian', sv: 'Swedish', da: 'Danish', fi: 'Finnish',
  no: 'Norwegian', et: 'Estonian', ja: 'Japanese', zh: 'Chinese', ko: 'Korean',
};

const argv = process.argv.slice(2);
function opt(name) { const i = argv.indexOf(name); return i !== -1 ? argv[i + 1] : null; }
const output = opt('-o');
const from = opt('--from');
const languages = (opt('--languages') || '').split(',').map(s => s.trim()).filter(Boolean);

const consumed = new Set();
['-o', '--from', '--languages'].forEach(f => {
  const i = argv.indexOf(f);
  if (i !== -1) { consumed.add(i); consumed.add(i + 1); }
});
const input = argv.filter((a, i) => !consumed.has(i) && !a.startsWith('-'))[0];

if (!input || !output) {
  die('usage: node tools/make-sheet.js <bundle.js> -o <out.csv> [--from locale.json] [--languages cs,fr,es]');
}
if (!fs.existsSync(input)) die('no such file: ' + input);

const source = fs.readFileSync(input, 'utf8');
const dicts = B.findDictionaries(source);
const english = dicts.find(d => String(d.lang).indexOf('en') === 0);
if (!english) die('could not find the English dictionary in this bundle');

let prefill = {};
if (from) {
  if (!fs.existsSync(from)) die('no such file: ' + from);
  prefill = (JSON.parse(fs.readFileSync(from, 'utf8')).messages) || {};
}

// The English dictionary is NOT the full list of translatable phrases: English
// falls through to the source string in the code, so a phrase can be live in
// other languages while absent from `en` ("Loading..." is in ro/tr/pl but not
// in en). Use the union of every dictionary.
const enKeys = new Set(Object.keys(english.dict).filter(k => k !== ''));
const union = new Map();
for (const d of dicts) {
  for (const k of Object.keys(d.dict)) {
    if (k === '') continue;
    if (!union.has(k)) union.set(k, []);
    union.get(k).push(String(d.lang).split('_')[0]);
  }
}
const keys = [...enKeys, ...[...union.keys()].filter(k => !enKeys.has(k))];

const header = ['English (do not edit)', 'Placeholders to keep', 'Notes'];
if (languages.length) {
  languages.forEach(c => header.push((LANGUAGE_NAMES[c] || c.toUpperCase()) + ' (' + c + ')'));
} else {
  header.push('Translation');
}

const rows = [header];
for (const k of keys) {
  const ph = (k.match(/\{[0-9]\}/g) || []).join(' ');
  const note = enKeys.has(k) ? '' :
    'not in the English dictionary; translated in ' + union.get(k).join('/');
  const row = [k, ph, note];
  if (languages.length) {
    languages.forEach(() => row.push(''));
  } else {
    row.push(prefill[k] && prefill[k][0] ? prefill[k][0] : '');
  }
  rows.push(row);
}

fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
fs.writeFileSync(output, csv.write(rows));

console.log('make-sheet.js');
console.log('  bundle : ' + path.resolve(input));
console.log('  phrases: ' + keys.length + '  (' + enKeys.size + ' from the English dictionary, ' +
  (keys.length - enKeys.size) + ' translated only in other languages)');
if (languages.length) console.log('  columns: ' + languages.join(', '));
if (from) console.log('  prefill: ' + path.resolve(from));
console.log('  output : ' + path.resolve(output));
console.log('');
console.log('  Translators fill only their own column.');
console.log('  Any marker shown in column B must appear in the translation too -');
console.log('  those are replaced at runtime with the year, registration number, etc.');
