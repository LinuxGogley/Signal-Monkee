"""Placement/stale-result/clear-menu test.  Usage: python3 tests/place_test.py  (after build.py)"""
import os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import run
from playwright.sync_api import sync_playwright
OUT=os.path.join(os.path.dirname(os.path.abspath(__file__)),'out'); os.makedirs(OUT,exist_ok=True); cnt={'t':0}
def route(r):
    if 'terrarium' in r.request.url: cnt['t']+=1
    return run.route(r)
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page(viewport={'width':1600,'height':960},accept_downloads=True); errs=[]
    pg.on('pageerror',lambda e:errs.append(str(e))); pg.on('console',lambda m:errs.append(m.text) if m.type=='error' else None); pg.route('**/*',route)
    pg.goto(run.HTML); pg.wait_for_function("document.getElementById('statusTxt').textContent==='ready'",timeout=30000)
    print('modeSeg present:', pg.evaluate("!!document.getElementById('modeSeg')"), 'MCS rail:', pg.evaluate("!!document.querySelector('#rail button[data-p=mcs]')"), 'theme', pg.evaluate("S.flatTheme"))
    pg.click('#clrRes'); pg.click('#clrMenu button[data-c=sites]'); time.sleep(.3)
    print('markers after clear:', pg.evaluate("[!!markers.tx, !!markers.rx, !!markers.path]"))
    pg.click('#bP2P'); time.sleep(.3); print('log tail:', pg.eval_on_selector('#log','e=>e.innerText').split('\n')[-1])
    pg.evaluate("map.setView([36.08,-120.65],10)"); time.sleep(1); t0=cnt['t']
    pg.click('#pickTx'); pg.mouse.click(800,500); time.sleep(.3); pg.mouse.click(1250,300); time.sleep(.5)
    print('placed:', pg.evaluate("[S.tx.placed,S.rx.placed,!!markers.tx,!!markers.rx]"), 'terrain requests during placement:', cnt['t']-t0)
    pg.click('#bP2P'); pg.wait_for_function("RF.last && document.getElementById('statusTxt').textContent==='ready'",timeout=60000)
    print('terrain requests after Path:', cnt['t']-t0)
    pg.evaluate("setSite('rx',36.2,-120.5)"); time.sleep(.3); print('stale bar:', pg.evaluate("$('staleBar').style.display"), 'requests:', cnt['t']-t0)
    pg.screenshot(path=OUT+'/27_stale.png')
    pg.click('#staleBar >> text=Re-run path'); pg.wait_for_function("$('staleBar').style.display==='none' && document.getElementById('statusTxt').textContent==='ready'",timeout=60000); print('stale cleared after run')
    pg.evaluate("S.f=4400;S.rx.mode='msl';S.rx.h=10000;saveState()"); pg.click('#bP2P'); pg.wait_for_function("RF.last && RF.last.hrx>3000 && document.getElementById('statusTxt').textContent==='ready'",timeout=60000); time.sleep(.4)
    pg.screenshot(path=OUT+'/27_air.png',clip={'x':410,'y':660,'width':1190,'height':300})
    pg.evaluate("S.rx.mode='agl';S.rx.h=2;S.f=446;saveState()"); pg.click('#bP2P'); pg.wait_for_function("RF.last && RF.last.hrx<10 && document.getElementById('statusTxt').textContent==='ready'",timeout=60000); time.sleep(.4)
    pg.screenshot(path=OUT+'/27_ground.png',clip={'x':410,'y':660,'width':1190,'height':300})
    with pg.expect_download() as d: pg.click('#dlPdf')
    d.value.save_as(os.path.join(OUT,'report.pdf'))
    pg.click('#baseSeg button[data-b=flat]'); pg.evaluate("map.setView([36.0,-121.0],8)"); time.sleep(3); pg.screenshot(path=OUT+'/27_contrast.png')
    pg.click('#clrRes'); pg.click('#clrMenu button[data-c=all]'); time.sleep(.3); print('after clear all:', pg.evaluate("[!!RF.last,!!COV.cur,!!markers.tx]"))
    print('ERRS', errs); b.close()
