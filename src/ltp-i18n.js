/*!
 * ltp-i18n.js - add languages to the Product Selector bundle without rebuilding it.
 *
 * The bundle ships a hard-coded locale map:
 *
 *     var b = { en: h.default, ro: m.default, tr: v.default };
 *
 * Every new language today means hand-editing four places inside a webpack
 * bundle. This file replaces that with a registry: the map is built once, and
 * further languages are plain JSON files.
 *
 * The bundle's Provider already supports lazy locales - it does:
 *
 *     i = localeData[locale];
 *     if (typeof i === "function") { i = await i(); }
 *
 * so each language registered here is a function that resolves to
 * { messages, additions } only when that language is actually selected.
 *
 * Load this file BEFORE the bundle. ES5 only, no dependencies.
 */
(function (global) {
  'use strict';

  var config = { locales: {}, basePath: '/locales/', debug: false };
  var cache = {};
  var engine = null; // { format, buildFormattingTokensRegExp, fallbackDateLocale }

  // ---------------------------------------------------------------- utilities

  function warn() {
    if (global.console && console.warn) {
      console.warn.apply(console, ['[ltp-i18n]'].concat([].slice.call(arguments)));
    }
  }
  function info() {
    if (config.debug && global.console && console.log) {
      console.log.apply(console, ['[ltp-i18n]'].concat([].slice.call(arguments)));
    }
  }

  function assign(target) {
    for (var i = 1; i < arguments.length; i++) {
      var s = arguments[i];
      if (!s) continue;
      for (var k in s) if (Object.prototype.hasOwnProperty.call(s, k)) target[k] = s[k];
    }
    return target;
  }

  // ------------------------------------------------------- plural_forms check
  //
  // The bundle compiles messages[""].plural_forms straight into a Function:
  //     Function("n","nplurals","plural", plural_forms + " return plural;")
  // A malformed header is therefore a runtime error, or worse, silently wrong
  // plurals. Validate it here, where the message is actionable.

  function validatePluralForms(code, pluralForms) {
    if (!pluralForms) {
      warn('locale "' + code + '": messages[""].plural_forms is missing. ' +
           'Plurals (ngettext) will throw when used.');
      return false;
    }
    var fn;
    try {
      /* jshint evil:true */
      fn = new Function('n', 'nplurals', 'plural', pluralForms + ' return plural;');
    } catch (e) {
      warn('locale "' + code + '": plural_forms does not compile: ' + e.message +
           '\n  value: ' + pluralForms);
      return false;
    }
    var declared = /nplurals\s*=\s*(\d+)/.exec(pluralForms);
    var nplurals = declared ? parseInt(declared[1], 10) : null;

    var seen = {}, max = -1, ok = true;
    for (var n = 0; n <= 200; n++) {
      var idx;
      try { idx = fn(n); } catch (e) {
        warn('locale "' + code + '": plural_forms threw for n=' + n + ': ' + e.message);
        return false;
      }
      idx = Number(idx);
      if (idx === true) idx = 1;
      if (idx === false) idx = 0;
      if (!isFinite(idx) || idx < 0) {
        warn('locale "' + code + '": plural_forms produced a bad index (' + idx + ') for n=' + n);
        ok = false;
        break;
      }
      seen[idx] = true;
      if (idx > max) max = idx;
    }
    if (ok && nplurals !== null) {
      if (max >= nplurals) {
        warn('locale "' + code + '": plural_forms declares nplurals=' + nplurals +
             ' but produces index ' + max + '. Translation arrays will be read out of range.');
        ok = false;
      } else if (max < nplurals - 1) {
        warn('locale "' + code + '": plural_forms declares nplurals=' + nplurals +
             ' but never produces an index above ' + max + '. ' +
             'The declared form count and the rule disagree - one of them is wrong.');
        ok = false;
      }
    }
    return ok;
  }

  // ------------------------------------------------------ date-fns v1 locale
  //
  // The bundle's formatDate is date-fns v1 `format(date, fmt, { locale })`.
  // A locale is { distanceInWords, format: { formatters, formattingTokensRegExp } }.
  // We can build one from plain JSON so a new language needs no JS at all.

  function buildDateLocale(code, date) {
    if (!engine || !engine.buildFormattingTokensRegExp) return null;
    if (!date) return null;

    var need = ['months', 'monthsShort', 'weekdays', 'weekdaysShort', 'weekdaysMin'];
    for (var i = 0; i < need.length; i++) {
      var arr = date[need[i]];
      var want = need[i].indexOf('month') === 0 ? 12 : 7;
      if (!arr || arr.length !== want) {
        warn('locale "' + code + '": date.' + need[i] + ' must be an array of ' + want +
             ' names - falling back to English month/day names for this language.');
        return null;
      }
    }

    var mer = date.meridiem || {};
    var A = mer.A || ['AM', 'PM'];
    var a = mer.a || ['am', 'pm'];
    var aa = mer.aa || ['a.m.', 'p.m.'];

    var formatters = {
      MMM:  function (d) { return date.monthsShort[d.getMonth()]; },
      MMMM: function (d) { return date.months[d.getMonth()]; },
      dd:   function (d) { return date.weekdaysMin[d.getDay()]; },
      ddd:  function (d) { return date.weekdaysShort[d.getDay()]; },
      dddd: function (d) { return date.weekdays[d.getDay()]; },
      A:    function (d) { return d.getHours() / 12 >= 1 ? A[1] : A[0]; },
      a:    function (d) { return d.getHours() / 12 >= 1 ? a[1] : a[0]; },
      aa:   function (d) { return d.getHours() / 12 >= 1 ? aa[1] : aa[0]; }
    };

    // Ordinals ("1st", "1er", "1."). `ordinal` may be a plain suffix string.
    if (typeof date.ordinal === 'string') {
      var suffix = date.ordinal;
      ['M', 'D', 'DDD', 'd', 'Q', 'W'].forEach(function (token) {
        formatters[token + 'o'] = function (d, base) { return base[token](d) + suffix; };
      });
    }

    return {
      format: {
        formatters: formatters,
        formattingTokensRegExp: engine.buildFormattingTokensRegExp(formatters)
      },
      // distanceInWords is only used by relative-time helpers; fall back to
      // English rather than inventing grammar we have not been given.
      distanceInWords: engine.fallbackDateLocale && engine.fallbackDateLocale.distanceInWords
    };
  }

  var DEFAULT_FORMATS = {
    time: 'HH:mm',
    date: 'DD.MM.YYYY',
    dateTime: 'DD.MM.YYYY HH:mm',
    humanizedDate: 'DD MMMM YYYY'
  };

  // ------------------------------------------------- mojibake-tolerant lookup
  //
  // Some source strings in the bundle are stored double-encoded, e.g. the
  // footer is compiled as "Â© Copyright {0} LTP..." rather than "© Copyright...".
  // gettext looks a message up by the exact English string, so a clean JSON key
  // ("©") would never match a damaged call site ("Â©") and vice versa.
  //
  // Rather than force the bundle and the JSON to be repaired in lockstep, we
  // register both spellings. Whichever way round the bundle is, the lookup hits.

  // Windows-1252 byte -> codepoint, for the 0x80-0x9F range only.
  var CP1252 = {
    128: 8364, 130: 8218, 131: 402, 132: 8222, 133: 8230, 134: 8224, 135: 8225,
    136: 710, 137: 8240, 138: 352, 139: 8249, 140: 338, 142: 381, 145: 8216,
    146: 8217, 147: 8220, 148: 8221, 149: 8226, 150: 8211, 151: 8212, 152: 732,
    153: 8482, 154: 353, 155: 8250, 156: 339, 158: 382, 159: 376
  };

  // Re-create the damaged spelling of a string: encode as UTF-8, then read each
  // byte back as a Windows-1252 character.
  function damagedSpelling(str) {
    if (!/[^\x00-\x7F]/.test(str)) return str;     // pure ASCII cannot differ
    var bytes;
    try {
      bytes = unescape(encodeURIComponent(str));   // string -> UTF-8 bytes as chars
    } catch (e) {
      return str;
    }
    var out = '';
    for (var i = 0; i < bytes.length; i++) {
      var b = bytes.charCodeAt(i);
      if (b >= 128 && b <= 159) {
        if (!CP1252[b]) return str;                // unmappable -> give up
        out += String.fromCharCode(CP1252[b]);
      } else {
        out += String.fromCharCode(b);
      }
    }
    return out;
  }

  // For every key, also register the damaged spelling (and vice versa), so the
  // dictionary matches the bundle whether or not its strings were repaired.
  function addSpellingAliases(code, messages) {
    var aliased = 0;
    var keys = Object.keys(messages);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (!k) continue;                            // skip the "" header
      var d = damagedSpelling(k);
      if (d !== k && !Object.prototype.hasOwnProperty.call(messages, d)) {
        messages[d] = messages[k];
        aliased++;
      }
    }
    if (aliased) info('locale "' + code + '": registered ' + aliased +
                      ' alternate spelling(s) so lookups work against an unrepaired bundle');
    return messages;
  }

  // Turn a locale definition into the { messages, additions } shape that
  // createLocaleData() produces for the built-in languages.
  function toLocaleData(code, def) {
    var messages = def.messages || {};
    if (!messages['']) {
      warn('locale "' + code + '": messages is missing the "" header entry. ' +
           'Adding a default one so plurals do not crash.');
      messages[''] = { domain: 'messages', plural_forms: 'nplurals=2; plural=(n != 1);', lang: code };
    }
    validatePluralForms(code, messages[''].plural_forms);
    addSpellingAliases(code, messages);

    var dateLocale = buildDateLocale(code, def.date) || (engine && engine.fallbackDateLocale);
    var formats = assign({}, DEFAULT_FORMATS, def.formats || {});

    var additions = {
      formats: formats,
      formatDate: function (d, fmt) {
        if (!engine || !engine.format) return String(d);
        return engine.format(d, fmt, { locale: dateLocale });
      }
    };
    return { messages: messages, additions: additions };
  }

  // --------------------------------------------------------------- loading

  function fetchJSON(url) {
    if (global.fetch) {
      return global.fetch(url, { credentials: 'same-origin' }).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + url);
        return r.json();
      });
    }
    return new Promise(function (resolve, reject) {
      var x = new XMLHttpRequest();
      x.open('GET', url, true);
      x.onreadystatechange = function () {
        if (x.readyState !== 4) return;
        if (x.status >= 200 && x.status < 300) {
          try { resolve(JSON.parse(x.responseText)); }
          catch (e) { reject(new Error('Invalid JSON in ' + url + ': ' + e.message)); }
        } else {
          reject(new Error('HTTP ' + x.status + ' for ' + url));
        }
      };
      x.onerror = function () { reject(new Error('Network error for ' + url)); };
      x.send();
    });
  }

  function loaderFor(code, def) {
    return function () {
      if (cache[code]) return cache[code];
      var source;
      if (def.messages) {
        source = Promise.resolve(def);                       // inline
      } else {
        var url = def.url || (config.basePath + code + '.json');
        info('fetching locale "' + code + '" from ' + url);
        source = fetchJSON(url);
      }
      cache[code] = source.then(function (data) {
        var merged = assign({}, def, data);
        var built = toLocaleData(code, merged);
        info('locale "' + code + '" ready, ' + Object.keys(built.messages).length + ' entries');
        return built;
      })['catch'](function (err) {
        warn('locale "' + code + '" failed to load: ' + err.message +
             '. The interface will stay in English for this language.');
        cache[code] = null;
        throw err;
      });
      return cache[code];
    };
  }

  // ------------------------------------------------------------- public API

  var LTPI18n = {
    /**
     * Declare the extra languages. Call this before the bundle runs.
     *
     *   LTPI18n.configure({
     *     basePath: '/wp-content/themes/you/locales/',
     *     locales: {
     *       pl: {},                                  // -> basePath + 'pl.json'
     *       de: { url: '/custom/de.json' },
     *       fr: { messages: { ... } }                // inline, no request
     *     }
     *   });
     */
    configure: function (options) {
      options = options || {};
      if (options.basePath) config.basePath = options.basePath;
      if (options.debug !== undefined) config.debug = !!options.debug;
      if (options.locales) assign(config.locales, options.locales);
      return LTPI18n;
    },

    /** Add or replace a single language. */
    add: function (code, def) {
      config.locales[code] = def || {};
      delete cache[code];
      return LTPI18n;
    },

    /**
     * Called from inside the bundle. `builtIn` is the original hard-coded map;
     * `deps` hands us the bundle's own date-fns pieces so new languages format
     * dates through exactly the same engine as en/ro/tr.
     */
    register: function (builtIn, deps) {
      builtIn = builtIn || {};
      if (deps) {
        engine = {
          format: deps.format,
          buildFormattingTokensRegExp: deps.buildFormattingTokensRegExp,
          fallbackDateLocale: deps.fallbackDateLocale
        };
      }
      var map = assign({}, builtIn);
      var added = [];
      for (var code in config.locales) {
        if (!Object.prototype.hasOwnProperty.call(config.locales, code)) continue;
        if (map[code]) {
          warn('locale "' + code + '" is already built into the bundle - ' +
               'the built-in version wins. Remove it from configure() or rebuild the bundle without it.');
          continue;
        }
        map[code] = loaderFor(code, config.locales[code]);
        added.push(code);
      }
      LTPI18n._map = map;
      info('locale map: built-in [' + Object.keys(builtIn).join(', ') + ']' +
           (added.length ? ', added [' + added.join(', ') + ']' : ', nothing added'));
      return map;
    },

    /**
     * Diagnostic. Compares the languages the WordPress API offers against the
     * languages that actually have translation data. A language present in the
     * API but absent here renders in English with no error - which is exactly
     * the failure that is easy to miss.
     */
    report: function (apiLanguages) {
      var map = LTPI18n._map || {};
      var have = Object.keys(map);
      var rows = [];
      (apiLanguages || []).forEach(function (l) {
        var code = typeof l === 'string' ? l : (l.code || l.slug);
        rows.push({ language: code, hasTranslations: have.indexOf(code) !== -1 ? 'yes' : 'NO - falls back to English' });
      });
      have.forEach(function (code) {
        var listed = (apiLanguages || []).some(function (l) {
          return (typeof l === 'string' ? l : (l.code || l.slug)) === code;
        });
        if (!listed) rows.push({ language: code, hasTranslations: 'yes, but not offered by the API' });
      });
      if (global.console && console.table) console.table(rows); else warn(rows);
      return rows;
    }
  };

  global.LTPI18n = LTPI18n;
  if (typeof module !== 'undefined' && module.exports) module.exports = LTPI18n;
})(typeof window !== 'undefined' ? window : this);
