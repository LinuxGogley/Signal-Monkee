/* Terrain manager: AWS Terrain Tiles (Terrarium, SRTM/NED/GMTED-derived) + user-loaded SRTM .hgt files, with IndexedDB cache. */
var DEM = (function () {
  'use strict';
  var tiles = new Map();      // key z/x/y -> Float32Array(65536) | null (missing) | Promise
  var hgt = [];               // {lat, lon, n, data:Int16Array}
  var cfg = { url: 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png', clampSea: true, useTiles: true, maxTiles: 400 };
  var stats = { fetched: 0, cached: 0, failed: 0 };
  var listeners = [];
  // ---------- IndexedDB (tile + kv cache) ----------
  var dbp = null;
  function db() {
    if (dbp) return dbp;
    dbp = new Promise(function (res) {
      try {
        var rq = indexedDB.open('pathlink-rf', 2);
        rq.onupgradeneeded = function () { var d = rq.result; if (!d.objectStoreNames.contains('tiles')) d.createObjectStore('tiles'); if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv'); };
        rq.onsuccess = function () { res(rq.result); };
        rq.onerror = function () { res(null); };
      } catch (e) { res(null); }
    });
    return dbp;
  }
  function idbGet(store, key) { return db().then(function (d) { if (!d) return null; return new Promise(function (res) { try { var r = d.transaction(store).objectStore(store).get(key); r.onsuccess = function () { res(r.result || null); }; r.onerror = function () { res(null); }; } catch (e) { res(null); } }); }); }
  function idbPut(store, key, val) { return db().then(function (d) { if (!d) return; return new Promise(function (res) { try { var t = d.transaction(store, 'readwrite'); t.objectStore(store).put(val, key); t.oncomplete = res; t.onerror = res; } catch (e) { res(); } }); }); }
  /* bulk write [[key, value], ...] in chunks of 400 per transaction */
  function idbPutMany(store, pairs, onProg) {
    return db().then(function (d) {
      if (!d) return;
      var i = 0;
      function chunk() {
        if (i >= pairs.length) return Promise.resolve();
        var part = pairs.slice(i, i + 400); i += part.length;
        return new Promise(function (res) {
          try { var t = d.transaction(store, 'readwrite'), os = t.objectStore(store); part.forEach(function (p) { os.put(p[1], p[0]); }); t.oncomplete = res; t.onerror = res; t.onabort = res; } catch (e) { res(); }
        }).then(function () { if (onProg) onProg(i, pairs.length); return chunk(); });
      }
      return chunk();
    });
  }
  function idbCount(store) { return db().then(function (d) { if (!d) return 0; return new Promise(function (res) { try { var r = d.transaction(store).objectStore(store).count(); r.onsuccess = function () { res(r.result); }; r.onerror = function () { res(0); }; } catch (e) { res(0); } }); }); }
  function idbClear(store) { return db().then(function (d) { if (!d) return; return new Promise(function (res) { var t = d.transaction(store, 'readwrite'); t.objectStore(store).clear(); t.oncomplete = res; }); }); }

  // ---------- Mercator helpers ----------
  function lon2x(lon, z) { return (lon + 180) / 360 * 256 * Math.pow(2, z); }
  function lat2y(lat, z) { var s = Math.sin(lat * Math.PI / 180); s = Math.min(Math.max(s, -0.9999), 0.9999); return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * 256 * Math.pow(2, z); }

  function decodePNG(buf) {
    var blob = new Blob([buf], { type: 'image/png' });
    return createImageBitmap(blob).then(function (bmp) {
      var c = (typeof OffscreenCanvas !== 'undefined') ? new OffscreenCanvas(256, 256) : Object.assign(document.createElement('canvas'), { width: 256, height: 256 });
      var g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(bmp, 0, 0, 256, 256);
      var px = g.getImageData(0, 0, 256, 256).data, out = new Float32Array(65536);
      for (var i = 0, j = 0; i < 65536; i++, j += 4) out[i] = (px[j] * 256 + px[j + 1] + px[j + 2] / 256) - 32768;
      return out;
    });
  }
  function tileURL(z, x, y) { return cfg.url.replace('{z}', z).replace('{x}', x).replace('{y}', y); }
  function loadTile(z, x, y) {
    var n = Math.pow(2, z); x = ((x % n) + n) % n;
    var key = z + '/' + x + '/' + y;
    var t = tiles.get(key);
    if (t !== undefined) return t instanceof Promise ? t : Promise.resolve(t);
    var url = tileURL(z, x, y);
    var p = idbGet('tiles', url).then(function (cached) {
      if (cached) { stats.cached++; return decodePNG(cached); }
      if (!cfg.useTiles) return null;
      return fetch(url, { mode: 'cors' }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
        .then(function (buf) { stats.fetched++; idbPut('tiles', url, buf); return decodePNG(buf); });
    }).catch(function () { stats.failed++; return null; }).then(function (arr) { tiles.set(key, arr); notify(); return arr; });
    tiles.set(key, p);
    return p;
  }
  function notify() { listeners.forEach(function (f) { try { f(stats); } catch (e) { } }); }

  /* Choose terrarium zoom for a bbox so the tile count stays bounded. */
  function zoomFor(s, w, n, e, maxZ, maxTiles) {
    maxTiles = maxTiles || cfg.maxTiles;
    for (var z = maxZ || 13; z >= 3; z--) {
      var nx = Math.floor(lon2x(e, z) / 256) - Math.floor(lon2x(w, z) / 256) + 1;
      var ny = Math.floor(lat2y(s, z) / 256) - Math.floor(lat2y(n, z) / 256) + 1;
      if (nx * ny <= maxTiles) return z;
    }
    return 3;
  }
  var activeZ = 12;
  function ensure(s, w, n, e, z, onProg) {
    activeZ = z;
    if (hgtCovers(s, w, n, e) || !cfg.useTiles && !hgt.length) return Promise.resolve(0);
    var x0 = Math.floor(lon2x(w, z) / 256), x1 = Math.floor(lon2x(e, z) / 256);
    var y0 = Math.floor(lat2y(n, z) / 256), y1 = Math.floor(lat2y(s, z) / 256);
    var jobs = [], total = (x1 - x0 + 1) * (y1 - y0 + 1), done = 0;
    for (var x = x0 - 0; x <= x1; x++) for (var y = y0; y <= y1; y++) jobs.push([x, y]);
    // limited concurrency
    var idx = 0, failed = 0;
    function next() {
      if (idx >= jobs.length) return Promise.resolve();
      var j = jobs[idx++];
      return loadTile(z, j[0], j[1]).then(function (a) { if (!a) failed++; done++; if (onProg) onProg(done, total); return next(); });
    }
    var ps = []; for (var k = 0; k < 8; k++) ps.push(next());
    return Promise.all(ps).then(function () { return failed; });
  }
  function tilePix(z, gx, gy) {
    var n = Math.pow(2, z), tx = Math.floor(gx / 256), ty = Math.floor(gy / 256);
    tx = ((tx % n) + n) % n;
    var t = tiles.get(z + '/' + tx + '/' + ty);
    if (!t || t instanceof Promise) return NaN;
    var px = ((gx % 256) + 256) % 256, py = ((gy % 256) + 256) % 256;
    return t[py * 256 + px];
  }
  // ---------- SRTM .hgt ----------
  function hgtFind(lat, lon) {
    for (var i = 0; i < hgt.length; i++) { var h = hgt[i]; if (lat >= h.lat && lat <= h.lat + 1 && lon >= h.lon && lon <= h.lon + 1) return h; }
    return null;
  }
  function hgtCovers(s, w, n, e) {
    if (!hgt.length) return false;
    for (var la = Math.floor(s); la <= Math.floor(n); la++) for (var lo = Math.floor(w); lo <= Math.floor(e); lo++) if (!hgtFind(la + 0.5, lo + 0.5)) return false;
    return true;
  }
  function hgtElev(h, lat, lon) {
    var n = h.n - 1, fy = (h.lat + 1 - lat) * n, fx = (lon - h.lon) * n;
    var x0 = Math.min(Math.floor(fx), n - 1), y0 = Math.min(Math.floor(fy), n - 1), ax = fx - x0, ay = fy - y0;
    function g(x, y) { var v = h.data[y * h.n + x]; return v === -32768 ? NaN : v; }
    var a = g(x0, y0), b = g(x0 + 1, y0), c = g(x0, y0 + 1), d = g(x0 + 1, y0 + 1);
    var v = (a * (1 - ax) + b * ax) * (1 - ay) + (c * (1 - ax) + d * ax) * ay;
    if (isNaN(v)) v = [a, b, c, d].filter(function (q) { return !isNaN(q); })[0];
    return v;
  }
  function addHGT(name, buf) {
    var m = /([NS])(\d{2})([EW])(\d{3})/i.exec(name);
    if (!m) throw new Error('Filename must look like N35W119.hgt');
    var lat = parseInt(m[2], 10) * (m[1].toUpperCase() === 'S' ? -1 : 1), lon = parseInt(m[4], 10) * (m[3].toUpperCase() === 'W' ? -1 : 1);
    var nWords = buf.byteLength / 2, n = Math.round(Math.sqrt(nWords));
    if (n * n !== nWords) throw new Error('Unexpected .hgt size ' + buf.byteLength);
    var dv = new DataView(buf), data = new Int16Array(nWords);
    for (var i = 0; i < nWords; i++) data[i] = dv.getInt16(i * 2, false);
    hgt = hgt.filter(function (h) { return !(h.lat === lat && h.lon === lon); });
    hgt.push({ lat: lat, lon: lon, n: n, data: data, name: name });
    notify();
    return { lat: lat, lon: lon, res: n === 3601 ? '1″ (~30 m)' : n === 1201 ? '3″ (~90 m)' : n + ' samples' };
  }
  /* Minimal ZIP reader (stored/deflate) for .hgt.zip archives using DecompressionStream. */
  function unzip(buf) {
    var dv = new DataView(buf), out = [], p = 0;
    var jobs = [];
    while (p + 30 < buf.byteLength && dv.getUint32(p, true) === 0x04034b50) {
      var method = dv.getUint16(p + 8, true), csize = dv.getUint32(p + 18, true), nlen = dv.getUint16(p + 26, true), xlen = dv.getUint16(p + 28, true), flags = dv.getUint16(p + 6, true);
      var name = new TextDecoder().decode(new Uint8Array(buf, p + 30, nlen));
      var start = p + 30 + nlen + xlen;
      if (flags & 8 && csize === 0) throw new Error('Streamed ZIP entries not supported — unzip first');
      var data = buf.slice(start, start + csize);
      (function (name, method, data) {
        if (method === 0) jobs.push(Promise.resolve({ name: name, data: data }));
        else if (method === 8) jobs.push(new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer().then(function (b) { return { name: name, data: b }; }));
      })(name, method, data);
      p = start + csize;
    }
    return Promise.all(jobs);
  }

  /* Elevation at lat/lon (m AMSL). Uses .hgt where loaded, else Terrarium at the active zoom (falls back to coarser cached zooms). */
  function elev(lat, lon) {
    var v = NaN;
    if (hgt.length) { var h = hgtFind(lat, lon); if (h) v = hgtElev(h, lat, lon); }
    if (isNaN(v)) {
      for (var z = activeZ; z >= Math.max(activeZ - 6, 1) && isNaN(v); z--) {
        var fx = lon2x(lon, z) - 0.5, fy = lat2y(lat, z) - 0.5, x0 = Math.floor(fx), y0 = Math.floor(fy), ax = fx - x0, ay = fy - y0;
        var a = tilePix(z, x0, y0), b = tilePix(z, x0 + 1, y0), c = tilePix(z, x0, y0 + 1), d = tilePix(z, x0 + 1, y0 + 1);
        if (isNaN(a + b + c + d)) { var q = [a, b, c, d].filter(function (u) { return !isNaN(u); }); v = q.length ? q[0] : NaN; }
        else v = (a * (1 - ax) + b * ax) * (1 - ay) + (c * (1 - ax) + d * ax) * ay;
      }
    }
    if (isNaN(v)) return NaN;
    return cfg.clampSea && v < 0 ? 0 : v;
  }
  function resolution(lat) { // metres per sample of current source
    if (hgt.length) { var h = hgtFind(lat, 0) || hgt[0]; return 111320 / (h.n - 1); }
    return 156543.03 * Math.cos(lat * Math.PI / 180) / Math.pow(2, activeZ) ;
  }
  function setZoom(z) { activeZ = z; }
  function clearMem() { tiles.clear(); notify(); }
  return { cfg: cfg, stats: stats, ensure: ensure, elev: elev, zoomFor: zoomFor, addHGT: addHGT, unzip: unzip, hgtList: function () { return hgt; }, removeHGT: function (i) { hgt.splice(i, 1); notify(); },
    onChange: function (f) { listeners.push(f); }, resolution: resolution, setZoom: setZoom, getZoom: function () { return activeZ; }, clearMem: clearMem, memCount: function () { return tiles.size; },
    idbGet: idbGet, idbPut: idbPut, idbPutMany: idbPutMany, tileURL: tileURL, idbCount: idbCount, idbClear: idbClear, lon2x: lon2x, lat2y: lat2y, loadTile: loadTile, tilePix: tilePix };
})();
