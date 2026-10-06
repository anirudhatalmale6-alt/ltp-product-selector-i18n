#!/usr/bin/env python3
"""
make-master-workbook.py - build the single master spreadsheet.

  python3 tools/make-master-workbook.py <bundle.js> <sheet.csv> -o master.xlsx

Produces ONE workbook that is the complete record of every phrase in every
language the app uses:

  sheet "Translations" - the full grid. Every language, including the two that
                         are compiled into the bundle rather than supplied in a
                         sheet (English and Turkish), so nothing is missing.
                         Cells needing attention are shaded.
  sheet "Corrections"  - what is wrong with each shaded cell and why.

Keeping it to one file is deliberate: a separate corrections file gets lost, and
the next person to pick this up should find everything in one place.
"""
import os
import re
import subprocess
import sys
import json

import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment
from openpyxl.utils import get_column_letter
from openpyxl.comments import Comment

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

argv = sys.argv[1:]
o = argv.index('-o') if '-o' in argv else -1
OUT = argv[o + 1] if o != -1 else None
rest = [a for i, a in enumerate(argv) if not a.startswith('-') and not (o != -1 and i == o + 1)]
if len(rest) < 2 or not OUT:
    print("usage: python3 tools/make-master-workbook.py <bundle.js> <sheet.csv> -o <out.xlsx>")
    sys.exit(1)
BUNDLE, SHEET = rest[0], rest[1]

# ---- pull the languages compiled into the bundle (en, tr, and whatever else) ----
dump = subprocess.run(
    ['node', '-e', '''
const B = require(process.argv[1] + '/tools/lib/bundle');
const fs = require('fs');
const src = fs.readFileSync(process.argv[2], 'utf8');
const out = {};
for (const d of B.findDictionaries(src)) {
  const code = String(d.lang).split('_')[0];
  out[code] = {};
  for (const k of Object.keys(d.dict)) if (k) out[code][k] = d.dict[k][0];
}
process.stdout.write(JSON.stringify(out));
''', ROOT, BUNDLE],
    capture_output=True, text=True, check=True)
builtin = json.loads(dump.stdout)

# ---- read the supplied sheet ----
import csv as csvmod
with open(SHEET, encoding='utf-8-sig') as fh:
    rows = list(csvmod.reader(fh))
header, body = rows[0], rows[1:]

# column index -> language code, from headers like "French (fr)"
supplied_cols = {}
for i, h in enumerate(header):
    m = re.search(r'\(([^)]+)\)', h or '')
    if m and i >= 3:
        supplied_cols[m.group(1).strip().lower()] = i

ISO_NAME = {'ro': 'Romanian', 'pl': 'Polish', 'cs': 'Czech', 'bg': 'Bulgarian', 'nl': 'Dutch',
            'fr': 'French', 'it': 'Italian', 'es': 'Spanish', 'de': 'German', 'el': 'Greek',
            'hu': 'Hungarian', 'tr': 'Turkish'}
# the sheet labelled Greek "gr" and Hungarian "HU"; standardise on ISO
RENAME = {'gr': 'el', 'hu': 'hu'}

phrases = [r[0] for r in body if r and r[0]]
# any phrase that exists only in a built-in language must still appear
for code, m in builtin.items():
    for k in m:
        if k not in phrases:
            phrases.append(k)

order = ['ro', 'pl', 'cs', 'bg', 'nl', 'fr', 'it', 'es', 'de', 'el', 'hu', 'tr']

def value_for(code, phrase):
    src_code = {'el': 'gr'}.get(code, code)
    idx = supplied_cols.get(src_code) or supplied_cols.get(src_code.lower())
    if idx is not None:
        for r in body:
            if r and r[0] == phrase and idx < len(r):
                return r[idx]
    return builtin.get(code, {}).get(phrase, '')

# ---- problems, from the same logic the tooling uses ----
FALSE_FRIENDS = {
    'No matches available': {
        'means': 'no results - no matching products were found',
        'senses': [
            ('a matchstick', {'pl': ['zapał'], 'cs': ['zápalk', 'sirk'], 'bg': ['кибрит'],
                              'nl': ['lucifer'], 'fr': ['allumette'], 'de': ['streichholz'],
                              'it': ['fiammifer'], 'es': ['cerill', 'fósforo'], 'ro': ['chibrit'],
                              'el': ['σπίρτ'], 'hu': ['gyufa'], 'tr': ['kibrit']}),
            ('a sports fixture', {'pl': ['mecz'], 'cs': ['zápas'], 'bg': ['мач'], 'nl': ['wedstrijd'],
                                  'fr': ['match'], 'de': ['spiel'], 'it': ['partita'],
                                  'es': ['partido', 'combate'], 'ro': ['meci'], 'el': ['αγών'],
                                  'hu': ['mérkőzés'], 'tr': ['maç']}),
        ]},
    'Press Start': {
        'means': 'push the Start button',
        'senses': [
            ('the press / newspapers', {'ro': ['presă', 'presa'], 'pl': ['prasow', 'prasa'],
                                        'cs': ['tiskov'], 'bg': ['преса'], 'nl': ['persbericht'],
                                        'fr': ['presse'], 'de': ['pressemit'], 'it': ['stampa'],
                                        'es': ['prensa'], 'el': ['τύπου'], 'hu': ['sajtó'],
                                        'tr': ['basın']}),
        ]},
}

