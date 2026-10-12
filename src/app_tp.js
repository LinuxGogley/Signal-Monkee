/* ===================== Test points, KML/KMZ export, project save/load ===================== */
var ZIP = (function () {
  var T = null;
  function crc(u) { if (!T) { T = new Uint32Array(256); for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; T[n] = c >>> 0; } } var x = 0xFFFFFFFF; for (var i = 0; i < u.length; i++) x = T[(x ^ u[i]) & 0xFF] ^ (x >>> 8); return (x ^ 0xFFFFFFFF) >>> 0; }
  /* store-only ZIP writer: files [{name, data:Uint8Array}] -> Blob */
  function make(files) {
    var parts = [], cen = [], off = 0, enc = new TextEncoder();
    files.forEach(function (f) {
      var nm = enc.encode(f.name), c = crc(f.data), h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(8, 0, true); h.setUint32(14, c, true); h.setUint32(18, f.data.length, true); h.setUint32(22, f.data.length, true); h.setUint16(26, nm.length, true);
      parts.push(new Uint8Array(h.buffer), nm, f.data);
      var cd = new DataView(new ArrayBuffer(46));
      cd.setUint32(0, 0x02014b50, true); cd.setUint16(4, 20, true); cd.setUint16(6, 20, true); cd.setUint32(16, c, true); cd.setUint32(20, f.data.length, true); cd.setUint32(24, f.data.length, true); cd.setUint16(28, nm.length, true); cd.setUint32(42, off, true);
      cen.push(new Uint8Array(cd.buffer), nm);
      off += 30 + nm.length + f.data.length;
    });
    var csize = cen.reduce(function (s, p) { return s + p.length; }, 0), e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, csize, true); e.setUint32(16, off, true);
    return new Blob(parts.concat(cen, [new Uint8Array(e.buffer)]), { type: 'application/zip' });
  }
  return { make: make, crc: crc };
})();

