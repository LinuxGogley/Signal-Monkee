/* ===================== GNSS & SATCOM: TLE propagation (SGP4), sky plots, DOP, terrain masking, GEO look angles ===================== */
var SAT = (function () {
  var groups = {};      // id -> {ts, sats:[{name,l1,l2,rec}], src}
  var pt = null;        // analysis point {lat, lon, h}
  var hz = null;        // horizon profile for pt: {az step, el[]}
  var lastVis = null, liveLayer = null, liveTimer = null, geoLayer = null, areaLayer = null;
  var GEO_R = 42164.0;  // km

  function parseTLE(text) {
    var lines = text.split(/\r?\n/).map(function (l) { return l.replace(/\s+$/, ''); }).filter(Boolean), out = [];
    for (var i = 0; i < lines.length; i++) {
      if (lines[i][0] === '1' && lines[i + 1] && lines[i + 1][0] === '2') { out.push({ name: 'SAT ' + lines[i].slice(2, 7).trim(), l1: lines[i], l2: lines[i + 1] }); i++; }
      else if (lines[i + 1] && lines[i + 1][0] === '1' && lines[i + 2] && lines[i + 2][0] === '2') { out.push({ name: lines[i].replace(/^0 /, '').trim(), l1: lines[i + 1], l2: lines[i + 2] }); i += 2; }
    }
    out.forEach(function (s) { try { s.rec = satellite.twoline2satrec(s.l1, s.l2); } catch (e) { s.rec = null; } });
    return out.filter(function (s) { return s.rec && !s.rec.error; });
  }
  function grpInfo(id) { var g = groups[id]; return g ? g.sats.length + ' sats, ' + ageStr(g.ts) : 'not loaded'; }
  function ageStr(ts) { var h = (Date.now() - ts) / 3600e3; return h < 1 ? Math.round(h * 60) + ' min old' : h < 48 ? fx(h, 1) + ' h old' : fx(h / 24, 1) + ' d old'; }
  function loadCached() {
    var ids = STATIC.constellations.gnss.concat(STATIC.constellations.satcom).map(function (c) { return c[1]; });
    return Promise.all(ids.map(function (id) { return DEM.idbGet('kv', 'tle:' + id).then(function (v) { if (v) { groups[id] = { ts: v.ts, sats: parseTLE(v.text), src: v.src, text: v.text }; } }); }));
  }
  function fetchGroup(id, quiet) {
    var url = 'https://celestrak.org/NORAD/elements/gp.php?GROUP=' + encodeURIComponent(id) + '&FORMAT=tle';
    status('TLE ' + id + '…');
    return fetchJSONorText(url, null, true).then(function (t) {
      var sats = parseTLE(t); if (!sats.length) throw new Error('no TLEs in response');
      groups[id] = { ts: Date.now(), sats: sats, src: 'CelesTrak', text: t }; DEM.idbPut('kv', 'tle:' + id, { ts: Date.now(), text: t, src: 'CelesTrak' });
      status('ready'); if (!quiet) log('TLE ' + id + ': ' + sats.length + ' satellites (CelesTrak)', 'g'); return sats.length;
    }).catch(function (e) { status('ready'); if (!quiet) log('TLE ' + id + ' fetch failed: ' + e.message, 'e'); return 0; });
  }
  function importTLE(id) {
    return pickFiles('.txt,.tle,.3le').then(function (fs) {
      if (!fs.length) return;
      return readText(fs[0]).then(function (t) { var sats = parseTLE(t); groups[id] = { ts: fs[0].lastModified || Date.now(), sats: sats, src: fs[0].name, text: t }; DEM.idbPut('kv', 'tle:' + id, { ts: groups[id].ts, text: t, src: fs[0].name }); log('Imported ' + sats.length + ' TLEs into ' + id, 'g'); rerender(); });
    });
  }

  /* ---- geometry ---- */
  function obsGd(p) { return { latitude: p.lat * D2R, longitude: p.lon * D2R, height: ((DEM.elev(p.lat, p.lon) || 0) + (p.h || 2)) / 1000 }; }
  function satECF(s, date, gmst) {
    var pv = satellite.propagate(s.rec, date);
    if (!pv || !pv.position || typeof pv.position === 'boolean') return null;
    return satellite.eciToEcf(pv.position, gmst);
  }
  function lookAll(ids, date, p, gd) {
    var gmst = satellite.gstime(date), out = [];
    gd = gd || obsGd(p);
    ids.forEach(function (id) {
      var g = groups[id]; if (!g) return;
      var meta = STATIC.constellations.gnss.concat(STATIC.constellations.satcom).find(function (c) { return c[1] === id; });
      g.sats.forEach(function (s) {
        var ecf = satECF(s, date, gmst); if (!ecf) return;
        var la = satellite.ecfToLookAngles(gd, ecf);
        out.push({ name: s.name, grp: id, cons: meta ? meta[0] : id, color: meta ? meta[2] : '#fff', az: la.azimuth * R2D, el: la.elevation * R2D, range: la.rangeSat });
      });
    });
    return out;
  }
  function geoLook(p, lonE, gd) {
    gd = gd || obsGd(p);
    var la = satellite.ecfToLookAngles(gd, { x: GEO_R * Math.cos(lonE * D2R), y: GEO_R * Math.sin(lonE * D2R), z: 0 });
    return { az: la.azimuth * R2D, el: la.elevation * R2D, range: la.rangeSat };
  }
  /* terrain horizon: elevation angle of the skyline (deg) at nAz azimuths, out to radius km */
  function horizonAt(lat, lon, hAGL, radiusKm, nAz) {
    nAz = nAz || 72;
    var z0 = DEM.elev(lat, lon); if (!isFinite(z0)) z0 = 0;
    var h0 = z0 + (hAGL || 2), ae = 4 / 3 * 6371e3, el = new Float32Array(nAz), R = radiusKm * 1000;
    for (var a = 0; a < nAz; a++) {
      var brg = a * 360 / nAz, mx = -90, d = 30;
      while (d <= R) {
        var q = PC.dest(lat, lon, brg, d), z = DEM.elev(q[0], q[1]);
        if (isFinite(z)) { var ang = (Math.atan2(z - h0, d) - d / (2 * ae)) * R2D; if (ang > mx) mx = ang; }
        d = d < 300 ? d + 30 : d * 1.06;
      }
      el[a] = mx;
    }
    return el;
  }
  function hzAt(h, az) { if (!h) return -90; var n = h.length, f = ((az % 360) + 360) % 360 / 360 * n, i = Math.floor(f) % n, j = (i + 1) % n, t = f - Math.floor(f); return h[i] * (1 - t) + h[j] * t; }
  function visible(list, mask, h) { return list.filter(function (s) { return s.el >= mask && s.el >= hzAt(h, s.az); }); }

  /* ---- DOP with one receiver clock per constellation ---- */
  function dop(vis) {
    var cons = []; vis.forEach(function (s) { if (cons.indexOf(s.cons) < 0 && s.cons !== 'SBAS') cons.push(s.cons); });
    var use = vis.filter(function (s) { return s.cons !== 'SBAS'; }), m = 3 + cons.length;
    if (use.length < m) return null;
    var N = []; for (var i = 0; i < m; i++) { N.push(new Float64Array(m)); }
    use.forEach(function (s) {
      var e = s.el * D2R, a = s.az * D2R, row = new Float64Array(m);
      row[0] = -Math.cos(e) * Math.sin(a); row[1] = -Math.cos(e) * Math.cos(a); row[2] = -Math.sin(e); row[3 + cons.indexOf(s.cons)] = 1;
      for (var r = 0; r < m; r++) for (var c = 0; c < m; c++) N[r][c] += row[r] * row[c];
    });
    var Q = inv(N); if (!Q) return null;
    var tr = 0; for (i = 0; i < m; i++) tr += Q[i][i];
    var t = 0; for (i = 3; i < m; i++) t += Q[i][i];
    return { G: Math.sqrt(tr), P: Math.sqrt(Q[0][0] + Q[1][1] + Q[2][2]), H: Math.sqrt(Q[0][0] + Q[1][1]), V: Math.sqrt(Q[2][2]), T: Math.sqrt(t / (m - 3)), n: use.length };
  }
  function inv(A) {
    var n = A.length, M = A.map(function (r, i) { var o = new Float64Array(2 * n); o.set(r); o[n + i] = 1; return o; });
    for (var c = 0; c < n; c++) {
      var p = c; for (var r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      if (Math.abs(M[p][c]) < 1e-12) return null;
      var t = M[c]; M[c] = M[p]; M[p] = t;
      var d = M[c][c]; for (var k = 0; k < 2 * n; k++) M[c][k] /= d;
      for (r = 0; r < n; r++) if (r !== c) { var f = M[r][c]; if (f) for (k = 0; k < 2 * n; k++) M[r][k] -= f * M[c][k]; }
    }
    return M.map(function (r) { return Array.prototype.slice.call(r, n); });
  }

  /* ---- sky plot ---- */
  function skyplot(cv, sats, h, mask, geo) {
    var W = cv.clientWidth || 300, dpr = window.devicePixelRatio || 1; cv.width = W * dpr; cv.height = W * dpr;
    var g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    var c = W / 2, R = W / 2 - 18;
    function P(az, el) { var r = R * (90 - Math.max(el, 0)) / 90, a = az * D2R; return [c + r * Math.sin(a), c - r * Math.cos(a)]; }
    g.fillStyle = '#101315'; g.fillRect(0, 0, W, W);
    g.strokeStyle = '#2f363d'; g.lineWidth = 1; g.fillStyle = '#7d8790'; g.font = '10px system-ui';
    [0, 30, 60].forEach(function (e) { g.beginPath(); g.arc(c, c, R * (90 - e) / 90, 0, 7); g.stroke(); g.fillText(e + '°', c + 3, c - R * (90 - e) / 90 + 11); });
    for (var a = 0; a < 360; a += 30) { var p = P(a, 0); g.beginPath(); g.moveTo(c, c); g.lineTo(p[0], p[1]); g.stroke(); }
    g.fillStyle = '#cfd6dc'; g.font = 'bold 11px system-ui'; [['N', 0], ['E', 90], ['S', 180], ['W', 270]].forEach(function (k) { var p = P(k[1], -8); g.fillText(k[0], p[0] - 4, p[1] + 4); });
    // terrain mask
    if (h) {
      g.fillStyle = 'rgba(139,94,52,.55)'; g.beginPath();
      for (var i = 0; i <= h.length; i++) { var az = i * 360 / h.length, pp = P(az, Math.max(h[i % h.length], 0)); i ? g.lineTo(pp[0], pp[1]) : g.moveTo(pp[0], pp[1]); }
      for (i = h.length; i >= 0; i--) { var q = P(i * 360 / h.length, 0); g.lineTo(q[0], q[1]); }
      g.fill();
    }
    if (mask > 0) { g.strokeStyle = '#e5484d'; g.setLineDash([3, 3]); g.beginPath(); g.arc(c, c, R * (90 - mask) / 90, 0, 7); g.stroke(); g.setLineDash([]); }
    (sats || []).forEach(function (s) {
      if (s.el < 0) return; var p = P(s.az, s.el), blk = s.el < mask || s.el < hzAt(h, s.az);
      g.fillStyle = blk ? '#555' : s.color; g.strokeStyle = '#000';
      g.beginPath(); g.arc(p[0], p[1], s.geo ? 6 : 4.5, 0, 7); g.fill(); g.stroke();
      if (s.label) { g.fillStyle = blk ? '#777' : '#e4e8ec'; g.font = '9px system-ui'; g.fillText(s.label, p[0] + 6, p[1] - 4); }
    });
  }
  function shortName(s) { var m = /PRN\s*(\d+)|\((?:PRN\s*)?([A-Z]?\d+)\)|(\d+)\s*$/.exec(s.name); return (s.cons || '')[0] + (m ? (m[1] || m[2] || m[3]) : ''); }

  /* ---- analysis at point ---- */
  function when() { var w = S.gnss.when; var d = w ? new Date(w) : new Date(); return isNaN(d) ? new Date() : d; }
  function setPoint(lat, lon) {
    pt = { lat: lat, lon: lon, h: S.rx.mode === 'agl' ? S.rx.h : 2 }; hz = null;
    if (!markers.gn) markers.gn = L.marker([lat, lon], { icon: mkIcon('gn', ico('sat'), 24), draggable: true }).addTo(map).on('dragend', function (e) { var ll = e.target.getLatLng(); setPoint(ll.lat, ll.lng); });
    markers.gn.setLatLng([lat, lon]);
    if (curPanel !== 'gnss' && curPanel !== 'sat') showPanel('gnss'); else rerender();
    analyzePoint();
  }
  function ensurePt() { if (!pt) { pt = { lat: S.rx.lat, lon: S.rx.lon, h: S.rx.mode === 'agl' ? S.rx.h : 2 }; } return pt; }
  function prepHorizon() {
    var p = ensurePt();
    if (!S.gnss.terrain) { hz = null; return Promise.resolve(); }
    var r = +S.gnss.horizonKm || 15, dLat = r / 111, dLon = r / (111 * Math.cos(p.lat * D2R));
    return RF.ensureFor([{ lat: p.lat - dLat, lon: p.lon - dLon }, { lat: p.lat + dLat, lon: p.lon + dLon }], 0, 12).then(function () { hz = horizonAt(p.lat, p.lon, p.h, r, 72); });
  }
  function analyzePoint() {
    ensurePt();
    return prepHorizon().then(function () {
      var date = when(), mask = +S.gnss.mask, gnssIds = STATIC.constellations.gnss.map(function (c) { return c[1]; }).filter(function (id) { return groups[id]; });
      var all = lookAll(gnssIds, date, pt).filter(function (s) { return s.el > -5; });
      all.forEach(function (s) { s.label = shortName(s); });
      var vis = visible(all, mask, hz);
      lastVis = { date: date, all: all, vis: vis, dopAll: dop(vis), dopGPS: dop(vis.filter(function (s) { return s.cons === 'GPS'; })) };
      drawGnss();
      drawSatcom();
    });
  }
  function drawGnss() {
    var cv = $('gnssSky'); if (!cv || !lastVis) return;
    skyplot(cv, lastVis.all, hz, +S.gnss.mask);
    var by = {}; lastVis.all.forEach(function (s) { by[s.cons] = by[s.cons] || [0, 0]; if (s.el >= 0) by[s.cons][0]++; }); lastVis.vis.forEach(function (s) { by[s.cons][1]++; });
    var d = lastVis.dopAll, dg = lastVis.dopGPS;
    var h = '<table class="t"><tr><th>Constellation</th><th>Above horizon</th><th>Usable (mask+terrain)</th></tr>' + Object.keys(by).map(function (k) { return '<tr><td>' + k + '</td><td class="n">' + by[k][0] + '</td><td class="n">' + by[k][1] + '</td></tr>'; }).join('') + '</table>';
    h += '<div class="kv" style="margin-top:6px"><span>Multi-GNSS PDOP / HDOP / VDOP</span><b>' + (d ? fx(d.P, 2) + ' / ' + fx(d.H, 2) + ' / ' + fx(d.V, 2) : 'insufficient sats') + '</b><span>Multi-GNSS GDOP / TDOP</span><b>' + (d ? fx(d.G, 2) + ' / ' + fx(d.T, 2) : '—') + '</b><span>GPS-only PDOP (n)</span><b>' + (dg ? fx(dg.P, 2) + ' (' + dg.n + ')' : '<span class="tag bad">no GPS fix</span>') + '</b><span>Epoch</span><b>' + lastVis.date.toISOString().slice(0, 16).replace('T', ' ') + 'Z</b>' +
      (hz ? '<span>Max terrain mask</span><b>' + fx(Math.max.apply(null, hz), 1) + '°</b>' : '') + '</div>';
    if (!lastVis.all.length) h = '<div class="note">Load GNSS TLEs first (Fetch all GNSS).</div>';
    $('gnssOut').innerHTML = h;
  }
  function drawSatcom() {
    var cv = $('satSky'); if (!cv) return;
    ensurePt(); var gd = obsGd(pt), mask = +S.gnss.mask, list = [], rows = '';
    STATIC.geo.forEach(function (g) {
      var la = geoLook(pt, g[1], gd), blocked = la.el < hzAt(hz, la.az), ok = la.el >= mask && !blocked;
      list.push({ az: la.az, el: la.el, color: ok ? '#ffd166' : '#e5484d', label: g[0].replace(/Inmarsat |\(.*\)/g, '').trim(), geo: true });
      rows += '<tr><td>' + esc(g[0]) + '</td><td class="n">' + fx(g[1], 1) + '°</td><td class="n">' + fx(la.az, 1) + '</td><td class="n">' + fx(la.el, 1) + '</td><td>' + (la.el < 0 ? '<span class="tag bad">below horizon</span>' : blocked ? '<span class="tag bad">terrain</span>' : la.el < mask ? '<span class="tag w">low</span>' : '<span class="tag ok">clear</span>') + '</td></tr>';
    });
    var date = when(), leo = STATIC.constellations.satcom.filter(function (c) { return groups[c[1]] && (S.satShow || {})[c[1]] !== false; });
    var leoRows = '';
    leo.forEach(function (c) {
      var vs = lookAll([c[1]], date, pt, gd).filter(function (s) { return s.el > 0; });
      var us = vs.filter(function (s) { return s.el >= c[3] && s.el >= hzAt(hz, s.az); });
      if (vs.length <= 60) vs.forEach(function (s) { s.label = ''; list.push(s); });
      var best = us.reduce(function (m, s) { return s.el > m ? s.el : m; }, -90);
      leoRows += '<tr><td>' + c[0] + '</td><td class="n">' + vs.length + '</td><td class="n">' + us.length + '</td><td class="n">' + (us.length ? fx(best, 0) + '°' : '—') + '</td><td class="mini">min el ' + c[3] + '°</td></tr>';
    });
    skyplot(cv, list, hz, mask);
    $('satOut').innerHTML = '<table class="t"><tr><th>GEO satellite</th><th>Slot</th><th>Az°</th><th>El°</th><th>Status</th></tr>' + rows + '</table>' +
      (leoRows ? '<table class="t" style="margin-top:8px"><tr><th>LEO system</th><th>Above hzn</th><th>Usable</th><th>Best el</th><th></th></tr>' + leoRows + '</table>' : '<div class="note">Load LEO TLEs to evaluate Iridium/Starlink/OneWeb visibility.</div>');
  }

  /* ---- 24 h timeline at point ---- */
  function timeline() {
    ensurePt();
    var gnssIds = STATIC.constellations.gnss.map(function (c) { return c[1]; }).filter(function (id) { return groups[id] && id !== 'sbas'; });
    if (!gnssIds.length) { log('Load GNSS TLEs first.', 'w'); return; }
    return prepHorizon().then(function () {
      var t0 = when().getTime(), steps = 144, cnt = [], pd = [], gd = obsGd(pt), mask = +S.gnss.mask;
      for (var i = 0; i <= steps; i++) {
        var all = lookAll(gnssIds, new Date(t0 + i * 600e3), pt, gd), vis = visible(all, mask, hz), d = dop(vis);
        cnt.push(vis.length); pd.push(d ? d.P : NaN);
      }
      var cv = $('gnssChart'); chart(cv, [cnt, pd.map(function (v) { return Math.min(v, 10); })], ['#4cc9f0', '#ffd166'], ['usable sats', 'PDOP (cap 10)'], t0, 600e3);
      var bad = pd.filter(function (v) { return !isFinite(v) || v > 6; }).length;
      log('GNSS 24 h at point: sats ' + Math.min.apply(null, cnt) + '–' + Math.max.apply(null, cnt) + ', PDOP>6 or no fix for ' + fx(bad / pd.length * 100, 1) + '% of epochs', bad ? 'w' : 'g');
    });
  }
  function chart(cv, series, colors, names, t0, dt) {
    var W = cv.clientWidth, H = cv.clientHeight, dpr = window.devicePixelRatio || 1; cv.width = W * dpr; cv.height = H * dpr;
    var g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.fillStyle = '#101315'; g.fillRect(0, 0, W, H);
    var mxs = series.map(function (s) { var m = 0; s.forEach(function (v) { if (isFinite(v) && v > m) m = v; }); return Math.ceil(m * 1.1) || 1; }), mx = mxs[0];
    var n = series[0].length, ml = 24, mb = 16;
    g.strokeStyle = '#2f363d'; g.fillStyle = '#7d8790'; g.font = '9px system-ui';
    for (var y = 0; y <= 4; y++) { var yy = 4 + (H - mb - 4) * y / 4; g.beginPath(); g.moveTo(ml, yy); g.lineTo(W - 22, yy); g.stroke(); g.fillStyle = colors[0]; g.fillText(fx(mx * (1 - y / 4), 0), 2, yy + 3); if (series[1]) { g.fillStyle = colors[1]; g.fillText(fx(mxs[1] * (1 - y / 4), 1), W - 20, yy + 3); } }
    g.fillStyle = '#7d8790';
    for (var q = 0; q <= 4; q++) { var xx = ml + (W - ml - 22) * q / 4; g.fillText(new Date(t0 + q * (n - 1) * dt / 4).toISOString().slice(11, 16), xx - 12, H - 3); }
    series.forEach(function (s, k) { var m = mxs[k]; g.strokeStyle = colors[k]; g.lineWidth = 1.5; g.beginPath(); s.forEach(function (v, i) { var x = ml + (W - ml - 22) * i / (n - 1), yv = 4 + (H - mb - 4) * (1 - (isFinite(v) ? v : m) / m); i ? g.lineTo(x, yv) : g.moveTo(x, yv); }); g.stroke(); g.fillStyle = colors[k]; g.fillText(names[k], ml + 6 + k * 80, 12); });
  }
  /* LEO availability over a window */
  function leoAvailability(id, hours, stepMin) {
    var c = STATIC.constellations.satcom.find(function (x) { return x[1] === id; });
    if (!groups[id]) { log('Load ' + c[0] + ' TLEs first.', 'w'); return Promise.resolve(); }
    ensurePt();
    return prepHorizon().then(function () {
      var t0 = when().getTime(), steps = Math.round(hours * 60 / stepMin), gd = obsGd(pt), ok = 0, gap = 0, maxGap = 0, cnts = [], i = 0;
      prog(true, c[0] + ' availability…', 0);
      return new Promise(function (res) {
        (function chunk() {
          var tEnd = performance.now() + 40;
          while (i <= steps && performance.now() < tEnd) {
            var vs = lookAll([id], new Date(t0 + i * stepMin * 60e3), pt, gd).filter(function (s) { return s.el >= c[3] && s.el >= hzAt(hz, s.az); });
            cnts.push(vs.length); if (vs.length) { ok++; gap = 0; } else { gap += stepMin; maxGap = Math.max(maxGap, gap); }
            i++;
          }
          prog(true, c[0] + ' availability ' + i + '/' + (steps + 1), i / (steps + 1));
          if (i <= steps) setTimeout(chunk, 0); else { prog(false); res(); }
        })();
      }).then(function () {
        var av = ok / cnts.length * 100;
        log(c[0] + ' at point over ' + hours + ' h (' + stepMin + ' min steps, el ≥ ' + c[3] + '° + terrain): availability ' + fx(av, 1) + '%, sats in view ' + Math.min.apply(null, cnts) + '–' + Math.max.apply(null, cnts) + ', longest outage ' + maxGap + ' min', av > 99 ? 'g' : 'w');
        var cv = $('satChart'); if (cv) chart(cv, [cnts], [c[2]], [c[0] + ' usable sats'], t0, stepMin * 60e3);
      });
    });
  }

  /* ---- map overlays ---- */
  function geoFootprints() {
    if (geoLayer) { map.removeLayer(geoLayer); geoLayer = null; }
    var sel = S.geoSel || [], g = L.layerGroup();
    STATIC.geo.forEach(function (s, idx) {
      if (sel.indexOf(idx) < 0) return;
      [0, 10, 20].forEach(function (elMin, k) {
        var e = elMin * D2R, psi = Math.acos(6378.137 / GEO_R * Math.cos(e)) - e, pts = [];
        for (var a = 0; a <= 360; a += 3) { var q = PC.dest(0, s[1], a, psi * 6371008.8); pts.push(q); }
        // unwrap longitudes around the sub-satellite point
        pts.forEach(function (p) { while (p[1] - s[1] > 180) p[1] -= 360; while (p[1] - s[1] < -180) p[1] += 360; });
        g.addLayer(L.polygon(pts, { color: ['#ffd166', '#ff9f1c', '#e5484d'][k], weight: 1.5, fill: k === 2, fillOpacity: 0.04, dashArray: k ? null : '5 4', interactive: false }));
      });
      g.addLayer(L.circleMarker([0, s[1]], { radius: 5, color: '#ffd166' }).bindTooltip(s[0] + ' (' + s[1] + '°)'));
    });
    geoLayer = g.addTo(map);
  }
  function live(on) {
    if (liveTimer) { clearInterval(liveTimer); liveTimer = null; }
    if (liveLayer) { map.removeLayer(liveLayer); liveLayer = null; }
    if (!on) return;
    liveLayer = L.layerGroup().addTo(map);
    function tick() {
      liveLayer.clearLayers();
      var date = new Date(), gmst = satellite.gstime(date);
      STATIC.constellations.gnss.concat(STATIC.constellations.satcom).forEach(function (c) {
        if (!groups[c[1]] || !(S.liveSel || {})[c[1]]) return;
        groups[c[1]].sats.forEach(function (s) {
          var pv = satellite.propagate(s.rec, date); if (!pv || !pv.position || typeof pv.position === 'boolean') return;
          var gd = satellite.eciToGeodetic(pv.position, gmst), lat = gd.latitude * R2D, lon = gd.longitude * R2D;
          liveLayer.addLayer(L.circleMarker([lat, lon], { renderer: rnd, radius: 3, color: c[2], weight: 1, fillOpacity: 0.9 }).bindTooltip(s.name + ' · ' + fx(gd.height, 0) + ' km'));
          if (c[3] && S.liveFoot && groups[c[1]].sats.length < 120) {
            var e = c[3] * D2R, rr = 6378.137 + gd.height, psi = Math.acos(6378.137 / rr * Math.cos(e)) - e;
            liveLayer.addLayer(L.circle([lat, lon], { radius: psi * 6371008.8, color: c[2], weight: 0.6, fillOpacity: 0.03, interactive: false }));
          }
        });
      });
    }
    tick(); liveTimer = setInterval(tick, 10000);
  }
  /* terrain-masked GNSS / GEO availability grid over the current view */
  function areaMap(kind) {
    var b = map.getBounds(), N = clamp(+S.gnss.grid || 36, 8, 80), r = +S.gnss.horizonKm || 15;
    var dLat = r / 111, dLon = r / (111 * Math.cos(b.getCenter().lat * D2R));
    var s = b.getSouth(), n = b.getNorth(), w = b.getWest(), e = b.getEast();
    if ((n - s) > 6 || (e - w) > 8) { log('Zoom in further (view must be < ~600 km) for the terrain-mask grid.', 'w'); return; }
    var z = DEM.zoomFor(s - dLat, w - dLon, n + dLat, e + dLon, 11, 250);
    prog(true, 'Loading terrain…', 0);
    DEM.ensure(s - dLat, w - dLon, n + dLat, e + dLon, z, function (d, t) { prog(true, 'Terrain ' + d + '/' + t, d / t * 0.3); }).then(function () {
      var date = when(), mask = +S.gnss.mask, gnssIds = STATIC.constellations.gnss.map(function (c) { return c[1]; }).filter(function (id) { return groups[id] && id !== 'sbas'; });
      if (kind === 'gnss' && !gnssIds.length) { prog(false); log('Load GNSS TLEs first.', 'w'); return; }
      var gi = (S.geoSel || [])[0], geo = STATIC.geo[gi === undefined ? 0 : gi];
      var gmst = satellite.gstime(date), ecfs = [];
      if (kind === 'gnss') gnssIds.forEach(function (id) { var meta = STATIC.constellations.gnss.find(function (c) { return c[1] === id; }); groups[id].sats.forEach(function (sv) { var ecf = satECF(sv, date, gmst); if (ecf) ecfs.push([ecf, meta[0]]); }); });
      var cells = [], i = 0, total = N * N;
      if (areaLayer) map.removeLayer(areaLayer);
      areaLayer = L.layerGroup().addTo(map);
      (function chunk() {
        var tEnd = performance.now() + 50;
        while (i < total && performance.now() < tEnd) {
          var yi = Math.floor(i / N), xi = i % N, lat = s + (n - s) * (yi + 0.5) / N, lon = w + (e - w) * (xi + 0.5) / N;
          var h = S.gnss.terrain ? horizonAt(lat, lon, 2, r, 36) : null, val, txt, col;
          var gd = { latitude: lat * D2R, longitude: lon * D2R, height: ((DEM.elev(lat, lon) || 0) + 2) / 1000 };
          if (kind === 'gnss') {
            var vis = [];
            ecfs.forEach(function (q) { var la = satellite.ecfToLookAngles(gd, q[0]), el = la.elevation * R2D, az = la.azimuth * R2D; if (el >= mask && el >= hzAt(h, az)) vis.push({ el: el, az: az, cons: q[1] }); });
            var d = dop(vis); val = d ? d.P : 99;
            col = val < 2 ? '#2fe07a' : val < 4 ? '#a7e34b' : val < 6 ? '#ffd166' : val < 10 ? '#ff9f1c' : '#e5484d';
            txt = vis.length + ' sats, PDOP ' + (d ? fx(d.P, 1) : 'no fix');
          } else {
            var la = geoLook(null, geo[1], gd), hzEl = hzAt(h, la.az);
            val = la.el - Math.max(hzEl, mask);
            col = la.el < mask ? '#555' : val >= 3 ? '#2fe07a' : val >= 0 ? '#ffd166' : '#e5484d';
            txt = geo[0] + ': el ' + fx(la.el, 1) + '°, terrain ' + fx(hzEl, 1) + '° → ' + (val >= 0 ? 'clear by ' + fx(val, 1) + '°' : 'BLOCKED');
          }
          var dy = (n - s) / N / 2, dx = (e - w) / N / 2;
          areaLayer.addLayer(L.rectangle([[lat - dy, lon - dx], [lat + dy, lon + dx]], { renderer: rnd, stroke: false, fillColor: col, fillOpacity: 0.45 }).bindTooltip(txt));
          i++;
        }
        prog(true, (kind === 'gnss' ? 'GNSS PDOP' : 'GEO look-angle') + ' grid ' + i + '/' + total, 0.3 + 0.7 * i / total);
        if (i < total) setTimeout(chunk, 0);
        else { prog(false); log((kind === 'gnss' ? 'GNSS terrain-mask PDOP map' : geo[0] + ' blockage map') + ' done (' + N + '×' + N + ', horizon ' + r + ' km). Hover cells for values.', 'g'); }
      })();
    });
  }
  function clearArea() { if (areaLayer) map.removeLayer(areaLayer); areaLayer = null; }
  function clearPoint() { if (markers.gn) { map.removeLayer(markers.gn); markers.gn = null; } pt = null; hz = null; lastVis = null; }

  /* ---- panels ---- */
  function tleRows(list) {
    return list.map(function (c) { return '<tr><td><span style="color:' + c[2] + '">●</span> ' + c[0] + '</td><td class="mini">' + grpInfo(c[1]) + '</td><td><a class="lnk" onclick="SAT.fetchGroup(\'' + c[1] + '\').then(rerender)">fetch</a> · <a class="lnk" onclick="SAT.importTLE(\'' + c[1] + '\')">import</a> · <label class="mini"><input type="checkbox" ' + ((S.liveSel || {})[c[1]] ? 'checked' : '') + ' title="Show live positions on the map" onchange="S.liveSel=S.liveSel||{};S.liveSel[\'' + c[1] + '\']=this.checked;saveState();SAT.live(Object.values(S.liveSel).some(Boolean))"> live</label></td></tr>'; }).join('');
  }
  function renderGnss() {
    ensurePt();
    var h = '<h3>GNSS coverage</h3>';
    h += '<div class="card"><div class="kv"><span>Analysis point</span><b>' + fx(pt.lat, 5) + ', ' + fx(pt.lon, 5) + '</b></div><div class="row"><button class="btn sm" onclick="setPick(\'gn\')">Pick on map</button><button class="btn sm" onclick="SAT.setPoint(S.tx.lat,S.tx.lon)">Use Tx</button><button class="btn sm" onclick="SAT.setPoint(S.rx.lat,S.rx.lon)">Use Rx</button></div></div>';
    h += F('Elevation mask', 'gnss.mask', { unit: '°' }) + CK('Apply terrain horizon mask', 'gnss.terrain') + F('Horizon search radius', 'gnss.horizonKm', { unit: 'km' }) + F('Epoch (UTC, blank = now)', 'gnss.when', { text: 1, title: 'e.g. 2026-10-12T15:00Z' });
    h += '<div class="row"><button class="btn pri sm" id="gnRun">Analyze point</button><button class="btn sm" id="gnTL">24 h timeline</button><button class="btn sm" id="gnFetch">Fetch all GNSS TLEs</button></div>';
    h += '<canvas class="sky" id="gnssSky"></canvas><div id="gnssOut" class="note">Run an analysis to see the sky plot and DOP.</div><canvas class="chart" id="gnssChart"></canvas>';
    h += '<h4>Area maps (current view)</h4>' + F('Grid cells per side', 'gnss.grid') + '<div class="row"><button class="btn sm" id="gnArea">Terrain-masked PDOP map</button><button class="btn sm" onclick="SAT.clearArea()">Clear grid</button></div>';
    h += '<h4>Orbital data (CelesTrak GP)</h4><table class="t">' + tleRows(STATIC.constellations.gnss) + '</table>';
    h += '<div class="note">Interference reports: enable "Known test / chronic areas" or fetch gpsjam.org in Layers. Always check NOTAMs for GPS testing.</div>';
    return h;
  }
  function afterGnss() {
    $('gnRun').onclick = function () { analyzePoint(); };
    $('gnTL').onclick = function () { timeline(); };
    $('gnFetch').onclick = function () { Promise.all(STATIC.constellations.gnss.map(function (c) { return fetchGroup(c[1]); })).then(function () { rerender(); analyzePoint(); }); };
    $('gnArea').onclick = function () { areaMap('gnss'); };
    if (lastVis) setTimeout(function () { drawGnss(); }, 0);
  }
  function renderSat() {
    ensurePt();
    S.geoSel = S.geoSel || [];
    var h = '<h3>SATCOM coverage</h3><div class="card"><div class="kv"><span>Analysis point</span><b>' + fx(pt.lat, 5) + ', ' + fx(pt.lon, 5) + '</b></div><div class="row"><button class="btn sm" onclick="setPick(\'gn\')">Pick on map</button><button class="btn sm" onclick="SAT.setPoint(S.tx.lat,S.tx.lon)">Use Tx</button><button class="btn sm" onclick="SAT.setPoint(S.rx.lat,S.rx.lon)">Use Rx</button><button class="btn pri sm" onclick="SAT.analyzePoint()">Analyze</button></div></div>';
    h += '<canvas class="sky" id="satSky"></canvas><div id="satOut"></div>';
    h += '<h4>GEO footprints (0° / 10° / 20° elevation contours)</h4><div class="scrollbox" style="max-height:170px">' + STATIC.geo.map(function (g, i) { return '<label class="chk"><input type="checkbox" ' + (S.geoSel.indexOf(i) >= 0 ? 'checked' : '') + ' onchange="SAT.toggleGeo(' + i + ',this.checked)"> ' + esc(g[0]) + ' <span class="mini">' + g[1] + '° ' + g[2] + '</span></label>'; }).join('') + '</div>';
    h += '<div class="row"><button class="btn sm" id="geoArea">Terrain blockage map for first checked GEO</button><button class="btn sm" onclick="SAT.clearArea()">Clear grid</button></div>';
    h += '<h4>LEO constellations</h4><table class="t">' + tleRows(STATIC.constellations.satcom) + '</table>' + CK('Draw footprints on live map (small constellations)', 'liveFoot');
    h += '<div class="row"><select id="leoSel" class="inp" style="width:140px">' + STATIC.constellations.satcom.map(function (c) { return '<option value="' + c[1] + '">' + c[0] + '</option>'; }).join('') + '</select><input id="leoH" class="inp" type="number" value="6" style="width:56px" title="hours"> h<input id="leoStep" class="inp" type="number" value="2" style="width:50px" title="step min"> min<button class="btn sm" id="leoGo">Availability</button></div><canvas class="chart" id="satChart"></canvas>';
    h += '<div class="note">Elevation masks used: Iridium 8.2°, Starlink 25°, OneWeb 15°. Visibility ≠ service: Starlink/OneWeb need gateway coverage and licensing for the region; Iridium is global incl. poles; Inmarsat GEO elevation falls below ~5° beyond ±76° latitude. GEO slots are nominal.</div>';
    return h;
  }
  function afterSat() {
    $('geoArea').onclick = function () { areaMap('geo'); };
    $('leoGo').onclick = function () { leoAvailability($('leoSel').value, +$('leoH').value || 6, +$('leoStep').value || 2); };
    setTimeout(function () { drawSatcom(); }, 0);
  }
  function toggleGeo(i, on) { S.geoSel = S.geoSel || []; var k = S.geoSel.indexOf(i); if (on && k < 0) S.geoSel.push(i); if (!on && k >= 0) S.geoSel.splice(k, 1); saveState(); geoFootprints(); }
  watch('gnss.', function () { if (curPanel === 'gnss' && lastVis) analyzePoint(); });

  return { loadCached: loadCached, fetchGroup: fetchGroup, importTLE: importTLE, setPoint: setPoint, analyzePoint: analyzePoint, renderGnss: renderGnss, afterGnss: afterGnss, renderSat: renderSat, afterSat: afterSat,
    toggleGeo: toggleGeo, clearPoint: clearPoint, geoFootprints: geoFootprints, live: live, clearArea: clearArea, horizonAt: horizonAt, dop: dop, parseTLE: parseTLE, groups: function () { return groups; }, geoLook: geoLook, lookAll: lookAll };
})();
