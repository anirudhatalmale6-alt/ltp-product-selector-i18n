#!/usr/bin/env node
/*
 * make-corrections-sheet.js - list only the cells that need fixing.
 *
 *   node tools/make-corrections-sheet.js <bundle.js> -o corrections.csv locales/*.json
 *
 * Sending a translator the whole 40-row sheet again and saying "some of these
 * are wrong" wastes their time and invites fresh mistakes. This produces a short
 * sheet containing only the problem cells, with what is wrong and why.
 *
 * It covers:
 *   - placeholders dropped or invented
 *   - phrases left identical to the English source
 *   - the false-friend checks from check-translations.js
 *   - languages compiled into the bundle that were not in the sheet at all
 */

'use strict';

const fs = require('fs');
const path = require('path');
const csv = require('./lib/csv');
const B = require('./lib/bundle');

function die(m) { console.error('ERROR: ' + m); process.exit(1); }

const FALSE_FRIENDS = [
  {
    key: 'No matches available',
    means: 'no results / no matching products were found',
    senses: [
      { label: 'a matchstick', words: { pl: ['zapał'], cs: ['zápalk', 'sirk'], bg: ['кибрит'],
          nl: ['lucifer'], fr: ['allumette'], de: ['streichholz', 'zündholz'],
          it: ['fiammifer', 'cerin'], es: ['cerill', 'fósforo'], ro: ['chibrit'],
          el: ['σπίρτ'], hu: ['gyufa'], tr: ['kibrit'] } },
      { label: 'a sports fixture', words: { pl: ['mecz'], cs: ['zápas'], bg: ['мач'],
          nl: ['wedstrijd'], fr: ['match'], de: ['spiel'], it: ['partita'],
          es: ['partido', 'combate'], ro: ['meci'], el: ['αγών'], hu: ['mérkőzés'],
          tr: ['maç'] } },
    ],
  },
  {
    key: 'Press Start',
    means: 'push the Start button',
    senses: [
      { label: 'the press / newspapers', words: { ro: ['presă', 'presa'], pl: ['prasow', 'prasa'],
          cs: ['tiskov'], bg: ['преса'], nl: ['persbericht'], fr: ['presse'], de: ['pressemit'],
          it: ['stampa'], es: ['prensa'], el: ['τύπου'], hu: ['sajtó'], tr: ['basın'] } },
    ],
  },
];

const argv = process.argv.slice(2);
const oIdx = argv.indexOf('-o');
const output = oIdx !== -1 ? argv[oIdx + 1] : null;
const rest = argv.filter((a, i) => !a.startsWith('-') && !(oIdx !== -1 && i === oIdx + 1));
const bundlePath = rest[0];
const localeFiles = rest.slice(1);

if (!bundlePath || !output) {
  die('usage: node tools/make-corrections-sheet.js <bundle.js> -o <out.csv> [locale.json ...]');
}

const source = fs.readFileSync(bundlePath, 'utf8');
const builtIn = {};
for (const d of B.findDictionaries(source)) {
  const code = String(d.lang).split('_')[0];
  builtIn[code] = d.dict;
}

const supplied = {};
for (const f of localeFiles) {
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  supplied[j.code] = j.messages;
}

const english = builtIn.en || {};
const placeholders = s => (String(s).match(/\{[0-9]\}/g) || []).sort();

const rows = [['Language', 'Code', 'English phrase', 'Current translation',
               'What is wrong', 'What it should say']];

function addRow(code, key, current, problem, should) {
  rows.push([code.toUpperCase(), code, key, current, problem, should || '']);
}

// Everything that will actually be live: supplied languages, plus built-ins
// that were not re-supplied.
const live = {};
for (const code of Object.keys(builtIn)) if (code !== 'en') live[code] = builtIn[code];
for (const code of Object.keys(supplied)) {
  live[code] = {};
  for (const k of Object.keys(supplied[code])) live[code][k] = supplied[code][k];
}

for (const code of Object.keys(live).sort()) {
  const m = live[code];

  // 1. placeholders
  for (const key of Object.keys(m)) {
    if (!key) continue;
    const value = (m[key] || [''])[0];
    if (!value) continue;
    const want = placeholders(key), got = placeholders(value);
    if (want.join(',') === got.join(',')) continue;
    const missing = want.filter(p => got.indexOf(p) === -1);
    const extra = got.filter(p => want.indexOf(p) === -1);
    let problem = '';
    if (missing.length) {
      problem = 'missing ' + missing.join(' ') +
        ' - the value it stands for never appears on the page';
    }
    if (extra.length) {
      problem += (problem ? '; ' : '') + 'contains ' + extra.join(' ') +
        ' which the app never fills in';
    }
    const should = missing.length
      ? 'same wording, with ' + missing.join(' ') + ' put back in the right place. English is: ' + key
      : '';
    addRow(code, key, value, problem, should);
  }

  // 2. left in English
  for (const key of Object.keys(m)) {
    if (!key) continue;
    if ((m[key] || [''])[0] === key) {
      addRow(code, key, (m[key] || [''])[0], 'still in English - not translated', '');
    }
  }

  // 3. false friends
  for (const check of FALSE_FRIENDS) {
    const value = (m[check.key] || [''])[0];
    if (!value || value === check.key) continue;
    const low = value.toLowerCase();
    for (const sense of check.senses) {
      const hit = (sense.words[code] || []).find(w => low.indexOf(w.toLowerCase()) !== -1);
      if (!hit) continue;
      addRow(code, check.key, value,
        'wrong meaning - "' + hit + '" is ' + sense.label,
        'should mean: ' + check.means);
      break;
    }
  }
}

fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
fs.writeFileSync(output, csv.write(rows));

console.log('make-corrections-sheet.js');
console.log('  bundle : ' + path.resolve(bundlePath));
console.log('  locales: ' + (localeFiles.length ? localeFiles.length + ' supplied' : 'none'));
console.log('  issues : ' + (rows.length - 1));
console.log('  output : ' + path.resolve(output));
console.log('');
for (let i = 1; i < rows.length; i++) {
  console.log('  ' + rows[i][1].padEnd(4) + JSON.stringify(rows[i][2].slice(0, 30)).padEnd(34) +
    rows[i][4].slice(0, 58));
}
