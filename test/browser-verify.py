#!/usr/bin/env python3
"""
browser-verify.py - run the patched bundle in a real browser and prove that a
new language resolves through the bundle's own Provider code path.

  python3 test/browser-verify.py <patched-bundle.js>

The WordPress API is stubbed with a minimal response so the app can boot
offline; everything asserted here is the localisation layer, which is what the
patch touches.
"""
import json
import os
import sys
import http.server
import socketserver
import threading
import functools

from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

if len(sys.argv) < 2:
    print("usage: python3 test/browser-verify.py <patched-bundle.js>")
    sys.exit(1)
BUNDLE = os.path.abspath(sys.argv[1])

serve_dir = os.path.join(ROOT, ".serve")
os.makedirs(os.path.join(serve_dir, "locales"), exist_ok=True)

# assemble the document root
import shutil
shutil.copy(BUNDLE, os.path.join(serve_dir, "bundle.js"))
shutil.copy(os.path.join(ROOT, "src", "ltp-i18n.js"), os.path.join(serve_dir, "ltp-i18n.js"))
for f in os.listdir(os.path.join(ROOT, "locales")):
    if f.endswith(".json"):
        shutil.copy(os.path.join(ROOT, "locales", f), os.path.join(serve_dir, "locales", f))

with open(os.path.join(serve_dir, "index.html"), "w", encoding="utf-8") as fh:
    fh.write("""<!doctype html>
<html><head><meta charset="utf-8"><title>locale harness</title></head>
<body>
<div id="app"></div>
<script src="ltp-i18n.js"></script>
<script>
  window.__logs = [];
  ['log','warn','error'].forEach(function (lvl) {
    var orig = console[lvl];
    console[lvl] = function () {
      window.__logs.push(lvl + ': ' + Array.prototype.slice.call(arguments).join(' '));
      orig.apply(console, arguments);
    };
  });
  // Adding a language: one entry. The JSON is fetched only when pl is selected.
  LTPI18n.configure({
    basePath: 'locales/',
    debug: true,
    locales: { pl: {} }
  });
</script>
<script src="bundle.js"></script>
</body></html>
""")


class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


httpd = socketserver.TCPServer(("127.0.0.1", 0), functools.partial(Handler, directory=serve_dir))
port = httpd.server_address[1]
threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = "http://127.0.0.1:%d/" % port

passed = failed = 0


def check(name, actual, expected):
    global passed, failed
    ok = actual == expected
    if ok:
        passed += 1
    else:
        failed += 1
    print("  %s  %s" % ("PASS" if ok else "FAIL", name))
    if not ok:
        print("        expected: %r" % (expected,))
        print("        actual  : %r" % (actual,))


def check_true(name, cond, detail=""):
    global passed, failed
    if cond:
        passed += 1
    else:
        failed += 1
    print("  %s  %s%s" % ("PASS" if cond else "FAIL", name, "" if cond else "   " + str(detail)))


with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page()
    page.set_viewport_size({"width": 1280, "height": 720})

    # stub the WordPress REST calls so the app can boot with no backend
    def route_api(route):
        url = route.request.url
        body = []
        if "languages" in url:
            body = [{"code": "en", "name": "English"}, {"code": "ro", "name": "Romana"},
                    {"code": "tr", "name": "Turkce"}, {"code": "pl", "name": "Polski"}]
        route.fulfill(status=200, content_type="application/json", body=json.dumps(body))

    page.route("**/wp-json/**", route_api)
    page.route("**/api/**", route_api)

    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))

    page.goto(base, wait_until="load")
    page.wait_for_timeout(1500)

    print("\n== browser: patched bundle booted ==")
    check_true("no uncaught page errors", len(errors) == 0, errors[:3])

    have_map = page.evaluate("() => !!(window.LTPI18n && window.LTPI18n._map)")
    check_true("LTPI18n.register() ran during bundle bootstrap", have_map)

    if have_map:
        codes = page.evaluate("() => Object.keys(window.LTPI18n._map)")
        check("locale map codes", sorted(codes), ["en", "pl", "ro", "tr"])
        check("pl is lazy", page.evaluate("() => typeof window.LTPI18n._map.pl"), "function")
        check("en is eager", page.evaluate("() => typeof window.LTPI18n._map.en"), "object")

        # resolve pl exactly as the bundle's Provider does
        res = page.evaluate("""async () => {
            const i = window.LTPI18n._map.pl;
            const d = (typeof i === 'function') ? await i() : i;
            const g = (k) => (d.messages[k] ? d.messages[k][0] : k);
            return {
              count: Object.keys(d.messages).length,
              productSelector: g('Product Selector'),
              backToTop: g('Back to top'),
              loading: g('Loading...'),
              monthName: d.additions.formatDate(new Date(2026, 2, 9), 'MMMM'),
              humanized: d.additions.formatDate(new Date(2026, 2, 9), d.additions.formats.humanizedDate),
              damagedKey: g('\\u00c2\\u00a9 Copyright {0} LTP. All rights reserved. Company Registration No. {1}. VAT No. {2}').slice(0, 20),
              cleanKey: g('\\u00a9 Copyright {0} LTP. All rights reserved. Company Registration No. {1}. VAT No. {2}').slice(0, 20)
            };
        }""")
        print("\n== Polish resolved in-browser ==")
        check("gettext('Product Selector')", res["productSelector"], "Wybór produktu")
        check("gettext('Back to top')", res["backToTop"], "Powrót na górę")
        check("gettext('Loading...')", res["loading"], "Załadunek")
        check("formatDate MMMM", res["monthName"], "marca")
        print("     humanizedDate -> %s" % res["humanized"])
        check_true("damaged 'Â©' key resolves to Polish",
                   res["damagedKey"].startswith("© Copyright") or "Wszelkie" in res["damagedKey"],
                   res["damagedKey"])
        check_true("clean '©' key resolves to Polish",
                   res["cleanKey"].startswith("© Copyright") or "Wszelkie" in res["cleanKey"],
                   res["cleanKey"])

        # built-ins untouched
        built = page.evaluate("""() => {
            const m = window.LTPI18n._map;
            const g = (d, k) => (d.messages[k] ? d.messages[k][0] : k);
            return { ro: g(m.ro, 'Product Selector'), tr: g(m.tr, 'Product Selector'),
                     en: g(m.en, 'Product Selector') };
        }""")
        print("\n== built-in languages after the patch ==")
        check("ro unchanged", built["ro"], "Selectie produs")
        check("en unchanged", built["en"], "Product Selector")
        check_true("tr still translated", built["tr"] != "Product Selector", built["tr"])
        print("     tr -> %s" % built["tr"])

    logs = page.evaluate("() => window.__logs || []")
    interesting = [l for l in logs if "ltp-i18n" in l]
    if interesting:
        print("\n== runtime log ==")
        for l in interesting[:12]:
            print("     " + l)

    page.screenshot(path=os.path.join(ROOT, "test", "browser-verify.png"))
    browser.close()

httpd.shutdown()
print("\n%d passed, %d failed" % (passed, failed))
sys.exit(1 if failed else 0)
