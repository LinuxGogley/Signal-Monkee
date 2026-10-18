/* ===================== RF: link budget, point-to-point analysis, profile, report ===================== */
var RF = (function () {
  var last = null; // last P2P analysis

  /* ---- derived link-budget quantities ---- */
  function txdBm() { return W2dBm(S.pwrW); }
  function eirp() { return OPM() ? txdBm() + S.txGain : txdBm() - S.txLoss + S.txGain; }       // dBm (main beam)
  /* everything in the budget except path loss and antenna pattern: Prx = rxBase() + pattern - loss */
  function rxBase() { return OPM() ? txdBm() + S.txGain + S.rxGain : txdBm() - S.txLoss + S.txGain + S.rxGain - S.rxLoss; }
  function erp() { return eirp() - 2.15; }
  function noise(bwKHz, nf) { return -174 + 10 * Math.log10((bwKHz || S.bwKHz) * 1000) + (nf == null ? S.rxNF : nf); }
  function sens() {
    if (OPM()) return +S.op.minRssi;
    var o = parseFloat(S.sensOverride); if (isFinite(o)) return o;
    return noise() + S.reqSNR;
  }
  function antSpec() { if (OPM()) return { type: 'iso' }; var a = S.ant; return { type: a.type === 'omni' ? (a.vbw > 0 ? 'omni' : 'iso') : a.type, gain: S.txGain, az: a.az, tilt: a.tilt, hbw: a.hbw, vbw: a.vbw, fb: a.fb, sla: a.sla, azTab: a.azTab, elTab: a.elTab, rot: a.rot, mtilt: a.mtilt, mtiltDir: a.mtiltDir }; }
  function effEarth(hsys) { // ITM-consistent effective earth radius
    if (OPM()) return S.op.earth === 'geo' ? 6371e3 : 6371e3 * 4 / 3; // geometric (visual) or standard radio horizon
    var ko = parseFloat(S.kOverride);
    if (isFinite(ko) && ko > 0) return ko * 6370e3;
    var Ns = S.itm.N0 * Math.exp(-(hsys || 0) / 9460);
    return 1 / (157e-9 * (1 - 0.04665 * Math.exp(Ns / 179.3)));
  }
  /* terrain-only LOS planning uses its own earth-curvature choice */
  function losEarth() { return S.los.earth === 'geo' ? 6371e3 : 6371e3 * 4 / 3; }
  function itmOpts() { return { climate: +S.itm.climate, N0: +S.itm.N0, pol: +S.itm.pol, eps: +S.itm.eps, sigma: +S.itm.sigma, mdvar: +S.itm.mdvar, time: +S.itm.time, loc: +S.itm.loc, sit: +S.itm.sit }; }
  function logBudget() {
    if (OPM()) { log('EIRP: ' + fx(dBm2W(eirp()), 3) + 'W / ' + sgn(eirp(), 1) + 'dBm · minimum RSSI ' + fx(sens(), 1) + ' dBm (isotropic antennas, free-space loss)'); return; }
    log('ERP: ' + fx(dBm2W(erp()), 3) + 'W / ' + sgn(erp(), 1) + 'dBm');
    log('EIRP: ' + fx(dBm2W(eirp()), 3) + 'W / ' + sgn(eirp(), 1) + 'dBm');
    log('Johnson-Nyquist noise (' + S.bwKHz + ' kHz, NF ' + S.rxNF + ' dB): ' + fx(noise(), 1) + 'dBm');
    log('Rx sensitivity used: ' + fx(sens(), 1) + 'dBm (' + (isFinite(parseFloat(S.sensOverride)) ? 'override' : 'noise + SNR ' + S.reqSNR + ' dB') + ')');
  }

  /* ---- profile extraction ---- */
  function buildProfile(a, b, step) {
    var D = PC.dist(a.lat, a.lon, b.lat, b.lon);
    var n = clamp(Math.round(D / step), 32, 4000), xi = D / n;
    var lat = new Float64Array(n + 1), lon = new Float64Array(n + 1), z = new Float64Array(n + 1), miss = 0;
    for (var i = 0; i <= n; i++) {
      var p = PC.interp(a.lat, a.lon, b.lat, b.lon, i / n); lat[i] = p[0]; lon[i] = p[1];
      var e = DEM.elev(p[0], p[1]); if (!isFinite(e)) { e = 0; miss++; } z[i] = e;
    }
    return { D: D, n: n, xi: xi, lat: lat, lon: lon, z: z, miss: miss };
  }
  function ensureFor(points, padDeg, zmax) {
    var s = 90, w = 180, n = -90, e = -180;
    points.forEach(function (p) { s = Math.min(s, p.lat); n = Math.max(n, p.lat); w = Math.min(w, p.lon); e = Math.max(e, p.lon); });
    s -= padDeg; n += padDeg; w -= padDeg; e += padDeg;
    var z = DEM.zoomFor(s, w, n, e, zmax || S.p2pZ, 220);
    prog(true, 'Loading terrain (z' + z + ')…', 0);
    return DEM.ensure(s, w, n, e, z, function (d, t) { prog(true, 'Loading terrain tiles ' + d + '/' + t + ' (z' + z + ')', d / t); }).then(function (failed) { prog(false); return { z: z, failed: failed }; });
  }

  /* ---- full SPLAT!-style path analysis ---- */
  function analyze(txs, rxs, opt) {
    opt = opt || {};
    var res = DEM.resolution((txs.lat + rxs.lat) / 2);
    var P = buildProfile(txs, rxs, Math.max(res, 10));
    var n = P.n, xi = P.xi, z = P.z, D = P.D;
    var p10 = Math.trunc(0.1 * n), hs = 0; for (var i = p10; i <= n - p10; i++) hs += z[i]; hs /= (n - 2 * p10 + 1);
    var ae = opt.losOnly ? losEarth() : effEarth(hs), k = ae / 6370e3;
    var htx = txs.h, hrx = rxs.mode === 'msl' ? Math.max(rxs.h - z[n], 0.5) : rxs.h;
    var H1 = z[0] + htx, H2 = z[n] + hrx, f = S.f, lam = C_LIGHT / (f * 1e6);
    // per-point geometry
    var bulge = new Float64Array(n + 1), los = new Float64Array(n + 1), fr = new Float64Array(n + 1), clr = new Float64Array(n + 1);
    var minClr = 1e9, minRatio = 1e9, minRatioI = 0, obs = [], inObs = false, cur = null;
    for (i = 0; i <= n; i++) {
      var d1 = i * xi, d2 = D - d1;
      bulge[i] = d1 * d2 / (2 * ae);
      los[i] = H1 + (H2 - H1) * d1 / D;
      fr[i] = Math.sqrt(lam * d1 * d2 / D);
      clr[i] = los[i] - (z[i] + bulge[i]);
      if (i > 0 && i < n) {
        if (clr[i] < minClr) minClr = clr[i];
        var ratio = fr[i] > 0 ? clr[i] / fr[i] : 9;
        if (ratio < minRatio) { minRatio = ratio; minRatioI = i; }
        if (clr[i] < 0) {
          if (!inObs) { cur = { i: i, peak: i }; inObs = true; }
          if (clr[i] < clr[cur.peak]) cur.peak = i;
        } else if (inObs) { obs.push(cur); inObs = false; }
      }
    }
    if (inObs) obs.push(cur);
    // required antenna heights (Tx moved, Rx fixed) for 0, 0.6 F1, 1.0 F1 clearance
    function reqTx(mult) {
      var need = -1e9;
      for (var j = 1; j < n; j++) { var t = j * xi / D; var hreq = (z[j] + bulge[j] + mult * fr[j] - H2 * t) / (1 - t); if (hreq > need) need = hreq; }
      return Math.max(need - z[0], 0);
    }
    function reqRx(mult) {
      var need = -1e9;
      for (var j = 1; j < n; j++) { var t = j * xi / D; var hreq = (z[j] + bulge[j] + mult * fr[j] - H1 * (1 - t)) / t; if (hreq > need) need = hreq; }
      return Math.max(need - z[n], 0);
    }
    // angles
    var elevAng = (Math.atan2(H2 - H1, D) - D / (2 * ae)) * R2D;
    var elevAngR = (Math.atan2(H1 - H2, D) - D / (2 * ae)) * R2D;
    var az = PC.bearing(txs.lat, txs.lon, rxs.lat, rxs.lon), azR = PC.bearing(rxs.lat, rxs.lon, txs.lat, txs.lon);
    // horizon of Tx (max angle to terrain along path)
    var hzA = -90, hzI = 0;
    for (i = 1; i < n; i++) { var a = (Math.atan2(z[i] - H1, i * xi) - i * xi / (2 * ae)) * R2D; if (a > hzA) { hzA = a; hzI = i; } }
    // losses
    var pfl = new Float64Array(n + 3); for (i = 0; i <= n; i++) pfl[i + 2] = z[i];
    var common = { f: f, htx: htx, hrx: hrx, ae: ae, itm: itmOpts(), hataEnv: +S.hataEnv };
    var Litm = PC.pathLoss(pfl, n, xi, Object.assign({ model: 'itm' }, common));
    var Lp526 = PC.pathLoss(pfl, n, xi, Object.assign({ model: 'p526' }, common));
    var Lhata = (f >= 150 && f <= 2000) ? PC.pathLoss(pfl, n, xi, Object.assign({ model: 'hata' }, common)) : null;
    var Lfs = PC.fspl(D, f);
    var sel = S.model === 'itm' ? Litm : S.model === 'p526' ? Lp526 : S.model === 'hata' && Lhata ? Lhata : S.model === 'los' ? (minClr >= 0 ? { L: Lfs } : { L: 999 }) : { L: Lfs };
    var usedModel = S.model === 'itm' && !Litm.itm ? 'p526' : S.model === 'hata' && !Lhata ? 'fspl' : S.model;
    var Lsel = sel.L + (+S.clutterDb || 0);
    if (OPM() || opt.losOnly) { usedModel = 'oplos'; Lsel = Lfs; } // operator / LOS planning: free-space RSSI; LOS judged geometrically
    var pat = PC.patternLoss(antSpec(), az, elevAng);
    var Prx = rxBase() + pat - Lsel;
    var Piso = eirp() + pat - Lsel; // isotropic received power at Rx location
    var E = Piso + 20 * Math.log10(f) + 77.2;
    var pd = E - 145.8; // dBW/m^2
    var N = noise(), snr = Prx - N, se = sens(), margin = Prx - se;
    return {
      t: new Date(), tx: Object.assign({}, txs), rx: Object.assign({}, rxs), P: P, n: n, xi: xi, D: D, z: z, ae: ae, k: k, hsys: hs,
      htx: htx, hrx: hrx, H1: H1, H2: H2, lam: lam, bulge: bulge, los: los, fr: fr, clr: clr, minClr: minClr, minRatio: minRatio, minRatioI: minRatioI, obs: obs,
      req: { tx0: reqTx(0), tx60: reqTx(0.6), tx100: reqTx(1), rx0: reqRx(0), rx60: reqRx(0.6), rx100: reqRx(1) },
      elevAng: elevAng, elevAngR: elevAngR, az: az, azR: azR, hzA: hzA, hzI: hzI,
      Litm: Litm, Lp526: Lp526, Lhata: Lhata, Lfs: Lfs, Lsel: Lsel, pat: pat, Prx: Prx, Piso: Piso, E: E, pd: pd, N: N, snr: snr, sens: se, margin: margin,
      model: usedModel, reqModel: OPM() || opt.losOnly ? 'oplos' : S.model, zoom: DEM.getZoom(), res: res, op: OPM() || !!opt.losOnly, losOnly: !!opt.losOnly, rxAltNeed: z[n] + reqRx(0), los0: minClr >= 0
    };
  }

  var lastOpt = {};
  function rerun() { return runP2P(lastOpt); }
  function runP2P(opt) {
    opt = opt || {}; lastOpt = opt;
    var tx = S.tx, rx = S.rx;
    if (!tx.placed || !rx.placed) { log('Place both sites first (Tx and Rx buttons on the map).', 'w'); return Promise.resolve(); }
    if (PC.dist(tx.lat, tx.lon, rx.lat, rx.lon) < 20) { log('Tx and Rx are too close.', 'e'); return Promise.resolve(); }
    status('path analysis…');
    return ensureFor([tx, rx], 0.02).then(function (r) {
      if (r.failed) log(r.failed + ' terrain tile(s) unavailable (no internet, or outside the imported offline area) — elevations there treated as 0 m. Results near those areas are unreliable.', 'w');
      var A = analyze(tx, rx, opt);
      last = A; RF.lastP2P = A; OPS.markStale(false);
      if (A.P.miss) log(A.P.miss + ' profile samples had no terrain data.', 'w');
      logP2P(A);
      $('reportTxt').textContent = report(A);
      openDrawer($('drawer').classList.contains('open') ? null : 'profile');
      OPS.refreshSummary();
      drawProfile();
      status('ready');
      return A;
    }).catch(function (e) { prog(false); status('error'); log('Path analysis failed: ' + e.message, 'e'); console.error(e); });
  }
  function logP2P(A) {
    var wo = OPS.worstObs(A), v = OPS.verdict(A);
    log('— ' + (A.losOnly ? 'LOS ' : 'Path ') + esc(A.tx.name) + ' → ' + esc(A.rx.name) + ': ' + dDual(A.D, 2) + ' @ ' + fx(A.az, 0) + '°', 'g');
    log('Line of sight ' + (A.los0 ? 'CLEAR — ' + hShort(A.minClr) + ' above terrain at the closest point' : 'BLOCKED' + (wo ? ' by terrain ' + dU(wo.peak * A.xi, 1) + ' from Tx (' + hShort(A.z[wo.peak]) + ' MSL)' : '') + '; Rx needs ' + hShort(A.rxAltNeed) + ' MSL'), A.los0 ? 'g' : 'e');
    if (A.losOnly) return;
    log('Worst first-Fresnel clearance ' + fx(A.minRatio * 100, 0) + '% (' + (A.minRatio >= 0.6 ? 'OK' : 'below 60%') + ')');
    if (A.reqModel !== A.model) log('ITM not valid for this geometry (terminal > 3 km or < 0.5 m) — using ' + modelName(A.model) + '.', 'w');
    log('Path loss ' + modelName(A.model) + ' ' + fx(A.Lsel, 1) + ' dB · RSSI ' + fx(A.Prx, 1) + ' dBm vs ' + (A.op ? 'minimum ' : 'sensitivity ') + fx(v.required, 1) + ' dBm · margin ' + sgn(v.margin, 1) + ' dB', v.margin >= 0 ? 'g' : 'e');
    log('Result: ' + v.text + (v.reason ? ' — ' + v.reason : ''), v.pass ? 'g' : v.marginal ? 'w' : 'e');
  }
  function modelName(m) { return { oplos: 'Line of sight + free space', itm: 'Longley-Rice ITM', p526: 'ITU-R P.526 Deygout', hata: 'Okumura-Hata/COST-231', fspl: 'Free space', los: 'LOS/free space' }[m] || m; }
  var ITMW = { 0x1: 'Tx height near limits', 0x2: 'Rx height near limits', 0x4: 'Frequency near limits (40 MHz–10 GHz)', 0x8: 'Path distance near upper limit', 0x10: 'Path distance large', 0x20: 'Path distance near lower limit', 0x40: 'Path < 1 km', 0x80: 'Tx horizon angle large', 0x100: 'Rx horizon angle large', 0x200: 'Tx horizon < 0.1× smooth earth', 0x400: 'Rx horizon < 0.1× smooth earth', 0x800: 'Tx horizon > 3× smooth earth', 0x1000: 'Rx horizon > 3× smooth earth', 0x2000: 'Extreme variability', 0x4000: 'Low surface refractivity' };
  function itmWarn(w) { var o = []; for (var b in ITMW) if (w & b) o.push(ITMW[b]); return o; }

  /* ---- text report ---- */
  function report(A) {
    var L = [], t = A.tx, r = A.rx, pad = function (s, n) { s = String(s); while (s.length < n) s += ' '; return s; };
    var line = '─'.repeat(78);
    L.push('Signal Monkee ' + VERSION + ' — ' + (A.losOnly ? 'Line-of-Sight Planning (terrain only)' : 'Point-to-Point Path Analysis (SPLAT!-style)'));
    L.push('Generated ' + nowISO() + '   Terrain: ' + (DEM.hgtList().length ? 'SRTM .hgt' : 'AWS Terrain Tiles z' + A.zoom) + ' (~' + fx(A.res, 0) + ' m), profile ' + (A.n + 1) + ' pts @ ' + fx(A.xi, 1) + ' m');
    L.push(line);
    function site(s, z0, h, label, az, el) {
      L.push(label + ' site: ' + s.name);
      L.push('  Site location:          ' + llStr(s.lat, s.lon));
      L.push('  Ground elevation:       ' + hStr(z0, 1) + ' AMSL');
      L.push('  Antenna height:         ' + hStr(h, 1) + ' AGL / ' + hStr(z0 + h, 1) + ' AMSL');
      L.push('  Azimuth to other end:   ' + fx(az, 2) + '° true');
      L.push('  ' + (el >= 0 ? 'Elevation' : 'Depression') + ' angle:        ' + fx(Math.abs(el), 4) + '°');
    }
    function clearance() {
      var rf = !A.losOnly, du = IMP() ? 1852 : 1000, dn = IMP() ? ' NM' : ' km', hu = function (m) { return IMP() ? fx(m / 0.3048, 0) + ' ft' : fx(m, 1) + ' m'; };
      L.push(line);
      L.push('Terrain clearance:');
      L.push('  Line of sight:               ' + (A.los0 ? 'CLEAR — closest terrain ' + hu(A.minClr) + ' below the line' : 'BLOCKED — terrain up to ' + hu(-A.minClr) + ' above the line'));
      if (rf) L.push('  Worst first-Fresnel clearance: ' + fx(A.minRatio * 100, 1) + '% at ' + dStr(A.minRatioI * A.xi));
      if (!A.obs.length) L.push('  No obstructions to LOS path due to terrain were detected.');
      else {
        L.push('  Obstructions (between Tx and Rx), k = ' + fx(A.k, 3) + ':');
        L.push('    ' + pad('Latitude', 12) + pad('Longitude', 13) + pad('Dist from Tx', 16) + pad('Terrain AMSL', 15) + 'Above the line');
        A.obs.slice(0, 60).forEach(function (o) {
          var i = o.peak; L.push('    ' + pad(fx(A.P.lat[i], 5), 12) + pad(fx(A.P.lon[i], 5), 13) + pad(fx(i * A.xi / du, 3) + dn, 16) + pad(hu(A.z[i]), 15) + hu(-A.clr[i]));
        });
        if (A.obs.length > 60) L.push('    … ' + (A.obs.length - 60) + ' more');
      }
      L.push('');
      L.push('Antenna height requirements (other end fixed):');
      L.push('  Tx AGL to clear all obstructions:     ' + hStr(A.req.tx0, 1));
      if (rf) { L.push('  Tx AGL for 60% first Fresnel zone:    ' + hStr(A.req.tx60, 1)); L.push('  Tx AGL for 100% first Fresnel zone:   ' + hStr(A.req.tx100, 1)); }
      L.push('  Rx AGL to clear all obstructions:     ' + hStr(A.req.rx0, 1) + '  (' + hStr(A.rxAltNeed, 0) + ' MSL)');
      if (rf) { L.push('  Rx AGL for 60% first Fresnel zone:    ' + hStr(A.req.rx60, 1)); L.push('  Rx AGL for 100% first Fresnel zone:   ' + hStr(A.req.rx100, 1)); }
      if (!rf) { L.push(line); L.push('Bare-earth terrain only (no buildings or vegetation). No radio parameters are used in line-of-sight planning.'); }
    }
    site(t, A.z[0], A.htx, 'Transmitter', A.az, A.elevAng);
    if (A.hzI) { L.push('  Tx horizon (along path): ' + fx(A.hzA, 4) + '° at ' + dStr(A.hzI * A.xi)); }
    L.push('');
    site(r, A.z[A.n], A.hrx, 'Receiver', A.azR, A.elevAngR);
    L.push(line);
    L.push('Distance:                 ' + dStr(A.D));
    if (!A.losOnly) L.push('Frequency:                ' + fx(S.f, 4) + ' MHz   (λ = ' + fx(A.lam, 4) + ' m)');
    L.push('Effective earth radius:   ' + fx(A.ae / 1000, 0) + ' km  (k = ' + fx(A.k, 3) + ')');
    if (A.losOnly) { clearance(); return L.join('\n'); }   // LOS planning: terrain only, no radio sections
    L.push('');
    L.push('Longley-Rice / ITM parameters:');
    L.push('  Earth dielectric constant:   ' + fx(S.itm.eps, 3));
    L.push('  Earth conductivity:          ' + fx(S.itm.sigma, 4) + ' S/m');
    L.push('  Atmospheric bending (N0):    ' + fx(S.itm.N0, 1) + ' N-units');
    L.push('  Radio climate:               ' + S.itm.climate + ' (' + STATIC.climates[S.itm.climate] + ')');
    L.push('  Polarization:                ' + (S.itm.pol == 1 ? '1 (Vertical)' : '0 (Horizontal)'));
    L.push('  Mode of variability:         ' + S.itm.mdvar + '   Time ' + S.itm.time + '%  Location ' + S.itm.loc + '%  Situation ' + S.itm.sit + '%');
    L.push('');
    L.push('Path loss:');
    L.push('  Free space path loss:        ' + fx(A.Lfs, 2) + ' dB');
    if (A.Litm.itm) {
      L.push('  Longley-Rice (ITM) loss:     ' + fx(A.Litm.L, 2) + ' dB   ITM regime: ' + ITM.MODES[A.Litm.itm.mode]);
      L.push('    Geometric path: ' + (A.minClr >= 0 ? 'clear line of sight' : 'obstructed (see obstruction list)'));
      L.push('    Terrain shielding (ITM-FS): ' + fx(A.Litm.L - A.Lfs, 2) + ' dB   Δh = ' + fx(A.Litm.itm.deltaH, 1) + ' m   Ns = ' + fx(A.Litm.itm.Ns, 1));
      var ww = itmWarn(A.Litm.itm.warn); if (ww.length) L.push('    ITM warnings: ' + ww.join('; '));
    } else L.push('  Longley-Rice (ITM) loss:     n/a (terminal height outside 0.5–3000 m) — used ITU-R P.526');
    L.push('  ITU-R P.526 Deygout loss:    ' + fx(A.Lp526.L, 2) + ' dB   (diffraction ' + fx(A.Lp526.L - A.Lfs, 2) + ' dB)');
    if (A.Lhata) L.push('  Okumura-Hata (' + ['urban', 'suburban', 'open'][S.hataEnv] + '):     ' + fx(A.Lhata.L, 2) + ' dB');
    if (+S.clutterDb) L.push('  Additional clutter loss:     ' + fx(+S.clutterDb, 1) + ' dB');
    L.push('  Model used for budget:       ' + modelName(A.model) + ' → ' + fx(A.Lsel, 2) + ' dB');
    L.push('');
    L.push('Link budget:');
    L.push('  Transmitter power:           ' + fx(S.pwrW, 3) + ' W (' + sgn(txdBm(), 2) + ' dBm)');
    L.push('  Tx feeder loss / gain:       ' + fx(S.txLoss, 1) + ' dB / ' + fx(S.txGain, 2) + ' dBi');
    L.push('  ERP / EIRP:                  ' + fx(dBm2W(erp()), 3) + ' W (' + sgn(erp(), 2) + ' dBm) / ' + fx(dBm2W(eirp()), 3) + ' W (' + sgn(eirp(), 2) + ' dBm)');
    L.push('  Antenna pattern toward Rx:   ' + fx(A.pat, 2) + ' dB (field ' + fx(Math.pow(10, A.pat / 20), 3) + ')');
    L.push('  Field strength at Rx:        ' + fx(A.E, 2) + ' dBµV/m');
    L.push('  Power density at Rx:         ' + fx(A.pd, 2) + ' dBW/m²');
    L.push('  Rx antenna gain / feeder:    ' + fx(S.rxGain, 2) + ' dBi / ' + fx(S.rxLoss, 1) + ' dB');
    L.push('  Received power:              ' + fx(A.Prx, 2) + ' dBm  (' + fx(A.Prx + 107, 2) + ' dBµV across 50 Ω, ' + fx(A.Prx + 108.75, 2) + ' dBµV across 75 Ω)');
    L.push('  Noise floor (' + S.bwKHz + ' kHz, NF ' + S.rxNF + '): ' + fx(A.N, 2) + ' dBm');
    L.push('  SNR:                         ' + fx(A.snr, 2) + ' dB');
    L.push('  Rx sensitivity / margin:     ' + fx(A.sens, 2) + ' dBm / ' + sgn(A.margin, 2) + ' dB  ' + (A.margin >= 0 ? '[LINK OK]' : '[BELOW SENSITIVITY]'));
    clearance();
    L.push(line);
    L.push('Notes: ITM is the NTIA/ITS reference algorithm (validated bit-for-bit in this port). Terrain is bare-earth; add clutter loss');
    L.push('for foliage/buildings. Airport/ATC frequency data: OurAirports (community) — verify against FAA Chart Supplement before use.');
    return L.join('\n');
  }

  /* ---- profile canvas ---- */
  var hoverI = -1;
  /* Profile colours: dark for the on-screen drawer, light for printed PDF reports (less ink, readable in greyscale) */
  var PF_DARK = { bg: '#121518', grid: '#2a3036', gridC: '#3a434c', axis: '#8b96a0', text: '#cfd6dc', terr: ['#8a6d3b', '#3d5a2a'], terrLine: '#c9a66b', earth: '#1d2a36', sea: '#5b86ad', seaTxt: '#7fa6c9',
    frFill: 'rgba(80,200,255,.16)', frLine: 'rgba(80,200,255,.75)', f60: 'rgba(255,209,102,.7)', ok: '#2fe07a', bad: '#ff5a5f', tx: '#ff6b2c', rx: '#53c7f0', obs: '#ff3b3b', worst: '#ffd166' };
  var PF_LIGHT = { bg: '#ffffff', grid: '#e1e5e9', gridC: '#d6dbe0', axis: '#4a535c', text: '#2b3238', frame: '#9aa3ac', terr: ['#e3d3b2', '#c9dbb6'], terrLine: '#7a5a26', earth: '#eef3f8', sea: '#4d7ba6', seaTxt: '#3f6f9a',
    frFill: 'rgba(30,120,200,.10)', frLine: 'rgba(20,100,180,.9)', f60: 'rgba(176,120,0,.95)', ok: '#13873b', bad: '#cc2229', tx: '#d9480f', rx: '#1672ad', obs: '#cc2229', worst: '#b07800' };
  function drawProfile(tgt) {
    var cv = tgt ? tgt.cv : $('profileCv'); if (!tgt && (!cv || !$('drawer').classList.contains('open'))) return;
    var W = tgt ? tgt.W : cv.clientWidth, H = tgt ? tgt.H : cv.clientHeight; if (!W || !H) return;
    var dpr = tgt ? 1 : window.devicePixelRatio || 1; cv.width = W * dpr; cv.height = H * dpr;
    var g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    var C = tgt && tgt.light ? PF_LIGHT : PF_DARK;
    g.fillStyle = C.bg; g.fillRect(0, 0, W, H);
    var A = last;
    if (!A) { g.fillStyle = C.axis; g.font = '13px system-ui'; g.fillText('Place Tx and Rx, then press Path (or P) to compute the terrain profile.', 20, 30); return; }
    var view = A.op ? 'curved' : ($('pfView') || {}).value || 'curved', rel = view === 'fresnel', curved = view !== 'flat', showF = !A.losOnly;   // Fresnel zone drawn whenever there is a frequency (Engineer and Operator)
    var frMax = 0; for (var q = 0; q <= A.n; q++) if (A.fr[q] > frMax) frMax = A.fr[q];
    var n = A.n, ml = 58, mr = 16, mt = 14, mb = 30, pw = W - ml - mr, ph = H - mt - mb;
    var yT = new Float64Array(n + 1), yLos = A.los, ymin = 1e9, ymax = -1e9;
    for (var i = 0; i <= n; i++) {
      yT[i] = A.z[i] + A.bulge[i];
      ymin = Math.min(ymin, A.z[i], A.bulge[i] + Math.min(0, A.z[i])); ymax = Math.max(ymax, yT[i], yLos[i] + (showF ? A.fr[i] : 0));
    }
    ymin = Math.min(ymin, 0);
    var span = ymax - ymin || 1; ymax += span * 0.08; ymin -= span * 0.06;
    if (rel) { // heights relative to the LOS line: LOS = 0, F1 = ±r
      var tmax = -1e9; for (i = 0; i <= n; i++) { yT[i] = A.z[i] + A.bulge[i] - A.los[i]; if (yT[i] > tmax) tmax = yT[i]; }
      ymax = Math.max(frMax * 1.35, tmax + frMax * 0.3, 5); ymin = -Math.max(frMax * 3, 20, Math.min(-tmax, frMax * 3));
    }
    var X = function (i) { return ml + i / n * pw; }, Y = function (v) { return mt + (1 - (v - ymin) / (ymax - ymin)) * ph; };
    // grid
    g.strokeStyle = C.grid; g.lineWidth = 1; g.font = '11px ' + getComputedStyle(document.body).getPropertyValue('--mono'); g.fillStyle = C.axis;
    var hk = IMP() ? 0.3048 : 1, ystep = niceStep((ymax - ymin) / hk / 6) * hk;   // round steps in the display unit (ft or m)
    g.save(); g.beginPath(); g.rect(ml, mt, pw, ph); g.clip();
    var curvedGrid = curved && !rel, v; if (curvedGrid) g.strokeStyle = C.gridC;
    for (v = Math.floor((ymin - (curvedGrid ? A.bulge[Math.round(n / 2)] : 0)) / ystep) * ystep; v <= ymax; v += ystep) {
      g.beginPath();
      if (curvedGrid) { for (var gi = 0; gi <= n; gi += Math.max(1, Math.floor(n / 200))) { var gy = Y(v + A.bulge[gi]); gi ? g.lineTo(X(gi), gy) : g.moveTo(X(gi), gy); } g.lineTo(X(n), Y(v + A.bulge[n])); }
      else { g.moveTo(ml, Y(v)); g.lineTo(W - mr, Y(v)); }
      g.stroke();
    }
    g.restore();
    for (v = Math.ceil(ymin / ystep) * ystep; v <= ymax; v += ystep) g.fillText(S.units.h === 'ft' ? fx(v / 0.3048, 0) : fx(v, 0), 4, Y(v) + 4);
    var du = IMP() ? 1852 : 1000, Dk = A.D / du, xstep = niceStep(Dk / 8);   // distance axis: km, or NM with feet
    for (var dk = 0; dk <= Dk + 1e-9; dk += xstep) { var xx = ml + dk / Dk * pw; g.beginPath(); g.moveTo(xx, mt); g.lineTo(xx, mt + ph); g.stroke(); g.fillText(fx(dk, xstep < 1 ? 1 : 0), xx - 8, H - 12); }
    g.fillText((IMP() ? 'ft' : 'm') + (rel ? ' vs LOS' : ' AMSL'), 4, 10); g.textAlign = 'right'; g.fillText(IMP() ? 'NM' : 'km', W - mr, H - 2); g.textAlign = 'left';
    if (tgt && tgt.light) { g.strokeStyle = C.frame; g.lineWidth = 1; g.strokeRect(ml + .5, mt + .5, pw - 1, ph - 1); }
    // terrain
    var tvals = curved ? yT : A.z;
    if (rel) for (i = 0; i <= n; i++) tvals[i] = Math.max(tvals[i], ymin);
    function seaY(i) { return Y(rel ? ymin : curved ? A.bulge[i] : 0); }
    var grd = g.createLinearGradient(0, mt, 0, mt + ph); grd.addColorStop(0, C.terr[0]); grd.addColorStop(1, C.terr[1]);
    g.fillStyle = grd; g.beginPath(); g.moveTo(X(0), seaY(0));
    for (i = 0; i <= n; i++) g.lineTo(X(i), Y(tvals[i]));
    for (i = n; i >= 0; i--) g.lineTo(X(i), seaY(i));
    g.closePath(); g.fill();
    if (!rel) {
      // earth body below sea level (curved arc in curved view, flat line in flat view)
      g.fillStyle = C.earth; g.beginPath(); g.moveTo(X(0), mt + ph);
      for (i = 0; i <= n; i++) g.lineTo(X(i), Math.min(seaY(i), mt + ph));
      g.lineTo(X(n), mt + ph); g.closePath(); g.fill();
      g.strokeStyle = C.sea; g.lineWidth = 1.4; g.beginPath(); for (i = 0; i <= n; i++) { var yb = seaY(i); i ? g.lineTo(X(i), yb) : g.moveTo(X(i), yb); } g.stroke();
      g.fillStyle = C.seaTxt; g.font = '10px system-ui';
      g.fillText(curved ? 'sea level — elevation grid follows earth curvature (k = ' + fx(A.k, 2) + ', mid-path bulge ' + fx(A.bulge[Math.round(n / 2)], 1) + ' m)' : 'sea level (flat earth; LOS bends to show curvature)', ml + 8, mt + ph - 4);
    }
    g.strokeStyle = C.terrLine; g.lineWidth = 1.2; g.beginPath(); for (i = 0; i <= n; i++) i ? g.lineTo(X(i), Y(tvals[i])) : g.moveTo(X(i), Y(tvals[i])); g.stroke();
    // LOS, Fresnel (curved view: straight; flat view: subtract bulge from LOS)
    function losAt(i, m) { return (rel ? 0 : curved ? A.los[i] : A.los[i] - A.bulge[i]) + m * A.fr[i]; }
    // shaded first Fresnel zone (engineer mode only)
    if (showF) {
    g.fillStyle = C.frFill; g.beginPath();
    for (i = 0; i <= n; i++) { var yu = Y(losAt(i, 1)); i ? g.lineTo(X(i), yu) : g.moveTo(X(i), yu); }
    for (i = n; i >= 0; i--) g.lineTo(X(i), Y(losAt(i, -1)));
    g.closePath(); g.fill();
    g.lineWidth = 1; g.strokeStyle = C.frLine; g.setLineDash([5, 4]);
    [1, -1].forEach(function (s) { g.beginPath(); for (var i = 0; i <= n; i++) { var yv = Y(losAt(i, s)); i ? g.lineTo(X(i), yv) : g.moveTo(X(i), yv); } g.stroke(); });
    g.strokeStyle = C.f60; g.setLineDash([2, 3]);
    g.beginPath(); for (i = 0; i <= n; i++) { var y6 = Y(losAt(i, -0.6)); i ? g.lineTo(X(i), y6) : g.moveTo(X(i), y6); } g.stroke();
    }
    g.setLineDash([]);
    g.strokeStyle = A.minClr >= 0 ? C.ok : C.bad; g.lineWidth = 2;
    g.beginPath(); for (i = 0; i <= n; i++) { var yl = Y(losAt(i, 0)); i ? g.lineTo(X(i), yl) : g.moveTo(X(i), yl); } g.stroke();
    // antennas
    // antennas: short masts for ground stations; an aircraft-style marker (no mast) for receivers at altitude
    function endMark(i, h, col, label) {
      var x = X(i), yTop = Y(losAt(i, 0));
      if (!rel && h <= 300) { g.strokeStyle = col; g.lineWidth = 3; g.beginPath(); g.moveTo(x, Y(tvals[i])); g.lineTo(x, yTop); g.stroke(); }
      g.fillStyle = col; g.beginPath(); g.arc(x, yTop, 4, 0, 7); g.fill();
      g.font = 'bold 10px system-ui'; g.textAlign = i ? 'right' : 'left'; var lt = label + (h > 300 ? ' · ' + hShort(h) + ' AGL' : ''), ly = yTop < mt + 34 ? yTop + 26 : yTop - 7; g.lineWidth = 3; g.strokeStyle = C.bg; g.strokeText(lt, x + (i ? -7 : 7), ly); g.fillText(lt, x + (i ? -7 : 7), ly); g.textAlign = 'left';
    }
    endMark(0, A.htx, C.tx, 'Tx'); endMark(n, A.hrx, C.rx, 'Rx');
    // obstructions
    g.fillStyle = C.obs;
    A.obs.forEach(function (o) { var i = o.peak; g.beginPath(); g.arc(X(i), Y(tvals[i]), 4, 0, 7); g.fill(); });
    // worst fresnel point
    if (showF) { g.strokeStyle = C.worst; g.beginPath(); g.arc(X(A.minRatioI), Y(tvals[A.minRatioI]), 6, 0, 7); g.stroke(); }
    // legend
    g.font = '11px system-ui'; var lx = ml + 8, ly = mt + 14;
    (showF ? [[C.ok, 'LOS (' + (A.minClr >= 0 ? 'clear' : 'obstructed') + ')'], [C.frLine, '1st Fresnel'], [C.worst, '60% F1 / worst point'], [C.obs, 'terrain blocking']] : [[C.ok, 'Line of sight (' + (A.minClr >= 0 ? 'clear' : 'blocked') + ')'], [C.obs, 'terrain blocking']]).forEach(function (it) { g.fillStyle = it[0]; g.fillRect(lx, ly - 8, 12, 3); g.fillStyle = C.text; g.fillText(it[1], lx + 16, ly - 4); lx += g.measureText(it[1]).width + 34; });
    g.fillStyle = C.text; g.textAlign = 'right';
    g.fillText(dU(A.D, 2) + ' · ' + (A.losOnly ? 'k=' + fx(A.k, 2) + ' · terrain line of sight ' + (A.los0 ? 'clear' : 'blocked')
      : fx(S.f, 3) + ' MHz · k=' + fx(A.k, 2) + ' · ' + modelName(A.model) + ' ' + fx(A.Lsel, 1) + ' dB · RSSI ' + fx(A.Prx, 1) + ' dBm (' + (A.op ? 'min ' : 'sens ') + fx(A.sens, 0) + ')'), W - mr - 4, mt + 10);
    g.textAlign = 'left';
    // hover
    if (!tgt && hoverI >= 0 && hoverI <= n) {
      var hx = X(hoverI); g.strokeStyle = '#fff8'; g.lineWidth = 1; g.beginPath(); g.moveTo(hx, mt); g.lineTo(hx, mt + ph); g.stroke();
      var txt = [dU(hoverI * A.xi, 2), 'terrain ' + hShort(A.z[hoverI]), 'clearance ' + hShort(A.clr[hoverI]), A.losOnly ? (A.clr[hoverI] >= 0 ? 'line of sight clear' : 'blocked here') : 'F1 r=' + hShort(A.fr[hoverI]) + ' (' + fx(A.fr[hoverI] > 0 ? A.clr[hoverI] / A.fr[hoverI] * 100 : 0, 0) + '%)', fx(A.P.lat[hoverI], 5) + ', ' + fx(A.P.lon[hoverI], 5)];
      var bx = hx + 10 > W - 170 ? hx - 170 : hx + 10; g.fillStyle = 'rgba(15,17,20,.9)'; g.fillRect(bx, mt + 20, 160, txt.length * 15 + 8);
      g.fillStyle = '#e4e8ec'; txt.forEach(function (t, j) { g.fillText(t, bx + 6, mt + 36 + j * 15); });
    }
    if (!tgt) cv._X = { ml: ml, pw: pw, n: n };
  }
  function niceStep(r) { var p = Math.pow(10, Math.floor(Math.log10(r || 1))), m = r / p; return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p; }
  function initProfileHover() {
    var cv = $('profileCv');
    cv.addEventListener('mousemove', function (e) {
      if (!last || !cv._X) return; var r = cv.getBoundingClientRect(), x = e.clientX - r.left;
      hoverI = Math.round((x - cv._X.ml) / cv._X.pw * cv._X.n); if (hoverI < 0 || hoverI > last.n) hoverI = -1;
      drawProfile();
      if (hoverI >= 0) {
        var ll = [last.P.lat[hoverI], last.P.lon[hoverI]];
        if (!markers.pathHover) markers.pathHover = L.circleMarker(ll, { radius: 6, color: '#fff', weight: 2, fillColor: '#ff3b3b', fillOpacity: 1, interactive: false }).addTo(map);
        else markers.pathHover.setLatLng(ll);
      }
    });
    cv.addEventListener('mouseleave', function () { hoverI = -1; drawProfile(); if (markers.pathHover) { map.removeLayer(markers.pathHover); markers.pathHover = null; } });
    $('pfView').addEventListener('change', function () { drawProfile(); });
    $('dlReport').onclick = function () { if (last) download('signalmonkee_report_' + Date.now() + '.txt', report(last)); };
    $('dlProfile').onclick = function () { $('profileCv').toBlob(function (b) { download('signalmonkee_profile.png', b); }); };
  }

  /* ---- panel ---- */
  function render() {
    if (OPM()) return OPMODE.render();
    var gsel = STATIC.ground.map(function (g, i) { return [i, g[0] + ' (ε' + g[1] + ', σ' + g[2] + ')']; });
    var h = '<div id="engResult">' + (last && !last.op ? OPS.resultCard(last) : '') + '</div>';   // PASS/FAIL at the top, as in Operator mode
    h += acc(ico('pin'), 'Site / Tx',
      F('Name', 'tx.name', { text: 1 }) + F('Latitude', 'tx.lat') + F('Longitude', 'tx.lon') + F('Antenna height', 'tx.h', { u: 'h', title: 'Above ground level' }) +
      '<div class="row"><button class="btn sm" data-ico="pin" onclick="setPick(\'tx\')">Pick on map</button><button class="btn sm" data-ico="zoom" onclick="map.setView([S.tx.lat,S.tx.lon],12)">Zoom to</button><button class="btn sm" data-ico="swap" onclick="RF.swap()">Swap Tx/Rx</button></div>', true);
    h += acc(ico('signal'), 'Signal',
      F('Frequency', 'f', { unit: 'MHz' }) + '<div class="f"><label>Tx power</label><div class="pair"><input data-k="pwrW" type="number" step="any" title="Watts"><input id="pwrDbm" type="number" step="0.1" title="dBm"></div></div>' +
      '<div class="note" style="text-align:right">W ⇄ dBm</div>' + OPS.bwFields());
    h += acc(ico('feeder'), 'Feeder', F('Tx feeder loss', 'txLoss', { unit: 'dB' }) + F('Rx feeder loss', 'rxLoss', { unit: 'dB' }) + '<div class="note">Include cable, connectors, duplexer/combiner losses.</div>');
    h += acc(ico('antenna'), 'Antenna',
      F('Tx gain', 'txGain', { unit: 'dBi' }) + F('Pattern', 'ant.type', { sel: [['omni', 'Omni (optional vertical beam)'], ['dir', 'Directional (parametric)'], ['table', 'SPLAT! .az/.el files']] }) +
      F('Azimuth', 'ant.az', { unit: '°T' }) + F('Downtilt', 'ant.tilt', { unit: '° (+down)' }) + F('H beamwidth', 'ant.hbw', { unit: '°' }) + F('V beamwidth', 'ant.vbw', { unit: '° (0=off)' }) + F('Front/back', 'ant.fb', { unit: 'dB' }) +
      F('Polarization', 'itm.pol', { sel: [[1, 'Vertical'], [0, 'Horizontal']], num: 1 }) +
      '<div class="row"><button class="btn sm" data-ico="open" id="ldAz">Load .az</button><button class="btn sm" data-ico="open" id="ldEl">Load .el</button><span class="mini" id="antInfo">' + (S.ant.azTab ? 'az: ' + S.ant.azTab.length + ' pts ' : '') + (S.ant.elTab ? 'el: ' + S.ant.elTab.length + ' pts' : '') + '</span></div>' +
      '<div class="note">SPLAT! .az: first line = rotation°, then "azimuth field" pairs. .el: first line = "mech-tilt tilt-azimuth", then "elevation(+down) field".</div>');
    h += acc(ico('rx'), 'Mobile / Rx',
      F('Name', 'rx.name', { text: 1 }) + F('Latitude', 'rx.lat') + F('Longitude', 'rx.lon') + F('Height reference', 'rx.mode', { sel: [['agl', 'AGL (ground station)'], ['msl', 'MSL altitude (aircraft)']] }) + F('Height / altitude', 'rx.h', { u: 'h' }) +
      F('Rx gain', 'rxGain', { unit: 'dBi' }) + F('Noise figure', 'rxNF', { unit: 'dB' }) + F('Required SNR', 'reqSNR', { unit: 'dB' }) + F('Sensitivity override', 'sensOverride', { text: 1, unit: 'dBm' }) + F('Required fade margin', 'reqMargin', { unit: 'dB', title: 'Pass/fail threshold' }) +
      '<div class="row"><button class="btn sm" data-ico="pin" onclick="setPick(\'rx\')">Pick on map</button><button class="btn sm" data-ico="zoom" onclick="map.setView([S.rx.lat,S.rx.lon],12)">Zoom to</button></div>');
    h += acc(ico('model'), 'Model',
      F('Propagation model', 'model', { sel: [['itm', 'Longley-Rice ITM (SPLAT! default)'], ['p526', 'ITU-R P.526 Deygout + FSPL'], ['hata', 'Okumura-Hata / COST-231'], ['fspl', 'Free space (no terrain)'], ['los', 'LOS only (SPLAT! -c)']] }) +
      F('Mode of variability', 'itm.mdvar', { sel: [[0, 'Single message'], [1, 'Accidental'], [2, 'Mobile'], [3, 'Broadcast'], [12, 'Mobile, no location var.'], [13, 'Broadcast, no loc. var.']], num: 1 }) +
      F('Time %', 'itm.time') + F('Location %', 'itm.loc') + F('Situation %', 'itm.sit') +
      F('k-factor override', 'kOverride', { text: 1, title: 'Blank = derive from N0 like ITM (≈1.33 at 301 N)' }) +
      F('Hata environment', 'hataEnv', { sel: [[0, 'Urban'], [1, 'Suburban'], [2, 'Open/rural']], num: 1 }));
    h += acc(ico('globe'), 'Environment',
      '<div class="f"><label>Ground preset</label><select id="gndSel">' + gsel.map(function (o) { return '<option value="' + o[0] + '">' + esc(o[1]) + '</option>'; }).join('') + '</select></div>' +
      F('Dielectric ε', 'itm.eps') + F('Conductivity σ', 'itm.sigma', { unit: 'S/m' }) + F('Refractivity N0', 'itm.N0', { unit: 'N-units' }) +
      F('Radio climate', 'itm.climate', { sel: STATIC.climates.map(function (c, i) { return [i, i + ' ' + c]; }).slice(1), num: 1 }) +
      F('Clutter loss', 'clutterDb', { unit: 'dB', title: 'Extra loss for foliage/buildings at the Rx' }));
    h += acc(ico('output'), 'Output (coverage)',
      F('Radius', 'cov.radius', { unit: 'km' }) + F('Rx height ref', 'cov.rxMode', { sel: [['agl', 'AGL (ground)'], ['msl', 'MSL altitude (air)']] }) + F('Rx height', 'cov.rxH', { u: 'h' }) +
      F('Display', 'cov.display', { sel: [['dbm', 'Received power (dBm)'], ['loss', 'Path loss (dB)'], ['field', 'Field strength (dBµV/m)'], ['snr', 'SNR (dB)'], ['margin', 'Fade margin (dB)'], ['los', 'Line of sight']] }) +
      F('Scale top', 'cov.top') + F('Scale bottom', 'cov.bottom') + F('Step', 'cov.step', { unit: 'dB' }) +
      F('Palette', 'cov.palette', { sel: [['rainbow', 'Rainbow (CloudRF-like)'], ['viridis', 'Viridis'], ['turbo', 'Turbo'], ['mono', 'Single colour + alpha']] }) +
      F('Opacity', 'cov.opacity', { step: 0.05 }) + F('Max radial steps', 'cov.maxSteps', { title: 'Samples per radial — higher = finer/slower' }) + F('Radials (0=auto)', 'cov.rays') +
      F('Max terrain tiles', 'cov.maxTiles') + CK('Show values below sensitivity / scale bottom', 'cov.showBelow') +
      '<div class="row"><button class="btn sm" data-ico="clear" onclick="COV.clear()">Clear coverage</button><button class="btn sm" data-ico="layers" onclick="COV.keep()">Keep as layer</button><button class="btn sm" data-ico="download" onclick="COV.exportKMZ()">Coverage KMZ</button><button class="btn sm" data-ico="png" onclick="COV.exportPNG()">PNG</button></div>' +
      '<div id="covLayers"></div>');
    return h;
  }
  function after(root) {
    if (OPM()) { OPMODE.after(root); return; }
    OPS.bindBw(root);
    var pd = $('pwrDbm'); pd.value = fx(txdBm(), 2);
    pd.addEventListener('change', function () { S.pwrW = +dBm2W(+pd.value).toPrecision(6); saveState(); root.querySelector('[data-k="pwrW"]').value = S.pwrW; logBudget(); });
    var gs = $('gndSel'); gs.value = S.itm.ground || 0;
    gs.addEventListener('change', function () { var g = STATIC.ground[+gs.value]; S.itm.ground = +gs.value; S.itm.eps = g[1]; S.itm.sigma = g[2]; saveState(); rerender(); });
    $('ldAz').onclick = function () { loadPattern('az'); };
    $('ldEl').onclick = function () { loadPattern('el'); };
    COV.renderLayerList();
  }
  function loadPattern(kind) {
    pickFiles('.az,.el,.txt').then(function (fs) {
      if (!fs.length) return;
      readText(fs[0]).then(function (t) {
        var lines = t.split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
        var head = lines.shift().split(/\s+/).map(Number), tab = [];
        lines.forEach(function (l) { var p = l.split(/\s+/).map(Number); if (p.length >= 2 && isFinite(p[0]) && isFinite(p[1])) tab.push([p[0], p[1]]); });
        tab.sort(function (a, b) { return a[0] - b[0]; });
        var mx = Math.max.apply(null, tab.map(function (r) { return r[1]; })); if (mx > 0) tab.forEach(function (r) { r[1] /= mx; });
        if (kind === 'az') { S.ant.azTab = tab; S.ant.rot = head[0] || 0; } else { S.ant.elTab = tab; S.ant.mtilt = head[0] || 0; S.ant.mtiltDir = head[1] || 0; }
        S.ant.type = 'table'; saveState(); rerender(); log('Loaded ' + kind + ' pattern: ' + tab.length + ' points from ' + fs[0].name, 'g');
      });
    });
  }
  function swap() { var t = S.tx, r = S.rx; var a = { lat: t.lat, lon: t.lon, name: t.name }; t.lat = r.lat; t.lon = r.lon; t.name = r.name; r.lat = a.lat; r.lon = a.lon; r.name = a.name; saveState(); placeMarkers(); rerender(); if (last) runP2P(); }

  watch('pwrW', function () { var pd = $('pwrDbm'); if (pd) pd.value = fx(txdBm(), 2); logBudget(); });
  ['tx', 'rx'].forEach(function (k) { watch(k + '.', function (key) { if (/\.(lat|lon)$/.test(key)) { S[k].placed = true; saveState(); if (last || COV.cur) OPS.markStale(true); } placeMarkers(); }); });

  function clearLast() { last = null; RF.lastP2P = null; drawProfile(); }
  return { clearLast: clearLast, render: render, after: after, runP2P: runP2P, analyze: analyze, ensureFor: ensureFor, drawProfile: drawProfile, initProfileHover: initProfileHover, report: report,
    rerun: rerun, losEarth: losEarth, txdBm: txdBm, rxBase: rxBase, eirp: eirp, erp: erp, noise: noise, sens: sens, antSpec: antSpec, effEarth: effEarth, itmOpts: itmOpts, logBudget: logBudget, modelName: modelName, swap: swap, lastP2P: null, get last() { return last; } };
})();