var KML = (function () {
  function x(s) { return String(s == null ? '' : s).replace(/[<>&'"]/g, function (c) { return { '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]; }); }
  function kcol(rgb, a) { function h(v) { return ('0' + Math.round(v).toString(16)).slice(-2); } return h(a == null ? 255 : a) + h(rgb[2]) + h(rgb[1]) + h(rgb[0]); }
  function styles(extra) {
    var s = '<Style id="tx"><IconStyle><color>ff20a0f0</color><scale>1.2</scale><Icon><href>http://maps.google.com/mapfiles/kml/shapes/target.png</href></Icon></IconStyle></Style>' +
      '<Style id="rx"><IconStyle><color>fff0c753</color><scale>1.1</scale><Icon><href>http://maps.google.com/mapfiles/kml/shapes/target.png</href></Icon></IconStyle></Style>' +
      '<Style id="path"><LineStyle><color>ff20a0f0</color><width>3</width></LineStyle></Style><Style id="pathbad"><LineStyle><color>ff5f5aff</color><width>3</width></LineStyle></Style>';
    return s + (extra || '');
  }
  function pointStyle(id, rgb) { return '<Style id="' + id + '"><IconStyle><color>' + kcol(rgb) + '</color><scale>0.9</scale><Icon><href>http://maps.google.com/mapfiles/kml/paddle/wht-blank.png</href></Icon></IconStyle><LabelStyle><scale>0.8</scale></LabelStyle></Style>'; }
  function placemark(name, lat, lon, hAGL, style, desc, ext) {
    var ed = ext ? '<ExtendedData>' + Object.keys(ext).map(function (k) { return '<Data name="' + x(k) + '"><value>' + x(ext[k]) + '</value></Data>'; }).join('') + '</ExtendedData>' : '';
    return '<Placemark><name>' + x(name) + '</name>' + (desc ? '<description>' + x(desc) + '</description>' : '') + '<styleUrl>#' + style + '</styleUrl>' + ed +
      '<Point><extrude>1</extrude><altitudeMode>relativeToGround</altitudeMode><coordinates>' + lon.toFixed(7) + ',' + lat.toFixed(7) + ',' + (+hAGL || 0).toFixed(1) + '</coordinates></Point></Placemark>';
  }
  function line(name, coords, style) { return '<Placemark><name>' + x(name) + '</name><styleUrl>#' + style + '</styleUrl><LineString><tessellate>0</tessellate><altitudeMode>absolute</altitudeMode><coordinates>' + coords.map(function (c) { return c[1].toFixed(7) + ',' + c[0].toFixed(7) + ',' + (c[2] || 0).toFixed(1); }).join(' ') + '</coordinates></LineString></Placemark>'; }
  function groundOverlay(name, href, n, s, e, w, op) { return '<GroundOverlay><name>' + x(name) + '</name><color>' + ('0' + Math.round((op == null ? 0.7 : op) * 255).toString(16)).slice(-2) + 'ffffff</color><Icon><href>' + href + '</href></Icon><LatLonBox><north>' + n + '</north><south>' + s + '</south><east>' + e + '</east><west>' + w + '</west></LatLonBox></GroundOverlay>'; }
  function screenOverlay(name, href) { return '<ScreenOverlay><name>' + x(name) + '</name><Icon><href>' + href + '</href></Icon><overlayXY x="1" y="1" xunits="fraction" yunits="fraction"/><screenXY x="0.99" y="0.97" xunits="fraction" yunits="fraction"/><size x="0" y="0" xunits="pixels" yunits="pixels"/></ScreenOverlay>'; }
  function folder(name, items) { return '<Folder><name>' + x(name) + '</name>' + items.join('') + '</Folder>'; }
  function doc(name, items, st) { return '<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>' + x(name) + '</name>' + (st || '') + items.join('\n') + '</Document></kml>'; }
  function parsePoints(text) {
    var d = new DOMParser().parseFromString(text, 'application/xml'), out = [];
    d.querySelectorAll('Placemark').forEach(function (p) {
      var c = p.querySelector('Point coordinates'); if (!c) return;
      var v = c.textContent.trim().split(/[\s,]+/).map(Number);
      out.push({ name: (p.querySelector('name') || {}).textContent || 'pt', lon: v[0], lat: v[1], alt: v[2] || 0 });
    });
    return out;
  }
  return { styles: styles, pointStyle: pointStyle, placemark: placemark, line: line, groundOverlay: groundOverlay, screenOverlay: screenOverlay, folder: folder, doc: doc, parsePoints: parsePoints, kcol: kcol };
})();

