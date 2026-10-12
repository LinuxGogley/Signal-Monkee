/* ===================== Coverage engine (radial sweep, Web Workers) + rendering + legend ===================== */
var COV = (function () {
  var cur = null;          // {tx, R, L, rays, xi, loss, elAng, los, opts, overlay, bounds}
  var kept = [];           // kept overlays
  var running = false;

  function palette(name, t) { // t in 0..1 (1 = strong)
    t = clamp(t, 0, 1);
    if (name === 'viridis') return lerpStops([[68, 1, 84], [59, 82, 139], [33, 145, 140], [94, 201, 98], [253, 231, 37]], t);
    if (name === 'turbo') return lerpStops([[48, 18, 59], [70, 130, 248], [27, 229, 181], [164, 252, 60], [250, 186, 57], [227, 66, 16], [122, 4, 3]], t);
    if (name === 'mono') return [240, 160, 32];
    // rainbow: blue (weak) -> red (strong), like CloudRF
    var h = (1 - t) * 240; return hsl2rgb(h, 1, 0.5);
  }
  function lerpStops(st, t) { var x = t * (st.length - 1), i = Math.min(Math.floor(x), st.length - 2), f = x - i; return [0, 1, 2].map(function (k) { return Math.round(st[i][k] + (st[i + 1][k] - st[i][k]) * f); }); }
  function hsl2rgb(h, s, l) { var c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2, r, g, b; if (h < 60) { r = c; g = x; b = 0; } else if (h < 120) { r = x; g = c; b = 0; } else if (h < 180) { r = 0; g = c; b = x; } else if (h < 240) { r = 0; g = x; b = c; } else { r = x; g = 0; b = c; } return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)]; }
  var MCS_COLORS = [[49, 54, 149], [69, 117, 180], [116, 173, 209], [171, 217, 233], [224, 243, 248], [254, 224, 144], [253, 174, 97], [244, 109, 67], [215, 48, 39], [165, 0, 38], [120, 0, 60], [80, 0, 80]];

  var K = null;
  function prepK() { K = { spec: RF.antSpec(), base: RF.txdBm() - S.txLoss + S.txGain + S.rxGain - S.rxLoss, eirp: RF.eirp(), noise: RF.noise(), sens: RF.sens(), clutter: +S.clutterDb || 0, f20: 20 * Math.log10(S.f), gs: +S.cov.gnssSig }; return K; }
  /* value transform for display mode; returns NaN to hide */
  function displayValue(lossDb, elAng, az, losFlag, mode) {
    if (mode === 'los') return losFlag ? 1 : 0;
    if (!(lossDb < 900)) return NaN;
    if (!K) prepK();
    var pat = K.spec.type === 'iso' ? 0 : PC.patternLoss(K.spec, az, elAng);
    var L = lossDb + K.clutter;
    var prx = K.base + pat - L;
    switch (mode) {
      case 'loss': return L;
      case 'field': return K.eirp + pat - L + K.f20 + 77.2;
      case 'snr': return prx - K.noise;
      case 'margin': return prx - K.sens;
      case 'js': return prx - K.gs;
      default: return prx;
    }
  }
  function colorFor(v, mode) {
    if (!isFinite(v)) return null;
    var c = S.cov;
    if (mode === 'los') return v ? [47, 224, 122, 200] : (c.showBelow ? [229, 72, 77, 140] : null);
    if (mode === 'js') { var thr = +c.jsThr; if (v < thr - 20) return c.showBelow ? [60, 60, 60, 80] : null; var tt = clamp((v - (thr - 20)) / 40, 0, 1); var cc = v >= thr ? lerpStops([[255, 200, 0], [255, 60, 0], [160, 0, 0]], clamp((v - thr) / 30, 0, 1)) : [80, 160, 255]; return [cc[0], cc[1], cc[2], v >= thr ? 230 : 110]; }
    var top = +c.top, bot = +c.bottom, step = +c.step || 1, invert = mode === 'loss';
    if (!K) prepK();
    if (mode === 'margin' || mode === 'snr') { top = 40; bot = mode === 'margin' ? 0 : K.sens - K.noise; }
    if (mode === 'field') { top = +c.top + 127; bot = +c.bottom + 127; }
    if (mode === 'loss') { top = -(+c.bottom) + K.eirp; bot = -(+c.top) + K.eirp; }
    var lo = Math.min(top, bot), hi = Math.max(top, bot);
    if (v < lo && !invert || v > hi && invert) { if (!c.showBelow) return null; }
    if (mode === 'dbm' && !c.showBelow && v < K.sens && K.sens > lo) return null;
    var q = Math.floor((v - lo) / step) * step + lo; // quantise to steps
    var t = (q - lo) / Math.max(hi - lo, 1e-9); if (invert) t = 1 - t;
    var col = palette(c.palette, t);
    var a = c.palette === 'mono' ? Math.round(60 + 195 * clamp(t, 0, 1)) : 255;
    return [col[0], col[1], col[2], a];
  }

  function run(opt) {
    if (running) { log('Coverage already running…', 'w'); return Promise.resolve(); }
    opt = opt || {};
    if (!S.tx.placed) { log('Place the Tx site first (📍 Tx).', 'w'); return Promise.resolve(); }
    var tx = Object.assign({}, S.tx), R = (+S.cov.radius) * 1000;
    if (!(R > 100)) { log('Set a coverage radius.', 'e'); return Promise.resolve(); }
    running = true; status('coverage…');
    var n = PC.dest(tx.lat, tx.lon, 0, R)[0], s = PC.dest(tx.lat, tx.lon, 180, R)[0];
    var e = PC.dest(tx.lat, tx.lon, 90, R)[1], w = PC.dest(tx.lat, tx.lon, 270, R)[1];
    var z = DEM.zoomFor(s, w, n, e, 12, +S.cov.maxTiles || 250);
    prog(true, 'Loading terrain…', 0);
    var t0 = performance.now();
    return DEM.ensure(s, w, n, e, z, function (d, t) { prog(true, 'Loading terrain tiles ' + d + '/' + t + ' (z' + z + ')', d / t * 0.3); }).then(function (failed) {
      if (failed) log(failed + ' terrain tiles unavailable (treated as 0 m).', 'w');
      var res = Math.max(DEM.resolution(tx.lat), 10);
      var L = clamp(Math.round(R / res), 40, +S.cov.maxSteps || 500), xi = R / L;
      var rays = +S.cov.rays > 0 ? +S.cov.rays : clamp(Math.round(2 * Math.PI * L * 0.9), 360, 3600);
      prog(true, 'Sampling terrain: ' + rays + ' radials × ' + L + ' steps…', 0.32);
      return raf().then(function () {
        var elev = new Float32Array(rays * (L + 1)), miss = 0;
        var p1 = tx.lat * D2R, l1 = tx.lon * D2R, sp1 = Math.sin(p1), cp1 = Math.cos(p1);
        for (var r = 0; r < rays; r++) {
          var th = r / rays * 2 * Math.PI, st = Math.sin(th), ct = Math.cos(th);
          for (var k = 0; k <= L; k++) {
            var dr = k * xi / PC.R_E, sd = Math.sin(dr), cd = Math.cos(dr);
            var p2 = Math.asin(sp1 * cd + cp1 * sd * ct), l2 = l1 + Math.atan2(st * sd * cp1, cd - sp1 * Math.sin(p2));
            var ev = DEM.elev(p2 * R2D, ((l2 * R2D + 540) % 360) - 180);
            if (!isFinite(ev)) { ev = 0; miss++; }
            elev[r * (L + 1) + k] = ev;
          }
        }
        if (miss) log(miss + ' samples lacked terrain.', 'w');
        var hs = 0; for (var i = 0; i < elev.length; i += 7) hs += elev[i]; hs /= Math.ceil(elev.length / 7);
        var opts = { model: S.model, f: S.f, htx: tx.h, hrx: +S.cov.rxH, rxMode: S.cov.rxMode, ae: RF.effEarth(hs), itm: RF.itmOpts(), hataEnv: +S.hataEnv };
        if (S.cov.display === 'los') opts.model = 'los';
        return compute(elev, rays, L, xi, opts, t0).then(function (out) {
          cur = { tx: tx, R: R, L: L, rays: rays, xi: xi, loss: out.loss, elAng: out.elAng, los: out.los, opts: opts, bounds: [[s, w], [n, e]], f: S.f, model: opts.model };
          paint.logNext = true; paint(); OPS.markStale(false);
          var dt = (performance.now() - t0) / 1000;
          log('Coverage: ' + rays + ' radials × ' + L + ' steps (' + fx(xi, 0) + ' m), ' + RF.modelName(opts.model) + ', ' + fx(dt, 1) + ' s', 'g');
          RF.logBudget();
          running = false; status('ready'); prog(false);
        });
      });
    }).catch(function (e) { running = false; prog(false); status('error'); log('Coverage failed: ' + e.message, 'e'); console.error(e); });
  }

  function compute(elev, rays, L, xi, opts, t0) {
    var nw = clamp((navigator.hardwareConcurrency || 4) - 1, 1, 12);
    var chunk = Math.ceil(rays / (nw * 4)), jobs = [];
    for (var r0 = 0; r0 < rays; r0 += chunk) jobs.push([r0, Math.min(rays, r0 + chunk)]);
    var loss = new Float32Array(rays * (L + 1)), elAng = new Float32Array(rays * (L + 1)), los = new Uint8Array(rays * (L + 1));
    var done = 0, progress = {};
    return new Promise(function (resolve, reject) {
      var workers = [], next = 0, finished = 0;
      function feed(wk) {
        if (next >= jobs.length) { wk.terminate(); return; }
        var j = jobs[next++], sub = elev.slice(j[0] * (L + 1), j[1] * (L + 1));
        wk.postMessage({ cmd: 'radials', id: j[0], r0: j[0], r1: j[1], steps: L, xi: xi, opts: opts, elev: sub.buffer }, [sub.buffer]);
      }
      for (var i = 0; i < Math.min(nw, jobs.length); i++) {
        var wk;
        try { wk = makeWorker(); } catch (e) { reject(e); return; }
        wk.onerror = function (e) { reject(new Error(e.message || 'worker error')); };
        wk.onmessage = (function (wk) {
          return function (ev) {
            var m = ev.data;
            if (m.cmd === 'progress') { progress[m.id] = m.done; }
            else if (m.cmd === 'done') {
              var off = m.r0 * (L + 1);
              loss.set(new Float32Array(m.loss), off); elAng.set(new Float32Array(m.elAng), off); los.set(new Uint8Array(m.los), off);
              done += m.r1 - m.r0; delete progress[m.id]; finished++;
              if (finished === jobs.length) { resolve({ loss: loss, elAng: elAng, los: los }); return; }
              feed(wk);
            }
            var pr = done; for (var k in progress) pr += progress[k];
            prog(true, 'Computing ' + RF.modelName(opts.model) + '… ' + pr + '/' + rays + ' radials (' + fx((performance.now() - t0) / 1000, 0) + ' s)', 0.35 + 0.65 * pr / rays);
          };
        })(wk);
        workers.push(wk); feed(wk);
      }
    });
  }

  /* polar lookup with bilinear interpolation of display value */
  function polarValue(c, az, d, mode) {
    var fr = az / 360 * c.rays, r0 = Math.floor(fr) % c.rays, r1 = (r0 + 1) % c.rays, a = fr - Math.floor(fr);
    var fk = d / c.xi; if (fk > c.L) return NaN;
    var k0 = Math.min(Math.floor(fk), c.L), k1 = Math.min(k0 + 1, c.L), b = fk - k0;
    var L1 = c.L + 1;
    if (mode === 'los') { var rr = a < 0.5 ? r0 : r1, kk = b < 0.5 ? k0 : k1; var ii = rr * L1 + kk; return displayValue(c.loss[ii], c.elAng[ii], az, c.los[ii], mode); }
    var i00 = r0 * L1 + k0, i01 = r0 * L1 + k1, i10 = r1 * L1 + k0, i11 = r1 * L1 + k1;
    var l = (c.loss[i00] * (1 - b) + c.loss[i01] * b) * (1 - a) + (c.loss[i10] * (1 - b) + c.loss[i11] * b) * a;
    var ea = (c.elAng[i00] * (1 - b) + c.elAng[i01] * b) * (1 - a) + (c.elAng[i10] * (1 - b) + c.elAng[i11] * b) * a;
    var lf = c.los[b < 0.5 ? (a < 0.5 ? i00 : i10) : (a < 0.5 ? i01 : i11)];
    if (Math.max(c.loss[i00], c.loss[i01], c.loss[i10], c.loss[i11]) > 900) l = Math.max(c.loss[i00], c.loss[i01], c.loss[i10], c.loss[i11]);
    return displayValue(l, ea, az, lf, mode);
  }
  /* render raster; proj 'merc' (Leaflet) or 'eqr' (KML GroundOverlay) */
  function renderCanvas(c, proj, maxDim) {
    var b = c.bounds, s = b[0][0], w = b[0][1], n = b[1][0], e = b[1][1];
    var ys = proj === 'merc' ? DEM.lat2y(n, 0) : n, ye = proj === 'merc' ? DEM.lat2y(s, 0) : s;
    var dxm = PC.dist(c.tx.lat, w, c.tx.lat, e), dym = PC.dist(s, c.tx.lon, n, c.tx.lon);
    var W = Math.round(clamp(maxDim || Math.min(2 * c.L * 1.2, 1800), 200, 4000)), H = Math.round(W * dym / dxm);
    var cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    var g = cv.getContext('2d'), img = g.createImageData(W, H), d = img.data, mode = S.cov.display;
    prepK();
    var p1 = c.tx.lat * D2R, cp1 = Math.cos(p1), sp1 = Math.sin(p1);
    for (var y = 0; y < H; y++) {
      var lat;
      if (proj === 'merc') { var yy = ys + (ye - ys) * (y + 0.5) / H; lat = (2 * Math.atan(Math.exp(Math.PI * (1 - 2 * yy / 256))) - Math.PI / 2) * R2D; }
      else lat = n - (n - s) * (y + 0.5) / H;
      var p2 = lat * D2R, cp2 = Math.cos(p2), sp2 = Math.sin(p2);
      for (var x = 0; x < W; x++) {
        var lon = w + (e - w) * (x + 0.5) / W, dl = (lon - c.tx.lon) * D2R;
        var sdl = Math.sin(dl), cdl = Math.cos(dl);
        var cosc = clamp(sp1 * sp2 + cp1 * cp2 * cdl, -1, 1), dist = Math.acos(cosc) * PC.R_E;
        if (dist > c.R) continue;
        var az = (Math.atan2(sdl * cp2, cp1 * sp2 - sp1 * cp2 * cdl) * R2D + 360) % 360;
        var v = polarValue(c, az, dist, mode), col = colorFor(v, mode);
        if (!col) continue;
        var i = (y * W + x) * 4; d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2]; d[i + 3] = col[3];
      }
    }
    g.putImageData(img, 0, 0);
    return cv;
  }
  function paint() {
    if (!cur) return;
    prog(true, 'Rendering…', 1);
    var cv = renderCanvas(cur, 'merc');
    if (cur.overlay) map.removeLayer(cur.overlay);
    cur.overlay = L.imageOverlay(cv.toDataURL('image/png'), cur.bounds, { opacity: +S.cov.opacity, pane: 'covPane', interactive: false }).addTo(map);
    cur.canvas = cv; prog(false);
    legend(); stats(paint.logNext); paint.logNext = false;
  }
  function legend() {
    var mode = S.cov.display, el = $('legend'), h = ''; prepK();
    if (!cur) { el.innerHTML = ''; return; }
    var c = S.cov, unit = { dbm: 'dBm', loss: 'dB loss', field: 'dBµV/m', snr: 'SNR dB', margin: 'margin dB', js: 'J/S dB', los: 'LOS' }[mode];
    h += '<div class="lgt">' + unit + '</div><div class="lg">';
    if (mode === 'los') h += '<div style="background:#2fe07a">LOS</div><div style="background:#e5484d;color:#fff">NLOS</div>';
    else if (mode === 'js') { var thr = +c.jsThr; [thr + 30, thr + 20, thr + 10, thr, thr - 10].forEach(function (v) { var col = colorFor(v + 0.01, 'js'); h += '<div style="background:rgba(' + col.slice(0, 3) + ',1)">' + (v >= thr ? 'denied ' : '') + fx(v, 0) + '</div>'; }); }
    else {
      var top = +c.top, bot = +c.bottom, step = +c.step || 4;
      if (mode === 'margin' || mode === 'snr') { top = 40; bot = mode === 'margin' ? 0 : RF.sens() - RF.noise(); }
      if (mode === 'field') { top += 127; bot += 127; }
      if (mode === 'loss') { var t2 = -(+c.bottom) + RF.eirp(); bot = -(+c.top) + RF.eirp(); top = t2; }
      var lo = Math.min(top, bot), hi = Math.max(top, bot), cnt = 0;
      var vals = []; for (var v = hi; v >= lo - 1e-9 && cnt < 40; v -= step, cnt++) vals.push(v);
      if (mode === 'loss') vals.reverse();
      vals.forEach(function (v) { var col = colorFor(v + 1e-6, mode) || [60, 60, 60]; h += '<div style="background:rgb(' + col.slice(0, 3) + ')">' + fx(v, 0) + '</div>'; });
    }
    el.innerHTML = h + '</div>';
  }
  /* area statistics (each radial sample weighted by its annulus area ∝ k) */
  function stats(logIt) {
    if (!cur) return;
    prepK();
    var c = cur, L1 = c.L + 1, tot = 0, above = 0, los = 0, bins = [-60, -70, -80, -90, -100, -110], binA = bins.map(function () { return 0; });
    for (var r = 0; r < c.rays; r++) for (var k = 1; k <= c.L; k++) {
      var i = r * L1 + k, w = k, l = c.loss[i];
      tot += w; if (c.los[i]) los += w;
      if (!(l < 900)) continue;
      var az = r * 360 / c.rays, prx = displayValue(l, c.elAng[i], az, 1, 'dbm');
      if (prx >= K.sens) above += w;
      bins.forEach(function (b, j) { if (prx >= b) binA[j] += w; });
    }
    var area = Math.PI * c.R * c.R / 1e6;
    var h = '<div class="kv"><span>Site</span><b>' + esc(c.tx.name) + ' (' + fx(c.tx.lat, 5) + ', ' + fx(c.tx.lon, 5) + '), ' + hShort(c.tx.h) + ' AGL</b><span>Frequency / model</span><b>' + fx(c.f, 4) + ' MHz / ' + RF.modelName(c.model) + '</b><span>Radius / grid</span><b>' + fx(c.R / 1000, 1) + ' km, ' + c.rays + ' radials × ' + c.L + ' steps (' + fx(c.xi, 0) + ' m)</b>' +
      '<span>Rx height</span><b>' + hShort(c.opts.hrx) + ' ' + (c.opts.rxMode === 'msl' ? 'MSL' : 'AGL') + '</b><span>Area ≥ sensitivity (' + fx(K.sens, 1) + ' dBm)</span><b>' + fx(above / tot * 100, 1) + '% (' + fx(above / tot * area, 0) + ' km²)</b><span>Area with geometric LOS</span><b>' + fx(los / tot * 100, 1) + '%</b>' +
      bins.map(function (b, j) { return '<span>Area ≥ ' + b + ' dBm</span><b>' + fx(binA[j] / tot * 100, 1) + '%</b>'; }).join('') + '</div>';
    $('infoTab').innerHTML = '<h3 style="margin:0 0 8px">Coverage statistics</h3>' + h;
    if (logIt) log('Coverage ≥ sensitivity: ' + fx(above / tot * 100, 1) + '% of ' + fx(area, 0) + ' km² (LOS ' + fx(los / tot * 100, 1) + '%)');
  }
  function valueAt(lat, lon) {
    if (!cur) return null;
    prepK();
    var d = PC.dist(cur.tx.lat, cur.tx.lon, lat, lon); if (d > cur.R) return null;
    var az = PC.bearing(cur.tx.lat, cur.tx.lon, lat, lon);
    var prx = polarValue(cur, az, d, 'dbm'), los = polarValue(cur, az, d, 'los'), l = polarValue(cur, az, d, 'loss');
    var s = 'coverage: ' + (isFinite(prx) ? fx(prx, 1) + ' dBm' : '—') + '  loss ' + fx(l, 1) + ' dB  ' + (los ? 'LOS' : 'NLOS');
    if (S.cov.display === 'js') s += '  J/S ' + fx(prx - S.cov.gnssSig, 1) + ' dB' + (prx - S.cov.gnssSig >= S.cov.jsThr ? ' DENIED' : '');
    return s;
  }
  function clear() { if (cur && cur.overlay) map.removeLayer(cur.overlay); cur = null; $('legend').innerHTML = ''; }
  function keep() {
    if (!cur) return;
    kept.push({ name: cur.tx.name + ' ' + fx(cur.f, 3) + ' MHz ' + new Date().toLocaleTimeString(), overlay: cur.overlay, c: cur });
    cur = null; renderLayerList(); log('Coverage kept as a layer (toggle it in Output).');
  }
  function renderLayerList() {
    var el = $('covLayers'); if (!el) return;
    el.innerHTML = kept.length ? '<h4>Kept coverage layers</h4>' + kept.map(function (k, i) { return '<label class="chk"><input type="checkbox" ' + (map.hasLayer(k.overlay) ? 'checked' : '') + ' onchange="COV.toggleKept(' + i + ',this.checked)"> ' + esc(k.name) + ' <a class="lnk" onclick="COV.dropKept(' + i + ')">✕</a></label>'; }).join('') : '';
  }
  function toggleKept(i, on) { var k = kept[i]; if (!k) return; if (on) k.overlay.addTo(map); else map.removeLayer(k.overlay); }
  function dropKept(i) { var k = kept[i]; if (!k) return; map.removeLayer(k.overlay); kept.splice(i, 1); renderLayerList(); }
  function dropAll() { kept.forEach(function (k) { map.removeLayer(k.overlay); }); kept = []; renderLayerList(); }
  function exportPNG() { if (!cur) return log('No coverage to export.', 'w'); cur.canvas.toBlob(function (b) { download('coverage.png', b); }); }
  function legendCanvas() {
    var cv = document.createElement('canvas'), items = $('legend').querySelectorAll('.lg div');
    cv.width = 150; cv.height = 22 + items.length * 18; var g = cv.getContext('2d');
    g.fillStyle = 'rgba(20,22,25,0.9)'; g.fillRect(0, 0, cv.width, cv.height); g.font = 'bold 12px sans-serif'; g.fillStyle = '#fff';
    g.fillText(($('legend').querySelector('.lgt') || {}).textContent || '', 6, 15);
    items.forEach(function (d, i) { g.fillStyle = d.style.background; g.fillRect(4, 20 + i * 18, 142, 17); g.fillStyle = d.style.color || '#111'; g.fillText(d.textContent, 10, 33 + i * 18); });
    return cv;
  }
  function exportKMZ() {
    if (!cur) return log('Run coverage first.', 'w');
    var cv = renderCanvas(cur, 'eqr'), b = cur.bounds;
    Promise.all([canvasBytes(cv), canvasBytes(legendCanvas())]).then(function (bs) {
      var kml = KML.doc('Signal Monkee coverage — ' + cur.tx.name, [
        KML.groundOverlay('Coverage ' + fx(cur.f, 3) + ' MHz (' + RF.modelName(cur.model) + ')', 'coverage.png', b[1][0], b[0][0], b[1][1], b[0][1], S.cov.opacity),
        KML.screenOverlay('Legend', 'legend.png'),
        KML.placemark(cur.tx.name, cur.tx.lat, cur.tx.lon, cur.tx.h, 'tx', 'Transmitter, ' + fx(cur.f, 4) + ' MHz, EIRP ' + fx(RF.eirp(), 1) + ' dBm')
      ], KML.styles());
      download('signalmonkee_coverage.kmz', ZIP.make([{ name: 'doc.kml', data: new TextEncoder().encode(kml) }, { name: 'coverage.png', data: bs[0] }, { name: 'legend.png', data: bs[1] }]), 'application/vnd.google-earth.kmz');
      log('Coverage KMZ exported (open in Google Earth).', 'g');
    });
  }
  function canvasBytes(cv) { return new Promise(function (res) { cv.toBlob(function (b) { b.arrayBuffer().then(function (a) { res(new Uint8Array(a)); }); }, 'image/png'); }); }

  watch('cov.', function (k) { if (k === 'cov.opacity' && cur && cur.overlay) cur.overlay.setOpacity(+S.cov.opacity); else if (/display|top|bottom|step|palette|showBelow|jsThr|gnssSig/.test(k) && cur) paint(); else legend(); });
  ['pwrW', 'txLoss', 'rxLoss', 'txGain', 'rxGain', 'rxNF', 'reqSNR', 'bwKHz', 'sensOverride', 'ant.', 'clutterDb'].forEach(function (p) { watch(p, function () { if (cur) paint(); }); });

  return { dropAll: dropAll, run: run, paint: paint, legend: legend, valueAt: valueAt, clear: clear, keep: keep, renderLayerList: renderLayerList, toggleKept: toggleKept, dropKept: dropKept, exportKMZ: exportKMZ, exportPNG: exportPNG, renderCanvas: renderCanvas, canvasBytes: canvasBytes, legendCanvas: legendCanvas, get cur() { return cur; }, polarValue: polarValue, colorFor: colorFor };
})();
