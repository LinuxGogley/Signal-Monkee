/* Propagation core shared by main thread and coverage workers: geodesy, diffraction, empirical models, antenna patterns. */
var PC = (function () {
  'use strict';
  var R_E = 6371008.8, D2R = Math.PI / 180, R2D = 180 / Math.PI;

  function dist(lat1, lon1, lat2, lon2) { // haversine, metres
    var p1 = lat1 * D2R, p2 = lat2 * D2R, dp = p2 - p1, dl = (lon2 - lon1) * D2R;
    var a = Math.sin(dp / 2) * Math.sin(dp / 2) + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
    return 2 * R_E * Math.asin(Math.min(1, Math.sqrt(a)));
  }
  function bearing(lat1, lon1, lat2, lon2) {
    var p1 = lat1 * D2R, p2 = lat2 * D2R, dl = (lon2 - lon1) * D2R;
    var y = Math.sin(dl) * Math.cos(p2), x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
    return (Math.atan2(y, x) * R2D + 360) % 360;
  }
  function dest(lat, lon, brg, d) {
    var p1 = lat * D2R, l1 = lon * D2R, t = brg * D2R, dr = d / R_E;
    var p2 = Math.asin(Math.sin(p1) * Math.cos(dr) + Math.cos(p1) * Math.sin(dr) * Math.cos(t));
    var l2 = l1 + Math.atan2(Math.sin(t) * Math.sin(dr) * Math.cos(p1), Math.cos(dr) - Math.sin(p1) * Math.sin(p2));
    return [p2 * R2D, ((l2 * R2D + 540) % 360) - 180];
  }
  function interp(lat1, lon1, lat2, lon2, f) { // great-circle intermediate point
    var p1 = lat1 * D2R, l1 = lon1 * D2R, p2 = lat2 * D2R, l2 = lon2 * D2R;
    var d = dist(lat1, lon1, lat2, lon2) / R_E;
    if (d < 1e-12) return [lat1, lon1];
    var A = Math.sin((1 - f) * d) / Math.sin(d), B = Math.sin(f * d) / Math.sin(d);
    var x = A * Math.cos(p1) * Math.cos(l1) + B * Math.cos(p2) * Math.cos(l2);
    var y = A * Math.cos(p1) * Math.sin(l1) + B * Math.cos(p2) * Math.sin(l2);
    var z = A * Math.sin(p1) + B * Math.sin(p2);
    return [Math.atan2(z, Math.sqrt(x * x + y * y)) * R2D, Math.atan2(y, x) * R2D];
  }
  function fspl(dm, fMHz) { return 32.45 + 20 * Math.log10(fMHz) + 20 * Math.log10(Math.max(dm, 1) / 1000); }

  // Knife-edge loss J(v), ITU-R P.526-15 eq.31
  function J(v) { return v <= -0.78 ? 0 : 6.9 + 20 * Math.log10(Math.sqrt((v - 0.1) * (v - 0.1) + 1) + v - 0.1); }

  /* Deygout multiple knife-edge (ITU-R P.526 §4.5.3 style, up to 3 edges) over profile z[0..n] with spacing xi.
     h1, h2: absolute antenna heights (m AMSL) at ends; ae: effective earth radius. */
  function deygout(z, n, xi, h1, h2, lambda, ae, i0, i1, depth) {
    if (i1 - i0 < 2) return 0;
    var D = (i1 - i0) * xi, best = -1e9, bi = -1;
    for (var i = i0 + 1; i < i1; i++) {
      var d1 = (i - i0) * xi, d2 = D - d1;
      var bulge = d1 * d2 / (2 * ae);
      var los = h1 + (h2 - h1) * d1 / D;
      var hh = z[i] + bulge - los;
      var v = hh * Math.sqrt(2 * D / (lambda * d1 * d2));
      if (v > best) { best = v; bi = i; }
    }
    if (best <= -0.78 || bi < 0) return 0;
    var L = J(best);
    if (depth < 2) {
      var hb = z[bi] + 0; // edge height (curvature handled relative to sub-path chords)
      var hbAbs = hb;
      L += deygout(z, n, xi, h1, hbAbs, lambda, ae, i0, bi, depth + 1);
      L += deygout(z, n, xi, hbAbs, h2, lambda, ae, bi, i1, depth + 1);
    }
    return L;
  }

  // Okumura-Hata (150-1500 MHz) / COST-231 Hata (1500-2000 MHz). env: 0 urban, 1 suburban, 2 open
  function hata(dm, f, hb, hm, env) {
    var dk = Math.max(dm / 1000, 0.05); hb = Math.max(hb, 1); hm = Math.max(hm, 1);
    var ahm = (1.1 * Math.log10(f) - 0.7) * hm - (1.56 * Math.log10(f) - 0.8);
    var L;
    if (f <= 1500) L = 69.55 + 26.16 * Math.log10(f) - 13.82 * Math.log10(hb) - ahm + (44.9 - 6.55 * Math.log10(hb)) * Math.log10(dk);
    else L = 46.3 + 33.9 * Math.log10(f) - 13.82 * Math.log10(hb) - ahm + (44.9 - 6.55 * Math.log10(hb)) * Math.log10(dk) + (env === 0 ? 3 : 0);
    if (env === 1) L -= 2 * Math.pow(Math.log10(f / 28), 2) + 5.4;
    if (env === 2) L -= 4.78 * Math.pow(Math.log10(f), 2) - 18.33 * Math.log10(f) + 40.94;
    return Math.max(L, fspl(dm, f));
  }

  /* Geometric LOS test over profile, returns min clearance (m) relative to LOS line (negative = obstructed). */
  function losClear(z, n, xi, h1, h2, ae) {
    var D = n * xi, m = 1e9;
    for (var i = 1; i < n; i++) {
      var d1 = i * xi, d2 = D - d1;
      var c = h1 + (h2 - h1) * d1 / D - (z[i] + d1 * d2 / (2 * ae));
      if (c < m) m = c;
    }
    return m;
  }

  /* Antenna pattern. spec: {type:'omni'|'dir'|'table', gain, az, tilt, hbw, vbw, fb, sla, azTab:[[deg,field]...], elTab:[[deg,field]...], rot, mtilt, mtiltDir}
     Returns attenuation in dB (<=0) toward (azimuth deg true, elevation deg, + up). */
  function patternLoss(sp, az, el) {
    if (!sp || sp.type === 'iso') return 0;
    var a = 0;
    if (sp.type === 'table') {
      var fa = 1, fe = 1;
      if (sp.azTab && sp.azTab.length) fa = tabInterp(sp.azTab, ((az - (sp.rot || 0)) % 360 + 360) % 360, 360);
      if (sp.elTab && sp.elTab.length) {
        // SPLAT .el: angle positive = below horizon (downtilt). Apply mechanical tilt toward mtiltDir.
        var dep = -el;
        if (sp.mtilt) dep -= sp.mtilt * Math.cos(((az - (sp.mtiltDir || 0)) * D2R));
        fe = tabInterp(sp.elTab, dep, 0);
      }
      var f = Math.max(fa * fe, 1e-6);
      return 20 * Math.log10(f);
    }
    var vb = sp.vbw || 0, ah = 0, av = 0;
    if (sp.type === 'dir') {
      var dphi = ((az - (sp.az || 0)) % 360 + 540) % 360 - 180;
      ah = Math.min(12 * Math.pow(dphi / Math.max(sp.hbw || 65, 1), 2), sp.fb || 25);
    }
    if (vb > 0) {
      var dth = el + (sp.tilt || 0); // tilt positive = down
      av = Math.min(12 * Math.pow(dth / vb, 2), sp.sla || 20);
    }
    a = Math.min(ah + av, Math.max(sp.fb || 25, sp.sla || 20));
    return -a;
  }
  function tabInterp(tab, x, wrap) {
    // tab sorted by angle; wrap=360 for azimuth tables
    var n = tab.length;
    if (n === 1) return tab[0][1];
    if (wrap) {
      for (var i = 0; i < n; i++) {
        var a0 = tab[i], a1 = tab[(i + 1) % n], x0 = a0[0], x1 = a1[0] + (i + 1 === n ? 360 : 0);
        var xx = x < x0 && i === n - 1 ? x + 360 : x;
        if (xx >= x0 && xx <= x1) return a0[1] + (a1[1] - a0[1]) * (xx - x0) / Math.max(x1 - x0, 1e-9);
      }
      return tab[0][1];
    }
    if (x <= tab[0][0]) return tab[0][1];
    if (x >= tab[n - 1][0]) return tab[n - 1][1];
    for (var j = 0; j < n - 1; j++) if (x >= tab[j][0] && x <= tab[j + 1][0]) return tab[j][1] + (tab[j + 1][1] - tab[j][1]) * (x - tab[j][0]) / Math.max(tab[j + 1][0] - tab[j][0], 1e-9);
    return 1;
  }

  /* Compute basic transmission loss for a profile z[0..n] (spacing xi) with model options.
     o: {model:'itm'|'p526'|'fspl'|'hata'|'los', f, htx, hrx (AGL), itm{...}, ae, hataEnv}
     Returns {L, mode, clr} where clr = LOS clearance (m) */
  /* pfl: Float64Array laid out ITM-style: [*, *, z0, z1, ...]. Only the first n+1 elevations are used (prefix paths for radials). */
  function pathLoss(pfl, n, xi, o) {
    var D = n * xi, z = pfl.subarray(2);
    if (n < 1 || D < 1) return { L: fspl(Math.max(D, 1), o.f), mode: 1, clr: 1 };
    var h1 = z[0] + o.htx, h2 = z[n] + o.hrx;
    var model = o.model;
    var clr = o.fast && model === 'itm' ? 0 : losClear(z, n, xi, h1, h2, o.ae);
    if (model === 'itm' && (o.hrx > 3000 || o.htx > 3000 || o.hrx < 0.5 || o.htx < 0.5 || n < 3)) model = 'p526';
    if (model === 'itm') {
      pfl[0] = n; pfl[1] = xi;
      var r = ITM.p2p(pfl, { htx: o.htx, hrx: o.hrx, climate: o.itm.climate, N0: o.itm.N0, f: o.f, pol: o.itm.pol, eps: o.itm.eps, sigma: o.itm.sigma, mdvar: o.itm.mdvar, time: o.itm.time, loc: o.itm.loc, sit: o.itm.sit });
      if (!r.err && isFinite(r.A)) return { L: r.A, mode: r.mode, clr: clr, itm: r };
      model = 'p526';
    }
    if (model === 'p526') {
      var lam = 299.792458 / o.f;
      var Ld = deygout(z, n, xi, h1, h2, lam, o.ae, 0, n, 0);
      return { L: fspl(D, o.f) + Ld, mode: clr >= 0 ? 1 : 2, clr: clr };
    }
    if (model === 'hata') return { L: hata(D, o.f, o.htx + Math.max(0, z[0] - avg(z, n)), o.hrx, o.hataEnv === undefined ? 1 : o.hataEnv), mode: clr >= 0 ? 1 : 2, clr: clr };
    if (model === 'los') return { L: clr >= 0 ? fspl(D, o.f) : 999, mode: clr >= 0 ? 1 : 0, clr: clr };
    return { L: fspl(D, o.f), mode: clr >= 0 ? 1 : 2, clr: clr };
  }
  function avg(z, n) { var s = 0; for (var i = 0; i <= n; i++) s += z[i]; return s / (n + 1); }

  return { R_E: R_E, D2R: D2R, R2D: R2D, dist: dist, bearing: bearing, dest: dest, interp: interp, fspl: fspl, J: J, deygout: deygout, hata: hata, losClear: losClear, patternLoss: patternLoss, pathLoss: pathLoss };
})();
if (typeof module !== 'undefined') module.exports = PC;
