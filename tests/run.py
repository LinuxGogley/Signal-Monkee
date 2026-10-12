"""Headless regression tests with synthetic terrain/TLE fixtures (no network needed).
Usage: python3 tests/run.py [p2p,cov,base,air,gnss,sat,tp,layers]   or   python3 tests/run.py extra
Requires: pip install playwright numpy pillow && playwright install chromium
"""
import sys, time, json, re, zipfile, io, os
sys.path.insert(0, os.path.dirname(__file__))
import fixtures
from playwright.sync_api import sync_playwright
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out'); os.makedirs(OUT, exist_ok=True)
HTML = 'file://' + os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'dist', 'Signal_Monkee.html'))
errors = []
def route(r):
    u = r.request.url
    m = re.search(r'terrarium/(\d+)/(\d+)/(\d+)\.png', u)
    if m:
        z, x, y = map(int, m.groups()); return r.fulfill(status=200, body=fixtures.terrarium_png(z, x, y), headers={'Content-Type': 'image/png', 'Access-Control-Allow-Origin': '*'})
    m = re.search(r'GROUP=([\w-]+)', u)
    if 'celestrak' in u and m:
        t = fixtures.group(m.group(1))
        return r.fulfill(status=200 if t else 404, body=t, headers={'Access-Control-Allow-Origin': '*', 'Content-Type': 'text/plain'})
    if u.startswith('http') and re.search(r'\.(png|jpg)|/tile/', u):
        return r.fulfill(status=200, body=fixtures.blank_png(), headers={'Content-Type': 'image/png', 'Access-Control-Allow-Origin': '*'})
    if u.startswith('http'):
        return r.fulfill(status=404, body='nope', headers={'Access-Control-Allow-Origin': '*'})
    return r.continue_()
