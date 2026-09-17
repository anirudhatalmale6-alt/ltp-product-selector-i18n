#!/usr/bin/env python3
"""
demo-switch.py - screenshot the Product Selector before and after switching to
a language that was added via a JSON file only.

  python3 test/demo-switch.py <patched-bundle.js>
"""
import json, os, sys, shutil, threading, functools
import http.server, socketserver
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
BUNDLE = os.path.abspath(sys.argv[1])

serve = os.path.join(ROOT, ".serve-demo")
os.makedirs(os.path.join(serve, "locales"), exist_ok=True)
shutil.copy(BUNDLE, os.path.join(serve, "bundle.js"))
shutil.copy(os.path.join(ROOT, "src", "ltp-i18n.js"), os.path.join(serve, "ltp-i18n.js"))
for f in os.listdir(os.path.join(ROOT, "locales")):
    if f.endswith(".json"):
        shutil.copy(os.path.join(ROOT, "locales", f), os.path.join(serve, "locales", f))

# A little CSS so the screenshots are readable; the real site has its own.
with open(os.path.join(serve, "index.html"), "w", encoding="utf-8") as fh:
    fh.write("""<!doctype html>
<html><head><meta charset="utf-8"><title>Product Selector</title>
<style>
 body{font:16px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;margin:0;padding:32px;color:#1a1a1a}
 h1{font-size:28px;margin:24px 0 8px}
 a{color:#0b5cab;text-decoration:none;margin-right:10px}
 img{display:none}
 #app > div{max-width:900px}
 .lang{border:1px solid #ddd;border-radius:6px;padding:10px 14px;margin-bottom:20px;background:#fafafa}
</style></head>
<body>
<div id="app"></div>
<script src="ltp-i18n.js"></script>
<script>
  LTPI18n.configure({ basePath: 'locales/', debug: true, locales: { pl: {} } });
</script>
<script src="bundle.js"></script>
</body></html>
""")

class H(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass

httpd = socketserver.TCPServer(("127.0.0.1", 0), functools.partial(H, directory=serve))
port = httpd.server_address[1]
threading.Thread(target=httpd.serve_forever, daemon=True).start()

def api(route):
    body = []
    if "languages" in route.request.url:
        body = [{"code":"en","name":"English"},{"code":"ro","name":"Romana"},
                {"code":"tr","name":"Turkce"},{"code":"pl","name":"Polski"}]
    route.fulfill(status=200, content_type="application/json", body=json.dumps(body))

with sync_playwright() as p:
    br = p.chromium.launch()
    pg = br.new_page()
    pg.set_viewport_size({"width": 1100, "height": 560})
    pg.route("**/wp-json/**", api); pg.route("**/api/**", api)
    pg.goto("http://127.0.0.1:%d/" % port, wait_until="load")
    pg.wait_for_timeout(1200)

    def texts():
        return pg.evaluate("() => document.getElementById('app').innerText")

    shots = []
    for code, label in [("en", "English"), ("pl", "Polski"), ("tr", "Turkce")]:
        link = pg.locator("a", has_text=label).first
        if link.count():
            link.click()
            pg.wait_for_timeout(900)
        out = os.path.join(HERE, "demo-%s.png" % code)
        pg.screenshot(path=out)
        shots.append(out)
        print("--- %s ---" % code)
        print(texts().strip()[:400])
        print()
    br.close()

httpd.shutdown()
print("screenshots: " + ", ".join(shots))
