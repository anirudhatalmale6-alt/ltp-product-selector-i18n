#!/usr/bin/env node
/*
 * sheet-to-locale.js - turn a filled-in translator sheet into a locale file.
 *
 *   node tools/sheet-to-locale.js german.csv --code de --name German -o locales/de.json
 *
 * Checks as it goes, because these are the mistakes that actually happen:
 *   - blank translations (the phrase would silently show in English)
 *   - dropped {0}/{1} placeholders (the value would vanish from the sentence)
 *   - invented placeholders that the app will never fill
 *   - a plural rule that does not match the language
 *
 * Exits non-zero if anything would break at runtime, so it can gate a build.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const csv = require('./lib/csv');

function die(msg) { console.error('ERROR: ' + msg); process.exit(1); }

const PLURALS = {
  en: 'nplurals=2; plural=(n != 1);', de: 'nplurals=2; plural=(n != 1);',
  nl: 'nplurals=2; plural=(n != 1);', it: 'nplurals=2; plural=(n != 1);',
  es: 'nplurals=2; plural=(n != 1);', tr: 'nplurals=2; plural=(n != 1);',
  hu: 'nplurals=2; plural=(n != 1);', el: 'nplurals=2; plural=(n != 1);',
  bg: 'nplurals=2; plural=(n != 1);', sv: 'nplurals=2; plural=(n != 1);',
  da: 'nplurals=2; plural=(n != 1);', no: 'nplurals=2; plural=(n != 1);',
  fi: 'nplurals=2; plural=(n != 1);', et: 'nplurals=2; plural=(n != 1);',
  fr: 'nplurals=2; plural=(n > 1);',  pt: 'nplurals=2; plural=(n > 1);',
  ro: 'nplurals=3; plural=(n==1 ? 0 : n==0 || (n!=1 && n%100>=1 && n%100<=19) ? 1 : 2);',
  pl: 'nplurals=3; plural=(n==1 ? 0 : n%10>=2 && n%10<=4 && (n%100<12 || n%100>14) ? 1 : 2);',
  cs: 'nplurals=3; plural=(n==1) ? 0 : (n>=2 && n<=4) ? 1 : 2;',
  sk: 'nplurals=3; plural=(n==1) ? 0 : (n>=2 && n<=4) ? 1 : 2;',
  ru: 'nplurals=3; plural=(n%10==1 && n%100!=11 ? 0 : n%10>=2 && n%10<=4 && (n%100<12 || n%100>14) ? 1 : 2);',
  uk: 'nplurals=3; plural=(n%10==1 && n%100!=11 ? 0 : n%10>=2 && n%10<=4 && (n%100<12 || n%100>14) ? 1 : 2);',
  hr: 'nplurals=3; plural=(n%10==1 && n%100!=11 ? 0 : n%10>=2 && n%10<=4 && (n%100<12 || n%100>14) ? 1 : 2);',
  ja: 'nplurals=1; plural=0;', zh: 'nplurals=1; plural=0;', ko: 'nplurals=1; plural=0;',
};

const argv = process.argv.slice(2);
function opt(name) { const i = argv.indexOf(name); return i !== -1 ? argv[i + 1] : null; }

const code = opt('--code');
const name = opt('--name');
const output = opt('-o');
const input = argv.filter((a, i) => !a.startsWith('-') &&
  !['--code', '--name', '-o', '--column'].some(f => argv.indexOf(f) !== -1 && i === argv.indexOf(f) + 1))[0];

if (!input || !code || !output) {
  die('usage: node tools/sheet-to-locale.js <sheet.csv> --code <xx> --name <Name> -o <out.json>');
}
if (!fs.existsSync(input)) die('no such file: ' + input);

console.log('sheet-to-locale.js');
console.log('  sheet   : ' + path.resolve(input));
console.log('  language: ' + code + (name ? ' (' + name + ')' : ''));

const rows = csv.parse(fs.readFileSync(input, 'utf8'));
if (rows.length < 2) die('the sheet has no rows');

const header = rows[0] || [];
const hasHeader = /english/i.test(header[0] || '');
const start = hasHeader ? 1 : 0;

// Which column holds this language? A multi-language sheet labels each column
// "French (fr)"; a single-language sheet just has "Translation".
let col = 1;
if (hasHeader) {
  const byCode = header.findIndex(h => new RegExp('\\(\\s*' + code + '\\s*\\)', 'i').test(h || ''));
  const byName = opt('--column')
    ? header.findIndex(h => String(h || '').toLowerCase().includes(String(opt('--column')).toLowerCase()))
    : -1;
  const generic = header.findIndex(h => /^translation$/i.test(String(h || '').trim()));
  col = byName !== -1 ? byName : (byCode !== -1 ? byCode : generic);
  if (col === -1) {
    die('could not find a column for "' + code + '" in this sheet.\n' +
        '       columns are: ' + header.map((h, i) => i + '=' + JSON.stringify(h)).join(', ') + '\n' +
        '       pass --column "<header text>" to choose one explicitly.');
  }
}
console.log('  column  : ' + col + (hasHeader ? ' (' + JSON.stringify(header[col]) + ')' : ''));

const placeholders = s => (String(s).match(/\{[0-9]\}/g) || []).sort().join(',');

const messages = {};
const blank = [], phMissing = [], phExtra = [];

for (let i = start; i < rows.length; i++) {
  const source = rows[i][0];
  if (!source) continue;
  const value = (rows[i][col] || '').trim();
  if (!value) { blank.push(source); continue; }

  const want = placeholders(source);
  const got = placeholders(value);
  if (want !== got) {
    const wantSet = new Set(source.match(/\{[0-9]\}/g) || []);
    const gotSet = new Set(value.match(/\{[0-9]\}/g) || []);
    const missing = [...wantSet].filter(p => !gotSet.has(p));
    const extra = [...gotSet].filter(p => !wantSet.has(p));
    if (missing.length) phMissing.push({ source, missing });
    if (extra.length) phExtra.push({ source, extra });
  }
  messages[source] = [value];
}

const plural = PLURALS[code];
if (!plural) {
  console.log('NOTE: no built-in plural rule for "' + code + '" - defaulting to the 2-form rule.');
  console.log('      Check it against https://www.gnu.org/software/gettext/manual/html_node/Plural-forms.html');
}
messages[''] = {
  domain: 'messages',
  plural_forms: plural || 'nplurals=2; plural=(n != 1);',
  lang: code,
};

// report
console.log('  filled  : ' + (Object.keys(messages).length - 1) + ' phrases');

let fatal = 0;
if (blank.length) {
  console.log('\n  [WARN] ' + blank.length + ' phrase(s) left blank - these will show in English:');
  blank.slice(0, 8).forEach(s => console.log('         ' + JSON.stringify(s.slice(0, 64))));
  if (blank.length > 8) console.log('         ... and ' + (blank.length - 8) + ' more');
}
if (phMissing.length) {
  console.log('\n  [BROKEN] ' + phMissing.length + ' translation(s) dropped a placeholder.');
  console.log('           The value it stands for will not appear on the page at all:');
  phMissing.forEach(p => console.log('         ' + p.missing.join(' ') + '  missing from  ' +
    JSON.stringify(p.source.slice(0, 56))));
  fatal += phMissing.length;
}
if (phExtra.length) {
  console.log('\n  [BROKEN] ' + phExtra.length + ' translation(s) contain a placeholder the app never fills:');
  phExtra.forEach(p => console.log('         ' + p.extra.join(' ') + '  invented in  ' +
    JSON.stringify(p.source.slice(0, 56))));
  fatal += phExtra.length;
}

if (fatal) {
  console.log('\n  Not written. Fix the rows above and run again.');
  process.exit(1);
}

const out = { code, name: name || code, messages };
fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
fs.writeFileSync(output, JSON.stringify(out, null, 2) + '\n');
console.log('\n  output  : ' + path.resolve(output));
console.log('  Next: node tools/build.js <bundle.js> -o dist/main.js ' + output);
