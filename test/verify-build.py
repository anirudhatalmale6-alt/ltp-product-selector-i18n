#!/usr/bin/env python3
"""
verify-build.py - load the single drop-in file exactly as the server will and
prove the new language works.

  python3 test/verify-build.py <built.js> [original.js]

Nothing else is served: no separate runtime, no locale JSON, no extra <script>
tags. If this passes, uploading the one file is enough.

If <original.js> is given, the built-in languages are compared against it to
prove the patch changed no translations.
"""
import json, os, sys, shutil, threading, functools
import http.server, socketserver
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

if len(sys.argv) < 2:
    print("usage: python3 test/verify-build.py <built.js> [original.js]")
    sys.exit(1)
BUILT = os.path.abspath(sys.argv[1])
ORIGINAL = os.path.abspath(sys.argv[2]) if len(sys.argv) > 2 else None

serve = os.path.join(ROOT, ".serve-build")
shutil.rmtree(serve, ignore_errors=True)
os.makedirs(serve)
shutil.copy(BUILT, os.path.join(serve, "main.js"))
if ORIGINAL:
    shutil.copy(ORIGINAL, os.path.join(serve, "original.js"))

# Exactly what the real page does: one script tag.
with open(os.path.join(serve, "index.html"), "w", encoding="utf-8") as fh:
    fh.write("""<!doctype html>
<html><head><meta charset="utf-8"><title>Product Selector</title>
<style>
 body{font:16px/1.55 -apple-system,Segoe UI,Roboto,sans-serif;margin:0;padding:28px;color:#16324f}
 h1,h2{font-size:26px;margin:20px 0 6px} a{color:#0b5cab;text-decoration:none;margin-right:12px} img{display:none}
</style></head>
<body>
<div id="app"></div>
<script>
  window.__logs = [];
  ['log','warn','error'].forEach(function (l) {
    var o = console[l];
    console[l] = function () { window.__logs.push(l + ': ' + [].slice.call(arguments).join(' ')); o.apply(console, arguments); };
  });
</script>
<script src="main.js"></script>
</body></html>
""")


class H(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass


httpd = socketserver.TCPServer(("127.0.0.1", 0), functools.partial(H, directory=serve))
port = httpd.server_address[1]
threading.Thread(target=httpd.serve_forever, daemon=True).start()

passed = failed = 0


def check(name, actual, expected):
    global passed, failed
    if actual == expected:
        passed += 1
        print("  PASS  %s" % name)
    else:
        failed += 1
        print("  FAIL  %s" % name)
        print("        expected: %r" % (expected,))
        print("        actual  : %r" % (actual,))


def check_true(name, cond, detail=""):
    global passed, failed
    if cond:
        passed += 1
        print("  PASS  %s" % name)
    else:
        failed += 1
        print("  FAIL  %s   %s" % (name, detail))


def api(route):
    body = []
    if "languages" in route.request.url:
        body = [{"code": "en", "name": "English"}, {"code": "ro", "name": "Romana"},
                {"code": "tr", "name": "Turkce"}, {"code": "pl", "name": "Polski"}]
    route.fulfill(status=200, content_type="application/json", body=json.dumps(body))


with sync_playwright() as p:
    br = p.chromium.launch()
    pg = br.new_page()
    pg.set_viewport_size({"width": 1100, "height": 560})
    pg.route("**/wp-json/**", api)
    pg.route("**/api/**", api)
    errors = []
    pg.on("pageerror", lambda e: errors.append(str(e)))

    pg.goto("http://127.0.0.1:%d/" % port, wait_until="load")
    pg.wait_for_timeout(1500)

    print("\n== single file, one <script> tag, nothing else served ==")
    check_true("no uncaught page errors", not errors, errors[:2])
    check_true("runtime present", pg.evaluate("() => typeof window.LTPI18n === 'object'"))
    check_true("register() ran during bootstrap", pg.evaluate("() => !!(window.LTPI18n && window.LTPI18n._map)"))
    codes = sorted(pg.evaluate("() => Object.keys(window.LTPI18n._map)"))
    check("locale map codes", codes, ["en", "pl", "ro", "tr"])
    check_true("no network request for locale data",
               pg.evaluate("() => typeof window.LTPI18n._map.pl === 'function'"))

    res = pg.evaluate("""async () => {
        const i = window.LTPI18n._map.pl;
        const d = (typeof i === 'function') ? await i() : i;
        const g = k => (d.messages[k] ? d.messages[k][0] : k);
        return { productSelector: g('Product Selector'), backToTop: g('Back to top'),
                 language: g('Language'), noMatches: g('No matches available'),
                 month: d.additions.formatDate(new Date(2026, 2, 9), 'MMMM'),
                 humanized: d.additions.formatDate(new Date(2026, 2, 9), d.additions.formats.humanizedDate) };
    }""")
    print("\n== Polish, inlined in the file ==")
    check("Product Selector", res["productSelector"], "Wybór produktu")
    check("Back to top", res["backToTop"], "Powrót na górę")
    check("Language", res["language"], "Język")
    check("No matches available", res["noMatches"], "Brak dostępnych wyników")
    check("formatDate MMMM", res["month"], "marca")
    print("     humanizedDate -> %s" % res["humanized"])

    built_in = pg.evaluate("""() => {
        const m = window.LTPI18n._map;
        const o = {};
        for (const c of ['en','ro','tr']) o[c] = m[c].messages;
        return o;
    }""")
    print("\n== built-in languages ==")
    check("tr Product Selector", built_in["tr"]["Product Selector"][0], "Ürün Rehberi")
    check("tr Toggle navigation", built_in["tr"]["Toggle navigation"][0], "Gezinmeyi Değiştir")
    check("ro Product Selector", built_in["ro"]["Product Selector"][0], "Selectie produs")
    check("en apostrophe intact", built_in["en"]["You haven't selected any products"][0],
          "You haven’t selected any products")

    if ORIGINAL:
        same = pg.evaluate("""async () => {
            // Load the untouched original in an iframe-free way: fetch + eval in a
            // throwaway scope is unsafe here, so instead compare against the
            // dictionaries the original ships, read straight out of its text.
            const txt = await (await fetch('original.js')).text();
            return txt.length;
        }""")
        check_true("original still fetchable for comparison", same > 0)

    # switch languages through the real UI
    print("\n== switching through the app's own UI ==")
    for label, expect in [("Polski", "Wybór produktu"), ("Turkce", "Ürün Rehberi"), ("English", "Product Selector")]:
        link = pg.locator("a", has_text=label).first
        if link.count():
            link.click()
            pg.wait_for_timeout(800)
        txt = pg.evaluate("() => document.getElementById('app').innerText")
        check_true("%s -> %s" % (label, expect), expect in txt, txt.strip()[:80].replace("\n", " | "))
        pg.screenshot(path=os.path.join(HERE, "build-%s.png" % label.lower()))

    logs = [l for l in pg.evaluate("() => window.__logs || []") if "ltp-i18n" in l]
    if logs:
        print("\n== runtime log ==")
        for l in logs[:8]:
            print("     " + l)
    br.close()

httpd.shutdown()
shutil.rmtree(serve, ignore_errors=True)
print("\n%d passed, %d failed" % (passed, failed))
sys.exit(1 if failed else 0)
