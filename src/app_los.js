/* ===================== LOS planning: terrain-only line of sight and viewshed (no radio settings) =====================
   Shares the Tx/Rx sites and antenna heights with the RF panel, but ignores every radio parameter:
     • Check line of sight → profile, CLEAR/BLOCKED, highest blocking terrain, altitude needed (RF.runP2P({losOnly:true}))
     • Viewshed map       → where a target at a chosen height can see the Tx antenna (COV.run({losOnly:true}))
   Earth curvature: standard radio horizon (k = 4/3) or geometric/visual (k = 1). */
var LOSP = (function () {
  var NM = 1.852;
  function render() {
    var h = '<h3>Line-of-sight planning</h3><div id="losResult">' + (RF.last && RF.last.losOnly ? OPS.resultCard(RF.last) : '') + '</div>';
    if (!(RF.last && RF.last.losOnly)) h += '<div class="note">Terrain only — no radio settings. Checks whether two points can see each other over the terrain, or maps everywhere a target can see the Tx site. Uses the same Tx and Rx sites as the RF panel.</div>';
    h += '<h4>Point A (Tx)</h4>' + F('Name', 'tx.name', { text: 1 }) + F('Latitude', 'tx.lat') + F('Longitude', 'tx.lon') + F('Height above ground', 'tx.h', { u: 'h' }) +
      '<div class="row"><button class="btn sm" data-ico="pin" onclick="setPick(\'tx\')">Pick on map</button><button class="btn sm" data-ico="swap" onclick="RF.swap()">Swap A/B</button></div>';
    h += '<h4>Point B (Rx)</h4>' + F('Name', 'rx.name', { text: 1 }) + F('Latitude', 'rx.lat') + F('Longitude', 'rx.lon') +
      F('Height is', 'rx.mode', { sel: [['agl', 'Height above ground (AGL)'], ['msl', 'Altitude above sea level (MSL)']] }) + F(S.rx.mode === 'msl' ? 'Altitude' : 'Height', 'rx.h', { u: 'h' }) +
      '<div class="row"><button class="btn sm" data-ico="pin" onclick="setPick(\'rx\')">Pick on map</button></div>';
    h += '<h4>Earth curvature</h4>' + F('Model', 'los.earth', { sel: [['std', 'Standard radio horizon (4/3 earth)'], ['geo', 'Geometric / visual (true earth)']] });
    h += '<div class="row" style="margin-top:10px"><button class="btn pri" data-ico="eye" id="losRun">Check line of sight</button></div>';
    h += '<h4>Viewshed map (from point A)</h4>' +
      '<div class="f"><label>Radius</label><div class="pair"><input id="losRkm" type="number" step="any" title="km"><input id="losRnm" type="number" step="any" title="NM"></div></div><div class="note" style="text-align:right;margin-top:-2px">km ⇄ NM</div>' +
      F('Target height is', 'los.rxMode', { sel: [['agl', 'Height above ground (AGL)'], ['msl', 'Altitude above sea level (MSL)']] }) + F(S.los.rxMode === 'msl' ? 'Target altitude' : 'Target height', 'los.rxH', { u: 'h' }) +
      CK('Shade hidden areas red', 'los.showHidden') +
      '<div class="row"><button class="btn pri" data-ico="map" id="losMap">Viewshed map</button><button class="btn sm" data-ico="clear" onclick="COV.clear()">Clear map</button><button class="btn sm" data-ico="download" onclick="COV.exportKMZ()">Google Earth KMZ</button></div>';
    h += '<div class="note">Bare terrain: buildings and trees are not included. Radio range is not considered — use the RF panel for signal strength.</div>';
    return h;
  }
  function after() {
    var rk = $('losRkm'), rn = $('losRnm');
    rk.value = +(+S.los.radius).toFixed(2); rn.value = +(S.los.radius / NM).toFixed(2);
    rk.onchange = function () { var v = parseFloat(rk.value); if (v > 0) { S.los.radius = v; rn.value = +(v / NM).toFixed(2); saveState(); } };
    rn.onchange = function () { var v = parseFloat(rn.value); if (v > 0) { S.los.radius = +(v * NM).toFixed(3); rk.value = +S.los.radius.toFixed(2); saveState(); } };
    $('losRun').onclick = function () { RF.runP2P({ losOnly: true }); };
    $('losMap').onclick = function () { COV.run({ losOnly: true }); };
  }
  watch('rx.mode', function () { if (curPanel === 'los') rerender(); });
  watch('los.rxMode', function () { if (curPanel === 'los') rerender(); });
  return { render: render, after: after };
})();
