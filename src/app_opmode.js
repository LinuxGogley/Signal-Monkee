/* ===================== Operator mode: one-page line-of-sight link check (pilot-friendly) =====================
   Operator mode deliberately reduces the model to:
     • geometric line of sight between the two antennas over the terrain profile (with earth curvature)
     • free-space path loss for the signal estimate
     • isotropic antennas (same gain in every direction), no feeder loss, fade margin, noise figure or clutter
     • PASS = line of sight is clear AND RSSI ≥ minimum RSSI
   Shared settings (sites, frequency, power, antenna gains, coverage radius/height) are the same values the
   Engineer panels use; Operator simply ignores the advanced ones. */
var OPMODE = (function () {
  var NM = 1.852; // km per nautical mile

  function render() {
    var h = '<h3>Line-of-sight link check</h3>';
    h += '<div id="opResult">' + (RF.last && RF.last.op ? OPS.resultCard(RF.last) : '') + '</div>';
    if (!(RF.last && RF.last.op)) h += '<div class="note">Checks whether the two ends can see each other over the terrain (including earth curvature) and estimates signal strength with free-space loss and isotropic antennas. Set both ends, then press <b>Path</b>.</div>';
    h += '<h4>Ground station (Tx)</h4>' + F('Name', 'tx.name', { text: 1 }) + F('Latitude', 'tx.lat') + F('Longitude', 'tx.lon') + F('Antenna height', 'tx.h', { u: 'h', title: 'Height of the antenna above the ground' }) +
      '<div class="row"><button class="btn sm" data-ico="pin" onclick="setPick(\'tx\')">Pick on map</button><button class="btn sm" data-ico="zoom" onclick="map.setView([S.tx.lat,S.tx.lon],11)">Zoom to</button><button class="btn sm" data-ico="swap" onclick="RF.swap()">Swap ends</button></div>';
    h += '<h4>Aircraft / remote (Rx)</h4>' + F('Name', 'rx.name', { text: 1 }) + F('Latitude', 'rx.lat') + F('Longitude', 'rx.lon') +
      F('Height is', 'rx.mode', { sel: [['msl', 'Altitude above sea level (MSL)'], ['agl', 'Height above ground (AGL)']] }) + F(S.rx.mode === 'msl' ? 'Altitude' : 'Height', 'rx.h', { u: 'h' }) +
      '<div class="row"><button class="btn sm" data-ico="pin" onclick="setPick(\'rx\')">Pick on map</button><button class="btn sm" data-ico="zoom" onclick="map.setView([S.rx.lat,S.rx.lon],11)">Zoom to</button></div>';
    h += '<h4>Radio</h4>' + F('Frequency', 'f', { unit: 'MHz' }) +
      '<div class="f"><label>Transmit power</label><div class="pair"><input data-k="pwrW" type="number" step="any" title="Watts"><input id="opDbm" type="number" step="0.1" title="dBm"></div></div><div class="note" style="text-align:right;margin-top:-2px">watts ⇄ dBm</div>' +
      F('Tx antenna gain', 'txGain', { unit: 'dBi' }) + F('Rx antenna gain', 'rxGain', { unit: 'dBi' }) + F('Minimum RSSI', 'op.minRssi', { unit: 'dBm', title: 'Weakest signal the receiver can use' });
    h += '<h4>Environment</h4>' + F('Earth curvature', 'op.earth', { sel: [['std', 'Standard radio horizon (4/3 earth)'], ['geo', 'Geometric / visual (true earth)']] }) +
      '<div class="note">Bare terrain only (no buildings or trees). Antennas are treated as isotropic — equal coverage in every direction.</div>';
    h += '<h4>Coverage map</h4>' +
      '<div class="f"><label>Radius</label><div class="pair"><input id="opRkm" type="number" step="any" title="km"><input id="opRnm" type="number" step="any" title="NM"></div></div><div class="note" style="text-align:right;margin-top:-2px">km ⇄ NM</div>' +
      F('Receiver height is', 'cov.rxMode', { sel: [['msl', 'Altitude above sea level (MSL)'], ['agl', 'Height above ground (AGL)']] }) + F(S.cov.rxMode === 'msl' ? 'Receiver altitude' : 'Receiver height', 'cov.rxH', { u: 'h' }) +
      F('Show', 'op.covDisplay', { sel: [['dbm', 'Signal strength where in line of sight'], ['los', 'Line of sight only']] }) + F('Opacity', 'cov.opacity', { step: 0.05 }) +
      '<div class="row"><button class="btn sm" data-ico="clear" onclick="COV.clear()">Clear coverage</button><button class="btn sm" data-ico="layers" onclick="COV.keep()">Keep as layer</button><button class="btn sm" data-ico="download" onclick="COV.exportKMZ()">Google Earth KMZ</button></div><div id="covLayers"></div>';
    return h;
  }
  function after(root) {
    var pd = $('opDbm'); pd.value = fx(RF.txdBm(), 1);
    pd.onchange = function () { var v = parseFloat(pd.value); if (!isFinite(v)) return; S.pwrW = +dBm2W(v).toPrecision(6); saveState(); root.querySelector('[data-k="pwrW"]').value = S.pwrW; };
    var rk = $('opRkm'), rn = $('opRnm');
    rk.value = +(+S.cov.radius).toFixed(2); rn.value = +(S.cov.radius / NM).toFixed(2);
    rk.onchange = function () { var v = parseFloat(rk.value); if (v > 0) { S.cov.radius = v; rn.value = +(v / NM).toFixed(2); saveState(); } };
    rn.onchange = function () { var v = parseFloat(rn.value); if (v > 0) { S.cov.radius = +(v * NM).toFixed(3); rk.value = +S.cov.radius.toFixed(2); saveState(); } };
    COV.renderLayerList();
  }

  /* ---- mode switching ---- */
  var OP_HIDE = ['terrain'];               // panels hidden in Operator mode
  function applyChrome() {
    var op = OPM();
    document.querySelectorAll('#modeSeg button').forEach(function (b) { b.classList.toggle('on', b.dataset.m === S.mode); });
    document.querySelectorAll('#rail button').forEach(function (b) { b.classList.toggle('hidden', op && OP_HIDE.indexOf(b.dataset.p) >= 0); });
    document.querySelectorAll('#dtabs button[data-t=report]').forEach(function (b) { b.classList.toggle('hidden', op); });
    var pv = $('pfView'); if (pv) pv.classList.toggle('hidden', op);
    var dr = $('dlReport'); if (dr) dr.classList.toggle('hidden', op);
    document.body.classList.toggle('opmode', op);
  }
  function setMode(m) {
    if (m !== 'operator' && m !== 'engineer') return;
    var changed = S.mode !== m;
    S.mode = m; saveState();
    if (changed && (RF.last || COV.cur)) { OPS.clearResults(); log('Results cleared — the ' + (m === 'operator' ? 'Operator' : 'Engineer') + ' mode uses a different calculation.'); }
    applyChrome();
    if (OP_HIDE.indexOf(curPanel) >= 0 && OPM()) showPanel('rf'); else rerender();
    if (changed) { log((OPM() ? 'Operator mode: line of sight + free-space signal, isotropic antennas.' : 'Engineer mode: full propagation models and RF settings.'), 'g'); RF.logBudget(); }
    if (curPanel === 'rf' && $('drawer').classList.contains('open')) selectTab('profile');
  }
  watch('rx.mode', function () { if (OPM() && curPanel === 'rf') rerender(); });
  watch('cov.rxMode', function () { if (OPM() && curPanel === 'rf') rerender(); });
  return { render: render, after: after, setMode: setMode, applyChrome: applyChrome };
})();
