#!/usr/bin/env node
/*
 * audit.js - report on the state of every language in the bundle.
 *
 *   node tools/audit.js <bundle.js>
 *
 * Checks, per language:
 *   - is the dictionary actually wired into the locale map?
 *   - is any text double-encoded?
 *   - does the plural rule match the language?
 *   - which English phrases are missing, or left untranslated?
 *   - do {0}/{1} placeholders match the English source string?
 *
 * Exit code is non-zero if anything that breaks at runtime is found.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { repairTree, repairDeep } = require('./lib/mojibake');

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

const input = process.argv[2];
if (!input) die('usage: node tools/audit.js <bundle.js>');
if (!fs.existsSync(input)) die('no such file: ' + input);
const source = fs.readFileSync(input, 'utf8');

// --------------------------------------------------------------- module array
const a = source.indexOf('})([');
const b = source.lastIndexOf(']);');
if (a < 0 || b < 0) die('this does not look like the Product Selector webpack bundle');
let mods;
try { mods = eval('(' + source.slice(a + 3, b + 1) + ')'); }
catch (e) { die('could not read the module array: ' + e.message); }

// ------------------------------------------------------- which are wired up?
const mapMatch = /\{\s*en\s*:\s*([\w$]+)\.default\s*,\s*ro\s*:\s*([\w$]+)\.default\s*,\s*tr\s*:\s*([\w$]+)\.default\s*\}/.exec(source);
const wired = new Set();
if (mapMatch) {
  for (const varName of [mapMatch[1], mapMatch[2], mapMatch[3]]) {
    const w = new RegExp(varName + '\\s*=\\s*[\\w$]+\\(\\s*n\\(\\s*(\\d+)\\s*\\)\\s*\\)').exec(source);
    if (!w) continue;
    const body = mods[Number(w[1])] ? mods[Number(w[1])].toString() : '';
    const ids = Array.from(body.matchAll(/n\(\s*(\d+)\s*\)/g)).map(x => Number(x[1]));
    if (ids.length) wired.add(ids[ids.length - 1]);
  }
}

// ------------------------------------------------------------- dictionaries
const dicts = [];
for (let id = 0; id < mods.length; id++) {
  const src = mods[id].toString();
  if (!/t\.exports\s*=\s*\{/.test(src) || !/"":\s*\{/.test(src)) continue;
  const m = { exports: {} };
  try { eval('(' + src + ')')(m, m.exports, () => ({})); } catch (e) { continue; }
  if (m.exports && m.exports['']) dicts.push({ id, dict: m.exports });
}
if (!dicts.length) die('no translation dictionaries found');

const english = dicts.find(d => String((d.dict[''] || {}).lang || '').indexOf('en') === 0);
const enKeys = english ? Object.keys(english.dict).filter(k => k !== '') : [];

function placeholders(s) {
  return (String(s).match(/\{[0-9]\}/g) || []).sort().join(',');
}

let problems = 0;
console.log('audit: ' + path.resolve(input));
console.log('       ' + mods.length + ' modules, ' + dicts.length + ' translation dictionaries\n');

// ------------------------------------------------- where is the encoding damage?
//
// This matters before anything else. If double-encoded text appears in
// third-party library code as well as in the translations, the whole FILE was
// transcoded at some point - typically by saving it, or running it through an
// online beautifier, that read UTF-8 as Windows-1252. In that case the
// translations are not damaged at all and the original file should be used.
//
// Only damage confined to the dictionaries means the translation data itself
// is wrong.
function encodingProvenance(source, dictModuleIds) {
  const dictSrc = new Set(dictModuleIds.map(id => mods[id].toString()));
  const lines = source.split(/\r?\n/);
  const isDictLine = (() => {
    const ranges = [];
    for (const body of dictSrc) {
      const at = source.indexOf(body);
      if (at < 0) continue;
      const start = source.slice(0, at).split('\n').length;
      ranges.push([start, start + body.split('\n').length]);
    }
    return ln => ranges.some(([a, b]) => ln >= a && ln <= b);
  })();

  let inDict = 0, outDict = 0;
  const samples = [];
  lines.forEach((l, i) => {
    const b = Buffer.from(l, 'utf8');
    let n = 0;
    for (let k = 0; k < b.length - 3; k++) {
      if (b[k] === 0xC3 && (b[k + 1] === 0x82 || b[k + 1] === 0x83)) n++;
      else if ((b[k] === 0xC4 || b[k] === 0xC5) && b[k + 1] >= 0x80 && b[k + 1] <= 0xBF &&
               b[k + 2] >= 0xC2 && b[k + 2] <= 0xC5) n++;
    }
    if (!n) return;
    if (isDictLine(i + 1)) inDict += n;
    else { outDict += n; if (samples.length < 4) samples.push('line ' + (i + 1) + ': ' + l.trim().slice(0, 96)); }
  });
  return { inDict, outDict, samples };
}

const prov = encodingProvenance(source, dicts.map(d => d.id));
console.log('=== encoding provenance ===');
if (!prov.inDict && !prov.outDict) {
  console.log('  clean - no double-encoded text anywhere in this file\n');
} else if (prov.outDict > 0) {
  console.log('  double-encoded text found in BOTH the translations (' + prov.inDict +
              ') and in unrelated code (' + prov.outDict + '):');
  prov.samples.forEach(s => console.log('    ' + s));
  console.log('');
  console.log('  Those outside hits are third-party library constants that ship correct');
  console.log('  from npm, so they cannot have been damaged by a translation workflow.');
  console.log('  This file has been transcoded as a whole - most likely by an online');
  console.log('  beautifier/unminifier reading UTF-8 as Windows-1252.');
  console.log('');
  console.log('  => The translations are probably FINE in the original file.');
  console.log('     Audit the real deployed .js, and do NOT run --fix-encoding on it.\n');
} else {
  console.log('  double-encoded text found ONLY inside the translation dictionaries (' +
              prov.inDict + ' occurrences),');
  console.log('  and nowhere else in the file. That points at the translation data itself,');
  console.log('  so --fix-encoding is appropriate here.\n');
  problems++;
}

for (const { id, dict } of dicts) {
  const header = dict[''] || {};
  const code = String(header.lang || ('module' + id)).split('_')[0];
  const keys = Object.keys(dict).filter(k => k !== '');
  const isEn = english && english.id === id;

  console.log('--- ' + code + '  (module ' + id + ', ' + keys.length + ' phrases) ---');

  // wiring
  if (!wired.has(id)) {
    console.log('  [BROKEN]  not referenced by the locale map - this language renders as English');
    problems++;
  } else {
    console.log('  wiring    OK');
  }

  // encoding
  const repaired = repairTree(dict);
  let damagedKeys = 0, damagedValues = 0;
  for (const k of Object.keys(dict)) {
    if (repairDeep(k) !== k) damagedKeys++;
    if (JSON.stringify(dict[k]) !== JSON.stringify(repaired[repairDeep(k)])) damagedValues++;
  }
  if (damagedKeys || damagedValues) {
    // If the whole file was transcoded, this is an artefact of the copy in
    // front of us, not a defect in the translations. Say so rather than
    // reporting a fault the client cannot act on.
    const artefact = prov.outDict > 0;
    console.log('  ' + (artefact ? '[copy]   ' : '[BROKEN] ') +
                ' double-encoded text: ' + damagedValues + ' translation(s), ' +
                damagedKeys + ' source phrase(s)' +
                (artefact ? '  (from the file-wide transcode above, not the data)' : ''));
    const sample = Object.keys(dict).find(k => JSON.stringify(dict[k]) !== JSON.stringify(repaired[repairDeep(k)]));
    if (sample) {
      console.log('            e.g. ' + JSON.stringify(String(dict[sample][0]).slice(0, 48)));
      console.log('            ->   ' + JSON.stringify(String(repaired[repairDeep(sample)][0]).slice(0, 48)));
    }
    if (!artefact) problems++;
  } else {
    console.log('  encoding  OK');
  }

  // plural rule
  const expected = KNOWN_PLURALS[code];
  if (expected && header.plural_forms !== expected) {
    console.log('  [BROKEN]  plural rule does not match "' + code + '"');
    console.log('            in bundle: ' + header.plural_forms);
    console.log('            expected : ' + expected);
    problems++;
  } else if (!header.plural_forms) {
    console.log('  [BROKEN]  no plural_forms header - ngettext will throw');
    problems++;
  } else {
    console.log('  plurals   OK');
  }

  if (!isEn && enKeys.length) {
    const missing = enKeys.filter(k => keys.indexOf(k) === -1);
    const same = keys.filter(k => String(dict[k][0]) === k);
    const badPh = keys.filter(k => enKeys.indexOf(k) !== -1 && placeholders(k) !== placeholders(dict[k][0]));

    console.log('  coverage  ' + (enKeys.length - missing.length) + '/' + enKeys.length + ' English phrases translated' +
                (missing.length ? '   MISSING: ' + JSON.stringify(missing.slice(0, 4)) : ''));
    if (same.length) console.log('  untranslated (identical to English): ' + JSON.stringify(same.slice(0, 6)));
    if (badPh.length) {
      console.log('  [WARN]    placeholder mismatch in ' + badPh.length + ' phrase(s) - ' +
                  'a missing {0} shows blank text to the user');
      badPh.slice(0, 3).forEach(k => {
        console.log('            ' + JSON.stringify(k.slice(0, 40)) + '  ' +
                    (placeholders(k) || 'none') + '  ->  ' + (placeholders(dict[k][0]) || 'none'));
      });
      problems++;
    }
  }
  console.log('');
}

console.log(problems ? problems + ' problem area(s) found' : 'no problems found');
process.exit(problems ? 1 : 0);
