/*
 * diff-check.js - prove the built file differs from the original ONLY by the
 * prepended language layer and the single rewritten locale-map statement.
 *
 *   node test/diff-check.js <original.js> <built.js>
 *
 * This is the check worth running before uploading anything to a live site:
 * it shows exactly which bytes of the application changed.
 */

'use strict';

const fs = require('fs');

const [, , originalPath, builtPath] = process.argv;
if (!originalPath || !builtPath) {
  console.error('usage: node test/diff-check.js <original.js> <built.js>');
  process.exit(1);
}

const original = fs.readFileSync(originalPath, 'utf8');
const built = fs.readFileSync(builtPath, 'utf8');

// The application bundle starts at the webpack IIFE.
const marker = '!function(t){var e={};function n(r){';
const markerPretty = '!(function (t) {';
let at = built.indexOf(marker);
if (at < 0) at = built.indexOf(markerPretty);
if (at < 0) { console.error('FAIL: could not find the bundle start inside the built file'); process.exit(1); }

const prefix = built.slice(0, at);
const bundlePart = built.slice(at);

console.log('prepended language layer: ' + prefix.length + ' bytes');
console.log('bundle portion          : ' + bundlePart.length + ' bytes');
console.log('original                : ' + original.length + ' bytes');
console.log('');

// Find the common prefix and suffix of original vs bundlePart.
let head = 0;
while (head < original.length && head < bundlePart.length && original[head] === bundlePart[head]) head++;
let tail = 0;
while (tail < original.length - head && tail < bundlePart.length - head &&
       original[original.length - 1 - tail] === bundlePart[bundlePart.length - 1 - tail]) tail++;

const removed = original.slice(head, original.length - tail);
const added = bundlePart.slice(head, bundlePart.length - tail);

console.log('identical leading bytes : ' + head);
console.log('identical trailing bytes: ' + tail);
console.log('');
console.log('--- the ONLY region of the application that differs ---');
console.log('removed (' + removed.length + ' bytes):');
console.log('  ' + removed);
console.log('added   (' + added.length + ' bytes):');
console.log('  ' + added);
console.log('');

let ok = true;
function assert(name, cond) {
  console.log('  ' + (cond ? 'PASS' : 'FAIL') + '  ' + name);
  if (!cond) ok = false;
}

assert('exactly one contiguous region of the bundle changed',
  head + tail + removed.length === original.length);
// Note: the common-prefix scan absorbs `var b` into the identical leading
// bytes, so the differing region begins at the `=` of the assignment.
assert('the removed text is the hard-coded locale map object',
  /^\s*=\s*\{\s*en\s*:/.test(removed) && /\}\s*;?\s*$/.test(removed));
assert('the added text is the register() hook',
  /LTPI18n\.register\(/.test(added));
assert('the same language expressions are preserved',
  (removed.match(/\w+\.default/g) || []).join(',') === (added.match(/\w+\.default/g) || []).join(','));
assert('no translation text was touched',
  !/["'][^"']*[^\x00-\x7F][^"']*["']/.test(removed + added));
assert('prepended layer defines the runtime before the bundle',
  /LTPI18n/.test(prefix) && prefix.indexOf('LTPI18n') < prefix.length);

console.log('');
console.log(ok ? 'OK - the application itself changed by one statement and nothing else'
               : 'PROBLEM - review the diff above');
process.exit(ok ? 0 : 1);
