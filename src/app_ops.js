/* ===================== Datalink bandwidths, pass/fail verdict, stale-result handling, PDF report, clear results ===================== */
var OPS = (function () {
  function bwFields() { return F('Bandwidth', 'bwKHz', { unit: 'kHz' }); }
  function bindBw() { }

  /* ---- pass / fail: received level vs. receiver sensitivity, with a required fade margin ---- */
  function verdict(A) {
    if (!A) return null;
    var req = +S.reqMargin || 0, v = { reqMargin: req, required: A.sens, reqLabel: 'Rx sensitivity' };
    v.basis = 'Received level vs. receiver sensitivity (noise floor + required SNR' + (isFinite(parseFloat(S.sensOverride)) ? ', overridden' : '') + ')';
    v.margin = A.Prx - v.required;
    v.pass = isFinite(v.margin) && v.margin >= req;
    v.marginal = !v.pass && v.margin >= 0;
    v.text = v.pass ? 'PASS' : v.marginal ? 'MARGINAL' : 'FAIL';
    return v;
  }
  function resultCard(A) {
    if (!A) return '<div class="note">No result yet — place Tx and Rx, then press ▶ Path.</div>';
    var v = verdict(A), col = v.pass ? 'var(--ok)' : v.marginal ? 'var(--warn)' : 'var(--bad)';
    var h = '<div class="card" style="border-color:' + col + '">' + (stale ? '<div class="tag w" style="margin-bottom:6px">Sites moved — result is from the previous placement</div>' : '') + '<div style="display:flex;align-items:center;gap:10px"><div style="font-size:26px;font-weight:800;color:' + col + '">' + v.text + '</div><div class="mini">' + esc(A.tx.name) + ' → ' + esc(A.rx.name) + '<br>' + fx(A.D / 1000, 2) + ' km · ' + fx(S.f, 3) + ' MHz</div></div>';
    h += '<div class="kv" style="margin-top:6px"><span>Received level</span><b>' + fx(A.Prx, 1) + ' dBm</b><span>Rx sensitivity</span><b>' + fx(v.required, 1) + ' dBm</b><span>Link margin</span><b>' + sgn(v.margin, 1) + ' dB (need ' + fx(v.reqMargin, 0) + ')</b>';
    h += '<span>Line of sight</span><b>' + (A.minClr >= 0 ? 'Yes' : 'No — ' + A.obs.length + ' obstruction' + (A.obs.length === 1 ? '' : 's')) + '</b><span>Fresnel clearance</span><b>' + fx(A.minRatio * 100, 0) + '% ' + (A.minRatio >= 0.6 ? '(OK ≥ 60%)' : '(below 60%)') + '</b></div>';
    if (!v.pass) h += '<div class="note">' + (A.minClr < 0 ? 'Terrain blocks the path — raising the Tx antenna to about ' + hShort(A.req.tx60) + ' AGL would give 60% Fresnel clearance.' : 'Increase power, antenna gain or height, or reduce bandwidth to gain margin.') + '</div>';
    h += '<div class="row"><button class="btn sm inf" onclick="OPS.pdf()">⬇ PDF report</button><button class="btn sm" onclick="OPS.clearResults()">🧹 Clear results</button></div></div>';
    return h;
  }
  function refreshSummary() { var e = $('sumTab'); if (e) e.innerHTML = '<div style="padding:10px 14px;max-width:560px">' + resultCard(RF.last) + '</div>'; }

  /* ---- stale results: sites moved since the last run (no terrain is fetched until the user runs again) ---- */
  var stale = false;
  function markStale(on) {
    stale = !!on;
    var b = $('staleBar'); if (b) b.style.display = stale ? 'flex' : 'none';
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
    var gold = [240, 160, 32], col = v.pass ? [47, 176, 107] : v.marginal ? [214, 160, 20] : [229, 72, 77];
    function header(title) {
      doc.setFillColor(23, 26, 30); doc.rect(0, 0, W, 54, 'F');
      doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.text('Signal Monkee', M, 34); var tw = doc.getTextWidth('Signal Monkee');
      doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.setTextColor(gold[0], gold[1], gold[2]); doc.text(pdfSafe(title), M + tw + 14, 34);
      doc.setTextColor(170, 176, 184); doc.setFontSize(9); doc.text(pdfSafe(new Date().toLocaleString() + '  (' + nowISO() + ')'), W - M, 34, { align: 'right' });
      y = 78; doc.setTextColor(20, 20, 20);
    }
    function footer(p) { doc.setFontSize(8); doc.setTextColor(120); doc.text(pdfSafe('Signal Monkee ' + VERSION + ' - Longley-Rice ITM (NTIA/ITS) - bare-earth terrain; verify frequencies & data against official sources.'), M, Hh - 22); doc.text('Page ' + p, W - M, Hh - 22, { align: 'right' }); doc.setTextColor(20); }
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
    header('Link Analysis Report');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.text(pdfSafe(A.tx.name + '  ->  ' + A.rx.name), M, y); y += 16;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(90);
    doc.text(pdfSafe(fx(A.D / 1000, 2) + ' km (' + fx(A.D / 1852, 2) + ' NM)  -  ' + fx(S.f, 4) + ' MHz  -  ' + (S.bwKHz >= 1000 ? fx(S.bwKHz / 1000, 3) + ' MHz' : fx(S.bwKHz, 2) + ' kHz') + '  -  ' + RF.modelName(A.model)), M, y); y += 18;
    doc.setFillColor(col[0], col[1], col[2]); doc.roundedRect(M, y, W - 2 * M, 64, 8, 8, 'F');
    doc.setTextColor(255); doc.setFont('helvetica', 'bold'); doc.setFontSize(34); doc.text(v.text, M + 18, y + 44);
    doc.setFontSize(12); doc.text(pdfSafe('Margin ' + sgn(v.margin, 1) + ' dB  (required ' + fx(v.reqMargin, 0) + ' dB)'), W - M - 16, y + 28, { align: 'right' });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.text(doc.splitTextToSize(pdfSafe(v.basis), 300), W - M - 16, y + 44, { align: 'right' });
    y += 84; doc.setTextColor(20);
    var res = [['Key results'], ['Received signal level', fx(A.Prx, 1) + ' dBm'], ['Required level (' + v.reqLabel + ')', fx(v.required, 1) + ' dBm'], ['Link margin', sgn(v.margin, 1) + ' dB'],
      ['SNR', fx(A.snr, 1) + ' dB (noise floor ' + fx(A.N, 1) + ' dBm)'], ['Path loss', fx(A.Lsel, 1) + ' dB (' + RF.modelName(A.model) + '); free space ' + fx(A.Lfs, 1) + ' dB'],
      ['Line of sight', A.minClr >= 0 ? 'Clear' : 'Obstructed (' + A.obs.length + ' obstruction' + (A.obs.length === 1 ? '' : 's') + ', worst ' + fx(-A.minClr, 0) + ' m)'],
      ['Worst Fresnel clearance', fx(A.minRatio * 100, 0) + '% of 1st zone at ' + fx(A.minRatioI * A.xi / 1000, 2) + ' km'],
      ['Field strength at Rx', fx(A.E, 1) + ' dBuV/m'], ['Azimuth Tx->Rx / Rx->Tx', fx(A.az, 1) + ' deg / ' + fx(A.azR, 1) + ' deg']];
    if (A.minClr < 0 || A.minRatio < 0.6) res.push(['Tx height for 60% Fresnel', fx(A.req.tx60, 1) + ' m (' + fx(A.req.tx60 / 0.3048, 0) + ' ft) AGL']);
    kv(res, M, W - 2 * M);
    // profile image
    var cv = document.createElement('canvas'); cv.width = 1060; cv.height = 360;
    RF.drawProfile({ cv: cv, W: 1060, H: 360 });
    y += 6; var ih = (W - 2 * M) * 360 / 1060;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(150, 95, 10); doc.text('Terrain profile', M, y); y += 6;
    doc.addImage(cv.toDataURL('image/png'), 'PNG', M, y, W - 2 * M, ih); y += ih + 8;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(90);
    doc.text(doc.splitTextToSize(pdfSafe('Profile includes earth curvature (k = ' + fx(A.k, 2) + '). Green/red line = line of sight (clear/obstructed); dashed blue = first Fresnel zone; dotted yellow = 60% F1; red dots = obstructions.'), W - 2 * M), M, y);
    footer(1);
    // ---------- page 2: all simulation parameters ----------
    doc.addPage(); header('Simulation parameters');
    var t = A.tx, r = A.rx, sp = RF.antSpec();
    kv([['Sites'],
      ['Transmitter', t.name + ' - ' + fx(t.lat, 6) + ', ' + fx(t.lon, 6)], ['Tx ground / antenna', fx(A.z[0], 1) + ' m AMSL / ' + fx(A.htx, 1) + ' m AGL (' + fx(A.H1, 1) + ' m AMSL)'],
      ['Receiver', r.name + ' - ' + fx(r.lat, 6) + ', ' + fx(r.lon, 6)], ['Rx ground / antenna', fx(A.z[A.n], 1) + ' m AMSL / ' + fx(A.hrx, 1) + ' m AGL (' + fx(A.H2, 1) + ' m AMSL)' + (r.mode === 'msl' ? ' - altitude entered as MSL' : '')],
      ['Path length', fx(A.D / 1000, 3) + ' km / ' + fx(A.D / 1609.344, 3) + ' mi / ' + fx(A.D / 1852, 3) + ' NM'],
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
      ['Terrain'], ['Source', DEM.hgtList().length ? 'SRTM .hgt files (' + DEM.hgtList().length + ')' : 'AWS Terrain Tiles, zoom ' + A.zoom + ' (~' + fx(A.res, 0) + ' m)'], ['Profile', (A.n + 1) + ' samples at ' + fx(A.xi, 1) + ' m'],
      ['Pass criteria'], ['Required margin', fx(v.reqMargin, 1) + ' dB'], ['Basis', v.basis]], M, W - 2 * M, 14);
    footer(doc.getNumberOfPages());
    // ---------- appendix (engineer mode): full text report ----------
    {
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
  return { bwFields: bwFields, bindBw: bindBw, verdict: verdict, resultCard: resultCard, refreshSummary: refreshSummary, clearResults: clearResults, pdf: pdf, markStale: markStale };
})();
