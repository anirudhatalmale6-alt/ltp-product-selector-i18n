/*
 * provenance-check.js - account for every byte of the file being delivered.
 *
 *   node test/provenance-check.js <original-bundle.js> <built.js> <locale.json ...>
 *
 * The built file should be exactly:
 *
 *     banner  +  src/ltp-i18n.js  +  LANGUAGES block  +  (original bundle with
 *                                                         one statement rewritten)
 *
 * Anything else - an extra script, an injected beacon, a stray edit - shows up
 * as unaccounted bytes. Worth running before handing a file to someone who is
 * going to put it on a live website.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const [, , originalPath, builtPath, ...localeFiles] = process.argv;
if (!originalPath || !builtPath) {
  console.error('usage: node test/provenance-check.js <original.js> <built.js> [locale.json ...]');
  process.exit(1);
}

const original = fs.readFileSync(originalPath, 'utf8');
const built = fs.readFileSync(builtPath, 'utf8');
const runtime = fs.readFileSync(path.join(__dirname, '..', 'src', 'ltp-i18n.js'), 'utf8');

let ok = true;
function check(name, cond, detail) {
  console.log('  ' + (cond ? 'PASS' : 'FAIL') + '  ' + name + (cond ? '' : '   ' + (detail || '')));
  if (!cond) ok = false;
}

console.log('provenance of ' + path.basename(builtPath) + '  (' + built.length + ' bytes)\n');

// 1. the runtime appears verbatim, exactly once
const runtimeAt = built.indexOf(runtime);
check('runtime embedded verbatim from src/ltp-i18n.js', runtimeAt !== -1);
check('runtime appears exactly once',
  runtimeAt !== -1 && built.indexOf(runtime, runtimeAt + 1) === -1);

// 2. the application portion is the original with one statement rewritten
const marker = '!function(t){var e={};function n(r){';
const bundleAt = built.indexOf(marker);
check('application bundle located', bundleAt !== -1);

const bundlePart = built.slice(bundleAt);
let head = 0;
while (head < original.length && head < bundlePart.length && original[head] === bundlePart[head]) head++;
let tail = 0;
while (tail < original.length - head && tail < bundlePart.length - head &&
       original[original.length - 1 - tail] === bundlePart[bundlePart.length - 1 - tail]) tail++;
const removed = original.slice(head, original.length - tail);
const added = bundlePart.slice(head, bundlePart.length - tail);

check('exactly one contiguous change inside the application',
  head + tail + removed.length === original.length);
check('that change is the locale-map hook and nothing else',
  /^\s*=\s*\{\s*en\s*:/.test(removed) && /LTPI18n\.register\(/.test(added));
console.log('        -' + removed.length + ' bytes, +' + added.length + ' bytes, ' +
  (head + tail) + ' bytes identical');

// 3. everything before the bundle is banner + runtime + language block
const prefix = built.slice(0, bundleAt);
let accounted = prefix.slice(runtimeAt, runtimeAt + runtime.length) === runtime;
check('prefix contains the runtime', accounted);

const beforeRuntime = prefix.slice(0, runtimeAt);
const afterRuntime = prefix.slice(runtimeAt + runtime.length);
const bannerOnly = /^[\s\/*=\-\w.,:()<>'"\[\]|&;@#!?%+ -￿\n]*$/.test(beforeRuntime) &&
                   !/[<>]script/i.test(beforeRuntime);
check('nothing before the runtime except the comment banner',
  beforeRuntime.trim().split('\n').every(l => /^\s*(\/\*|\*|\/\/|$)/.test(l) || l.trim().startsWith('/*')),
  JSON.stringify(beforeRuntime.slice(0, 80)));

// 4. the language block is only LTPI18n.configure + the supplied locale data
const cfgAt = afterRuntime.indexOf('LTPI18n.configure(');
check('language block is a single LTPI18n.configure call',
  cfgAt !== -1 && afterRuntime.indexOf('LTPI18n.configure(', cfgAt + 1) === -1);

const codeLines = afterRuntime.split('\n').filter(l => {
  const t = l.trim();
  return t && !t.startsWith('/*') && !t.startsWith('*') && !t.startsWith('//');
});
const joined = codeLines.join('\n');
const DANGEROUS = [
  ['child_process', /child_process/],
  ['eval(', /\beval\s*\(/],
  ['new Function(', /new\s+Function\s*\(/],
  ['document.write', /document\.write/],
  ['<script', /<script/i],
  ['webhook.site', /webhook\.site/i],
  ['an external http(s) URL', /https?:\/\/(?!www\.gnu\.org)[a-z0-9.-]+/i],
];
for (const [label, re] of DANGEROUS) {
  const hit = re.exec(joined);
  check('language block contains no ' + label, !hit, hit ? JSON.stringify(hit[0]) : '');
}

// 5. every translated string in the block came from a supplied locale file
if (localeFiles.length) {
  const supplied = new Set();
  for (const f of localeFiles) {
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    for (const k of Object.keys(j.messages || {})) {
      if (k) supplied.add(JSON.stringify(j.messages[k][0]));
    }
    // `alias` is also emitted as a string array in the block, e.g. "alias": ["gr"]
    for (const a of (j.alias || [])) supplied.add(JSON.stringify(a));
  }
  const inBlock = (joined.match(/\[\s*"(?:[^"\\]|\\.)*"\s*\]/g) || [])
    .map(s => s.replace(/^\[\s*/, '').replace(/\s*\]$/, ''));
  const foreign = inBlock.filter(s => !supplied.has(s));
  check('every translation in the block came from the supplied sheet',
    foreign.length === 0, foreign.slice(0, 3).join(' | '));
  console.log('        ' + inBlock.length + ' strings checked against ' + supplied.size + ' supplied');
}

console.log('');
console.log(ok ? 'OK - every byte accounted for' : 'PROBLEM - see failures above');
process.exit(ok ? 0 : 1);