var TP = (function () {
  var pts = [];
  try { pts = JSON.parse(localStorage.getItem('pathlink.tp') || '[]'); } catch (e) { }
  var layer = null;
  function save() { try { localStorage.setItem('pathlink.tp', JSON.stringify(pts.map(function (p) { var q = Object.assign({}, p); delete q.A; return q; }))); } catch (e) { } }
  function add(lat, lon, name, h) {
    pts.push({ id: Date.now() + Math.random(), name: name || 'TP' + (pts.length + 1), lat: +lat, lon: +lon, h: h != null ? h : S.rx.h, mode: S.rx.mode, meas: '' });
    save(); draw(); log('Test point added: ' + pts[pts.length - 1].name);
    if ($('drawer').classList.contains('open')) renderTable();
  }
  function draw() {
    if (!layer) layer = L.layerGroup().addTo(map);
    layer.clearLayers();
    pts.forEach(function (p, i) {
      var col = p.A ? COV.colorFor(p.A.Prx, 'dbm') : null;
      var m = L.marker([p.lat, p.lon], { draggable: true, icon: L.divIcon({ className: '', iconSize: [22, 22], iconAnchor: [11, 11], html: '<div class="mk tp" style="width:22px;height:22px;' + (col ? 'background:rgb(' + col.slice(0, 3) + ')' : '') + '">' + (i + 1) + '</div>' }) });
      m.bindTooltip(esc(p.name) + (p.A ? '<br>' + fx(p.A.Prx, 1) + ' dBm' : ''));
      m.on('dragend', function (e) { var ll = e.target.getLatLng(); p.lat = +ll.lat.toFixed(6); p.lon = +ll.lng.toFixed(6); p.A = null; save(); renderTable(); });
      layer.addLayer(m);
    });
  }
  function computeAll() {
    if (!pts.length) { log('No test points. Use “＋ Test pt” or import CSV/KML.', 'w'); return Promise.resolve(); }
    return RF.ensureFor([S.tx].concat(pts), 0.02).then(function () {
      var i = 0;
      return new Promise(function (res) {
        (function step() {
          if (i >= pts.length) { res(); return; }
          var p = pts[i];
          prog(true, 'Analysing test point ' + (i + 1) + '/' + pts.length, i / pts.length);
          try { p.A = summarize(RF.analyze(S.tx, { lat: p.lat, lon: p.lon, h: p.h, mode: p.mode, name: p.name })); } catch (e) { p.A = null; log('TP ' + p.name + ': ' + e.message, 'e'); }
          i++; setTimeout(step, 0);
        })();
      });
    }).then(function () { prog(false); save(); draw(); renderTable(); openDrawer('tp'); log('Computed ' + pts.length + ' test points.', 'g'); });
  }
  function summarize(A) { return { D: A.D, az: A.az, z: A.z[A.n], los: A.minClr >= 0, f1: A.minRatio, L: A.Lsel, Prx: A.Prx, E: A.E, snr: A.snr, margin: A.margin, mode: A.Litm.itm ? ITM.MODES[A.Litm.itm.mode] : '' }; }
  function renderTable() {
    var el = $('tpTable'); if (!el) return;
    if (!pts.length) { el.innerHTML = '<div class="note" style="padding:12px">No test points yet. Click “＋ Test pt” on the map, right-click → Add test point, or import a CSV (name,lat,lon[,height]) / KML.</div>' + tpButtons(); bindButtons(); return; }
    var h = tpButtons() + '<table class="t"><tr><th>#</th><th>Name</th><th>Lat</th><th>Lon</th><th>Ground</th><th>Rx h</th><th>Dist km</th><th>Az°</th><th>LOS</th><th>F1 %</th><th>Loss dB</th><th>Pred dBm</th><th>Margin</th><th>Meas dBm</th><th>Δ</th><th></th></tr>';
    pts.forEach(function (p, i) {
      var A = p.A, d = A && p.meas !== '' && isFinite(+p.meas) ? +p.meas - A.Prx : NaN;
      h += '<tr><td>' + (i + 1) + '</td><td><input value="' + esc(p.name) + '" data-i="' + i + '" data-f="name" style="width:90px"></td><td class="n">' + fx(p.lat, 5) + '</td><td class="n">' + fx(p.lon, 5) + '</td><td class="n">' + (A ? hShort(A.z) : '') + '</td><td><input value="' + fx(hU(p.h), 1) + '" data-i="' + i + '" data-f="h" style="width:52px"> ' + (p.mode === 'msl' ? 'MSL' : 'AGL') + '</td>' +
        (A ? '<td class="n">' + fx(A.D / 1000, 2) + '</td><td class="n">' + fx(A.az, 1) + '</td><td>' + (A.los ? '<span class="tag ok">LOS</span>' : '<span class="tag bad">NLOS</span>') + '</td><td class="n">' + fx(A.f1 * 100, 0) + '</td><td class="n">' + fx(A.L, 1) + '</td><td class="n"><b>' + fx(A.Prx, 1) + '</b></td><td class="n">' + sgn(A.margin, 1) + '</td>' : '<td colspan="7" class="mini">not computed</td>') +
        '<td><input value="' + esc(p.meas) + '" data-i="' + i + '" data-f="meas" style="width:60px" placeholder="—"></td><td class="n">' + (isFinite(d) ? sgn(d, 1) : '') + '</td><td><a class="lnk" onclick="TP.zoom(' + i + ')">⌖</a> <a class="lnk" onclick="TP.asRx(' + i + ')">Rx</a> <a class="lnk" onclick="TP.del(' + i + ')">✕</a></td></tr>';
    });
    var ds = pts.filter(function (p) { return p.A && p.meas !== '' && isFinite(+p.meas); }).map(function (p) { return +p.meas - p.A.Prx; });
    if (ds.length) { var mean = ds.reduce(function (a, b) { return a + b; }, 0) / ds.length, sd = Math.sqrt(ds.reduce(function (a, b) { return a + (b - mean) * (b - mean); }, 0) / ds.length); h += '<tr><td colspan="14" style="text-align:right">Measured − predicted (n=' + ds.length + '): mean ' + sgn(mean, 1) + ' dB, σ ' + fx(sd, 1) + ' dB</td><td colspan="2"></td></tr>'; }
    el.innerHTML = h + '</table>';
    el.querySelectorAll('input[data-i]').forEach(function (inp) { inp.onchange = function () { var p = pts[+inp.dataset.i], f = inp.dataset.f; if (f === 'h') { p.h = (+inp.value) * (S.units.h === 'ft' ? 0.3048 : 1); p.A = null; } else p[f] = inp.value; save(); renderTable(); draw(); }; });
    bindButtons();
  }
  function tpButtons() { return '<div class="row" style="padding:6px 10px"><button class="btn pri sm" id="tpRun">Compute all</button><button class="btn sm" id="tpImp">Import CSV/KML</button><button class="btn sm" id="tpKml">⬇ Google Earth KMZ</button><button class="btn sm" id="tpKmlP">⬇ KML (points)</button><button class="btn sm" id="tpCsv">⬇ CSV</button><button class="btn sm" id="tpClr">Clear all</button><span class="mini">Rx gain/losses and model from the RF panel apply; heights use each point’s value.</span></div>'; }
  function bindButtons() {
    var b = function (id, f) { var e = $(id); if (e) e.onclick = f; };
    b('tpRun', computeAll); b('tpImp', importPts); b('tpKml', function () { exportKMZ(true); }); b('tpKmlP', function () { exportKMZ(false); }); b('tpCsv', exportCSV);
    b('tpClr', function () { if (confirm('Remove all test points?')) { pts = []; save(); draw(); renderTable(); } });
  }
  function importPts() {
    pickFiles('.csv,.kml,.txt').then(function (fs) {
      if (!fs.length) return;
      readText(fs[0]).then(function (t) {
        var n = 0;
        if (/<kml/i.test(t)) KML.parsePoints(t).forEach(function (p) { pts.push({ id: Math.random(), name: p.name, lat: p.lat, lon: p.lon, h: p.alt > 0 ? p.alt : S.rx.h, mode: S.rx.mode, meas: '' }); n++; });
        else csvToObjects(t).forEach(function (o) {
          var lat = parseFloat(o.lat || o.latitude || o.Lat || o.LAT), lon = parseFloat(o.lon || o.lng || o.longitude || o.Lon || o.LON);
          if (!isFinite(lat) || !isFinite(lon)) return;
          var h = parseFloat(o.h || o.height || o.agl || o.alt); pts.push({ id: Math.random(), name: o.name || o.Name || o.id || 'TP' + (pts.length + 1), lat: lat, lon: lon, h: isFinite(h) ? h : S.rx.h, mode: S.rx.mode, meas: o.rssi || o.meas || o.measured || '' }); n++;
        });
        save(); draw(); renderTable(); log('Imported ' + n + ' test points from ' + fs[0].name, n ? 'g' : 'w');
        if (n) map.fitBounds(L.latLngBounds(pts.map(function (p) { return [p.lat, p.lon]; })).pad(0.2));
      });
    });
  }
  function exportCSV() {
    var rows = [['name', 'lat', 'lon', 'rx_height_m', 'height_ref', 'ground_m', 'dist_km', 'az_deg', 'los', 'f1_clearance_pct', 'path_loss_db', 'pred_rx_dbm', 'field_dbuv_m', 'snr_db', 'margin_db', 'measured_dbm', 'delta_db', 'freq_mhz', 'model']];
    pts.forEach(function (p) { var A = p.A || {}; rows.push([p.name, p.lat, p.lon, fx(p.h, 1), p.mode, fx(A.z, 1), fx(A.D / 1000, 3), fx(A.az, 2), A.los == null ? '' : A.los ? 'Y' : 'N', fx(A.f1 * 100, 1), fx(A.L, 2), fx(A.Prx, 2), fx(A.E, 2), fx(A.snr, 2), fx(A.margin, 2), p.meas, p.meas !== '' && A.Prx != null ? fx(+p.meas - A.Prx, 2) : '', S.f, RF.modelName(S.model)]); });
    download('signalmonkee_testpoints.csv', toCSV(rows), 'text/csv');
  }
  function exportKMZ(full) {
    var st = '', items = [], tpItems = [];
    pts.forEach(function (p, i) {
      var A = p.A, col = A ? (COV.colorFor(A.Prx, 'dbm') || [128, 128, 128]) : [179, 136, 255];
      st += KML.pointStyle('tp' + i, col);
      var desc = A ? 'Pred ' + fx(A.Prx, 1) + ' dBm | loss ' + fx(A.L, 1) + ' dB | ' + (A.los ? 'LOS' : 'NLOS') + ' | margin ' + sgn(A.margin, 1) + ' dB' + (p.meas !== '' ? ' | measured ' + p.meas + ' dBm' : '') : 'not computed';
      var hh = p.mode === 'msl' ? Math.max(p.h - (A ? A.z : 0), 0) : p.h;
      tpItems.push(KML.placemark((i + 1) + ' ' + p.name, p.lat, p.lon, hh, 'tp' + i, desc, A ? { pred_dbm: fx(A.Prx, 2), path_loss_db: fx(A.L, 2), dist_km: fx(A.D / 1000, 3), los: A.los ? 'yes' : 'no', measured_dbm: p.meas, freq_mhz: S.f } : null));
    });
    var tx = S.tx, z0 = DEM.elev(tx.lat, tx.lon) || 0;
    items.push(KML.placemark(tx.name + ' (Tx)', tx.lat, tx.lon, tx.h, 'tx', fx(S.f, 4) + ' MHz, EIRP ' + fx(RF.eirp(), 1) + ' dBm'));
    if (full) {
      var A = RF.last;
      items.push(KML.placemark(S.rx.name + ' (Rx)', S.rx.lat, S.rx.lon, S.rx.mode === 'msl' ? Math.max(S.rx.h - (DEM.elev(S.rx.lat, S.rx.lon) || 0), 0) : S.rx.h, 'rx', A ? 'Pred ' + fx(A.Prx, 1) + ' dBm, ' + fx(A.D / 1000, 2) + ' km' : ''));
      if (A) items.push(KML.line('Path ' + fx(A.D / 1000, 2) + ' km (' + (A.minClr >= 0 ? 'LOS' : 'obstructed') + ')', [[A.tx.lat, A.tx.lon, A.H1], [A.rx.lat, A.rx.lon, A.H2]], A.minClr >= 0 ? 'path' : 'pathbad'));
    }
    items.push(KML.folder('Test points', tpItems));
    var files = [];
    var go = function () {
      var kml = KML.doc('Signal Monkee — ' + tx.name + ' ' + fx(S.f, 3) + ' MHz', items, KML.styles(st));
      if (!full) { download('signalmonkee_testpoints.kml', kml, 'application/vnd.google-earth.kml+xml'); return; }
      files.unshift({ name: 'doc.kml', data: new TextEncoder().encode(kml) });
      download('signalmonkee_project.kmz', ZIP.make(files), 'application/vnd.google-earth.kmz'); log('KMZ exported — open in Google Earth.', 'g');
    };
    var c = COV.cur;
    if (full && c) {
      var cv = COV.renderCanvas(c, 'eqr');
      Promise.all([COV.canvasBytes(cv), COV.canvasBytes(COV.legendCanvas())]).then(function (bs) {
        files.push({ name: 'coverage.png', data: bs[0] }, { name: 'legend.png', data: bs[1] });
        items.push(KML.groundOverlay('Coverage ' + fx(c.f, 3) + ' MHz', 'coverage.png', c.bounds[1][0], c.bounds[0][0], c.bounds[1][1], c.bounds[0][1], S.cov.opacity), KML.screenOverlay('Legend', 'legend.png'));
        go();
      });
    } else go();
  }
  function clearResults() { pts.forEach(function (p) { p.A = null; }); save(); draw(); renderTable(); }
  function zoom(i) { var p = pts[i]; map.setView([p.lat, p.lon], 14); }
  function asRx(i) { var p = pts[i]; S.rx.h = p.h; S.rx.mode = p.mode; setSite('rx', p.lat, p.lon, p.name); RF.runP2P(); }
  function del(i) { pts.splice(i, 1); save(); draw(); renderTable(); }
  function render() {
    return '<h3>Test points & export</h3><div class="note">Test points are evaluated with the full path engine (profile, ITM, Fresnel, link budget). Enter measured RSSI to compare against prediction.</div>' +
      '<div class="row"><button class="btn sm" onclick="setPick(\'tp\')">＋ Add on map</button><button class="btn pri sm" onclick="TP.computeAll()">Compute all</button><button class="btn sm" onclick="openDrawer(\'tp\')">Open table</button></div>' +
      '<h4>Export</h4><div class="row"><button class="btn sm" onclick="TP.exportKMZ(true)">⬇ Google Earth KMZ (Tx, Rx, path, test points, coverage)</button></div>' +
      '<div class="row"><button class="btn sm" onclick="TP.exportKMZ(false)">⬇ KML (test points)</button><button class="btn sm" onclick="TP.exportCSV()">⬇ CSV</button><button class="btn sm" onclick="COV.exportKMZ()">⬇ Coverage KMZ</button></div>' +
      '<div class="row"><button class="btn sm" onclick="if(RF.last)download(\'signalmonkee_report.txt\',RF.report(RF.last))">⬇ Path report (.txt)</button><button class="btn sm" onclick="PROJ.save()">💾 Project JSON</button><button class="btn sm" onclick="PROJ.load()">📂 Load project</button></div>' +
      '<div class="card mini">Points: ' + pts.length + '. KMZ placemarks are coloured by predicted level using the coverage palette, extruded to the receive height, with ExtendedData (pred_dbm, path_loss_db, los, measured_dbm…).</div>';
  }
  return { clearResults: clearResults, add: add, draw: draw, computeAll: computeAll, renderTable: renderTable, exportKMZ: exportKMZ, exportCSV: exportCSV, zoom: zoom, asRx: asRx, del: del, render: render, list: function () { return pts; }, set: function (a) { pts = a || []; save(); draw(); } };
})();

var PROJ = {
  save: function () { download('signalmonkee_project_' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify({ app: 'Signal Monkee', version: VERSION, state: S, testPoints: TP.list().map(function (p) { var q = Object.assign({}, p); delete q.A; return q; }) }, null, 1), 'application/json'); },
  load: function () {
    pickFiles('.json').then(function (fs) {
      if (!fs.length) return;
      readText(fs[0]).then(function (t) {
        var j = JSON.parse(t); if (!j.state) throw new Error('not a Signal Monkee project');
        deepMerge(S, j.state); saveState(); if (j.testPoints) TP.set(j.testPoints);
        placeMarkers(); rerender(); log('Project loaded: ' + fs[0].name, 'g');
      }).catch(function (e) { log('Load failed: ' + e.message, 'e'); });
    });
  }
};
