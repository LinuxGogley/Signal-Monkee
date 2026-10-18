var MASCOT_SVG = '<img class="mascot" alt="Signal Monkee" style="width:72px;height:72px" src="' + (document.querySelector('.logo img') || {}).src + '">';
/* ===================== Terrain/settings panel, help, initialisation ===================== */
function renderTerrain() {
  var hl = DEM.hgtList();
  var h = '<h3>Terrain & settings</h3>';
  h += '<div class="card"><div class="kv"><span>Online terrain</span><b>' + (DEM.cfg.useTiles ? 'AWS Terrain Tiles (Terrarium)' : 'disabled') + '</b><span>Tiles in memory</span><b id="tMem">' + DEM.memCount() + '</b><span>Fetched / cache hits / failed</span><b id="tStat">' + DEM.stats.fetched + ' / ' + DEM.stats.cached + ' / ' + DEM.stats.failed + '</b><span>Offline cache</span><b id="tIdb">…</b><span>Loaded .hgt tiles</span><b>' + hl.length + '</b></div></div>';
  h += '<div class="note">Elevations come from the AWS/Mapzen Terrain Tiles (SRTM 1″ / USGS NED / GMTED / ETOPO), the same SRTM-family data behind most Google Earth terrain. For SPLAT!-identical inputs or fully offline work, load SRTM .hgt (or .hgt.zip) files — they take priority wherever they cover.</div>';
  h += '<div class="row"><label class="chk"><input type="checkbox" id="tUse" ' + (DEM.cfg.useTiles ? 'checked' : '') + '> Use online terrain tiles</label><label class="chk"><input type="checkbox" id="tClamp" ' + (DEM.cfg.clampSea ? 'checked' : '') + '> Clamp bathymetry to 0 m</label></div>';
  h += F('Path-profile zoom', 'p2pZ', { sel: [[11, 'z11 (~60 m)'], [12, 'z12 (~30 m, SRTM 1″)'], [13, 'z13 (~15 m, NED where available)'], [14, 'z14 (~8 m, 3DEP where available)']], num: 1 });
  h += '<div class="f"><label>Terrain tile URL</label><input id="tUrl" value="' + esc(DEM.cfg.url) + '"></div><div class="note">Any Terrarium-encoded PNG source works (e.g. a local tile server for air-gapped use).</div>';
  h += '<div class="row"><button class="btn sm" id="tHgt">Load SRTM .hgt / .zip</button><button class="btn sm" id="tPre">Pre-cache view for offline</button><button class="btn sm" id="tClrM">Clear memory</button><button class="btn sm" id="tClrI">Clear offline cache</button></div>';
  if (hl.length) h += '<table class="t">' + hl.map(function (x, i) { return '<tr><td>' + esc(x.name) + '</td><td>' + x.lat + ', ' + x.lon + '</td><td>' + (x.n === 3601 ? '1″' : x.n === 1201 ? '3″' : x.n) + '</td><td><a class="lnk" onclick="DEM.removeHGT(' + i + ');rerender()" title="Remove">' + ico('close') + '</a></td></tr>'; }).join('') + '</table>';
  h += '<h4>Units & behaviour</h4><div class="row">Units: <div class="seg" id="unitSeg2"><button data-u="m" class="' + (S.units.h === 'm' ? 'on' : '') + '">metres · km</button><button data-u="ft" class="' + (S.units.h === 'ft' ? 'on' : '') + '">feet · NM</button></div></div>';
  h += '<div class="row"><button class="btn sm" id="resetAll">Reset all settings</button></div>';
  return h;
}
function afterTerrain() {
  DEM.idbCount('tiles').then(function (n) { var e = $('tIdb'); if (e) e.textContent = n + ' tiles'; });
  $('tUse').onchange = function () { DEM.cfg.useTiles = this.checked; saveDemCfg(); };
  $('tClamp').onchange = function () { DEM.cfg.clampSea = this.checked; saveDemCfg(); };
  $('tUrl').onchange = function () { DEM.cfg.url = this.value.trim(); DEM.clearMem(); saveDemCfg(); log('Terrain URL set.'); };
  $('tHgt').onclick = loadHGT;
  $('tPre').onclick = function () {
    var b = map.getBounds(), z = DEM.zoomFor(b.getSouth(), b.getWest(), b.getNorth(), b.getEast(), +S.p2pZ, 600);
    prog(true, 'Caching terrain z' + z + '…', 0);
    DEM.ensure(b.getSouth(), b.getWest(), b.getNorth(), b.getEast(), z, function (d, t) { prog(true, 'Caching terrain z' + z + ' ' + d + '/' + t, d / t); }).then(function (f) {
      // also cache one coarser level for wide-area coverage
      var z2 = Math.max(z - 2, 6);
      return DEM.ensure(b.getSouth(), b.getWest(), b.getNorth(), b.getEast(), z2).then(function () { prog(false); log('Terrain cached for offline use (z' + z + ' + z' + z2 + ')' + (f ? ', ' + f + ' failed' : ''), f ? 'w' : 'g'); rerender(); });
    });
  };
  $('tClrM').onclick = function () { DEM.clearMem(); rerender(); };
  $('tClrI').onclick = function () { DEM.idbClear('tiles').then(rerender); };
  $('unitSeg2').onclick = function (e) { var b = e.target.closest('button'); if (b) setUnits(b.dataset.u); };
  $('resetAll').onclick = function () { if (confirm('Reset all settings to defaults?')) { localStorage.removeItem('pathlink.state'); location.reload(); } };
}
function saveDemCfg() { try { localStorage.setItem('pathlink.dem', JSON.stringify({ url: DEM.cfg.url, useTiles: DEM.cfg.useTiles, clampSea: DEM.cfg.clampSea })); } catch (e) { } }
function loadHGT() {
  pickFiles('.hgt,.zip', true).then(function (fs) {
    var jobs = fs.map(function (f) {
      return readBuf(f).then(function (buf) {
        if (/\.zip$/i.test(f.name)) return DEM.unzip(buf).then(function (ents) { ents.filter(function (e) { return /\.hgt$/i.test(e.name); }).forEach(function (e) { var r = DEM.addHGT(e.name.split('/').pop(), e.data); log('Loaded ' + e.name + ' ' + r.res, 'g'); }); });
        var r = DEM.addHGT(f.name, buf); log('Loaded ' + f.name + ' (' + r.res + ')', 'g');
      }).catch(function (e) { log(f.name + ': ' + e.message, 'e'); });
    });
    Promise.all(jobs).then(rerender);
  });
}
function setUnits(u) {
  S.units.h = u; saveState();
  document.querySelectorAll('#unitSeg button').forEach(function (b) { b.classList.toggle('on', b.dataset.u === u); });
  rerender(); RF.drawProfile(); TP.renderTable(); OPS.refreshSummary();
  if (RF.last) $('reportTxt').textContent = RF.report(RF.last);   // feet → reports in NM and ft; metres → km and m
}
function renderHelp() {
  return '<div style="display:flex;align-items:center;gap:12px"><div style="width:72px;height:72px">'+MASCOT_SVG+'</div><div><h3 style="margin:0">Signal Monkee — quick guide</h3><div class="mini">Mascot: Signal Monkee, ears up and listening</div></div></div>' +
    '<div class="card"><b>Operator vs Engineer</b><br><b>Operator</b> is a one-page line-of-sight check for pilots and field users: set the two ends, frequency, power, antenna gains and a minimum RSSI. It answers “can they see each other over the terrain, and is the signal strong enough?” using free-space loss and isotropic antennas — PASS needs clear line of sight and RSSI ≥ minimum. <b>Engineer</b> adds the propagation models (Longley-Rice, P.526, Hata), Fresnel zones, antenna patterns, feeder and fade margins.</div>' +
    '<div class="card"><b>LOS planning</b><br>Terrain-only line of sight, with no radio settings: check whether two points can see each other (with the altitude needed if not), or map everywhere a target at a chosen height can see point A (viewshed). Available in both modes.</div>' +
    '<div class="card"><b>Placing sites</b><br>Use the Tx / Rx map buttons (or drag the markers, or type coordinates). Placing or moving sites never downloads terrain — data is pulled only when you press Path or Coverage. Clear ▾ removes results, the Tx/Rx markers, or both.</div>' +
    '<div class="card"><b>Point-to-point (SPLAT! path mode)</b><br>Drag the Tx/Rx markers or use the Tx/Rx map buttons, then Path (P). You get the terrain profile with earth curvature (k from N0), first/60% Fresnel zones, obstruction list, antenna-height requirements, ITM/P.526/FSPL/Hata losses and the full link budget Hover the profile to trace the point on the map.</div>' +
    '<div class="card"><b>Area coverage (SPLAT! -c / -L)</b><br>Coverage (C) sweeps radials from the Tx (multi-threaded). Display modes: dBm, path loss, dBµV/m, SNR, margin, LOS. Change power/gain/display without recomputing. “Keep as layer” to overlay several sites.</div>' +
    '<div class="card"><b>Aviation</b><br>Towers, airports, ARTCC centers and navaids with clickable frequencies. Airband panel: ICAO lookup, towered fields near a point, reverse frequency finder, and an air-ground preset (Rx at altitude MSL).</div>' +
    '<div class="card"><b>Repeaters & Meshtastic</b><br>Layers panel fetches RepeaterBook, BrandMeister and Meshtastic map data (or import saved JSON/CSV). Any site popup → “Coverage from here”.</div>' +
    '<div class="card"><b>GNSS & SATCOM</b><br>Fetch TLEs (CelesTrak) → sky plot with terrain horizon, multi-GNSS DOP, 24 h timeline, terrain-masked PDOP grid. SATCOM: GEO look angles & footprints (Inmarsat, ViaSat…), LEO visibility/availability (Iridium, Starlink, OneWeb, Globalstar).</div>' +
    '<div class="card"><b>Keys</b><br>P path · C coverage · T/R pick Tx/Rx · A add test point · G GNSS point · B cycle basemap · Esc cancel pick · right-click map for context menu.</div>' +
    '<div class="note">Model notes: ITM is a faithful port of NTIA/ITS ITM v1.4 (validated against the C++ reference). Valid 20 MHz–20 GHz, terminal heights 0.5–3000 m; above 3 km (aircraft) the engine switches to geometric LOS + ITU-R P.526 Deygout diffraction. Terrain is bare earth — add clutter loss for vegetation/buildings. Frequencies, repeater and satellite data are informational; verify against official sources before operational use.</div>' +
    '<div class="note">Data: OurAirports (public domain), Natural Earth, AWS Terrain Tiles, CelesTrak, RepeaterBook, BrandMeister, meshmap.net, gpsjam.org. Libraries: Leaflet (BSD-2), satellite.js (MIT), h3-js (Apache-2.0).</div>';
}

