#!/usr/bin/env node
/*
 * build.js - produce ONE drop-in replacement for main.<hash>.js.
 *
 *   node tools/build.js <bundle.js> -o dist/main.js [locales/pl.json ...]
 *
 * The output file contains, in order:
 *
 *   1. the ltp-i18n runtime
 *   2. an editable LANGUAGES block with each supplied locale inlined
 *   3. the patched bundle
 *
 * Nothing else on the server changes: same filename, no extra <script> tags,
 * no JSON files to host, no template edits. Adding a language later means
 * editing the block at the top of this one file.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { patch } = require('./patch-bundle');

function die(msg) { console.error('ERROR: ' + msg); process.exit(1); }

function banner(text) {
  const line = '/* ' + '='.repeat(74) + ' */';
  return line + '\n' + text.split('\n').map(l => '/* ' + l.padEnd(74) + ' */').join('\n') + '\n' + line + '\n';
}

/*
 * JSON.stringify with indent puts every array element on its own line, which
 * turns `"Go back": ["Wracać"]` into three lines and makes the block painful
 * to read. Keep arrays of short strings inline.
 */
function prettyJSON(value, indent) {
  const pad = ' '.repeat(indent);
  const padIn = ' '.repeat(indent + 2);

  if (Array.isArray(value)) {
    const flat = value.every(v => typeof v === 'string');
    const oneLine = '[' + value.map(v => JSON.stringify(v)).join(', ') + ']';
    if (flat && oneLine.length + indent <= 110) return oneLine;
    return '[\n' + value.map(v => padIn + prettyJSON(v, indent + 2)).join(',\n') + '\n' + pad + ']';
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value);
    if (!keys.length) return '{}';
    return '{\n' + keys.map(k =>
      padIn + JSON.stringify(k) + ': ' + prettyJSON(value[k], indent + 2)).join(',\n') + '\n' + pad + '}';
  }
  return JSON.stringify(value);
}

function buildLanguageBlock(locales) {
  const entries = locales.map(loc => {
    const def = { messages: loc.messages };
    if (loc.date) def.date = loc.date;
    if (loc.formats) def.formats = loc.formats;
    return '    ' + JSON.stringify(loc.code) + ': ' + prettyJSON(def, 4);
  });

  return banner(
    'LANGUAGES\n' +
    '\n' +
    'To add a language:\n' +
    '  1. copy one of the blocks below\n' +
    '  2. change the two-letter code and the "lang" field\n' +
    '  3. translate the right-hand side of each line\n' +
    '  4. set plural_forms for that language\n' +
    '\n' +
    'The key on the left is the English text the app asks for - do not\n' +
    'change it. Each value is an array; the first entry is the singular.\n' +
    '\n' +
    'The language must ALSO be offered by the WordPress API for it to\n' +
    'appear in the switcher. Check both with, in the browser console:\n' +
    '  LTPI18n.report(await (await fetch(API + "languages?lang=en")).json())'
  ) +
  'LTPI18n.configure({\n' +
  '  debug: false,\n' +
  '  locales: {\n' +
  entries.join(',\n') + '\n' +
  '  }\n' +
  '});\n';
}

function main() {
  const argv = process.argv.slice(2);
  const oIdx = argv.indexOf('-o');
  const output = oIdx !== -1 ? argv[oIdx + 1] : null;
  const rest = argv.filter((a, i) =>
    !a.startsWith('--') && a !== '-o' && !(oIdx !== -1 && i === oIdx + 1));
  const input = rest[0];
  const localeFiles = rest.slice(1);

  if (!input || !output) {
    die('usage: node tools/build.js <bundle.js> -o <out.js> [locale.json ...]');
  }
  if (!fs.existsSync(input)) die('no such file: ' + input);

  const bundleSrc = fs.readFileSync(input, 'utf8');
  const runtime = fs.readFileSync(path.join(__dirname, '..', 'src', 'ltp-i18n.js'), 'utf8');

  const locales = localeFiles.map(f => {
    if (!fs.existsSync(f)) die('no such locale file: ' + f);
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    if (!j.code) die(f + ' has no "code" field');
    if (!j.messages || !j.messages['']) die(f + ' has no messages/"" gettext header');
    // strip documentation keys that belong to the template only
    delete j._readme; delete j._note;
    return j;
  });

  const { source: patched, changes } = patch(bundleSrc);

  const out =
    banner(
      'LTP Product Selector - localisation build\n' +
      '\n' +
      'This file is the original application bundle with a small language\n' +
      'layer added at the top. Upload it in place of the existing\n' +
      'main.<hash>.js - nothing else on the server needs to change.\n' +
      '\n' +
      'Built-in languages are untouched. Extra languages are defined in the\n' +
      'LANGUAGES block below.'
    ) + '\n' +
    runtime + '\n' +
    (locales.length ? buildLanguageBlock(locales) + '\n' : '') +
    patched;

  fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
  fs.writeFileSync(output, out);

  console.log('build.js');
  console.log('  bundle  : ' + path.resolve(input) + '  (' + bundleSrc.length + ' bytes)');
  changes.forEach(c => console.log('  - ' + c));
  locales.forEach(l => console.log('  + language "' + l.code + '": ' +
    (Object.keys(l.messages).length - 1) + ' phrases' + (l.date ? ', with date names' : '')));
  console.log('  output  : ' + path.resolve(output) + '  (' + out.length + ' bytes, ' +
    '+' + (out.length - bundleSrc.length) + ')');
}

if (require.main === module) main();