def main(which):
    with sync_playwright() as p:
        b = p.chromium.launch(args=['--allow-file-access-from-files'])
        pg = b.new_page(viewport={'width': 1600, 'height': 960}, accept_downloads=True)
        pg.on('console', lambda m: errors.append(m.type + ': ' + m.text) if m.type in ('error', 'warning') else None)
        pg.on('pageerror', lambda e: errors.append('PAGEERROR: ' + str(e)))
        pg.route('**/*', route)
        pg.goto(HTML)
        pg.wait_for_function("document.getElementById('statusTxt').textContent==='ready'", timeout=30000)
        time.sleep(1.5)
        pg.screenshot(path=OUT + '/01_start.png')
        def logtxt(): return pg.eval_on_selector('#log', 'e=>e.innerText')
        if 'p2p' in which:
            t = time.time(); pg.click('#bP2P')
            pg.wait_for_function("RF.last && document.getElementById('statusTxt').textContent==='ready'", timeout=60000)
            print('P2P took', round(time.time() - t, 2)); time.sleep(0.5)
            pg.screenshot(path=OUT + '/02_p2p.png')
            print(pg.eval_on_selector('#reportTxt', 'e=>e.textContent')[:5000])
            pg.hover('#profileCv', position={'x': 500, 'y': 120}); time.sleep(0.3)
            pg.screenshot(path=OUT + '/02b_hover.png')
        if 'cov' in which:
            pg.evaluate("S.cov.radius=40;S.cov.maxSteps=300;saveState()")
            t = time.time(); pg.click('#bCov')
            pg.wait_for_function("COV.cur && document.getElementById('statusTxt').textContent==='ready'", timeout=180000)
            print('COV took', round(time.time() - t, 2)); time.sleep(0.8)
            pg.screenshot(path=OUT + '/03_cov.png')
            pg.mouse.move(1000, 400); time.sleep(0.2); print('HUD:', pg.eval_on_selector('#hud', 'e=>e.textContent'))
            for mode in ['los', 'snr', 'margin']:
                pg.evaluate("S.cov.display='%s';COV.paint()" % mode); time.sleep(0.5); pg.screenshot(path=OUT + '/03_cov_%s.png' % mode)
            pg.evaluate("S.cov.display='dbm';COV.paint()")
        if 'base' in which:
            pg.click('#baseSeg button[data-b=flat]'); time.sleep(2.5); pg.screenshot(path=OUT + '/04_flat.png')
            pg.evaluate("S.flatTheme='light';buildBaseLayers();setBase('flat')"); time.sleep(2); pg.screenshot(path=OUT + '/04_flat_light.png')
            pg.evaluate("S.flatTheme='dark';buildBaseLayers();setBase('sat')"); time.sleep(1); pg.screenshot(path=OUT + '/04_sat.png')
            pg.evaluate("setBase('map')")
        if 'air' in which:
            pg.fill('#search', 'KLAX'); pg.press('#search', 'Enter'); time.sleep(1.5); pg.screenshot(path=OUT + '/05_klax.png')
            pg.click('#rail button[data-p=air]'); pg.fill('#apQ', 'SFO'); pg.click('#nearGo'); time.sleep(0.5); pg.screenshot(path=OUT + '/05_air.png')
            pg.fill('#fqQ', '124.3'); pg.click('#fqGo'); time.sleep(0.3); print('freqfinder rows', pg.eval_on_selector('#fqOut', 'e=>e.querySelectorAll("tr").length'))
        if 'gnss' in which:
            pg.evaluate("map.setView([36.08,-120.65],10)")
            pg.click('#rail button[data-p=gnss]'); time.sleep(0.3)
            pg.evaluate("S.gnss.when='2026-10-11T20:00Z';saveState()")
            pg.click('#gnFetch'); pg.wait_for_function("SAT.groups()['gps-ops']", timeout=30000); time.sleep(3)
            pg.screenshot(path=OUT + '/06_gnss.png')
            print('GNSS out:', pg.eval_on_selector('#gnssOut', 'e=>e.innerText')[:600])
            pg.click('#gnTL'); time.sleep(4); pg.screenshot(path=OUT + '/06b_gnss_tl.png')
            pg.evaluate("S.gnss.grid=16"); pg.click('#gnArea'); time.sleep(12); pg.screenshot(path=OUT + '/06c_gnss_area.png')
        if 'sat' in which:
            pg.click('#rail button[data-p=sat]'); time.sleep(0.3)
            pg.evaluate("SAT.fetchGroup('iridium-NEXT').then(()=>SAT.fetchGroup('starlink')).then(()=>{SAT.toggleGeo(2,true);SAT.toggleGeo(3,true);rerender();SAT.analyzePoint()})"); time.sleep(5)
            pg.evaluate("map.setView([20,-60],2)"); time.sleep(1)
            pg.screenshot(path=OUT + '/07_sat.png')
            print('SAT out:', pg.eval_on_selector('#satOut', 'e=>e.innerText')[:900])
            pg.select_option('#leoSel', 'iridium-NEXT'); pg.fill('#leoH', '2'); pg.click('#leoGo'); time.sleep(6)
        if 'tp' in which:
            pg.evaluate("map.setView([36.08,-120.65],10);TP.add(36.10,-120.70,'Ridge');TP.add(36.00,-120.50,'Valley');TP.add(36.20,-120.80,'North')")
            pg.evaluate("TP.computeAll()"); time.sleep(4)
            pg.screenshot(path=OUT + '/09_tp.png')
            with pg.expect_download() as d: pg.click('#tpKml')
            path = d.value.path(); z = zipfile.ZipFile(path); print('KMZ files', z.namelist()); kml = z.read('doc.kml').decode(); print('KML len', len(kml), kml.count('<Placemark>'))
            import xml.dom.minidom; xml.dom.minidom.parseString(kml); print('KML parses OK')
            with pg.expect_download() as d: pg.click('#tpCsv')
            print(open(d.value.path()).read()[:600])
        if 'layers' in which:
            pg.evaluate("""LAY.ingest('ham',{count:2,results:[{'Callsign':'W6ABC','Frequency':'146.940','Input Freq':'146.340','PL':'100.0','Lat':'36.10','Long':'-120.7','Nearest City':'Coalinga','FM Analog':'Yes','DMR':'No'},{'Callsign':'K6DMR','Frequency':'445.500','Input Freq':'440.500','Lat':'36.0','Long':'-120.6','DMR':'Yes','DMR Color Code':'1'}]},'test RB')""")
            pg.evaluate("""LAY.ingest('mesh',{'!abcd':{longName:'Ridge Router',shortName:'RR',role:'ROUTER',latitude:361000000,longitude:-1206500000,lastHeard:Date.now()/1000-600},'!ef01':{longName:'Client',role:'CLIENT',latitude:36.05,longitude:-120.55}},'test mesh')""")
            pg.evaluate("map.setView([36.05,-120.65],10);S.layers.gnssAreas=true;"); pg.click('#rail button[data-p=layers]'); time.sleep(1)
            pg.screenshot(path=OUT + '/10_layers.png')
        print('LOG:\n' + logtxt()[-2500:])
        b.close()
    print('ERRORS:', json.dumps(errors[:30], indent=1))
