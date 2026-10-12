/* ===================== Offline data packages =====================
   Build a .zip on an internet-connected computer and import it on an offline (e.g. secure) laptop.
   Package layout (store-only ZIP):
     manifest.json                      what is inside + area + tile URL templates
     terrain/{z}/{x}/{y}.png            AWS Terrain Tiles (Terrarium) for the area, zoom 3..maxZ
     imagery/{id}/{z}/{x}/{y}.{jpg|png} public-domain USGS National Map tiles (optional)
     tle/{group}.txt                    satellite orbital elements (GNSS + SATCOM)
     layers.json, testpoints.json, project.json   imported layers, test points, settings (optional)
   On import every tile is written to IndexedDB under the same URL key the app uses online, so the
   terrain engine, the Contrast basemap and the USGS layers simply find them in the cache. */
var OFFLINE = (function () {
  // Only public-domain imagery is packaged. Esri / CARTO / OSM tiles stay online-only (their terms restrict bulk offline caching).
  var IMG = {
    usgsimg: { name: 'USGS Imagery', url: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}', max: 16, attr: 'Imagery: USGS The National Map (public domain)' },
    usgstopo: { name: 'USGS Topo', url: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}', max: 16, attr: 'Map: USGS The National Map (public domain)' }
  };
  var LIMIT_TILES = 60000;           // hard cap per package (all layers)
  var EST_KB = { terrain: 75, imagery: 25 };
  var areaLayer = null;

  function fill(tpl, z, x, y) { return tpl.replace('{z}', z).replace('{x}', x).replace('{y}', y); }
  function bboxNow() {
    var o = S.offline;
    if (o.area === 'tx') { // radius around the Tx and the Rx (so the whole path and the coverage circle are inside)
      var R = Math.max(+o.radius || 50, 1) * 1000, bb = { s: 90, n: -90, w: 180, e: -180 };
      [S.tx, S.rx].forEach(function (p) {
        if (!p.placed) return;
        bb.s = Math.min(bb.s, PC.dest(p.lat, p.lon, 180, R)[0]); bb.n = Math.max(bb.n, PC.dest(p.lat, p.lon, 0, R)[0]);
        bb.w = Math.min(bb.w, PC.dest(p.lat, p.lon, 270, R)[1]); bb.e = Math.max(bb.e, PC.dest(p.lat, p.lon, 90, R)[1]);
      });
      if (bb.s <= bb.n) return bb;
    }
    var b = map.getBounds();
    return { s: Math.max(b.getSouth(), -85), n: Math.min(b.getNorth(), 85), w: Math.max(b.getWest(), -180), e: Math.min(b.getEast(), 180) };
  }
  function tileRange(bb, z) {
    var n = Math.pow(2, z);
    return { z: z, x0: clamp(Math.floor(DEM.lon2x(bb.w, z) / 256), 0, n - 1), x1: clamp(Math.floor(DEM.lon2x(bb.e, z) / 256), 0, n - 1), y0: clamp(Math.floor(DEM.lat2y(bb.n, z) / 256), 0, n - 1), y1: clamp(Math.floor(DEM.lat2y(bb.s, z) / 256), 0, n - 1) };
  }
  function listTiles(bb, z0, z1) {
    var out = [];
    for (var z = z0; z <= z1; z++) { var r = tileRange(bb, z); for (var x = r.x0; x <= r.x1; x++) for (var y = r.y0; y <= r.y1; y++) out.push([z, x, y]); }
    return out;
  }
  function plan() {
    var o = S.offline, bb = bboxNow();
    var terr = listTiles(bb, 3, +o.tz), imgs = [];
    (o.img === 'both' ? ['usgsimg', 'usgstopo'] : o.img === 'none' ? [] : [o.img]).forEach(function (id) { imgs.push({ id: id, tiles: listTiles(bb, 3, Math.min(+o.iz, IMG[id].max)) }); });
    var nImg = imgs.reduce(function (s, i) { return s + i.tiles.length; }, 0);
    return { bb: bb, terr: terr, imgs: imgs, total: terr.length + nImg, mb: (terr.length * EST_KB.terrain + nImg * EST_KB.imagery) / 1024 };
  }
  function estimate() {
    var p = plan(), ok = p.total <= LIMIT_TILES;
    var w = PC.dist((p.bb.s + p.bb.n) / 2, p.bb.w, (p.bb.s + p.bb.n) / 2, p.bb.e) / 1000, h = PC.dist(p.bb.s, p.bb.w, p.bb.n, p.bb.w) / 1000;
    var t = '<div class="kv"><span>Area</span><b>' + fx(w, 0) + ' × ' + fx(h, 0) + ' km</b><span>Terrain tiles</span><b>' + p.terr.length + ' (zoom 3–' + S.offline.tz + ')</b>' +
      p.imgs.map(function (i) { return '<span>' + IMG[i.id].name + ' tiles</span><b>' + i.tiles.length + '</b>'; }).join('') +
      '<span>Estimated size</span><b>~' + fx(p.mb, p.mb < 10 ? 1 : 0) + ' MB</b></div>' + (ok ? '' : '<div class="tag bad" style="margin-top:4px">Too many tiles (' + p.total + ' > ' + LIMIT_TILES + ') — shrink the area or lower the detail.</div>');
    var e = $('offEst'); if (e) e.innerHTML = t;
    drawArea(p.bb, '#ffd166');
    return p;
  }
  function drawArea(bb, col, label) {
    if (areaLayer) map.removeLayer(areaLayer);
    areaLayer = L.rectangle([[bb.s, bb.w], [bb.n, bb.e]], { color: col || '#ffd166', weight: 2, dashArray: '6 4', fill: false, interactive: false }).addTo(map);
    if (label) areaLayer.bindTooltip(label, { permanent: false });
  }
  function clearArea() { if (areaLayer) { map.removeLayer(areaLayer); areaLayer = null; } }

  /* fetch bytes with limited concurrency; returns [{path, data}] and failure count */
  function grab(jobs, onProg) {
    var out = [], failed = 0, i = 0, done = 0;
    function next() {
      if (i >= jobs.length) return Promise.resolve();
      var j = jobs[i++];
      return j.get().then(function (r) { if (r && r.data) out.push({ name: j.path.replace('{ext}', r.ext || 'bin'), data: r.data }); else failed++; })
        .catch(function () { failed++; }).then(function () { done++; if (onProg && (done % 10 === 0 || done === jobs.length)) onProg(done, jobs.length); return next(); });
    }
    var ps = []; for (var k = 0; k < 8; k++) ps.push(next());
    return Promise.all(ps).then(function () { return { files: out, failed: failed }; });
  }
  function getTerrain(z, x, y) {
    var url = DEM.tileURL(z, x, y);
    return DEM.idbGet('tiles', url).then(function (buf) {
      if (buf) return { data: new Uint8Array(buf), ext: 'png' };
      return fetch(url, { mode: 'cors' }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
        .then(function (b) { DEM.idbPut('tiles', url, b); return { data: new Uint8Array(b), ext: 'png' }; });
    });
  }
  function getImagery(id, z, x, y) {
    var url = fill(IMG[id].url, z, x, y);
    return DEM.idbGet('tiles', url).then(function (buf) {
      if (buf) return { data: new Uint8Array(buf), ext: sniff(buf) };
      return fetch(url, { mode: 'cors' }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
        .then(function (b) { if (b.byteLength < 100) throw new Error('empty tile'); return { data: new Uint8Array(b), ext: sniff(b) }; });
    });
  }
  function sniff(buf) { var u = new Uint8Array(buf, 0, 4); return u[0] === 0x89 && u[1] === 0x50 ? 'png' : 'jpg'; }

  function build() {
    var o = S.offline, p = estimate();
    if (!p.total) return;
    if (p.total > LIMIT_TILES) { log('Offline package is too large — shrink the area or lower the detail.', 'e'); return; }
    status('building offline package…');
    var jobs = p.terr.map(function (t) { return { path: 'terrain/' + t[0] + '/' + t[1] + '/' + t[2] + '.{ext}', get: function () { return getTerrain(t[0], t[1], t[2]); } }; });
    p.imgs.forEach(function (im) { im.tiles.forEach(function (t) { jobs.push({ path: 'imagery/' + im.id + '/' + t[0] + '/' + t[1] + '/' + t[2] + '.{ext}', get: function () { return getImagery(im.id, t[0], t[1], t[2]); } }); }); });
    var manifest = { app: 'Signal Monkee', kind: 'offline-package', version: VERSION, created: new Date().toISOString(), bbox: p.bb,
      terrain: { template: DEM.cfg.url, zmin: 3, zmax: +o.tz, count: 0 }, imagery: {}, tle: {}, extras: !!o.extra };
    var tlePromise = !o.tle ? Promise.resolve([]) : refreshTLE().then(function () {
      var gs = SAT.groups(), files = [];
      Object.keys(gs).forEach(function (id) { var g = gs[id]; if (g.text) { files.push({ name: 'tle/' + id + '.txt', data: new TextEncoder().encode(g.text) }); manifest.tle[id] = { ts: g.ts, count: g.sats.length, src: g.src }; } });
      return files;
    });
    prog(true, 'Collecting satellite orbits…', 0);
    return tlePromise.then(function (tleFiles) {
      return grab(jobs, function (d, t) { prog(true, 'Packaging tiles ' + d + '/' + t, d / t); }).then(function (r) {
        r.files.forEach(function (f) { if (f.name.indexOf('terrain/') === 0) manifest.terrain.count++; else { var id = f.name.split('/')[1]; manifest.imagery[id] = manifest.imagery[id] || { template: IMG[id].url, name: IMG[id].name, attr: IMG[id].attr, zmax: Math.min(+o.iz, IMG[id].max), count: 0 }; manifest.imagery[id].count++; } });
        var files = r.files.concat(tleFiles), enc = new TextEncoder();
        if (o.extra) {
          files.push({ name: 'layers.json', data: enc.encode(JSON.stringify(LAY.ext())) });
          files.push({ name: 'testpoints.json', data: enc.encode(JSON.stringify(TP.list().map(function (q) { var c = Object.assign({}, q); delete c.A; return c; }))) });
          files.push({ name: 'project.json', data: enc.encode(JSON.stringify(S)) });
        }
        manifest.failed = r.failed;
        files.unshift({ name: 'manifest.json', data: enc.encode(JSON.stringify(manifest, null, 1)) });
        var blob = ZIP.make(files), name = 'signalmonkee_offline_' + new Date().toISOString().slice(0, 10) + '.zip';
        download(name, blob, 'application/zip');
        prog(false); status('ready');
        var imgTxt = Object.keys(manifest.imagery).map(function (k) { return manifest.imagery[k].count + ' ' + manifest.imagery[k].name; }).join(', ');
        log('Offline package saved: ' + name + ' (' + fx(blob.size / 1048576, 1) + ' MB) — ' + manifest.terrain.count + ' terrain tiles' + (imgTxt ? ', ' + imgTxt + ' tiles' : '') + ', ' + Object.keys(manifest.tle).length + ' orbit groups.', 'g');
        if (r.failed) log(r.failed + ' tile(s) could not be downloaded (offline, blocked, or outside the provider’s coverage — USGS imagery covers the U.S. only).', 'w');
      });
    }).catch(function (e) { prog(false); status('error'); log('Offline package failed: ' + e.message, 'e'); console.error(e); });
  }
  /* refresh every TLE group when online; keep cached copies when not */
  function refreshTLE() {
    var ids = STATIC.constellations.gnss.concat(STATIC.constellations.satcom).map(function (c) { return c[1]; });
    if (!navigator.onLine) return Promise.resolve();
    return Promise.all(ids.map(function (id) { return SAT.fetchGroup(id, true); }));
  }

  function importPkg() {
    pickFiles('.zip').then(function (fs) {
      if (!fs.length) return;
      status('importing…'); prog(true, 'Reading ' + fs[0].name + '…', 0.05);
      readBuf(fs[0]).then(DEM.unzip).then(function (ents) {
        var mf = ents.find(function (e) { return e.name === 'manifest.json'; });
        if (!mf) throw new Error('not a Signal Monkee offline package (manifest.json missing)');
        var m = JSON.parse(new TextDecoder().decode(mf.data)), dec = new TextDecoder(), puts = [], nT = 0, nI = 0, tle = 0;
        ents.forEach(function (e) {
          var p = e.name.split('/');
          if (p[0] === 'terrain' && p.length === 4) { puts.push([DEM.tileURL(+p[1], +p[2], parseInt(p[3], 10)), e.data]); nT++; }
          else if (p[0] === 'imagery' && p.length === 5 && IMG[p[1]]) { puts.push([fill(IMG[p[1]].url, +p[2], +p[3], parseInt(p[4], 10)), e.data]); nI++; }
        });
        prog(true, 'Storing ' + puts.length + ' tiles…', 0.3);
        return DEM.idbPutMany('tiles', puts, function (d, t) { prog(true, 'Storing tiles ' + d + '/' + t, 0.3 + 0.6 * d / t); }).then(function () {
          var jobs = [];
          ents.forEach(function (e) {
            var p = e.name.split('/');
            if (p[0] === 'tle' && p.length === 2) { var id = p[1].replace(/\.txt$/, ''), meta = (m.tle || {})[id] || {}; jobs.push(DEM.idbPut('kv', 'tle:' + id, { ts: meta.ts || Date.now(), text: dec.decode(e.data), src: 'offline package' })); tle++; }
          });
          var get = function (n) { var e = ents.find(function (x) { return x.name === n; }); return e ? JSON.parse(dec.decode(e.data)) : null; };
          var lay = get('layers.json'), tps = get('testpoints.json'), prj = get('project.json');
          if (lay) LAY.mergeExt(lay);
          if (tps && tps.length) { var have = {}; TP.list().forEach(function (q) { have[q.id] = 1; }); TP.set(TP.list().concat(tps.filter(function (q) { return !have[q.id]; }))); }
          if (prj && S.offline.applySettings) { var keepMode = S.mode; deepMerge(S, prj); S.mode = keepMode; saveState(); placeMarkers(); }
          return Promise.all(jobs).then(SAT.loadCached).then(function () {
            DEM.clearMem();
            var rec = { name: fs[0].name, created: m.created, imported: new Date().toISOString(), bbox: m.bbox, terrain: nT, imagery: nI, tle: tle, zmax: (m.terrain || {}).zmax };
            return DEM.idbGet('kv', 'offline:packages').then(function (list) { list = (list || []).filter(function (x) { return x.name !== rec.name; }); list.push(rec); return DEM.idbPut('kv', 'offline:packages', list); }).then(function () {
              prog(false); status('ready');
              if (m.bbox) { drawArea(m.bbox, '#2fe07a', 'Offline data area'); map.fitBounds([[m.bbox.s, m.bbox.w], [m.bbox.n, m.bbox.e]]); }
              if (nI && m.imagery && m.imagery.usgsimg) { S.satSrc = 'usgsimg'; saveState(); buildBaseLayers(); setBase(S.base); }
              if (nI && m.imagery && m.imagery.usgstopo && !m.imagery.usgsimg) { S.mapStyle = 'usgstopo'; saveState(); buildBaseLayers(); setBase(S.base); }
              log('Offline package imported: ' + nT + ' terrain tiles' + (nI ? ', ' + nI + ' imagery tiles' : '') + (tle ? ', ' + tle + ' orbit groups' : '') + (lay ? ', layers' : '') + (tps && tps.length ? ', ' + tps.length + ' test points' : '') + (prj && S.offline.applySettings ? ', settings' : '') + '.', 'g');
              if (curPanel === 'offline') rerender();
              if (curPanel === 'layers') rerender();
            });
          });
        });
      }).catch(function (e) { prog(false); status('error'); log('Import failed: ' + e.message, 'e'); console.error(e); });
    });
  }

  function render() {
    var zs = [[10, 'Standard — zoom 10 (~150 m)'], [11, 'Fine — zoom 11 (~75 m)'], [12, 'Detailed — zoom 12 (~38 m, same as path analysis)'], [13, 'Very detailed — zoom 13 (~19 m, where available)']];
    var iz = [[10, 'zoom 10 (~150 m/pixel)'], [11, 'zoom 11 (~75 m)'], [12, 'zoom 12 (~38 m)'], [13, 'zoom 13 (~19 m)'], [14, 'zoom 14 (~10 m)'], [15, 'zoom 15 (~5 m)']];
    var h = '<h3>Offline data</h3><div class="note">Use this to work on a computer without internet (for example a secure laptop): build a package here while online, copy it across together with the Signal Monkee HTML file, and import it there. Works in Operator and Engineer modes.</div>';
    h += '<h4>1 · Build a package (online)</h4>' +
      F('Area', 'offline.area', { sel: [['view', 'Current map view'], ['tx', 'Around the Tx and Rx sites']] }) +
      (S.offline.area === 'tx' ? F('Radius around each site', 'offline.radius', { unit: 'km', title: 'Use at least your coverage radius' }) : '') +
      F('Terrain detail', 'offline.tz', { sel: zs, num: 1 }) +
      F('Map imagery', 'offline.img', { sel: [['none', 'None (use the Contrast map offline)'], ['usgsimg', 'USGS satellite imagery (U.S., public domain)'], ['usgstopo', 'USGS topo map (U.S., public domain)'], ['both', 'Both USGS layers']] }) +
      (S.offline.img !== 'none' ? F('Imagery detail', 'offline.iz', { sel: iz, num: 1 }) : '') +
      CK('Satellite orbits (GNSS & SATCOM) — refreshed now if online', 'offline.tle') +
      CK('Imported layers, test points and current settings', 'offline.extra') +
      '<div id="offEst" class="card mini">Press Estimate to see the tile count and size.</div>' +
      '<div class="row"><button class="btn sm" data-ico="check" id="offEstB">Estimate</button><button class="btn pri sm" data-ico="download" id="offBuild">Build offline package</button></div>' +
      '<div class="note">Terrain tiles: AWS Terrain Tiles (SRTM/NED/GMTED). Esri, CARTO and OpenStreetMap map tiles are not packaged (their terms don’t allow bulk offline copies); offline, use the <b>Contrast</b> basemap (built from the terrain) or packaged USGS layers. Orbit data ages: GNSS stays usable for weeks, LEO (Starlink, Iridium) for a few days.</div>';
    h += '<h4>2 · Import a package (offline laptop)</h4>' + CK('Also load the sites and settings saved in the package', 'offline.applySettings') +
      '<div class="row"><button class="btn pri sm" data-ico="open" id="offImp">Import offline package (.zip)</button></div><div id="offList"></div>' +
      '<div class="row"><button class="btn sm" onclick="OFFLINE.clearArea()">Hide area outline</button></div>';
    return h;
  }
  function after() {
    $('offEstB').onclick = estimate; $('offBuild').onclick = build; $('offImp').onclick = importPkg;
    DEM.idbGet('kv', 'offline:packages').then(function (list) {
      var e = $('offList'); if (!e || !list || !list.length) return;
      e.innerHTML = '<table class="t"><tr><th>Package</th><th>Built</th><th>Tiles</th><th></th></tr>' + list.map(function (r, i) { return '<tr><td>' + esc(r.name) + '</td><td>' + esc((r.created || '').slice(0, 10)) + '</td><td class="n">' + r.terrain + (r.imagery ? ' + ' + r.imagery : '') + '</td><td><a class="lnk" onclick="OFFLINE.showPkg(' + i + ')">show</a></td></tr>'; }).join('') + '</table>';
    });
  }
  function showPkg(i) { DEM.idbGet('kv', 'offline:packages').then(function (list) { var r = list && list[i]; if (r && r.bbox) { drawArea(r.bbox, '#2fe07a', r.name); map.fitBounds([[r.bbox.s, r.bbox.w], [r.bbox.n, r.bbox.e]]); } }); }
  watch('offline.', function (k) { if (/area|img/.test(k) && curPanel === 'offline') rerender(); });

  /* tile layer that serves tiles from the offline cache first, then the network */
  var CachedTiles = L.TileLayer.extend({
    createTile: function (coords, done) {
      var img = document.createElement('img'), url = this.getTileUrl(coords);
      img.alt = ''; img.setAttribute('role', 'presentation');
      DEM.idbGet('tiles', url).then(function (buf) {
        img.onload = function () { if (img._u) URL.revokeObjectURL(img._u); done(null, img); };
        img.onerror = function (e) { done(e, img); };
        if (buf) { img._u = URL.createObjectURL(new Blob([buf])); img.src = img._u; } else img.src = url;
      });
      return img;
    }
  });
  function layer(id, extra) { var d = IMG[id]; return new CachedTiles(d.url, Object.assign({ attribution: d.attr, maxZoom: 20, maxNativeZoom: d.max }, extra || {})); }

  return { render: render, after: after, estimate: estimate, build: build, importPkg: importPkg, showPkg: showPkg, clearArea: clearArea, layer: layer, IMG: IMG, plan: plan };
})();
