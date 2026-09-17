import os
from playwright.sync_api import sync_playwright
OUT = "/var/lib/freelancer/projects/40714502/ltp-i18n/test/live"
SHOTS = [(6, "live-french-english-text.png", 9000), (None, "live-language-menu.png", 0)]
with sync_playwright() as p:
    br = p.chromium.launch()
    ctx = br.new_context(viewport={"width":1280,"height":720},
        user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
    pg = ctx.new_page()
    pg.route("**/*", lambda r: r.abort() if r.request.method in ("POST","PUT","PATCH","DELETE") else r.continue_())
    pg.goto("https://ltp-productguide.co.uk/", wait_until="networkidle", timeout=60000)
    pg.wait_for_timeout(2500)
    # menu open
    pg.locator("#languagesMenu").first.click(); pg.wait_for_timeout(700)
    p1 = os.path.join(OUT, "live-language-menu.png"); pg.screenshot(path=p1)
    print(p1, os.path.exists(p1), os.path.getsize(p1))
    # french
    pg.locator("a.dropdown-item").nth(6).click(); pg.wait_for_timeout(9000)
    p2 = os.path.join(OUT, "live-french-english-text.png"); pg.screenshot(path=p2)
    print("heading:", pg.locator("h1,h2,.entry-title").first.inner_text().strip())
    print(p2, os.path.exists(p2), os.path.getsize(p2))
    br.close()
