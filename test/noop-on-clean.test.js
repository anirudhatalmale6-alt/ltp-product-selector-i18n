/*
 * The encoding repair must be a NO-OP on a correctly encoded file.
 *
 * These are the real non-ASCII constants that appear in this bundle - core-js
 * whitespace tables, replacement characters, library glyphs and properly
 * encoded translations. If the repair touches ANY of them it is unsafe to run,
 * because a clean bundle would come out damaged.
 */
const { repairDeep } = require('../tools/lib/mojibake');

const CLEAN = [
  // core-js WHITESPACE constant (line 14038 of the bundle, correctly encoded)
  '\t\n\v\f\r   ᠎             　  ﻿',
  // core-js trim test string (line 14019)
  '​',
  '�',            // replacement char (line 5068)
  '…',            // ellipsis (line 19767)
  '✖',            // heavy multiplication x (line 33236)
  '© Copyright {0} LTP. All rights reserved. Company Registration No. {1}. VAT No. {2}',
  'You haven’t selected any products',
  // correctly encoded translations
  'Ürün Rehberi', 'Gezinmeyi Değiştir', 'Başla',
  'Powrót na górę', 'Przełącz nawigację', 'Załadunek',
  'în urmă', 'sâmbătă', 'duminică', 'Eylül', 'Çar',
  'yaklaşık 1 saat', '1 gün',
  // general controls
  'naïve café', 'Ø£ÙØ¶Ù„', 'Back to top', '{0} products', '',
];

let pass = 0, fail = 0;
for (const s of CLEAN) {
  const got = repairDeep(s);
  const ok = got === s;
  if (ok) pass++; else fail++;
  if (!ok) {
    console.log('FAIL  clean text was altered:');
    console.log('        in : ' + JSON.stringify(s));
    console.log('        out: ' + JSON.stringify(got));
  }
}
console.log((fail ? 'FAIL' : 'PASS') + '  ' + pass + '/' + CLEAN.length +
  ' correctly-encoded strings left untouched by the repair');
process.exit(fail ? 1 : 0);
