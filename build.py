#!/usr/bin/env python3
"""Build Signal Monkee into ONE self-contained HTML file (dist/Signal_Monkee.html).

Usage:  python3 build.py            (Python 3.8+, standard library only)

What it does:
  * inlines the vendored libraries (vendor/), the app CSS and the app JS modules (src/)
  * gzips + base64-embeds the bundled datasets (data/*.json) so the page works offline
  * builds the coverage Web Worker from itm.js + propcore.js + worker.js
The output opens directly from disk (file://) in Chrome, Edge, Firefox or Safari.
"""
import base64, gzip, json, os, sys

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC, VENDOR, DATA, DIST = (os.path.join(ROOT, d) for d in ('src', 'vendor', 'data', 'dist'))

# Order matters: later modules use globals defined by earlier ones.
APP_MODULES = [
    'itm.js',        # Longley-Rice ITM (NTIA/ITS reference port)
    'propcore.js',   # geodesy, diffraction, Hata, antenna patterns, pathLoss()
    'dem.js',        # terrain: AWS Terrain Tiles + SRTM .hgt, IndexedDB cache
    'app_core.js',   # state, utilities, map, base layers, panels framework
    'app_rf.js',     # link budget, point-to-point analysis, profile chart, text report
    'app_cov.js',    # area coverage (radial sweep via workers), rendering, legend, stats
    'app_layers.js', # airports/ATC/navaids, repeaters, DMR, Meshtastic, GNSS interference
    'app_sat.js',    # GNSS & SATCOM: SGP4, sky plots, DOP, terrain masks, GEO look angles
    'app_tp.js',     # test points, KML/KMZ + ZIP writer, CSV, project save/load
    'app_ops.js',    # pass/fail verdict, Summary card, clear results, PDF report
    'app_opmode.js', # Operator mode: one-page line-of-sight check, mode switching
    'app_los.js',    # LOS planning: terrain-only line of sight and viewshed (no radio settings)
    'app_offline.js',# offline data packages (build on an online PC, import on an offline one)
    'app_main.js',   # terrain/help panels, panel registration, boot()
]
WORKER_MODULES = ['itm.js', 'propcore.js', 'worker.js']
VENDOR_JS = ['leaflet.js', 'satellite.min.js', 'h3-js.umd.js', 'jspdf.umd.min.js']
DATASETS = ['airports', 'navaids', 'cities', 'basemap']


def read(*p):
    with open(os.path.join(*p), encoding='utf-8') as f:
        return f.read()


def b64(path, compress=False):
    raw = open(path, 'rb').read()
    return base64.b64encode(gzip.compress(raw, 9, mtime=0) if compress else raw).decode()


def put(html, marker, code):
    token = '/*' + marker + '*/'
    if token not in html:
        sys.exit('template marker missing: ' + token)
    head, tail = html.split(token, 1)
    return head + code + tail


def main():
    html = read(SRC, 'index.html')
    libs = '\n'.join(read(VENDOR, f) for f in VENDOR_JS)
    worker = '\n'.join(read(SRC, f) for f in WORKER_MODULES)
    emb = {k: b64(os.path.join(DATA, k + '.json'), compress=True) for k in DATASETS}
    data = 'window.__EMB=' + json.dumps(emb) + ';\n' + read(SRC, 'static.js')
    app = '\n'.join(read(SRC, f) for f in APP_MODULES)
    for name, code in (('LIBS', libs), ('WORKER', worker), ('APP', app), ('DATA', data)):
        if '</script' in code.lower():
            sys.exit(name + ' contains "</script" and cannot be inlined')
    html = put(html, 'LEAFLET_CSS', read(VENDOR, 'leaflet.css'))
    html = put(html, 'APP_CSS', read(SRC, 'style.css'))
    for name, code in (('LIBS', libs), ('WORKER', worker), ('DATA', data), ('APP', app)):
        html = put(html, name, code)
    html = html.replace('%%MASCOT%%', 'data:image/png;base64,' + b64(os.path.join(DATA, 'mascot.png')))
    html = html.replace('%%FAV%%', 'data:image/png;base64,' + b64(os.path.join(DATA, 'mascot64.png')))
    os.makedirs(DIST, exist_ok=True)
    out = os.path.join(DIST, 'Signal_Monkee.html')
    with open(out, 'w', encoding='utf-8') as f:
        f.write(html)
    print('wrote %s (%.2f MB)' % (out, len(html.encode()) / 1e6))


if __name__ == '__main__':
    main()
