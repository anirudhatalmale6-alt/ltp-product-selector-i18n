#!/usr/bin/env node
/*
 * normalise-placeholders.js - repair (0) typed where {0} was meant.
 *
 *   node tools/normalise-placeholders.js <sheet.csv> -o <fixed.csv> [--column Turkish]
 *
 * Translators working in Excel sometimes type round brackets for the
 * placeholder tokens. The app only substitutes {0}, so "(0) için seçiminiz"
 * renders the literal text "(0)" to the user and the value never appears.
 *
 * This is a token repair, not a wording change: only the brackets around a
 * single digit are touched, and only when ALL of these hold:
 *
 *   - the English source for that row contains {N}
 *   - the translation contains (N) for the same N
 *   - the translation does not already contain {N}
 *
 * Anything else is left exactly as supplied. Every change is printed so it can
 * be checked, and the wording either side of the token is never altered.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const csv = require('./lib/csv');

function die(m) { console.error('ERROR: ' + m); process.exit(1); }

const argv = process.argv.slice(2);
function opt(n) { const i = argv.indexOf(n); return i !== -1 ? argv[i + 1] : null; }
const output = opt('-o');
const only = opt('--column');
const consumed = new Set();
for (const f of ['-o', '--column']) {
  const i = argv.indexOf(f);
  if (i !== -1) { consumed.add(i); consumed.add(i + 1); }
}
const input = argv.filter((a, i) => !consumed.has(i) && !a.startsWith('-'))[0];

if (!input || !output) {
  die('usage: node tools/normalise-placeholders.js <sheet.csv> -o <out.csv> [--column Name]');
}

const rows = csv.parse(fs.readFileSync(input, 'utf8'));
const header = rows[0];
const targets = [];
for (let c = 3; c < header.length; c++) {
  if (only && !String(header[c] || '').toLowerCase().includes(only.toLowerCase())) continue;
  targets.push(c);
}
if (!targets.length) die('no matching columns' + (only ? ' for --column ' + only : ''));

let changes = 0;
console.log('normalise-placeholders.js');
console.log('  sheet  : ' + path.resolve(input));
console.log('  columns: ' + targets.map(c => header[c]).join(', '));
console.log('');

for (let r = 1; r < rows.length; r++) {
  const source = rows[r][0];
  if (!source) continue;
  const wanted = (source.match(/\{([0-9])\}/g) || []).map(s => s[1]);
  if (!wanted.length) continue;

  for (const c of targets) {
    const before = rows[r][c] || '';
    if (!before) continue;
    let after = before;

    for (const digit of wanted) {
      const curly = '{' + digit + '}';
      const round = '(' + digit + ')';
      if (after.indexOf(curly) !== -1) continue;   // already correct, leave alone
      if (after.indexOf(round) === -1) continue;   // nothing to repair
      after = after.split(round).join(curly);
    }

    if (after !== before) {
      rows[r][c] = after;
      changes++;
      console.log('  ' + header[c] + '  ' + JSON.stringify(source.slice(0, 44)));
      console.log('     was: ' + JSON.stringify(before));
      console.log('     now: ' + JSON.stringify(after));
    }
  }
}

fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
fs.writeFileSync(output, csv.write(rows));

console.log('');
console.log('  ' + changes + ' cell(s) repaired');
console.log('  output : ' + path.resolve(output));
