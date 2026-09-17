/*
 * Shared helpers for reading the Product Selector webpack bundle.
 *
 * The bundle is a single IIFE that takes the module array as its argument:
 *
 *   minified :  !function(t){ ... n(n.s=238)}([function(t,e,n){...},...]);
 *   beautified: !(function (t) { ... n((n.s = 238)); })([ function (t, e, n) {...}, ... ]);
 *
 * The two differ in spacing and in whether the IIFE is parenthesised, so we
 * locate the array by finding the entry-point call (`n.s = <id>`) and taking
 * the first `[` after it. Everything else keys off the evaluated array, which
 * makes module ids authoritative rather than guessed from indentation.
 */

'use strict';

const ENTRY_RE = /n\(\s*\(?\s*n\.s\s*=\s*(\d+)\s*\)?\s*\)\s*;?/;

function findArrayBounds(source) {
  const m = ENTRY_RE.exec(source);
  if (!m) return null;
  const open = source.indexOf('[', m.index + m[0].length);
  if (open < 0) return null;

  // The array runs to the last `]` that is followed only by `)` `;` whitespace.
  const tail = /\]\s*\)\s*;?\s*$/.exec(source);
  const close = tail ? tail.index : source.lastIndexOf(']');
  if (close <= open) return null;
  return { open, close, entryId: Number(m[1]) };
}

/** Returns { modules: Function[], entryId, open, close } or null. */
function loadModules(source) {
  const b = findArrayBounds(source);
  if (!b) return null;
  let arr;
  try {
    arr = eval('(' + source.slice(b.open, b.close + 1) + ')');
  } catch (e) {
    return null;
  }
  if (!Array.isArray(arr) || !arr.length) return null;
  return { modules: arr, entryId: b.entryId, open: b.open, close: b.close };
}

/** Source text of each module, in id order. */
function moduleSources(source) {
  const loaded = loadModules(source);
  if (!loaded) return [];
  return loaded.modules.map(f => f.toString());
}

/**
 * The hard-coded locale map, e.g. `var b = { en: h.default, ro: m.default, tr: v.default }`.
 * Returns { match, varName, entries: [{code, expr}], index, length } or null.
 * Accepts any number of languages and any identifier names.
 */
function findLocaleMap(source) {
  // `var X = { code: expr, code: expr, ... }` where every value is `ident.default`
  const re = /var\s+([A-Za-z_$][\w$]*)\s*=\s*\{\s*((?:[A-Za-z_][\w-]*\s*:\s*[A-Za-z_$][\w$]*\.default\s*,\s*){1,}[A-Za-z_][\w-]*\s*:\s*[A-Za-z_$][\w$]*\.default\s*)\}\s*[;,]/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    const entries = [];
    const partRe = /([A-Za-z_][\w-]*)\s*:\s*([A-Za-z_$][\w$]*\.default)/g;
    let p;
    while ((p = partRe.exec(m[2])) !== null) entries.push({ code: p[1], expr: p[2] });
    // A locale map has at least two entries and contains "en".
    if (entries.length >= 2 && entries.some(e => e.code === 'en')) {
      return { match: m[0], varName: m[1], entries, index: m.index, length: m[0].length };
    }
  }
  return null;
}

/**
 * Given `h.default`, find the wrapper module id from `h=g(n(613))` / `h = g(n(613))`.
 */
function wrapperIdFor(source, expr) {
  const varName = String(expr).split('.')[0].trim();
  const re = new RegExp(varName + '\\s*=\\s*[A-Za-z_$][\\w$]*\\(\\s*n\\(\\s*(\\d+)\\s*\\)\\s*\\)');
  const m = re.exec(source);
  return m ? Number(m[1]) : null;
}

/** Module ids required by a module, in order of appearance. */
function requiresOf(moduleSource) {
  return Array.from(String(moduleSource).matchAll(/n\(\s*(\d+)\s*\)/g)).map(x => Number(x[1]));
}

/** Is module `id` required by anything in the bundle? */
function isReferenced(source, id) {
  return new RegExp('n\\(\\s*' + id + '\\s*\\)').test(source);
}

/**
 * Every phrase dictionary in the bundle: modules whose exports is an object
 * carrying a gettext "" header.
 */
function findDictionaries(source) {
  const sources = moduleSources(source);
  const out = [];
  for (let id = 0; id < sources.length; id++) {
    const body = sources[id];
    if (!/t\.exports\s*=\s*\{/.test(body) || !/""\s*:\s*\{/.test(body)) continue;
    const m = { exports: {} };
    try {
      eval('(' + body + ')')(m, m.exports, () => ({}));
    } catch (e) { continue; }
    if (m.exports && m.exports[''] && m.exports['']['lang']) {
      out.push({ id, dict: m.exports, lang: m.exports['']['lang'] });
    }
  }
  return out;
}

/** date-fns `format`, the token-regexp builder, and the English date locale. */
function findDateEngineIds(source, enExpr) {
  const wrapperId = wrapperIdFor(source, enExpr);
  if (wrapperId === null) return null;
  const sources = moduleSources(source);
  const body = sources[wrapperId];
  if (!body) return null;
  const ids = requiresOf(body);
  if (ids.length < 2) return null;

  let buildRegExp = null;
  for (let i = 0; i < sources.length; i++) {
    if (/formattingTokensRegExp\s*:\s*\w+\(/.test(sources[i])) {
      const inner = /var\s+(\w+)\s*=\s*n\(\s*(\d+)\s*\)/.exec(sources[i]);
      if (inner) { buildRegExp = Number(inner[2]); break; }
    }
  }
  return { format: ids[0], enDateLocale: ids[1], buildRegExp, wrapperId };
}

module.exports = {
  findArrayBounds, loadModules, moduleSources, findLocaleMap,
  wrapperIdFor, requiresOf, isReferenced, findDictionaries, findDateEngineIds,
};
