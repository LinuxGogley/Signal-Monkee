"""LOS planning panel: terrain-only check (clear/blocked, altitude needed), viewshed, PDF, works in both modes."""
import os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import run
from playwright.sync_api import sync_playwright
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out'); os.makedirs(OUT, exist_ok=True)
READY = "document.getElementById('statusTxt').textContent==='ready'"
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1600, 'height': 960}, accept_downloads=True); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None); pg.route('**/*', run.route)
    pg.goto(run.HTML); pg.wait_for_function(READY, timeout=30000)
    print('rail:', pg.evaluate("[...document.querySelectorAll('#rail button')].map(b=>b.dataset.p)"), '| map buttons:', pg.evaluate("[...document.querySelectorAll('#maptools > .hbtn, #maptools > div > .hbtn')].map(b=>b.textContent.trim())"))
    print('emoji left in UI:', pg.evaluate(r"(document.body.innerText.match(/[\u{1F300}-\u{1FAFF}⬇＋]/gu)||[]).join('')") or 'none', '| template select:', pg.evaluate("!!document.getElementById('tplSel')"))
    pg.evaluate("S.tx.placed=true;S.rx.placed=true;S.tx.lat=36.019;S.tx.lon=-120.944;S.tx.h=10;S.rx.lat=36.141;S.rx.lon=-120.36;S.rx.mode='agl';S.rx.h=2;S.los.radius=25;S.los.rxMode='agl';S.los.rxH=2;saveState();placeMarkers()")
    pg.click('#rail button[data-p=los]'); time.sleep(0.3)
    pg.click('#losRun'); pg.wait_for_function("RF.last && RF.last.losOnly && " + READY, timeout=60000); time.sleep(0.4)
    print('BLOCKED:\n' + pg.eval_on_selector('#losResult', 'e=>e.innerText'))
    need = pg.evaluate("RF.last.rxAltNeed")
    pg.evaluate("S.rx.mode='msl';S.rx.h=%f;saveState();rerender()" % (need + 20)); time.sleep(0.2)
    pg.click('#losRun'); pg.wait_for_function("RF.last && RF.last.rx.mode==='msl' && " + READY, timeout=60000); time.sleep(0.4)
    print('at needed altitude + 20 m ->', pg.evaluate("OPS.verdict(RF.last).text"), '| profile has RSSI text:', pg.evaluate("RF.last.losOnly"))
    with pg.expect_download() as d: pg.click('#losResult >> text=PDF report')
    d.value.save_as(os.path.join(OUT, 'los_report.pdf'))
    pg.click('#losMap'); pg.wait_for_function("COV.cur && COV.cur.losOnly && " + READY, timeout=120000); time.sleep(0.5)
    print('viewshed legend:', pg.eval_on_selector('#legend', 'e=>e.innerText').replace('\n', ' '), '| info:', pg.eval_on_selector('#infoTab', 'e=>e.innerText').replace('\n', ' ')[-60:])
    pg.screenshot(path=OUT + '/los_viewshed.png')
    pg.click('#modeSeg button[data-m=operator]'); time.sleep(0.4)
    print('operator bottom buttons:', pg.evaluate("[$('bP2P').textContent.trim(), $('bCov').textContent.trim()]"), '| LOS panel visible in operator:', pg.evaluate("!document.querySelector('#rail button[data-p=los]').classList.contains('hidden')"))
    pg.click('#rail button[data-p=los]'); time.sleep(0.3); pg.click('#losRun'); pg.wait_for_function("RF.last && RF.last.losOnly && " + READY, timeout=60000)
    print('LOS in operator mode ->', pg.evaluate("OPS.verdict(RF.last).text"))
    print('ERRS', errs); b.close()