/* ---------- register panels ---------- */
panel('rf', 'RF Link', RF.render, RF.after);
panel('los', 'LOS planning', LOSP.render, LOSP.after);
panel('layers', 'Layers', function () { return LAY.renderLayers(); }, function () { LAY.afterLayers(); });
panel('air', 'Airband ATC', function () { return LAY.renderAir(); }, function () { LAY.afterAir(); });
panel('gnss', 'GNSS', function () { return SAT.renderGnss(); }, function () { SAT.afterGnss(); });
panel('sat', 'SATCOM', function () { return SAT.renderSat(); }, function () { SAT.afterSat(); });
panel('tp', 'Test points', TP.render);
panel('terrain', 'Terrain', renderTerrain, afterTerrain);
panel('offline', 'Offline data', OFFLINE.render, OFFLINE.after);
panel('help', 'Help', renderHelp);

/* ---------- boot ---------- */
function boot() {
  try { var dc = JSON.parse(localStorage.getItem('pathlink.dem') || 'null'); if (dc) Object.assign(DEM.cfg, dc); } catch (e) { }
  buildRail();
  applyIcons(document);
  initMap();
  initDrawer();
  RF.initProfileHover();
  initSearch();
  showPanel('rf');
  document.querySelectorAll('#unitSeg button').forEach(function (b) { b.classList.toggle('on', b.dataset.u === S.units.h); });
  $('unitSeg').onclick = function (e) { var b = e.target.closest('button'); if (b) setUnits(b.dataset.u); };
  $('baseSeg').onclick = function (e) { var b = e.target.closest('button'); if (b) setBase(b.dataset.b); };
  // bottom buttons: RF analysis on the RF panel, terrain-only LOS on the LOS panel (hidden on other panels)
  $('bP2P').onclick = function () { runPath(); };
  $('bCov').onclick = function () { runCoverage(); };
  $('clrRes').onclick = function (e) { e.stopPropagation(); $('clrMenu').classList.toggle('hidden'); };
  $('clrMenu').onclick = function (e) { var b = e.target.closest('button'); if (!b) return; $('clrMenu').classList.add('hidden'); if (b.dataset.c !== 'sites') OPS.clearResults(); if (b.dataset.c !== 'res') clearSites(); if (b.dataset.c === 'all') { SAT.clearPoint(); if (curPanel === 'gnss' || curPanel === 'sat') rerender(); } };
  document.addEventListener('click', function (e) { if (!e.target.closest('#clrMenu')) $('clrMenu').classList.add('hidden'); });
  $('dlPdf').onclick = OPS.pdf;
  $('modeSeg').onclick = function (e) { var b = e.target.closest('button'); if (b) OPMODE.setMode(b.dataset.m); };
  OPMODE.applyChrome();
  $('bSave').onclick = PROJ.save; $('bLoad').onclick = PROJ.load;
  $('pickTx').onclick = function () { setPick('tx'); }; $('pickRx').onclick = function () { setPick('rx'); };
  $('pickTp').onclick = function () { setPick('tp'); }; $('pickGn').onclick = function () { setPick('gn'); };
  document.addEventListener('keydown', function (e) {
    if (/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName) || e.ctrlKey || e.metaKey || e.altKey) return;
    var k = e.key.toLowerCase();
    if (k === 'p') runPath(); else if (k === 'c') runCoverage(); else if (k === 't') setPick('tx'); else if (k === 'r') setPick('rx');
    else if (k === 'a') setPick('tp'); else if (k === 'g') setPick('gn'); else if (k === 'b') cycleBase(); else if (k === 'escape' && pickMode) setPick(pickMode);
  });
  DEM.onChange(function (st) { var e = $('tStat'); if (e) e.textContent = st.fetched + ' / ' + st.cached + ' / ' + st.failed; var m = $('tMem'); if (m) m.textContent = DEM.memCount(); });
  log('Signal Monkee ' + VERSION + ' — SPLAT!-style terrain analysis in your browser.', 'g');
  RF.logBudget();
  status('loading data…');
  loadEmbedded().then(function () {
    LAY.initLayers(); TP.draw();
    buildBaseLayers(); setBase(S.base);   // land polygons and coast data arrive with the embedded data: rebuild the Contrast map now
    status('ready');
    log('Loaded ' + DATA.airports.length + ' airports, ' + DATA.navaids.length + ' navaids, ' + DATA.cities.length + ' places.');
    return SAT.loadCached();
  }).then(function () { if (S.geoSel && S.geoSel.length) SAT.geoFootprints(); if (S.liveSel && Object.values(S.liveSel).some(Boolean)) SAT.live(true); })
    .catch(function (e) { status('data error'); log('Embedded data failed to load: ' + e.message + ' (use a current Chrome/Edge/Firefox/Safari).', 'e'); console.error(e); });
}
document.addEventListener('DOMContentLoaded', boot);
