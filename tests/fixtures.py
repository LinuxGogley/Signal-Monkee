import numpy as np, io, math
from PIL import Image
def elev(lat, lon):
    e = 150 + 950*np.exp(-(((lat-36.08)/0.07)**2 + ((lon+120.65)/0.06)**2))
    e += 400*np.exp(-(((lat-36.25)/0.15)**2 + ((lon+121.0)/0.25)**2))
    e += 60*np.sin(lat*90)*np.cos(lon*70)
    e = np.where(lon < -121.25, -50.0, e)  # ocean to the west
    return e
def terrarium_png(z, x, y):
    n = 2**z
    px = (np.arange(256)+0.5)/256
    lon = (x + px)/n*360-180
    yy = (y + px)/n
    lat = np.degrees(np.arctan(np.sinh(np.pi*(1-2*yy))))
    LON, LAT = np.meshgrid(lon, lat)
    v = elev(LAT, LON) + 32768
    R = np.floor(v/256); G = np.floor(v % 256); B = np.floor((v - np.floor(v))*256)
    img = np.stack([R, G, B], -1).astype(np.uint8)
    b = io.BytesIO(); Image.fromarray(img, 'RGB').save(b, 'PNG'); return b.getvalue()
def blank_png():
    b = io.BytesIO(); Image.new('RGBA', (256, 256), (40, 60, 50, 255)).save(b, 'PNG'); return b.getvalue()
def cks(l):
    s = 0
    for c in l:
        if c.isdigit(): s += int(c)
        elif c == '-': s += 1
    return str(s % 10)
def tle(name, num, inc, raan, ecc, argp, M, mm, epoch='26284.50000000'):
    l1 = '1 %05dU 26001A   %s  .00000000  00000-0  00000-0 0  999' % (num, epoch)
    l2 = '2 %05d %8.4f %8.4f %07d %8.4f %8.4f %11.8f%5d' % (num, inc, raan, int(ecc*1e7), argp, M, mm, 100)
    assert len(l1) == 68 and len(l2) == 68, (len(l1), len(l2))
    return '%s\n%s\n%s\n' % (name, l1 + cks(l1), l2 + cks(l2))
def group(gid):
    out = ''; num = {'gps-ops': 1000, 'galileo': 2000, 'glo-ops': 3000, 'beidou': 4000, 'iridium-NEXT': 5000, 'starlink': 6000, 'oneweb': 7000, 'globalstar': 8000, 'orbcomm': 9000, 'sbas': 9500}[gid]
    if gid == 'gps-ops':
        for p in range(6):
            for k in range(5): out += tle('GPS BIIF-%d (PRN %02d)' % (p*5+k, p*5+k+1), num+p*5+k, 55.0, p*60, 0.005, 30, (k*72 + p*17) % 360, 2.00563)
    elif gid == 'galileo':
        for p in range(3):
            for k in range(8): out += tle('GSAT0%d (GALILEO-E%02d)' % (p*8+k, p*8+k+1), num+p*8+k, 56.0, p*120, 0.0003, 0, (k*45 + p*15) % 360, 1.70475)
    elif gid == 'glo-ops':
        for p in range(3):
            for k in range(8): out += tle('COSMOS 27%02d (R%02d)' % (p*8+k, p*8+k+1), num+p*8+k, 64.8, p*120+10, 0.001, 0, (k*45 + p*15) % 360, 2.13104)
    elif gid == 'iridium-NEXT':
        for p in range(6):
            for k in range(11): out += tle('IRIDIUM %d' % (100+p*11+k), num+p*11+k, 86.4, p*31.6, 0.0002, 90, (k*32.73 + (p % 2)*16) % 360, 14.3422)
    elif gid == 'starlink':
        for p in range(24):
            for k in range(12): out += tle('STARLINK-%d' % (1000+p*12+k), num+p*12+k, 53.0, p*15, 0.0001, 90, (k*30 + p*3) % 360, 15.06)
    else:
        return ''
    return out

def write_hgt(path):
    """Synthetic 3-arc-second SRTM tile N36W121 (+500 m offset so it is distinguishable from tiles)."""
    n = 1201
    lat = 36 + 1 - np.arange(n) / (n - 1); lon = -121 + np.arange(n) / (n - 1)
    LON, LAT = np.meshgrid(lon, lat)
    (elev(LAT, LON) + 500).astype('>i2').tofile(path)
