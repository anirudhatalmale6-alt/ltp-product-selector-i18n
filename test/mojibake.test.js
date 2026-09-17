const { repairDeep } = require('../tools/lib/mojibake');

const cases = [
  // [input, expected]
  ['Yukaraya dÃ¶n',            'Yukaraya dön'],
  ['ÃœrÃ¼n Rehberi',            'Ürün Rehberi'],
  ['PowrÃ³t na gÃ³rÄ™',         'Powrót na górę'],
  ['SeÃ§imlerim',              'Seçimlerim'],
  ['Gezinmeyi DeÄŸiÅŸtir',      'Gezinmeyi Değiştir'],
  ['WybÃ³r produktu',          'Wybór produktu'],
  ['ZaÅ‚adunek',               'Załadunek'],
  // controls: must be left EXACTLY as-is
  ['Back to top',             'Back to top'],
  ['Selectie produs',         'Selectie produs'],
  ['Ürün Rehberi',            'Ürün Rehberi'],   // already correct -> must not be mangled
  ['Powrót na górę',          'Powrót na górę'], // already correct -> must not be mangled
  ['{0} products',            '{0} products'],
  ['naïve café',              'naïve café'],     // already correct accents
];

let pass = 0, fail = 0;
for (const [input, expected] of cases) {
  const got = repairDeep(input);
  const ok = got === expected;
  if (ok) pass++; else fail++;
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + JSON.stringify(input) + ' -> ' + JSON.stringify(got) +
    (ok ? '' : '   EXPECTED ' + JSON.stringify(expected)));
}
console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
