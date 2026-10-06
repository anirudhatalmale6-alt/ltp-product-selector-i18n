#!/usr/bin/env node
/*
 * check-translations.js - meaning-level checks the placeholder check can't catch.
 *
 *   node tools/check-translations.js locales/*.json
 *
 * Placeholder validation catches structural mistakes. It cannot catch a
 * translator rendering the right word in the wrong sense, which is the failure
 * that actually reaches users and is invisible to whoever signs it off.
 *
 * Two phrases in this app are classic false friends:
 *
 *   "No matches available"  - means no RESULTS. Most languages have a separate
 *                             word for a sports fixture, and another for the
 *                             thing you strike to light a fire.
 *   "Press Start"           - means push the button. "Press" is also the news
 *                             media in most of these languages.
 *
 * Flagged items are suggestions for a human who reads the language, not
 * corrections to apply blindly.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const CHECKS = [
  {
    key: 'No matches available',
    means: 'no results / no matching products',
    senses: [
      {
        label: 'matchstick (the thing you strike)',
        words: { pl: ['zapał'], cs: ['zápalk', 'sirk'], bg: ['кибрит'], nl: ['lucifer'],
                 fr: ['allumette'], de: ['streichholz', 'zündholz'], it: ['fiammifer', 'cerin'],
                 es: ['cerill', 'fósforo'], ro: ['chibrit'], el: ['σπίρτ'], hu: ['gyufa'] },
      },
      {
        label: 'sports fixture',
        words: { pl: ['mecz'], cs: ['zápas'], bg: ['мач'], nl: ['wedstrijd'], fr: ['match'],
                 de: ['spiel'], it: ['partita'], es: ['partido', 'combate'], ro: ['meci'],
                 el: ['αγών'], hu: ['mérkőzés'] },
      },
    ],
  },
  {
    key: 'Press Start',
    means: 'push the start button',
    senses: [
      {
        label: 'the press (news media)',
        words: { ro: ['presă', 'presa'], pl: ['prasow', 'prasa'], cs: ['tiskov'], bg: ['преса'],
                 nl: ['persbericht'], fr: ['presse'], de: ['pressemit'], it: ['stampa'],
                 es: ['prensa'], el: ['τύπου'], hu: ['sajtó'] },
      },
    ],
  },
];

const files = process.argv.slice(2);
if (!files.length) {
  console.error('usage: node tools/check-translations.js <locale.json ...>');
  process.exit(1);
}

const locales = files.map(f => {
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  return { file: f, code: j.code, messages: j.messages || {} };
});

let flagged = 0;

for (const check of CHECKS) {
  console.log('"' + check.key + '"  - ' + check.means);
  for (const loc of locales) {
    const value = (loc.messages[check.key] || [''])[0];
    if (!value) { console.log('  ' + loc.code.padEnd(4) + '(missing)'); continue; }

    let verdict = 'ok';
    if (value === check.key) {
      verdict = 'LEFT IN ENGLISH';
      flagged++;
    } else {
      const low = value.toLowerCase();
      for (const sense of check.senses) {
        const hit = (sense.words[loc.code.toLowerCase()] || [])
          .find(w => low.indexOf(w.toLowerCase()) !== -1);
        if (hit) { verdict = 'WRONG SENSE - "' + hit + '" is the ' + sense.label; flagged++; break; }
      }
    }
    console.log('  ' + loc.code.padEnd(4) + JSON.stringify(value).padEnd(40) + '  ' + verdict);
  }
  console.log('');
}

console.log('phrases left identical to the English source:');
let untranslated = 0;
for (const loc of locales) {
  const same = Object.keys(loc.messages).filter(k => k && loc.messages[k][0] === k);
  if (same.length) {
    console.log('  ' + loc.code + ': ' + JSON.stringify(same));
    untranslated += same.length;
  }
}
if (!untranslated) console.log('  none');

console.log('');
console.log(flagged
  ? flagged + ' phrase(s) flagged for a human who reads the language'
  : 'nothing flagged');
