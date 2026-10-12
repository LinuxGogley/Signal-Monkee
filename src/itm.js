/* ITM — Longley-Rice Irregular Terrain Model, point-to-point mode.
 * Faithful JavaScript port of the NTIA/ITS reference implementation (github.com/NTIA/itm, v1.4).
 * pfl format: [np, xi, z0, z1, ... z_np]  (np intervals, np+1 elevations, xi spacing in metres)
 */
var ITM = (function () {
  'use strict';
  var a_0 = 6370e3, a_9000 = 9000e3, THIRD = 1 / 3, SQRT2 = Math.SQRT2, PI = Math.PI;
  function fdim(x, y) { return x > y ? x - y : 0; }
  function MAX(x, y) { return x > y ? x : y; }
  function MIN(x, y) { return x < y ? x : y; }
  // complex helpers  [re, im]
  function cdiv(a, b) { var d = b[0] * b[0] + b[1] * b[1]; return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d]; }
  function csqrt(a) { var r = Math.hypot(a[0], a[1]); var re = Math.sqrt((r + a[0]) / 2); var im = Math.sqrt((r - a[0]) / 2); if (a[1] < 0) im = -im; return [re, im]; }
  function cabs(a) { return Math.hypot(a[0], a[1]); }

  function FreeSpaceLoss(d, f) { return 32.45 + 20 * Math.log10(f) + 20 * Math.log10(d / 1000); }
  function FresnelIntegral(v2) { return v2 < 5.76 ? 6.02 + 9.11 * Math.sqrt(v2) - 1.27 * v2 : 12.953 + 10 * Math.log10(v2); }
  function H0Curve(j, r) { var a = [25, 80, 177, 395, 705], b = [24, 45, 68, 80, 105]; return 10 * Math.log10(1 + a[j] * Math.pow(1 / r, 4) + b[j] * Math.pow(1 / r, 2)); }
  function H0Function(r, eta) { eta = MIN(MAX(eta, 1), 5); var i = Math.floor(eta), q = eta - i; var res = H0Curve(i - 1, r); if (q !== 0) res = (1 - q) * res + q * H0Curve(i, r); return res; }
  function SigmaH(dh) { return 0.78 * dh * Math.exp(-0.5 * Math.pow(dh, 0.25)); }
  function TerrainRoughness(d, dh) { return dh * (1 - 0.8 * Math.exp(-d / 50e3)); }

  function InitializePointToPoint(f, hsys, N0, pol, eps, sig) {
    var gamma_a = 157e-9;
    var Ns = hsys === 0 ? N0 : N0 * Math.exp(-hsys / 9460);
    var gamma_e = gamma_a * (1 - 0.04665 * Math.exp(Ns / 179.3));
    var ep_r = [eps, 18000 * sig / f];
    var Zg = csqrt([ep_r[0] - 1, ep_r[1]]);
    if (pol === 1) Zg = cdiv(Zg, ep_r);
    return { Zg: Zg, gamma_e: gamma_e, Ns: Ns };
  }

  function LinearLeastSquaresFit(pfl, d_start, d_end) {
    var np = Math.trunc(pfl[0]);
    var i_start = Math.trunc(fdim(d_start / pfl[1], 0));
    var i_end = np - Math.trunc(fdim(np, d_end / pfl[1]));
    if (i_end <= i_start) { i_start = Math.trunc(fdim(i_start, 1)); i_end = np - Math.trunc(fdim(np, i_end + 1)); }
    var xl = i_end - i_start;
    var msi = -0.5 * xl;
    var mse = i_end + msi;
    var sy = 0.5 * (pfl[i_start + 2] + pfl[i_end + 2]);
    var ssy = 0.5 * (pfl[i_start + 2] - pfl[i_end + 2]) * msi;
    for (var i = 2; i <= xl; i++) { i_start++; msi++; sy += pfl[i_start + 2]; ssy += pfl[i_start + 2] * msi; }
    sy = sy / xl;
    ssy = ssy * 12 / ((xl * xl + 2) * xl);
    return [sy - ssy * mse, sy + ssy * (np - mse)];
  }

  var S_BUF = new Float64Array(250), D_BUF = new Float64Array(250);
  function selectK(a, n, k) { // k-th smallest (0-based) of a[0..n-1], in-place quickselect
    var lo = 0, hi = n - 1;
    while (hi > lo) {
      var piv = a[(lo + hi) >> 1], i = lo, j = hi;
      while (i <= j) { while (a[i] < piv) i++; while (a[j] > piv) j--; if (i <= j) { var t = a[i]; a[i] = a[j]; a[j] = t; i++; j--; } }
      if (k <= j) hi = j; else if (k >= i) lo = i; else return a[k];
    }
    return a[k];
  }
  function ComputeDeltaH(pfl, d_start, d_end) {
    var np = Math.trunc(pfl[0]);
    var x_start = d_start / pfl[1], x_end = d_end / pfl[1];
    if (x_end - x_start < 2) return 0;
    var p10 = Math.trunc(0.1 * (x_end - x_start + 8));
    p10 = MIN(MAX(4, p10), 25);
    var n = 10 * p10 - 5, p90 = n - p10;
    var nps = n - 1;
    var s = S_BUF; s[0] = nps; s[1] = 1;
    x_end = (x_end - x_start) / nps;
    var i = Math.trunc(x_start);
    x_start -= Math.fround(i + 1.0);
    for (var j = 0; j < n; j++) {
      while (x_start > 0 && (i + 1) < np) { x_start--; i++; }
      s[j + 2] = pfl[i + 3] + (pfl[i + 3] - pfl[i + 2]) * x_start;
      x_start += x_end;
    }
    var fit = LinearLeastSquaresFit(s, 0, nps);
    var y1 = fit[0], y2 = (fit[1] - fit[0]) / nps;
    var diffs = D_BUF;
    for (j = 0; j < n; j++) { diffs[j] = s[j + 2] - y1; y1 += y2; }
    // nth_element (descending): q10 = p10-th largest, q90 = element at descending index p90
    var q10 = selectK(diffs, n, n - p10), q90 = selectK(diffs, n, n - 1 - p90);
    var dhd = q10 - q90;
    return dhd / (1 - 0.8 * Math.exp(-(d_end - d_start) / 50e3));
  }

  function FindHorizons(pfl, ae, h) {
    var np = Math.trunc(pfl[0]), xi = pfl[1], d = pfl[0] * pfl[1];
    var ztx = pfl[2] + h[0], zrx = pfl[np + 2] + h[1];
    var th = [(zrx - ztx) / d - d / (2 * ae), -(zrx - ztx) / d - d / (2 * ae)];
    var dh = [d, d];
    var dtx = 0, drx = d;
    for (var i = 1; i < np; i++) {
      dtx += xi; drx -= xi;
      var t1 = (pfl[i + 2] - ztx) / dtx - dtx / (2 * ae);
      var t2 = -(zrx - pfl[i + 2]) / drx - drx / (2 * ae);
      if (t1 > th[0]) { th[0] = t1; dh[0] = dtx; }
      if (t2 > th[1]) { th[1] = t2; dh[1] = drx; }
    }
    return { theta: th, dhzn: dh };
  }

  function QuickPfl(pfl, gamma_e, h) {
    var d = pfl[0] * pfl[1], np = Math.trunc(pfl[0]), ae = 1 / gamma_e;
    var hz = FindHorizons(pfl, ae, h), th = hz.theta, dh = hz.dhzn, he = [0, 0];
    var ds = MIN(15 * h[0], 0.1 * dh[0]);
    var de = d - MIN(15 * h[1], 0.1 * dh[1]);
    var deltaH = ComputeDeltaH(pfl, ds, de);
    var fit, q, i;
    if (dh[0] + dh[1] > 1.5 * d) {
      fit = LinearLeastSquaresFit(pfl, ds, de);
      he[0] = h[0] + fdim(pfl[2], fit[0]);
      he[1] = h[1] + fdim(pfl[np + 2], fit[1]);
      for (i = 0; i < 2; i++) dh[i] = Math.sqrt(2 * he[i] * ae) * Math.exp(-0.07 * Math.sqrt(deltaH / MAX(he[i], 5)));
      var ch = dh[0] + dh[1];
      if (ch <= d) {
        q = Math.pow(d / ch, 2);
        for (i = 0; i < 2; i++) { he[i] *= q; dh[i] = Math.sqrt(2 * he[i] * ae) * Math.exp(-0.07 * Math.sqrt(deltaH / MAX(he[i], 5))); }
      }
      for (i = 0; i < 2; i++) { q = Math.sqrt(2 * he[i] * ae); th[i] = (0.65 * deltaH * (q / dh[i] - 1) - 2 * he[i]) / q; }
    } else {
      fit = LinearLeastSquaresFit(pfl, ds, 0.9 * dh[0]);
      he[0] = h[0] + fdim(pfl[2], fit[0]);
      fit = LinearLeastSquaresFit(pfl, d - 0.9 * dh[1], de);
      he[1] = h[1] + fdim(pfl[np + 2], fit[1]);
    }
    return { theta: th, dhzn: dh, he: he, deltaH: deltaH, d: d };
  }

  function KnifeEdgeDiffraction(d, f, ae, tlos, dh) {
    var dML = dh[0] + dh[1], tn = d / ae - tlos, dn = d - dML;
    var v1 = 0.0795775 * (f / 47.7) * tn * tn * dh[0] * dn / (dn + dh[0]);
    var v2 = 0.0795775 * (f / 47.7) * tn * tn * dh[1] * dn / (dn + dh[1]);
    return FresnelIntegral(v1) + FresnelIntegral(v2);
  }
  function HeightFunction(x, K) {
    var w, r;
    if (x < 200) {
      w = -Math.log(K);
      if (K < 1e-5 || x * Math.pow(w, 3) > 5495) { r = -117; if (x > 1) r = 17.372 * Math.log(x) + r; }
      else r = 2.5e-5 * x * x / K - 8.686 * w - 15;
    } else {
      r = 0.05751 * x - 4.343 * Math.log(x);
      if (x < 2000) { w = 0.0134 * x * Math.exp(-0.005 * x); r = (1 - w) * r + w * (17.372 * Math.log(x) - 117); }
    }
    return r;
  }
  function SmoothEarthDiffraction(d, f, ae, tlos, dh, he, Zg) {
    var tn = d / ae - tlos, dML = dh[0] + dh[1];
    var a = [(d - dML) / (d / ae - tlos), 0.5 * dh[0] * dh[0] / he[0], 0.5 * dh[1] * dh[1] / he[1]];
    var dk = [a[0] * tn / 1000, dh[0] / 1000, dh[1] / 1000];
    var C0 = [], K = [], B0 = [], x = [], az = cabs(Zg);
    for (var i = 0; i < 3; i++) { C0[i] = Math.pow((4 / 3) * a_0 / a[i], THIRD); K[i] = 0.017778 * C0[i] * Math.pow(f, -THIRD) / az; B0[i] = 1.607 - K[i]; }
    x[1] = B0[1] * C0[1] * C0[1] * Math.pow(f, THIRD) * dk[1];
    x[2] = B0[2] * C0[2] * C0[2] * Math.pow(f, THIRD) * dk[2];
    x[0] = B0[0] * C0[0] * C0[0] * Math.pow(f, THIRD) * dk[0] + x[1] + x[2];
    var F1 = HeightFunction(x[1], K[1]), F2 = HeightFunction(x[2], K[2]);
    var G = 0.05751 * x[0] - 10 * Math.log10(x[0]);
    return G - F1 - F2 - 20;
  }
  function DiffractionLoss(d, dh, he, Zg, ae, deltaH, h, mode, tlos, dsML, f) {
    var Ak = KnifeEdgeDiffraction(d, f, ae, tlos, dh);
    var Ase = SmoothEarthDiffraction(d, f, ae, tlos, dh, he, Zg);
    var sh = SigmaH(TerrainRoughness(dsML, deltaH));
    var Afo = MIN(15, 5 * Math.log10(1 + 1e-5 * h[0] * h[1] * f * sh));
    var dhd = TerrainRoughness(d, deltaH);
    var q = h[0] * h[1], qk = he[0] * he[1] - q;
    if (mode === 0) q += 10;
    var term1 = Math.sqrt(1 + qk / q), dML = dh[0] + dh[1];
    q = (term1 + (-tlos * ae + dML) / d) * MIN(dhd * f / 47.7, 6283.2);
    var w = 25.1 / (25.1 + Math.sqrt(q));
    return w * Ase + (1 - w) * Ak + Afo;
  }
  function LineOfSightLoss(d, he, Zg, deltaH, Md, Ad0, dsML, f) {
    var sh = SigmaH(TerrainRoughness(d, deltaH)), wn = f / 47.7;
    var sp = (he[0] + he[1]) / Math.sqrt(d * d + Math.pow(he[0] + he[1], 2));
    var Re = cdiv([sp - Zg[0], -Zg[1]], [sp + Zg[0], Zg[1]]);
    var ex = Math.exp(-MIN(10, wn * sh * sp)); Re = [Re[0] * ex, Re[1] * ex];
    var q = Re[0] * Re[0] + Re[1] * Re[1];
    if (q < 0.25 || q < sp) { var s = Math.sqrt(sp / q); Re = [Re[0] * s, Re[1] * s]; }
    var dphi = wn * 2 * he[0] * he[1] / d;
    if (dphi > PI / 2) dphi = PI - Math.pow(PI / 2, 2) / dphi;
    var rr = [Math.cos(dphi) + Re[0], -Math.sin(dphi) + Re[1]];
    var At = -10 * Math.log10(rr[0] * rr[0] + rr[1] * rr[1]);
    var Ad = Md * d + Ad0;
    var w = 1 / (1 + f * deltaH / MAX(10e3, dsML));
    return w * At + (1 - w) * Ad;
  }
  function FFunction(td) {
    var a = [133.4, 104.6, 71.8], b = [0.332e-3, 0.212e-3, 0.157e-3], c = [-10, -2.5, 5];
    var i = td <= 10e3 ? 0 : (td <= 70e3 ? 1 : 2);
    return a[i] + b[i] * td + c[i] * Math.log10(td);
  }
  function TroposcatterLoss(d, th, dh, he, ae, Ns, f, tlos, h0ref) {
    var H0, wn = f / 47.7;
    if (h0ref.v > 15) H0 = h0ref.v;
    else {
      var ad = dh[0] - dh[1], rr = he[1] / he[0];
      if (ad < 0) { ad = -ad; rr = 1 / rr; }
      var theta = th[0] + th[1] + d / ae;
      var r1 = 2 * wn * theta * he[0], r2 = 2 * wn * theta * he[1];
      if (r1 < 0.2 && r2 < 0.2) return 1001;
      var s = (d - ad) / (d + ad);
      var q = MIN(MAX(0.1, rr / s), 10);
      s = MAX(0.1, s);
      var h0m = (d - ad) * (d + ad) * theta * 0.25 / d;
      var eta = (h0m / 1.7556e3) * (1 + (0.031 - Ns * 2.32e-3 + Ns * Ns * 5.67e-6) * Math.exp(-Math.pow(MIN(1.7, h0m / 8e3), 6)));
      var H00 = (H0Function(r1, eta) + H0Function(r2, eta)) / 2;
      var DH0 = MIN(H00, 6 * (0.6 - Math.log10(MAX(eta, 1))) * Math.log10(s) * Math.log10(q));
      H0 = MAX(H00 + DH0, 0);
      if (eta < 1) H0 = eta * H0 + (1 - eta) * 10 * Math.log10(Math.pow((1 + SQRT2 / r1) * (1 + SQRT2 / r2), 2) * (r1 + r2) / (r1 + r2 + 2 * SQRT2));
      if (H0 > 15 && h0ref.v >= 0) H0 = h0ref.v;
    }
    h0ref.v = H0;
    var t = d / ae - tlos;
    return FFunction(t * d) + 10 * Math.log10(wn * 47.7 * Math.pow(t, 4)) - 0.1 * (Ns - 301) * Math.exp(-t * d / 40e3) + H0;
  }

  function LongleyRice(th, f, Zg, dh, he, gamma_e, Ns, deltaH, h, d, mode) {
    var ae = 1 / gamma_e, warn = 0;
    var dhs = [Math.sqrt(2 * he[0] * ae), Math.sqrt(2 * he[1] * ae)];
    var dsML = dhs[0] + dhs[1], dML = dh[0] + dh[1];
    var tlos = -MAX(th[0] + th[1], -dML / ae);
    if (Math.abs(th[0]) > 0.2) warn |= 0x80;
    if (Math.abs(th[1]) > 0.2) warn |= 0x100;
    if (dh[0] < 0.1 * dhs[0]) warn |= 0x200;
    if (dh[1] < 0.1 * dhs[1]) warn |= 0x400;
    if (dh[0] > 3 * dhs[0]) warn |= 0x800;
    if (dh[1] > 3 * dhs[1]) warn |= 0x1000;
    if (Ns < 150) return { err: 1021 };
    if (Ns > 400) return { err: 1022 };
    if (Ns < 250) warn |= 0x4000;
    if (ae < 4000000 || ae > 13333333) return { err: 1016 };
    if (Zg[0] <= Math.abs(Zg[1])) return { err: 1013 };
    var k3 = Math.pow(ae * ae / f, THIRD);
    var d3 = MAX(dsML, dML + 5 * k3), d4 = d3 + 10 * k3;
    var A3 = DiffractionLoss(d3, dh, he, Zg, ae, deltaH, h, mode, tlos, dsML, f);
    var A4 = DiffractionLoss(d4, dh, he, Zg, ae, deltaH, h, mode, tlos, dsML, f);
    var Md = (A4 - A3) / (d4 - d3), Ad0 = A3 - Md * d3;
    var dmin = Math.abs(he[0] - he[1]) / 0.2;
    if (d < dmin) warn |= 0x20;
    if (d < 1e3) warn |= 0x40;
    if (d > 1000e3) warn |= 0x8;
    if (d > 2000e3) warn |= 0x10;
    var Aref, pm;
    if (d < dsML) {
      var AsML = dsML * Md + Ad0;
      var d0 = 0.04 * f * he[0] * he[1], d1;
      if (Ad0 >= 0) { d0 = MIN(d0, 0.5 * dML); d1 = d0 + 0.25 * (dML - d0); }
      else d1 = MAX(-Ad0 / Md, 0.25 * dML);
      var A1 = LineOfSightLoss(d1, he, Zg, deltaH, Md, Ad0, dsML, f);
      var flag = false, k1 = 0, k2 = 0;
      if (d0 < d1) {
        var A0 = LineOfSightLoss(d0, he, Zg, deltaH, Md, Ad0, dsML, f);
        var q = Math.log(dsML / d0);
        k2 = MAX(0, ((dsML - d0) * (A1 - A0) - (d1 - d0) * (AsML - A0)) / ((dsML - d0) * Math.log(d1 / d0) - (d1 - d0) * q));
        flag = Ad0 > 0 || k2 > 0;
        if (flag) {
          k1 = (AsML - A0 - k2 * q) / (dsML - d0);
          if (k1 < 0) { k1 = 0; k2 = fdim(AsML, A0) / q; if (k2 === 0) k1 = Md; }
        }
      }
      if (!flag) { k1 = fdim(AsML, A1) / (dsML - d1); k2 = 0; if (k1 === 0) k1 = Md; }
      var Ao = AsML - k1 * dsML - k2 * Math.log(dsML);
      Aref = Ao + k1 * d + k2 * Math.log(d);
      pm = 1;
    } else {
      var d5 = dML + 200e3, d6 = dML + 400e3, h0 = { v: -1 };
      var A6 = TroposcatterLoss(d6, th, dh, he, ae, Ns, f, tlos, h0);
      var A5 = TroposcatterLoss(d5, th, dh, he, ae, Ns, f, tlos, h0);
      var Ms, As0, dx;
      if (A5 < 1000) {
        Ms = (A6 - A5) / 200e3;
        dx = MAX(MAX(dsML, dML + 1.088 * k3 * Math.log(f)), (A5 - Ad0 - Ms * d5) / (Md - Ms));
        As0 = (Md - Ms) * dx + Ad0;
      } else { Ms = Md; As0 = Ad0; dx = 10e6; }
      if (d > dx) { Aref = Ms * d + As0; pm = 3; } else { Aref = Md * d + Ad0; pm = 2; }
    }
    return { err: 0, Aref: MAX(Aref, 0), mode: pm, warn: warn };
  }

  function ICCDF(q) {
    var x = q > 0.5 ? 1 - q : q;
    var T = Math.sqrt(-2 * Math.log(x));
    var z = ((0.010328 * T + 0.802853) * T + 2.515516) / (((0.001308 * T + 0.189269) * T + 1.432788) * T + 1);
    var Q = T - z; return q > 0.5 ? -Q : Q;
  }
  function Curve(c1, c2, x1, x2, x3, de) { return (c1 + c2 / (1 + Math.pow((de - x2) / x3, 2))) * Math.pow(de / x1, 2) / (1 + Math.pow(de / x1, 2)); }
  var VT = {
    ay: [[-9.67, -0.62, 1.26, -9.21, -0.62, -0.39, 3.15], [12.7, 9.19, 15.5, 9.05, 9.19, 2.86, 857.9], [144.9e3, 228.9e3, 262.6e3, 84.1e3, 228.9e3, 141.7e3, 2222e3], [190.3e3, 205.2e3, 185.2e3, 101.1e3, 205.2e3, 315.9e3, 164.8e3], [133.8e3, 143.6e3, 99.8e3, 98.6e3, 143.6e3, 167.4e3, 116.3e3]],
    bsm1: [2.13, 2.66, 6.11, 1.98, 2.68, 6.86, 8.51], bsm2: [159.5, 7.67, 6.65, 13.11, 7.16, 10.38, 169.8],
    xsm1: [762.2e3, 100.4e3, 138.2e3, 139.1e3, 93.7e3, 187.8e3, 609.8e3], xsm2: [123.6e3, 172.5e3, 242.2e3, 132.7e3, 186.8e3, 169.6e3, 119.9e3], xsm3: [94.5e3, 136.4e3, 178.6e3, 193.5e3, 133.5e3, 108.9e3, 106.6e3],
    bsp1: [2.11, 6.87, 10.08, 3.68, 4.75, 8.58, 8.43], bsp2: [102.3, 15.53, 9.60, 159.3, 8.12, 13.97, 8.19],
    xsp1: [636.9e3, 138.7e3, 165.3e3, 464.4e3, 93.2e3, 216.0e3, 136.2e3], xsp2: [134.8e3, 143.7e3, 225.7e3, 93.1e3, 135.9e3, 152.0e3, 188.5e3], xsp3: [95.6e3, 98.6e3, 129.7e3, 94.2e3, 113.4e3, 122.7e3, 122.9e3],
    CD: [1.224, 0.801, 1.380, 1.000, 1.224, 1.518, 1.518], zD: [1.282, 2.161, 1.282, 20.0, 1.282, 1.282, 1.282],
    bfm1: [1, 1, 1, 1, 0.92, 1, 1], bfm2: [0, 0, 0, 0, 0.25, 0, 0], bfm3: [0, 0, 0, 0, 1.77, 0, 0],
    bfp1: [1, 0.93, 1, 0.93, 0.93, 1, 1], bfp2: [0, 0.31, 0, 0.19, 0.31, 0, 0], bfp3: [0, 2.00, 0, 1.79, 2.00, 0, 0]
  };
  function Variability(time, loc, sit, he, deltaH, f, d, Aref, climate, mdvar) {
    var warn = 0;
    var zT = ICCDF(time / 100), zL = ICCDF(loc / 100), zS = ICCDF(sit / 100);
    var c = climate - 1, wn = f / 47.7;
    var dex = Math.sqrt(2 * a_9000 * he[0]) + Math.sqrt(2 * a_9000 * he[1]) + Math.pow(575.7e12 / wn, THIRD);
    var de = d < dex ? 130e3 * d / dex : 130e3 + d - dex;
    var mv = mdvar, plus20 = mv >= 20; if (plus20) mv -= 20;
    var sS = plus20 ? 0 : 5 + 3 * Math.exp(-de / 100e3);
    var plus10 = mv >= 10; if (plus10) mv -= 10;
    var Vmed = Curve(VT.ay[0][c], VT.ay[1][c], VT.ay[2][c], VT.ay[3][c], VT.ay[4][c], de);
    if (mv === 0) { zT = zS; zL = zS; } else if (mv === 1) zL = zS; else if (mv === 2) zL = zT;
    if (Math.abs(zT) > 3.1 || Math.abs(zL) > 3.1 || Math.abs(zS) > 3.1) warn |= 0x2000;
    var sL = 0;
    if (!plus10) { var dhd = TerrainRoughness(d, deltaH); sL = 10 * wn * dhd / (wn * dhd + 13); }
    var YL = sL * zL, q = Math.log(0.133 * wn);
    var gm = VT.bfm1[c] + VT.bfm2[c] / (Math.pow(VT.bfm3[c] * q, 2) + 1);
    var gp = VT.bfp1[c] + VT.bfp2[c] / (Math.pow(VT.bfp3[c] * q, 2) + 1);
    var sTm = Curve(VT.bsm1[c], VT.bsm2[c], VT.xsm1[c], VT.xsm2[c], VT.xsm3[c], de) * gm;
    var sTp = Curve(VT.bsp1[c], VT.bsp2[c], VT.xsp1[c], VT.xsp2[c], VT.xsp3[c], de) * gp;
    var sTD = VT.CD[c] * sTp, tgtd = (sTp - sTD) * VT.zD[c], sT;
    if (zT < 0) sT = sTm; else if (zT <= VT.zD[c]) sT = sTp; else sT = sTD + tgtd / zT;
    var YT = sT * zT;
    var YSt = sS * sS + YT * YT / (7.8 + zS * zS) + YL * YL / (24 + zS * zS);
    var YR, YS;
    if (mv === 0) { YR = 0; YS = Math.sqrt(sT * sT + sL * sL + YSt) * zS; }
    else if (mv === 1) { YR = YT; YS = Math.sqrt(sL * sL + YSt) * zS; }
    else if (mv === 2) { YR = Math.sqrt(sT * sT + sL * sL) * zT; YS = Math.sqrt(YSt) * zS; }
    else { YR = YT + YL; YS = Math.sqrt(YSt) * zS; }
    var r = Aref - Vmed - YR - YS;
    if (r < 0) r = r * (29 - r) / (29 - 10 * r);
    return { v: r, warn: warn };
  }

  /* opts: {htx, hrx, climate(1-7), N0, f, pol(0 H / 1 V), eps, sigma, mdvar, time, loc, sit} */
  function p2p(pfl, o) {
    var warn = 0;
    if (o.htx < 1 || o.htx > 1000) warn |= 0x1;
    if (o.htx < 0.5 || o.htx > 3000) return { err: 1000 };
    if (o.hrx < 1 || o.hrx > 1000) warn |= 0x2;
    if (o.hrx < 0.5 || o.hrx > 3000) return { err: 1001 };
    if (o.N0 < 250 || o.N0 > 400) return { err: 1008 };
    if (o.f < 40 || o.f > 10000) warn |= 0x4;
    if (o.f < 20 || o.f > 20000) return { err: 1009 };
    var np = Math.trunc(pfl[0]), p10 = Math.trunc(0.1 * np), hsys = 0;
    for (var i = p10; i <= np - p10; i++) hsys += pfl[i + 2];
    hsys /= (np - 2 * p10 + 1);
    var ip = InitializePointToPoint(o.f, hsys, o.N0, o.pol, o.eps, o.sigma);
    var h = [o.htx, o.hrx];
    var qp = QuickPfl(pfl, ip.gamma_e, h);
    var lr = LongleyRice(qp.theta, o.f, ip.Zg, qp.dhzn, qp.he, ip.gamma_e, ip.Ns, qp.deltaH, h, qp.d, 0);
    if (lr.err) return { err: lr.err };
    var Afs = FreeSpaceLoss(qp.d, o.f);
    var v = Variability(o.time, o.loc, o.sit, qp.he, qp.deltaH, o.f, qp.d, lr.Aref, o.climate, o.mdvar);
    return { err: 0, A: v.v + Afs, Afs: Afs, Aref: lr.Aref, mode: lr.mode, warn: warn | lr.warn | v.warn,
      deltaH: qp.deltaH, he: qp.he, dhzn: qp.dhzn, theta: qp.theta, Ns: ip.Ns, d: qp.d };
  }
  return { p2p: p2p, FreeSpaceLoss: FreeSpaceLoss, ICCDF: ICCDF, MODES: ['', 'Line-of-Sight', 'Diffraction', 'Troposcatter'] };
})();
if (typeof module !== 'undefined') module.exports = ITM;
