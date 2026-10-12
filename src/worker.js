/* Coverage worker: receives polar elevation radials and computes path loss per radial sample (SPLAT!-style radial sweep). */
self.onmessage = function (ev) {
  var m = ev.data;
  if (m.cmd !== 'radials') return;
  var o = m.opts, L = m.steps, xi = m.xi, nr = m.r1 - m.r0;
  var elev = new Float32Array(m.elev); // nr*(L+1)
  var loss = new Float32Array(nr * (L + 1));
  var elAng = new Float32Array(nr * (L + 1));
  var los = new Uint8Array(nr * (L + 1));
  var pfl = new Float64Array(L + 3);
  var rxAlt = o.rxMode === 'msl', hrxIn = o.hrx, oo = Object.assign({ fast: true }, o);
  var t0 = Date.now(), lastPost = t0;
  for (var r = 0; r < nr; r++) {
    var base = r * (L + 1);
    for (var i = 0; i <= L; i++) pfl[i + 2] = elev[base + i];
    var h1 = pfl[2] + o.htx;
    loss[base] = 0; elAng[base] = 90; los[base] = 1;
    var maxAng = -1e9; // running horizon angle (for fast LOS)
    for (var k = 1; k <= L; k++) {
      var zk = pfl[k + 2], d = k * xi;
      var hrx = rxAlt ? Math.max(hrxIn - zk, 0.5) : hrxIn;
      oo.hrx = hrx;
      // elevation angle from Tx antenna to Rx point (with effective earth curvature)
      var ang = Math.atan2(zk + hrx - h1, d) - d / (2 * o.ae);
      elAng[base + k] = ang * 57.29577951308232;
      // terrain horizon angle up to k-1 for LOS flag
      if (k > 1) { var dp = (k - 1) * xi; var a2 = Math.atan2(pfl[k + 1] - h1, dp) - dp / (2 * o.ae); if (a2 > maxAng) maxAng = a2; }
      los[base + k] = ang >= maxAng ? 1 : 0;
      if (o.model === 'los') { loss[base + k] = los[base + k] ? PC.fspl(d, o.f) : 999; continue; }
      if (o.model === 'fspl') { loss[base + k] = PC.fspl(d, o.f); continue; }
      var res = PC.pathLoss(pfl, k, xi, oo);
      loss[base + k] = res.L;
    }
    var now = Date.now();
    if (now - lastPost > 250) { self.postMessage({ cmd: 'progress', done: r + 1, total: nr, id: m.id }); lastPost = now; }
  }
  self.postMessage({ cmd: 'done', id: m.id, r0: m.r0, r1: m.r1, loss: loss.buffer, elAng: elAng.buffer, los: los.buffer }, [loss.buffer, elAng.buffer, los.buffer]);
};
