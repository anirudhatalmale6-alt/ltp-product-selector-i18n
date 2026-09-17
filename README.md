# LTP Product Selector — adding languages

Adding a language to the Product Selector currently means hand-editing a webpack
bundle in four separate places. This turns it into: **drop in a JSON file, add one
line.** No rebuild, no bundle surgery.

It also fixes three defects found in the bundle you sent (details in
[What the audit found](#what-the-audit-found)).

---

## How the bundle works today

The Product Selector is a React app compiled with webpack. The English strings
are baked into the components, and translations are gettext-style dictionaries
compiled in as webpack modules.

Near the end of the bundle the app builds a locale map:

```js
var b = { en: h.default, ro: m.default, tr: v.default };
```

Each of `h`, `m`, `v` is a wrapper module, and each wrapper pulls in **two** more
modules — a phrase dictionary and a date-fns locale:

```
locale "tr"
 └── module 620   createLocaleData(dictionary, { formatDate, formats })
      ├── module 621   date-fns locale ── module 622 (relative time)
      │                               └── module 623 (month / day names)
      └── module 624   phrase dictionary   { "Back to top": ["Yukarıya dön"], ... }
```

So one new language = four edits inside a minified bundle, which is why this got
painful.

Two behaviours of the framework matter here, and both are load-bearing:

1. **A missing language silently renders as English.** The Provider does
   `return localeData[locale] ? locale : "en"`. No error, no warning.
2. **A locale may be a function returning a promise.** The Provider does
   `if (typeof i === "function") { i = await i(); }`. That is the hook this
   package uses — languages load on demand, and the bundle never grows.

---

## What the audit found

Run `node tools/audit.js <bundle.js>` to reproduce all of this.

### 1. Polish is in the bundle but not connected

Module 625 contains a complete 38-phrase Polish dictionary. Nothing requires it.
Because of behaviour (1) above, selecting Polish shows English with no error —
which is almost certainly why it looked like it "didn't work".

Its gettext header also declares `nplurals=12`, which is not a valid Polish
plural rule (Polish has 3 forms). Corrected in `locales/pl.json`.

### 2. Accented text is double-encoded — including English

At some point the translations were saved as UTF-8, read back as Windows-1252,
and saved as UTF-8 again. The bundle currently contains:

| language | shown on the site now | should be |
|---|---|---|
| en | `You havenâ€™t selected any products` | `You haven’t selected any products` |
| tr | `ÃœrÃ¼n Rehberi` | `Ürün Rehberi` |
| tr | `Gezinmeyi DeÄŸiÅŸtir` | `Gezinmeyi Değiştir` |
| pl | `PrzeÅ‚Ä…cz nawigacjÄ™` | `Przełącz nawigację` |

33 of 38 Turkish phrases and 25 of 38 Polish phrases are affected. Romanian
escapes it only because its translations were written without diacritics
(`Selectie produs`, not `Selecție produs`).

**This is why it has to be fixed carefully.** The damage is on *both* sides —
the dictionary key *and* the English string compiled into the component are both
mojibake, so they still match each other and the lookup works. Repairing only
one side breaks it. `tools/patch-bundle.js --fix-encoding` repairs both together,
and the runtime additionally accepts either spelling so it cannot half-break.

### 3. Placeholders dropped in two footer translations

The English footer is:

```
© Copyright {0} LTP. All rights reserved. Company Registration No. {1}. VAT No. {2}
```

| language | translation | effect |
|---|---|---|
| ro | `© Copyright LTP. Toate drepturile rezervate. Date identificare: {0}` | registration no. and VAT no. are **not shown at all** |
| tr | `© Telif Hakkı {0} LTP. ... Şirket Kayıt No. KDV No. {2}` | `{1}` missing — "Company Reg. No." with **no number after it** |

These are translation-copy problems rather than code problems, so I have not
invented replacements — they need a word from whoever supplies the translations.

---

## Installing

**1. Publish the runtime and the locale files**

Put `src/ltp-i18n.js` and the `locales/` folder somewhere the site can serve, e.g.
`/wp-content/themes/<theme>/product-selector/`.

**2. Patch the bundle once**

```bash
node tools/patch-bundle.js path/to/bundle.js -o path/to/bundle.new.js --fix-encoding
```

This rewrites the locale map to:

```js
var b = window.LTPI18n.register(
  { en: h.default, ro: m.default, tr: v.default },
  { format: n(81), buildFormattingTokensRegExp: n(135), fallbackDateLocale: n(224) }
);
```

The module numbers are read out of the bundle, not hard-coded, so this still
works if the app is ever rebuilt and the modules are renumbered. It works on the
minified bundle as well as the readable one.

Drop `--fix-encoding` if you would rather leave the existing text exactly as it
is and only add the hook.

**3. Load the runtime before the bundle**

```html
<script src="/path/to/ltp-i18n.js"></script>
<script>
  LTPI18n.configure({
    basePath: '/path/to/locales/',
    locales: {
      pl: {},                  // -> /path/to/locales/pl.json
      de: {},                  // -> /path/to/locales/de.json
      fr: { url: '/somewhere/else/french.json' }
    }
  });
</script>
<script src="/path/to/bundle.new.js"></script>
```

**4. Make sure WordPress offers the language**

The switcher list comes from your WordPress API (`languages?lang=…`), not from
the JavaScript. A language has to appear there *and* have a JSON file. To check
both at once, in the browser console:

```js
LTPI18n.report(await (await fetch('/your-api/languages?lang=en')).json());
```

Anything reported as `NO - falls back to English` is listed by WordPress but has
no translations behind it.

---

## Adding a language after that

1. `cp locales/_template.json locales/de.json`
2. Fill in `code`, the `messages` values, and the `plural_forms` header.
3. Add `de: {}` to the `locales` block in step 3 above.

That is the whole process. Nothing is compiled and the bundle is not touched
again.

The keys in `messages` are the English strings exactly as they appear in the
interface — `tools/extract-locales.js` writes out a correct, complete set from
the bundle, so the template is always in sync with what the app actually asks for.

### Dates

`date` is optional. Leave it out and dates still render correctly, just with
English month and day names. Fill it in and new languages format dates through
the **bundle's own date-fns engine** — the same code path `en`, `ro` and `tr`
use, so there is no second date implementation to drift.

### Plurals

`plural_forms` is compiled into a function by the framework, so a malformed rule
is a runtime error. The runtime validates it at load and warns in the console if
the rule and the declared `nplurals` disagree — which is what catches the
`nplurals=12` class of mistake.

---

## The tools

| command | what it does |
|---|---|
| `node tools/audit.js <bundle.js>` | reports wiring, encoding, plural rules, coverage and placeholder mismatches per language. Non-zero exit if anything is broken. |
| `node tools/extract-locales.js <bundle.js> -d locales/` | writes every dictionary in the bundle out to JSON, repairing encoding and correcting known-bad plural rules |
| `node tools/patch-bundle.js <bundle.js> -o out.js [--fix-encoding] [--dry-run]` | applies the one-line hook |
| `node test/verify.js <bundle.js>` | static checks: wiring, unwired dictionaries, fallback behaviour |
| `node test/mojibake.test.js` | unit tests for the encoding repair, including strings that must **not** change |
| `python3 test/browser-verify.py <patched-bundle.js>` | loads the patched bundle in a real browser and proves a new language resolves through the app's own Provider |

### Verification

`browser-verify.py` runs the actual patched bundle in Chromium and asserts:

```
== browser: patched bundle booted ==
  PASS  no uncaught page errors
  PASS  LTPI18n.register() ran during bundle bootstrap
  PASS  locale map codes            (en, pl, ro, tr)
  PASS  pl is lazy                  (fetched only when selected)
  PASS  en is eager

== Polish resolved in-browser ==
  PASS  gettext('Product Selector') -> Wybór produktu
  PASS  gettext('Back to top')      -> Powrót na górę
  PASS  gettext('Loading...')       -> Załadunek
  PASS  formatDate MMMM             -> marca
       humanizedDate -> 09 marca 2026
  PASS  damaged 'Â©' key resolves to Polish
  PASS  clean '©' key resolves to Polish

== built-in languages after the patch ==
  PASS  ro unchanged                -> Selectie produs
  PASS  en unchanged                -> Product Selector
  PASS  tr still translated         -> Ürün Rehberi

14 passed, 0 failed
```

It passes against both a bundle patched with `--fix-encoding` and one patched
without it, which is what demonstrates that the encoding repair and the language
mechanism are independent and neither can half-break the other.

---

## Notes

- The runtime is plain ES5 with no dependencies and no build step.
- Built-in languages always win over configured ones, so this cannot
  accidentally shadow `en`, `ro` or `tr`. It warns if you try.
- If a locale file fails to load, that language falls back to English and the
  reason is logged — the app does not break.
- Module 625 (the orphaned Polish dictionary) can be left in the bundle
  harmlessly, since Polish now comes from JSON. `tools/audit.js` will keep
  reporting it as unwired until it is removed at the next rebuild.
