# LTP Product Selector — adding languages

Adding a language to the Product Selector currently means hand-editing a webpack
bundle in four separate places. This turns it into: **drop in a JSON file, add one
line.** No rebuild, no bundle surgery.

Along the way the audit turned up two real defects and one red herring — see
[What the audit found](#what-the-audit-found).

> **Note on the file this was built against.** The analysis used
> `unminimised.txt`, a copy put through https://unminify.com/. That tool
> corrupted every non-ASCII character in the file, so **issue 2 below is about
> the copy, not about the deployed code.** Issues 1 and 3 are structural and
> unaffected. The locale JSON in `locales/` was extracted from that copy with
> the corruption undone, so it should be re-extracted from the real bundle
> before going live, to be certain it matches character for character.

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

### 2. Double-encoded text — *in the unminified copy only*

The `unminimised.txt` supplied for this work is full of double-encoded text
(`ÃœrÃ¼n Rehberi` instead of `Ürün Rehberi`). **This is an artefact of the
online unminifier, not a defect in the deployed bundle.**

The evidence is where the damage sits. It is not confined to the translations —
it is also in third-party library constants that ship correct from npm and have
never been near a translation workflow:

```
line 14019: return !!a[t]() || "â€‹Â…" != "â€‹Â…"[t]();      <- core-js trim test
line 14038: "\t\n\v\f\r  áš€á Žâ€€â€...";                     <- core-js whitespace table
line  5068: ? "ï¿½"                                             <- U+FFFD replacement char
line 19767: ellipsis: "â€¦",
```

Those cannot have been damaged by editing translations. The whole file was
transcoded in one pass — UTF-8 read back as Windows-1252 — which is what
https://unminify.com/ did to it.

`tools/audit.js` now reports this distinction explicitly:

- damage **inside the dictionaries only** → the translation data really is
  broken, `--fix-encoding` is appropriate
- damage **inside *and* outside** → the copy you are auditing was transcoded;
  go back to the original file and do **not** run `--fix-encoding`

`--fix-encoding` is opt-in and never on by default. It is also safe to run by
mistake: every repair is gated on a round-trip check, so correctly encoded text
cannot be altered. `test/noop-on-clean.test.js` asserts exactly this against 25
real constants taken from this bundle.

One thing to know if the real bundle *ever does* need repairing: the damage
would be on *both* sides — the dictionary key *and* the English string compiled
into the component — so they still match each other and lookups keep working.
Repairing one side alone would break them. `--fix-encoding` does both in one
pass, and the runtime accepts either spelling regardless.

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
node tools/patch-bundle.js path/to/bundle.js -o path/to/bundle.new.js
```

Run this against the **real deployed bundle**, not a copy that has been through
an online beautifier — see [issue 2](#2-double-encoded-text--in-the-unminified-copy-only).
Add `--fix-encoding` only if `tools/audit.js` reports damage confined to the
dictionaries.

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

The hook alone changes no text at all.

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
| `node test/noop-on-clean.test.js` | asserts the repair leaves correctly-encoded text untouched |
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

The language mechanism does not depend on the encoding question either way.

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
