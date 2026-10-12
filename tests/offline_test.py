"""Offline round trip: build a package online, import it into a fresh offline browser profile, compare results."""
import os, sys, time, json, zipfile
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import run
from playwright.sync_api import sync_playwright
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out'); os.makedirs(OUT, exist_ok=True); PKG = os.path.join(OUT, 'offline_pkg.zip')
READY = "document.getElementById('statusTxt').textContent==='ready'"
SETUP = "S.tx.placed=true;S.rx.placed=true;S.tx.lat=36.019;S.tx.lon=-120.944;S.tx.h=10;S.rx.lat=36.141;S.rx.lon=-120.36;S.rx.mode='agl';S.rx.h=2;S.cov.radius=25;S.cov.maxSteps=120;S.cov.rxMode='agl';S.cov.rxH=2;saveState();placeMarkers();"
def results(pg, mode):
    pg.evaluate("OPMODE.setMode('%s')" % mode); time.sleep(0.3)
    pg.click('#bP2P'); pg.wait_for_function("RF.last && " + READY, timeout=60000)
    p2p = pg.evaluate("[RF.last.Prx.toFixed(3), RF.last.minClr.toFixed(2), RF.last.z[Math.floor(RF.last.n/2)].toFixed(2)]")
    pg.click('#bCov'); pg.wait_for_function("COV.cur && " + READY, timeout=120000)
    cov = pg.evaluate("(()=>{let s=0,n=0;for(let i=0;i<COV.cur.loss.length;i+=97){if(COV.cur.loss[i]<900){s+=COV.cur.loss[i];n++;}}return [n,(s/Math.max(n,1)).toFixed(4)]})()")
    return p2p, cov
with sync_playwright() as p:
    b = p.chromium.launch()
    # ---------- online profile: build package ----------
    ctx = b.new_context(viewport={'width': 1600, 'height': 960}, accept_downloads=True); pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e))); ctx.route('**/*', run.route)
    pg.goto(run.HTML); pg.wait_for_function(READY, timeout=30000)
    pg.evaluate(SETUP + "TP.add(36.10,-120.70,'Ridge');S.offline={area:'tx',radius:40,tz:12,img:'usgsimg',iz:12,tle:true,extra:true,applySettings:true};saveState()")
    online = {m: results(pg, m) for m in ('engineer', 'operator')}
    print('online results:', online)
    pg.click('#rail button[data-p=offline]'); time.sleep(0.3)
    pg.click('#offEstB'); time.sleep(0.3); print('estimate:', pg.eval_on_selector('#offEst', 'e=>e.innerText').replace('\n', ' | '))
    pg.screenshot(path=OUT + '/33_offline_panel.png')
    with pg.expect_download(timeout=180000) as d: pg.click('#offBuild')
    d.value.save_as(PKG); pg.wait_for_function(READY, timeout=60000)
    z = zipfile.ZipFile(PKG); names = z.namelist(); m = json.loads(z.read('manifest.json'))
    print('package:', os.path.getsize(PKG) // 1024, 'KB,', len(names), 'files; terrain', m['terrain']['count'], 'imagery', {k: v['count'] for k, v in m['imagery'].items()}, 'tle', list(m['tle']), 'failed', m['failed'])
    print('log:', pg.eval_on_selector('#log', 'e=>e.innerText').split('\n')[-2:])
    ctx.close()
    # ---------- fresh, OFFLINE profile: import package ----------
    ctx2 = b.new_context(viewport={'width': 1600, 'height': 960}, accept_downloads=True); pg2 = ctx2.new_page(); errs2 = []; net = []
    pg2.on('pageerror', lambda e: errs2.append(str(e)))
    def offline_route(r):
        u = r.request.url
        if u.startswith('http'): net.append(u); return r.abort()
        return r.continue_()
    ctx2.route('**/*', offline_route)
    pg2.goto(run.HTML); pg2.wait_for_function(READY, timeout=30000)
    print('fresh profile: tx at', pg2.evaluate("[S.tx.lat,S.tx.lon]"), 'test points', pg2.evaluate("TP.list().length"))
    pg2.click('#rail button[data-p=offline]'); time.sleep(0.3)
    pg2.evaluate("S.offline.applySettings=true;saveState()")
    with pg2.expect_file_chooser() as fc: pg2.click('#offImp')
    fc.value.set_files(PKG)
    pg2.wait_for_function("document.getElementById('log').innerText.indexOf('Offline package imported')>=0", timeout=120000)
    print('import log:', pg2.eval_on_selector('#log', 'e=>e.innerText').split('\n')[-1])
    print('after import: tx at', pg2.evaluate("[S.tx.lat,S.tx.lon]"), 'test points', pg2.evaluate("TP.list().length"), 'TLE groups', pg2.evaluate("Object.keys(SAT.groups())"), 'satSrc', pg2.evaluate("S.satSrc"))
    net.clear()
    offline = {m: results(pg2, m) for m in ('engineer', 'operator')}
    print('offline results:', offline)
    print('MATCH:', online == offline, '| terrain fetch failures offline:', pg2.evaluate("DEM.stats.failed"), '| network attempts during analysis:', len([u for u in net if 'terrarium' in u]))
    pg2.click('#baseSeg button[data-b=sat]'); time.sleep(2)
    print('imagery tiles shown from offline cache:', pg2.evaluate("[...document.querySelectorAll('.leaflet-tile-loaded')].filter(i=>i.src.startsWith('blob:')).length"))
    pg2.click('#baseSeg button[data-b=flat]'); time.sleep(2.5)
    pg2.screenshot(path=OUT + '/33_offline_import.png')
    print('errs', errs, errs2)
    b.close()
