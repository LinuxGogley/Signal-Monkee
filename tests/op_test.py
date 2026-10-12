"""Operator mode: blocked/clear LOS, required altitude, free-space RSSI check, coverage, PDF, mode switch."""
import os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import run
from playwright.sync_api import sync_playwright
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out'); os.makedirs(OUT, exist_ok=True)
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1600, 'height': 960}, accept_downloads=True); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None); pg.route('**/*', run.route)
    pg.goto(run.HTML); pg.wait_for_function("document.getElementById('statusTxt').textContent==='ready'", timeout=30000)
    pg.click('#modeSeg button[data-m=operator]'); time.sleep(0.4)
    print('rail visible:', pg.evaluate("[...document.querySelectorAll('#rail button')].filter(b=>!b.classList.contains('hidden')).map(b=>b.dataset.p)"))
    pg.evaluate("S.f=127;S.pwrW=25;S.txGain=2.15;S.op.minRssi=-101;saveState();rerender()"); time.sleep(0.3)
    pg.evaluate("S.tx.placed=true;S.rx.placed=true;S.tx.lat=36.019;S.tx.lon=-120.944;S.tx.h=10;S.rx.lat=36.141;S.rx.lon=-120.36;S.rx.mode='agl';S.rx.h=2;saveState();placeMarkers();rerender()")
    pg.click('#bP2P'); pg.wait_for_function("RF.last && document.getElementById('statusTxt').textContent==='ready'", timeout=60000); time.sleep(0.5)
    print('BLOCKED case:\n' + pg.eval_on_selector('#opResult', 'e=>e.innerText'))
    pg.screenshot(path=OUT + '/32_op_blocked.png')
    need = pg.evaluate("RF.last.rxAltNeed")
    pg.evaluate("S.rx.mode='msl';S.rx.h=%f;saveState();rerender()" % (need + 30))
    pg.click('#bP2P'); pg.wait_for_function("RF.last && RF.last.rx.mode==='msl' && document.getElementById('statusTxt').textContent==='ready'", timeout=60000); time.sleep(0.5)
    print('ABOVE needed altitude:', pg.evaluate("[RF.last.los0, RF.last.minClr.toFixed(1), RF.last.Prx.toFixed(1)]"), pg.evaluate("OPS.verdict(RF.last).text"))
    # independent check: free-space RSSI
    print('check RSSI:', pg.evaluate("(()=>{var A=RF.last;return (RF.txdBm()+S.txGain+S.rxGain-(32.45+20*Math.log10(S.f)+20*Math.log10(A.D/1000))).toFixed(2)+' vs '+A.Prx.toFixed(2)})()"))
    pg.screenshot(path=OUT + '/32_op_clear.png')
    with pg.expect_download() as d: pg.click('#opResult >> text=PDF report')
    d.value.save_as(os.path.join(OUT, 'operator_report.pdf'))
    pg.evaluate("S.cov.radius=25;S.cov.maxSteps=150;S.cov.rxMode='msl';S.cov.rxH=1500;saveState()")
    pg.click('#bCov'); pg.wait_for_function("COV.cur && document.getElementById('statusTxt').textContent==='ready'", timeout=120000); time.sleep(0.5)
    print('cov model:', pg.evaluate("[COV.cur.model, COV.cur.opts.model]"), 'legend:', pg.eval_on_selector('#legend', 'e=>e.innerText').replace('\n', ' ')[:120])
    pg.screenshot(path=OUT + '/32_op_cov.png')
    pg.click('#modeSeg button[data-m=engineer]'); time.sleep(0.4)
    print('after switch: results cleared', pg.evaluate("[!!RF.last, !!COV.cur]"), 'rail:', pg.evaluate("[...document.querySelectorAll('#rail button')].filter(b=>!b.classList.contains('hidden')).length"))
    pg.click('#bP2P'); pg.wait_for_function("RF.last && document.getElementById('statusTxt').textContent==='ready'", timeout=60000)
    print('engineer model:', pg.evaluate("RF.last.model"), 'verdict', pg.evaluate("OPS.verdict(RF.last).text"))
    print('ERRS', errs); b.close()