if __name__ == "__main__" and not (len(sys.argv) > 1 and sys.argv[1] == "extra"): main(sys.argv[1] if len(sys.argv) > 1 else 'p2p,cov,base,air,gnss,sat,tp,layers')
def extra():
    with sync_playwright() as p:
        b = p.chromium.launch(args=['--allow-file-access-from-files'])
        pg = b.new_page(viewport={'width': 1600, 'height': 960}, accept_downloads=True)
        pg.on('pageerror', lambda e: errors.append('PAGEERROR: ' + str(e)))
        pg.on('console', lambda m: errors.append(m.type + ': ' + m.text) if m.type == 'error' else None)
        pg.route('**/*', route)
        pg.goto(HTML); pg.wait_for_function("document.getElementById('statusTxt').textContent==='ready'", timeout=30000)
        # aircraft P2P
        pg.evaluate("S.rx.mode='msl';S.rx.h=3048*1.5;S.rx.lat=36.6;S.rx.lon=-120.0;S.f=127;placeMarkers();saveState()")
        pg.click('#bP2P'); pg.wait_for_function("RF.last && document.getElementById('statusTxt').textContent==='ready'", timeout=60000)
        rep = pg.eval_on_selector('#reportTxt', 'e=>e.textContent'); print('\n'.join([l for l in rep.split('\n') if 'loss' in l.lower() or 'Antenna height' in l or 'Received' in l]))
        pg.click('#unitSeg button[data-u=ft]'); time.sleep(0.5); pg.screenshot(path=OUT + '/11_air_ft.png')
        pg.click('#unitSeg button[data-u=m]')
        # jammer coverage
        pg.evaluate("S.rx.mode='agl';S.rx.h=2;S.tx.h=10;S.pwrW=1;S.txGain=0;S.cov.radius=25;S.cov.maxSteps=150;S.cov.rxH=2;S.cov.rxMode='agl';saveState()")
        pg.evaluate("S.f=1575.42;S.cov.display='js';S.bwKHz=2046;COV.run()")
        pg.wait_for_function("COV.cur && document.getElementById('statusTxt').textContent==='ready'", timeout=180000); time.sleep(0.5)
        pg.evaluate("map.setView([S.tx.lat,S.tx.lon],10)"); time.sleep(1)
        pg.screenshot(path=OUT + '/12_jam.png')
        pg.evaluate("openDrawer('info')"); time.sleep(0.5); print(pg.eval_on_selector('#infoTab', 'e=>e.innerText')[:800])
        with pg.expect_download() as d: pg.evaluate("TP.exportKMZ(true)")
        z = zipfile.ZipFile(d.value.path()); print('KMZ', z.namelist(), [len(z.read(n)) for n in z.namelist()])
        # hgt import
        pg.click('#rail button[data-p=terrain]'); time.sleep(0.3)
        with pg.expect_file_chooser() as fc: pg.click('#tHgt')
        hp = os.path.join(OUT, 'N36W121.hgt'); fixtures.write_hgt(hp); fc.value.set_files(hp); time.sleep(1.5)
        print('elev hgt vs tiles at 36.5,-120.5:', pg.evaluate("DEM.elev(36.5,-120.5)"))
        pg.screenshot(path=OUT + '/13_terrain.png')
        b.close()
    print('ERRORS:', json.dumps(errors[:30], indent=1))
if __name__ == "__main__" and len(sys.argv) > 1 and sys.argv[1] == "extra": extra()
