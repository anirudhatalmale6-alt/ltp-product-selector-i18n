/*
 * Minimal RFC4180 CSV reader/writer.
 *
 * Translations legitimately contain commas, quotes and the occasional line
 * break, so hand-rolled split(',') would corrupt them. This handles quoting
 * properly in both directions.
 */

'use strict';

function escapeCell(value) {
  const s = value === undefined || value === null ? '' : String(value);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function write(rows) {
  // Excel opens UTF-8 correctly only when a BOM is present.
  return '﻿' + rows.map(r => r.map(escapeCell).join(',')).join('\r\n') + '\r\n';
}

function parse(text) {
  let src = text;
  if (src.charCodeAt(0) === 0xFEFF) src = src.slice(1);   // strip BOM

  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++; }
        else inQuotes = false;
      } else cell += c;
      continue;
    }
    if (c === '"') { inQuotes = true; continue; }
    if (c === ',') { row.push(cell); cell = ''; continue; }
    if (c === '\r') { if (src[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; continue; }
    if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; continue; }
    cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.length > 1 || (r[0] !== undefined && r[0] !== ''));
}

module.exports = { write, parse };