def placeholders(s):
    return sorted(set(re.findall(r'\{[0-9]\}', s or '')))

problems = {}   # (code, phrase) -> (what is wrong, what it should say)
for code in order:
    for phrase in phrases:
        v = value_for(code, phrase)
        if not v:
            problems[(code, phrase)] = ('blank - this phrase will show in English', '')
            continue
        want, got = placeholders(phrase), placeholders(v)
        if want != got:
            missing = [p for p in want if p not in got]
            extra = [p for p in got if p not in want]
            bits = []
            if missing:
                bits.append('missing %s - the value it stands for never appears on the page'
                            % ' '.join(missing))
            if extra:
                bits.append('contains %s, which the app never fills in' % ' '.join(extra))
            problems[(code, phrase)] = ('; '.join(bits),
                                        'same wording with %s put back' % ' '.join(missing) if missing else '')
            continue
        if v == phrase:
            problems[(code, phrase)] = ('still in English - not translated', '')
            continue
        ff = FALSE_FRIENDS.get(phrase)
        if ff:
            low = v.lower()
            for label, words in ff['senses']:
                if any(w.lower() in low for w in words.get(code, [])):
                    problems[(code, phrase)] = ('wrong meaning - "%s" is %s'
                                                % (next(w for w in words[code] if w.lower() in low), label),
                                                'should mean: ' + ff['means'])
                    break

# ---- build the workbook ----
wb = openpyxl.Workbook()
ws = wb.active
ws.title = 'Translations'

HEAD = Font(bold=True, color='FFFFFF')
HEADFILL = PatternFill('solid', fgColor='1F4E79')
BAD = PatternFill('solid', fgColor='FFC7CE')
LOCK = PatternFill('solid', fgColor='F2F2F2')

cols = ['English (do not edit)', 'Placeholders to keep', 'Notes'] + \
       ['%s (%s)' % (ISO_NAME.get(c, c.title()), c) for c in order]
for i, h in enumerate(cols, start=1):
    c = ws.cell(row=1, column=i, value=h)
    c.font = HEAD
    c.fill = HEADFILL
    c.alignment = Alignment(vertical='center', wrap_text=True)

en_keys = set(builtin.get('en', {}).keys())
for r, phrase in enumerate(phrases, start=2):
    ws.cell(row=r, column=1, value=phrase).fill = LOCK
    ws.cell(row=r, column=2, value=' '.join(placeholders(phrase)))
    note = '' if phrase in en_keys else 'not in the English dictionary; translated in other languages'
    ws.cell(row=r, column=3, value=note)
    for j, code in enumerate(order, start=4):
        cell = ws.cell(row=r, column=j, value=value_for(code, phrase))
        p = problems.get((code, phrase))
        if p:
            cell.fill = BAD
            text = p[0] + (('\n' + p[1]) if p[1] else '')
            cell.comment = Comment(text, 'review')

ws.freeze_panes = 'D2'
ws.column_dimensions['A'].width = 60
ws.column_dimensions['B'].width = 16
ws.column_dimensions['C'].width = 22
for j in range(4, 4 + len(order)):
    ws.column_dimensions[get_column_letter(j)].width = 34

# ---- corrections tab ----
ws2 = wb.create_sheet('Corrections')
for i, h in enumerate(['Language', 'Code', 'English phrase', 'Current translation',
                       'What is wrong', 'What it should say'], start=1):
    c = ws2.cell(row=1, column=i, value=h)
    c.font = HEAD
    c.fill = HEADFILL
r = 2
for code in order:
    for phrase in phrases:
        p = problems.get((code, phrase))
        if not p:
            continue
        ws2.cell(row=r, column=1, value=ISO_NAME.get(code, code))
        ws2.cell(row=r, column=2, value=code)
        ws2.cell(row=r, column=3, value=phrase)
        ws2.cell(row=r, column=4, value=value_for(code, phrase))
        ws2.cell(row=r, column=5, value=p[0])
        ws2.cell(row=r, column=6, value=p[1])
        r += 1
for col, w in zip('ABCDEF', (14, 8, 52, 44, 56, 56)):
    ws2.column_dimensions[col].width = w
ws2.freeze_panes = 'A2'

os.makedirs(os.path.dirname(os.path.abspath(OUT)), exist_ok=True)
wb.save(OUT)

print('make-master-workbook.py')
print('  bundle    : %s' % BUNDLE)
print('  sheet     : %s' % SHEET)
print('  languages : %s' % ', '.join(order))
print('  phrases   : %d' % len(phrases))
print('  flagged   : %d cells' % len(problems))
print('  output    : %s' % os.path.abspath(OUT))
for (code, phrase), p in sorted(problems.items()):
    print('    %-3s %-32s %s' % (code, json.dumps(phrase[:30], ensure_ascii=False), p[0][:54]))
