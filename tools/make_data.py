#!/usr/bin/env python3
"""Re-download and compact the bundled datasets into data/*.json.

Sources (all public): OurAirports (public domain) and Natural Earth (public domain).
Usage: python3 tools/make_data.py      then  python3 build.py
"""
import csv, collections, io, json, os, urllib.request

DATA = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data')
OA = 'https://raw.githubusercontent.com/davidmegginson/ourairports-data/main/'
NE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/'


def get(url):
    print('fetch', url)
    return urllib.request.urlopen(url, timeout=120).read().decode('utf-8')


def dump(name, obj):
    with open(os.path.join(DATA, name), 'w', encoding='utf-8') as f:
        json.dump(obj, f, separators=(',', ':'), ensure_ascii=False)
    print('wrote', name)


def airports():
    freqs = collections.defaultdict(list)
    for r in csv.DictReader(io.StringIO(get(OA + 'airport-frequencies.csv'))):
        try:
            mhz = float(r['frequency_mhz'])
        except ValueError:
            continue
        freqs[r['airport_ref']].append([r['type'].strip().upper()[:8], (r['description'] or '').strip()[:40], round(mhz, 4)])
    kinds = {'large_airport': 'L', 'medium_airport': 'M', 'small_airport': 'S', 'heliport': 'H', 'seaplane_base': 'W'}
    out = []
    # row: [ident, iata, type L/M/S/W, name, lat, lon, elev_ft, country, municipality, [[type, desc, MHz], ...]]
    for r in csv.DictReader(io.StringIO(get(OA + 'airports.csv'))):
        t = r['type']
        if t not in kinds:
            continue
        fr = freqs.get(r['id'], [])
        if t in ('large_airport', 'medium_airport') or (fr and t != 'heliport'):
            try:
                lat, lon = round(float(r['latitude_deg']), 5), round(float(r['longitude_deg']), 5)
            except ValueError:
                continue
            el = int(float(r['elevation_ft'])) if r['elevation_ft'] else None
            out.append([r['ident'], r['iata_code'] or '', kinds[t], r['name'][:60], lat, lon, el, r['iso_country'], (r['municipality'] or '')[:30], fr])
    dump('airports.json', out)


def navaids():
    out = []
    # row: [ident, name, type, freq_kHz, lat, lon, elev_ft, country, dme_channel, power, associated_airport]
    for r in csv.DictReader(io.StringIO(get(OA + 'navaids.csv'))):
        try:
            lat, lon = round(float(r['latitude_deg']), 5), round(float(r['longitude_deg']), 5)
        except ValueError:
            continue
        fk = float(r['frequency_khz']) if r['frequency_khz'] else 0
        el = int(float(r['elevation_ft'])) if r['elevation_ft'] else None
        out.append([r['ident'], r['name'][:40], r['type'], fk, lat, lon, el, r['iso_country'], r['dme_channel'] or '', r['power'] or '', r['associated_airport'] or ''])
    dump('navaids.json', out)


def cities():
    d = json.loads(get(NE + 'ne_10m_populated_places_simple.geojson'))
    out = []
    # row: [name, lat, lon, pop_max, scalerank, adm0_a3, is_capital]
    for f in d['features']:
        p, c = f['properties'], f['geometry']['coordinates']
        out.append([p['name'], round(c[1], 4), round(c[0], 4), int(p.get('pop_max') or 0), int(p.get('scalerank') or 10), p.get('adm0_a3') or '', 1 if p.get('featurecla', '').startswith('Admin-0 cap') else 0])
    out.sort(key=lambda x: -x[3])
    dump('cities.json', out)


def basemap():
    def lines(fn):
        g = json.loads(get(NE + fn))
        res = []
        for f in g['features']:
            geom = f['geometry']
            cs = geom['coordinates']
            parts = cs if geom['type'] in ('MultiLineString', 'Polygon') else ([cs] if geom['type'] == 'LineString' else [r for poly in cs for r in poly])
            for part in parts:  # flat [lon, lat, lon, lat, ...]
                flat = []
                for x, y in part:
                    flat += [round(x, 3), round(y, 3)]
                res.append(flat)
        return res
    dump('basemap.json', {'coast': lines('ne_50m_coastline.geojson'), 'states': lines('ne_50m_admin_1_states_provinces_lines.geojson'),
                          'borders': lines('ne_50m_admin_0_boundary_lines_land.geojson'), 'lakes': lines('ne_50m_lakes.geojson')})


if __name__ == '__main__':
    os.makedirs(DATA, exist_ok=True)
    airports(); navaids(); cities(); basemap()
