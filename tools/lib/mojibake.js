// Safe repair for text that was UTF-8 bytes re-decoded as Windows-1252 and then
// stored as UTF-8 again (a.k.a. mojibake).
//
//   "dÃ¶n"  (U+00C3 U+00B6) -> "dön"  (U+00F6)
//   "ÃœrÃ¼n" (U+00C3 U+0153) -> "Ürün" (U+00DC ...)
//
// The second example is why plain latin-1 is not enough: U+0153 ("oe") is
// Windows-1252 byte 0x9C, which latin-1 has no mapping for.
//
// Rule: only accept a repair when it is provably reversible - re-encoding the
// repaired text the wrong way must reproduce the original string exactly.
// Anything that does not round-trip is returned untouched.

// Windows-1252 differs from latin-1 only in 0x80-0x9F.
const CP1252_HIGH = {
  0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x0192, 0x84: 0x201e, 0x85: 0x2026,
  0x86: 0x2020, 0x87: 0x2021, 0x88: 0x02c6, 0x89: 0x2030, 0x8a: 0x0160,
  0x8b: 0x2039, 0x8c: 0x0152, 0x8e: 0x017d, 0x91: 0x2018, 0x92: 0x2019,
  0x93: 0x201c, 0x94: 0x201d, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014,
  0x98: 0x02dc, 0x99: 0x2122, 0x9a: 0x0161, 0x9b: 0x203a, 0x9c: 0x0153,
  0x9e: 0x017e, 0x9f: 0x0178,
};
const TO_BYTE = new Map();   // codepoint -> byte
const FROM_BYTE = new Map(); // byte -> codepoint
for (let b = 0; b < 256; b++) {
  const cp = Object.prototype.hasOwnProperty.call(CP1252_HIGH, b) ? CP1252_HIGH[b]
           : (b >= 0x80 && b <= 0x9f) ? null   // unmapped in Windows-1252
           : b;
  if (cp === null) continue;
  TO_BYTE.set(cp, b);
  FROM_BYTE.set(b, cp);
}

// string -> Buffer using Windows-1252; returns null if any char is unmappable
function cp1252Encode(str) {
  const out = Buffer.alloc(str.length);
  for (let i = 0; i < str.length; i++) {
    const b = TO_BYTE.get(str.codePointAt(i));
    if (b === undefined) return null;
    out[i] = b;
  }
  return out;
}

// Buffer -> string using Windows-1252
function cp1252Decode(buf) {
  let out = '';
  for (const b of buf) {
    const cp = FROM_BYTE.get(b);
    if (cp === undefined) return null;
    out += String.fromCharCode(cp);
  }
  return out;
}

function repair(str) {
  if (typeof str !== 'string') return str;
  // fast path: pure ASCII cannot be mojibake
  if (!/[^\x00-\x7F]/.test(str)) return str;

  const bytes = cp1252Encode(str);
  if (!bytes) return str;

  const fixed = bytes.toString('utf8');
  if (fixed.indexOf('�') !== -1) return str;      // not valid UTF-8 -> not mojibake

  // reversibility check: encoding `fixed` as UTF-8 and reading it back as
  // Windows-1252 must reproduce the input exactly.
  const back = cp1252Decode(Buffer.from(fixed, 'utf8'));
  if (back !== str) return str;

  return fixed;
}

// Apply repeatedly for doubly/triply encoded text, bounded.
function repairDeep(str, maxRounds) {
  let out = str;
  const limit = maxRounds || 3;
  for (let i = 0; i < limit; i++) {
    const next = repair(out);
    if (next === out) break;
    out = next;
  }
  return out;
}

function repairTree(node) {
  if (typeof node === 'string') return repairDeep(node);
  if (Array.isArray(node)) return node.map(repairTree);
  if (node && typeof node === 'object') {
    const out = {};
    for (const k of Object.keys(node)) out[repairDeep(k)] = repairTree(node[k]);
    return out;
  }
  return node;
}

module.exports = { repair, repairDeep, repairTree, cp1252Encode, cp1252Decode };
