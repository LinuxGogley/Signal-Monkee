/* ===================== Datalink bandwidths, pass/fail verdict, stale-result handling, PDF report, clear results ===================== */
var OPS = (function () {
  function bwFields() { return F('Bandwidth', 'bwKHz', { unit: 'kHz' }); }
  function bindBw() { }

  /* ---- pass / fail: received level vs. receiver sensitivity, with a required fade margin ---- */
  function verdict(A) {
    if (!A) return null;
    if (A.losOnly) { // terrain-only planning: no radio settings at all
      var l = { reqMargin: 0, required: NaN, reqLabel: '', margin: A.minClr, los: A.los0, pass: A.los0, marginal: false };
      l.text = A.los0 ? 'CLEAR' : 'BLOCKED'; l.reason = A.los0 ? '' : 'Terrain blocks the line of sight';
      l.basis = 'Straight line between the two antennas vs. the terrain profile, earth curvature k = ' + fx(A.k, 2) + (S.los.earth === 'geo' ? ' (geometric / visual)' : ' (standard radio horizon)');
      return l;
    }
    if (A.op) { // Operator: pass = geometric line of sight AND free-space RSSI at or above the minimum
      var o = { reqMargin: 0, required: A.sens, reqLabel: 'Minimum RSSI', margin: A.Prx - A.sens, los: A.los0 };
      o.pass = o.los && o.margin >= 0; o.marginal = false; o.text = o.pass ? 'PASS' : 'FAIL';
      o.reason = !o.los ? 'Line of sight blocked by terrain' : o.margin < 0 ? 'Signal below minimum RSSI' : '';
      o.basis = 'Pass = clear line of sight over terrain (k = ' + fx(A.k, 2) + ') and free-space RSSI at or above the minimum RSSI (isotropic antennas)';
      return o;
    }
    var req = +S.reqMargin || 0, v = { reqMargin: req, required: A.sens, reqLabel: 'Rx sensitivity', los: A.los0 };
    v.basis = 'Pass = received level at least ' + fx(req, 0) + ' dB above receiver sensitivity (noise floor + required SNR' + (isFinite(parseFloat(S.sensOverride)) ? ', overridden' : '') + '); ' + RF.modelName(A.model) + ' includes terrain diffraction';
    v.margin = A.Prx - v.required;
    v.pass = isFinite(v.margin) && v.margin >= req;
    v.marginal = !v.pass && v.margin >= 0;
    v.text = v.pass ? 'PASS' : v.marginal ? 'MARGINAL' : 'FAIL';
    v.reason = v.pass ? '' : v.marginal ? 'Margin below the required ' + fx(req, 0) + ' dB' : 'Signal below receiver sensitivity';
    return v;
  }
  function worstObs(A) { var w = null; A.obs.forEach(function (o) { if (!w || A.clr[o.peak] < A.clr[w.peak]) w = o; }); return w; }
  function vcol(v) { return v.pass ? 'var(--ok)' : v.marginal ? 'var(--warn)' : 'var(--bad)'; }
  /* One list of key results for every mode, used by the result card and page 1 of the PDF, so Operator and Engineer
     read the same way. Rows: [label, value, where] — where 'pdf' = PDF only. H formats heights. */
  function keyRows(A, v, H) {
    var R = [], wo = worstObs(A), rf = !A.losOnly;
    R.push(['Line of sight', A.los0 ? 'Clear — ' + H(A.minClr) + ' above terrain at the closest point' : 'Blocked — terrain ' + H(-A.minClr) + ' above the line (' + A.obs.length + ' obstruction' + (A.obs.length === 1 ? '' : 's') + ')']);
    if (rf) R.push(['Fresnel clearance (1st zone)', A.minRatio < 0 ? 'None — terrain blocks the line of sight' : 'Worst ' + fx(A.minRatio * 100, 0) + '% at ' + dU(A.minRatioI * A.xi, 1) + ' from Tx — ' + (A.minRatio >= 0.6 ? 'OK (≥ 60%)' : 'below 60%')]);
    if (rf) R.push(['Received signal (RSSI)', fx(A.Prx, 1) + ' dBm'], [v.reqLabel, fx(v.required, 1) + ' dBm'], ['Link margin', sgn(v.margin, 1) + ' dB (need ' + (v.reqMargin ? '+' + fx(v.reqMargin, 0) : '0') + ' dB)']);
    if (rf) R.push(['Path loss', fx(A.Lsel, 1) + ' dB (' + (A.op ? 'free space' : RF.modelName(A.model) + '; free space ' + fx(A.Lfs, 1) + ' dB') + ')', 'pdf']);
    if (rf && !A.op) R.push(['SNR', fx(A.snr, 1) + ' dB (noise floor ' + fx(A.N, 1) + ' dBm)', 'pdf'], ['Field strength at Rx', fx(A.E, 1) + ' dBuV/m', 'pdf']);
    if (wo) R.push(['Highest blocking terrain', H(A.z[wo.peak]) + ' MSL, ' + dU(wo.peak * A.xi, 1) + ' from Tx']);
    R.push(['Distance', dDual(A.D, 2), 'pdf'], ['Bearing Tx→Rx / Rx→Tx', fx(A.az, 1) + '° / ' + fx(A.azR, 1) + '°', 'pdf'], ['Elevation angle at Tx', fx(A.elevAng, 2) + '°']);
    if (A.losOnly) R.push(['Earth curvature', 'k = ' + fx(A.k, 2) + (S.los.earth === 'geo' ? ' (geometric / visual)' : ' (standard radio horizon)')]);
    if (!A.los0) R.push(['Rx altitude for line of sight', H(A.rxAltNeed) + ' MSL (' + H(A.req.rx0) + ' AGL)', 'pdf'], ['or Tx antenna height', H(A.req.tx0) + ' AGL', 'pdf']);
    else if (rf && A.minRatio < 0.6) R.push(['Tx height for 60% Fresnel', H(A.req.tx60) + ' AGL', 'pdf']);
    return R;
  }
  function advice(A, v) {
    if (!A.los0) return 'For line of sight the Rx needs at least <b>' + hShort(A.rxAltNeed) + ' MSL</b> (' + hShort(A.req.rx0) + ' above ground), or the Tx antenna about <b>' + hShort(A.req.tx0) + '</b> above ground.';
    if (A.losOnly) return '';
    if (!v.pass) return 'Terrain is clear, but the signal is too weak: add power or antenna gain' + (A.op ? '' : ', reduce bandwidth') + ', or shorten the path.';
    if (A.minRatio < 0.6) return 'Line of sight is clear but the Fresnel zone is partly blocked — about ' + hShort(A.req.tx60) + ' Tx height (AGL) gives 60% clearance.';
    return '';
  }
  function resultCard(A) {
    if (!A) return '<div class="note">No result yet — place Tx and Rx, then press Path.</div>';
    var v = verdict(A), col = vcol(v), ad = advice(A, v);
    var h = '<div class="card" style="border-color:' + col + '">' + (stale ? '<div class="tag w" style="margin-bottom:6px">Inputs changed — result is from the previous run</div>' : '') +
      '<div style="display:flex;align-items:center;gap:10px"><div style="font-size:26px;font-weight:800;color:' + col + '">' + v.text + '</div><div class="mini">' + esc(A.tx.name) + ' → ' + esc(A.rx.name) + '<br>' + dDual(A.D, 1) + ' · bearing ' + fx(A.az, 0) + '°' + (A.losOnly ? '' : ' · ' + fx(S.f, 3) + ' MHz') + '</div></div>';
    if (v.reason) h += '<div style="margin-top:4px;font-weight:600;color:' + col + '">' + esc(v.reason) + '</div>';
    h += '<div class="kv" style="margin-top:6px">' + keyRows(A, v, hShort).filter(function (r) { return r[2] !== 'pdf'; }).map(function (r) { return '<span>' + esc(r[0]) + '</span><b>' + esc(r[1]) + '</b>'; }).join('') + '</div>';
    if (ad) h += '<div class="note">' + ad + '</div>';
    h += '<div class="row"><button class="btn sm inf" onclick="OPS.pdf()">' + ico('download') + 'PDF report</button><button class="btn sm" onclick="OPS.clearResults()">' + ico('clear') + 'Clear results</button></div></div>';
    return h;
  }
  function refreshSummary() { var e = $('sumTab'); if (e) e.innerHTML = '<div style="padding:10px 14px;max-width:560px">' + resultCard(RF.last) + '</div>'; var o = $('opResult'); if (o) o.innerHTML = RF.last && RF.last.op && !RF.last.losOnly ? resultCard(RF.last) : ''; var er = $('engResult'); if (er) er.innerHTML = RF.last && !RF.last.op ? resultCard(RF.last) : ''; var lr = $('losResult'); if (lr) lr.innerHTML = RF.last && RF.last.losOnly ? resultCard(RF.last) : ''; }

  /* ---- stale results: sites moved since the last run (no terrain is fetched until the user runs again) ---- */
  var stale = false;
  function markStale(on) {
    stale = !!on;
    var b = $('staleBar'); if (b) b.style.display = stale && (RF.last || COV.cur) ? 'flex' : 'none';
    refreshSummary();
  }

  /* ---- clear map results ---- */
  function clearResults() {
    COV.clear(); COV.dropAll(); RF.clearLast(); SAT.clearArea();
    if (markers.pathHover) { map.removeLayer(markers.pathHover); markers.pathHover = null; }
    TP.clearResults();
    $('reportTxt').textContent = 'Run a path analysis to generate the report.'; $('infoTab').innerHTML = '';
    $('drawer').classList.remove('open'); setTimeout(function () { map.invalidateSize(); }, 30);
    markStale(false); map.closePopup();
    log('Results cleared from the map.');
  }

  /* ---- PDF report ---- */
  function pdfSafe(s) {
    return String(s == null ? '' : s).replace(/≥/g, '>=').replace(/≤/g, '<=').replace(/→/g, '->').replace(/[─━]/g, '-').replace(/Δ/g, 'dh').replace(/ε/g, 'eps').replace(/σ/g, 'sigma').replace(/″/g, '"').replace(/′/g, "'").replace(/⇄/g, '<->').replace(/·/g, '-').replace(/≈/g, '~').replace(/⅔/g, '2/3').replace(/⅚/g, '5/6').replace(/⅓/g, '1/3').replace(/⅛/g, '1/8').replace(/[^\x00-\xFF—–°µ²…]/g, '?');
  }
  function pdf() {
    var A = RF.last;
    if (!A) { log('Run a path analysis first, then create the PDF.', 'w'); return; }
    var JS = window.jspdf && window.jspdf.jsPDF; if (!JS) { log('PDF library not available.', 'e'); return; }
    var v = verdict(A), doc = new JS({ unit: 'pt', format: 'letter' }), W = 612, Hh = 792, M = 40, y = 0;
    var gold = [240, 160, 32], col = v.pass ? [47, 176, 107] : v.marginal ? [214, 160, 20] : [229, 72, 77], op = !!A.op, lo = !!A.losOnly;
    function header(title) {
      doc.setFillColor(23, 26, 30); doc.rect(0, 0, W, 54, 'F');
      doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.text('Signal Monkee', M, 34); var tw = doc.getTextWidth('Signal Monkee');
      doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.setTextColor(gold[0], gold[1], gold[2]); doc.text(pdfSafe(title), M + tw + 14, 34);
      doc.setTextColor(170, 176, 184); doc.setFontSize(9); doc.text(pdfSafe(new Date().toLocaleString() + '  (' + nowISO() + ')'), W - M, 34, { align: 'right' });
      y = 78; doc.setTextColor(20, 20, 20);
    }
    function footer(p) { doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(120); doc.text(pdfSafe('Signal Monkee ' + VERSION + ' - ' + (lo ? 'terrain line of sight' : op ? 'line of sight + free space, isotropic antennas' : 'Longley-Rice ITM (NTIA/ITS)') + ' - bare-earth terrain; ' + (lo ? 'verify critical clearances against official charts.' : 'verify frequencies & data against official sources.')), M, Hh - 22); doc.text('Page ' + p, W - M, Hh - 22, { align: 'right' }); doc.setTextColor(20); }
    function kv(rows, x, w, lh) {
      lh = lh || 15; doc.setFontSize(10);
      rows.forEach(function (r) {
        if (y > Hh - 60) { footer(doc.getNumberOfPages()); doc.addPage(); header('Simulation parameters (cont.)'); }
        if (r.length === 1) { y += 6; doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(150, 95, 10); doc.text(pdfSafe(r[0]), x, y); doc.setTextColor(20); doc.setFontSize(10); y += 4; doc.setDrawColor(220); doc.line(x, y, x + w, y); y += lh - 2; return; }
        doc.setFont('helvetica', 'normal'); doc.setTextColor(90); doc.text(pdfSafe(r[0]), x, y);
        doc.setTextColor(20); doc.setFont('helvetica', 'bold');
        var lines = doc.splitTextToSize(pdfSafe(r[1]), w * 0.58); doc.text(lines, x + w * 0.42, y); y += lh * Math.max(1, lines.length);
      });
    }
    // ---------- page 1: results up front ----------
    header(lo ? 'Line-of-Sight Planning Report' : op ? 'Line-of-Sight Link Report' : 'Link Analysis Report');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.text(pdfSafe(A.tx.name + '  ->  ' + A.rx.name), M, y); y += 16;
    // labelled summary line: "Distance … · Frequency … · Bandwidth … · Model …" (grey label, bold value)
    var bwTxt = S.bwKHz >= 1000 ? fx(S.bwKHz / 1000, 3) + ' MHz' : fx(S.bwKHz, 2) + ' kHz';
    var sub = [['Distance', dDual(A.D, 2)]]
      .concat(lo ? [['Bearing', fx(A.az, 0) + ' deg'], ['Analysis', 'terrain line of sight']] :
        [['Frequency', fx(S.f, 4) + ' MHz']].concat(op ? [] : [['Bandwidth', bwTxt]]).concat([['Model', RF.modelName(A.model)]]));
    doc.setFontSize(9.5); var sx = M;
    sub.forEach(function (it, k) {
      var lab = pdfSafe(it[0]) + ' ', val = pdfSafe(it[1]);
      doc.setFont('helvetica', 'normal'); var lw = doc.getTextWidth(lab); doc.setFont('helvetica', 'bold'); var vw = doc.getTextWidth(val);
      if (k && sx + lw + vw > W - M) { sx = M; y += 13; }
      doc.setFont('helvetica', 'normal'); doc.setTextColor(120); doc.text(lab, sx, y);
      doc.setFont('helvetica', 'bold'); doc.setTextColor(40); doc.text(val, sx + lw, y);
      sx += lw + vw + 18;
    });
    y += 18;
    // verdict banner — same layout in every mode: verdict word, headline figure, then reason + pass basis
    var head = lo ? (A.los0 ? 'Clear by ' + hDual(A.minClr) + ' at the closest point' : 'Blocked - terrain ' + hDual(-A.minClr) + ' above the line')
      : 'Margin ' + sgn(v.margin, 1) + ' dB vs ' + (A.op ? 'minimum RSSI' : 'Rx sensitivity') + (v.reqMargin ? ' (need +' + fx(v.reqMargin, 0) + ' dB)' : '');
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
    var bl = doc.splitTextToSize(pdfSafe((v.reason ? v.reason + '. ' : '') + v.basis), 310), bh = Math.max(64, 40 + bl.length * 11);
    doc.setFillColor(col[0], col[1], col[2]); doc.roundedRect(M, y, W - 2 * M, bh, 8, 8, 'F');
    doc.setTextColor(255); doc.setFont('helvetica', 'bold'); doc.setFontSize(34); doc.text(v.text, M + 18, y + bh / 2 + 12);
    doc.setFontSize(12); doc.text(pdfSafe(head), W - M - 16, y + 24, { align: 'right' });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.text(bl, W - M - 16, y + 40, { align: 'right' });
    y += bh + 20; doc.setTextColor(20);
    kv([['Key results']].concat(keyRows(A, v, hDual)), M, W - 2 * M);
    // profile image
    var cv = document.createElement('canvas'); cv.width = 1060; cv.height = 360;
    RF.drawProfile({ cv: cv, W: 1060, H: 360, light: true });
    y += 6; var ih = (W - 2 * M) * 360 / 1060;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(150, 95, 10); doc.text('Terrain profile', M, y); y += 6;
    doc.addImage(cv.toDataURL('image/png'), 'PNG', M, y, W - 2 * M, ih); y += ih + 8;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(90);
    doc.text(doc.splitTextToSize(pdfSafe('Profile includes earth curvature (k = ' + fx(A.k, 2) + '). Green/red line = line of sight (clear/blocked)' + (lo ? '; red dots = terrain blocking the line of sight.' : '; dashed blue = first Fresnel zone; dotted amber = 60% of the first Fresnel zone; red dots = terrain blocking the line of sight.')), W - 2 * M), M, y);
    footer(1);
    // ---------- page 2: all simulation parameters ----------
    doc.addPage(); header('Simulation parameters');
    var t = A.tx, r = A.rx, sp = RF.antSpec();
    var gnd = function (z0, h, H0) { return hDual(z0) + ' AMSL ground / ' + hDual(h) + ' AGL antenna (' + hDual(H0) + ' AMSL)'; };
    var siteRows = [['Sites'],
      ['Transmitter', t.name + ' - ' + fx(t.lat, 6) + ', ' + fx(t.lon, 6)], ['Tx ground / antenna', gnd(A.z[0], A.htx, A.H1)],
      ['Receiver', r.name + ' - ' + fx(r.lat, 6) + ', ' + fx(r.lon, 6)], ['Rx ground / antenna', gnd(A.z[A.n], A.hrx, A.H2) + (r.mode === 'msl' ? ' - altitude entered as MSL' : '')],
      ['Path length', dStr(A.D)]];
    if (lo) kv(siteRows.concat([['Method'], ['Line of sight', v.basis], ['Not included', 'Buildings and vegetation (bare-earth terrain)'],
      ['Terrain'], ['Source', DEM.hgtList().length ? 'SRTM .hgt files (' + DEM.hgtList().length + ')' : 'AWS Terrain Tiles, zoom ' + A.zoom + ' (~' + fx(A.res, 0) + ' m)'], ['Profile', (A.n + 1) + ' samples every ' + (IMP() ? fx(A.xi / 0.3048, 0) + ' ft' : fx(A.xi, 1) + ' m')]]), M, W - 2 * M, 14);
    else if (op) kv(siteRows.concat([['Radio'], ['Frequency', fx(S.f, 4) + ' MHz'], ['Tx power', fx(S.pwrW, 3) + ' W (' + sgn(RF.txdBm(), 2) + ' dBm)'],
      ['Tx / Rx antenna gain', fx(S.txGain, 2) + ' dBi / ' + fx(S.rxGain, 2) + ' dBi (isotropic pattern - same gain in every direction)'], ['EIRP', sgn(RF.eirp(), 2) + ' dBm'],
      ['Minimum RSSI', fx(A.sens, 1) + ' dBm'],
      ['Method'], ['Line of sight', 'Geometric: straight line between antennas vs. terrain profile, earth curvature k = ' + fx(A.k, 3) + (S.op.earth === 'geo' ? ' (geometric / visual)' : ' (standard radio horizon, 4/3 earth)')],
      ['Signal', 'Free-space path loss ' + fx(A.Lfs, 2) + ' dB; no feeder losses, fade margin, noise figure or clutter'],
      ['Fresnel zone', 'First Fresnel zone and clearance shown for reference; pass/fail uses line of sight and RSSI'],
      ['Terrain'], ['Source', DEM.hgtList().length ? 'SRTM .hgt files (' + DEM.hgtList().length + ')' : 'AWS Terrain Tiles, zoom ' + A.zoom + ' (~' + fx(A.res, 0) + ' m)'], ['Profile', (A.n + 1) + ' samples every ' + (IMP() ? fx(A.xi / 0.3048, 0) + ' ft' : fx(A.xi, 1) + ' m')],
      ['Pass criteria'], ['Basis', v.basis]]), M, W - 2 * M, 14);
    else kv(siteRows.concat([
      ['Radio'], ['Frequency', fx(S.f, 4) + ' MHz'], ['Bandwidth', S.bwKHz >= 1000 ? fx(S.bwKHz / 1000, 4) + ' MHz' : fx(S.bwKHz, 3) + ' kHz'],
      ['Tx power', fx(S.pwrW, 3) + ' W (' + sgn(RF.txdBm(), 2) + ' dBm)'], ['Tx feeder loss / antenna gain', fx(S.txLoss, 2) + ' dB / ' + fx(S.txGain, 2) + ' dBi'],
      ['ERP / EIRP', sgn(RF.erp(), 2) + ' dBm / ' + sgn(RF.eirp(), 2) + ' dBm'], ['Tx antenna pattern', sp.type === 'iso' ? 'omni (no pattern)' : sp.type === 'table' ? 'SPLAT! .az/.el tables' : sp.type + ', az ' + S.ant.az + ' deg, tilt ' + S.ant.tilt + ' deg, H/V BW ' + S.ant.hbw + '/' + S.ant.vbw + ' deg, F/B ' + S.ant.fb + ' dB'],
      ['Pattern loss toward Rx', fx(A.pat, 2) + ' dB'], ['Polarization', S.itm.pol == 1 ? 'Vertical' : 'Horizontal'],
      ['Rx antenna gain / feeder loss', fx(S.rxGain, 2) + ' dBi / ' + fx(S.rxLoss, 2) + ' dB'], ['Rx noise figure / required SNR', fx(S.rxNF, 1) + ' dB / ' + fx(S.reqSNR, 1) + ' dB'],
      ['Rx sensitivity', fx(A.sens, 2) + ' dBm' + (isFinite(parseFloat(S.sensOverride)) ? ' (override)' : ' (computed)')],
      ['Propagation model'], ['Model', RF.modelName(A.model) + (A.reqModel !== A.model ? ' (ITM out of range, fallback)' : '')],
      ['Ground dielectric / conductivity', fx(S.itm.eps, 2) + ' / ' + fx(S.itm.sigma, 4) + ' S/m'], ['Surface refractivity N0', fx(S.itm.N0, 1) + ' N-units (k = ' + fx(A.k, 3) + ', a_e = ' + fx(A.ae / 1000, 0) + ' km)'],
      ['Radio climate', S.itm.climate + ' - ' + STATIC.climates[S.itm.climate]], ['Variability mode', String(S.itm.mdvar)], ['Time / location / situation', S.itm.time + '% / ' + S.itm.loc + '% / ' + S.itm.sit + '%'],
      ['Clutter loss', fx(+S.clutterDb || 0, 1) + ' dB'], ['Losses: ITM / P.526 / FSPL', (A.Litm.itm ? fx(A.Litm.L, 2) : 'n/a') + ' / ' + fx(A.Lp526.L, 2) + ' / ' + fx(A.Lfs, 2) + ' dB'],
      ['Terrain'], ['Source', DEM.hgtList().length ? 'SRTM .hgt files (' + DEM.hgtList().length + ')' : 'AWS Terrain Tiles, zoom ' + A.zoom + ' (~' + fx(A.res, 0) + ' m)'], ['Profile', (A.n + 1) + ' samples every ' + (IMP() ? fx(A.xi / 0.3048, 0) + ' ft' : fx(A.xi, 1) + ' m')],
      ['Pass criteria'], ['Required margin', fx(v.reqMargin, 1) + ' dB'], ['Basis', v.basis]]), M, W - 2 * M, 14);
    footer(doc.getNumberOfPages());
    // ---------- appendix (engineer mode): full text report ----------
    if (!op) {
      doc.addPage(); header('Appendix - detailed path report');
      doc.setFont('courier', 'normal'); doc.setFontSize(7.4);
      RF.report(A).split('\n').forEach(function (ln) {
        if (y > Hh - 40) { footer(doc.getNumberOfPages()); doc.addPage(); header('Appendix (cont.)'); doc.setFont('courier', 'normal'); doc.setFontSize(7.4); }
        doc.text(pdfSafe(ln), M, y); y += 9.2;
      });
      footer(doc.getNumberOfPages());
    }
    var fn = 'signalmonkee_' + String(A.tx.name + '_' + A.rx.name).replace(/[^\w-]+/g, '_') + '_' + new Date().toISOString().slice(0, 10) + '.pdf';
    doc.save(fn); log('PDF report saved: ' + fn + ' (' + v.text + ')', v.pass ? 'g' : 'w');
  }
  return { worstObs: worstObs, isStale: function () { return stale; }, bwFields: bwFields, bindBw: bindBw, verdict: verdict, resultCard: resultCard, refreshSummary: refreshSummary, clearResults: clearResults, pdf: pdf, markStale: markStale };
})();
