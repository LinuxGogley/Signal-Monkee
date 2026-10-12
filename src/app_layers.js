/* ===================== Data layers: airports/ATC, navaids, ham repeaters, DMR, Meshtastic, GNSS interference ===================== */
var LAY = (function () {
  var G = {};            // layer groups
  var ext = { ham: [], dmr: [], mesh: [], custom: [] }; // fetched/imported point sets
  var gpsjam = null;     // h3 overlay layer
  var FREQ_ORDER = ['ATIS', 'D-ATIS', 'CLD', 'CD', 'GND', 'TWR', 'APP', 'DEP', 'A/D', 'CNTR', 'CTAF', 'UNIC', 'AWOS', 'ASOS', 'RCO', 'FSS', 'MISC'];
  var FREQ_NAMES = { ATIS: 'ATIS', CLD: 'Clearance Delivery', GND: 'Ground', TWR: 'Tower', APP: 'Approach', DEP: 'Departure', 'A/D': 'Approach/Departure', CNTR: 'Center (ARTCC)', CTAF: 'CTAF', UNIC: 'UNICOM', AWOS: 'AWOS', ASOS: 'ASOS', RCO: 'Remote Comm Outlet', FSS: 'Flight Service', MISC: 'Misc' };

  function initLayers() {
    ['airports', 'towers', 'artcc', 'rco', 'navaids', 'ham', 'dmr', 'mesh', 'gnssAreas', 'custom', 'meshLinks'].forEach(function (k) { G[k] = L.layerGroup().addTo(map); });
    map.on('moveend', refreshDynamic);
    try { var c = JSON.parse(localStorage.getItem('pathlink.ext') || 'null'); if (c) ext = Object.assign(ext, c); } catch (e) { }
    loadExtIDB().then(function () { refreshAll(); });
  }
  function saveExt() { DEM.idbPut('kv', 'ext', JSON.stringify(ext)); }
  function loadExtIDB() { return DEM.idbGet('kv', 'ext').then(function (j) { if (j) try { ext = Object.assign(ext, JSON.parse(j)); } catch (e) { } }); }

  /* ---------- airports & ATC ---------- */
  function apHasTwr(a) { return a[9].some(function (f) { return f[0] === 'TWR'; }); }
  function apColor(a) { return a[2] === 'L' ? '#ff9f1c' : a[2] === 'M' ? '#ffd166' : '#a8dadc'; }
  function refreshDynamic() {
    G.airports.clearLayers(); G.towers.clearLayers(); G.rco.clearLayers(); G.navaids.clearLayers();
    if (!DATA.airports) return;
    var b = map.getBounds().pad(0.1), z = map.getZoom(), lyr = S.layers, n = 0;
    var showL = lyr.airportsL && z >= 4, showM = lyr.airportsM && z >= 6, showS = lyr.airportsS && z >= 8;
    DATA.airports.forEach(function (a) {
      if (!b.contains([a[4], a[5]])) return;
      var twr = apHasTwr(a);
      var show = (a[2] === 'L' && showL) || (a[2] === 'M' && showM) || ((a[2] === 'S' || a[2] === 'W') && showS);
      if (lyr.towers && twr && z >= 6) {
        n++;
        var m = L.marker([a[4], a[5]], { icon: L.divIcon({ className: '', iconSize: [18, 18], iconAnchor: [9, 9], html: '<svg width="18" height="18" viewBox="0 0 18 18"><rect x="1" y="1" width="16" height="16" rx="3" fill="#1b1f23" stroke="' + apColor(a) + '" stroke-width="1.6"/><path d="M6 15h6M9 15V8M6 6h6l-1 2H7z" stroke="' + apColor(a) + '" stroke-width="1.5" fill="none"/></svg>' }), title: a[0] + ' tower' });
        m.on('click', function () { openAirport(a); }); G.towers.addLayer(m);
      } else if (show) {
        n++;
        var cm = L.circleMarker([a[4], a[5]], { renderer: rnd, radius: a[2] === 'L' ? 6 : a[2] === 'M' ? 4.5 : 3.2, color: '#111', weight: 1, fillColor: apColor(a), fillOpacity: 0.95 });
        cm.on('click', function () { openAirport(a); }); cm.bindTooltip(a[0] + ' ' + a[3]); G.airports.addLayer(cm);
      }
      if (lyr.rco && z >= 6) {
        var rc = a[9].filter(function (f) { return f[0] === 'RCO' || f[0] === 'CNTR' || /RCO|RCAG|CNTR|CENTER/i.test(f[1]); });
        if (rc.length) {
          var rm = L.circleMarker([a[4], a[5]], { renderer: rnd, radius: 7, color: '#ff6b6b', weight: 2, fill: false });
          rm.bindTooltip(a[0] + ': ' + rc.map(function (f) { return f[1] + ' ' + f[2]; }).join(', ')); rm.on('click', function () { openAirport(a); }); G.rco.addLayer(rm);
        }
      }
    });
    if (lyr.navaids && DATA.navaids && z >= 7) {
      DATA.navaids.forEach(function (v) {
        if (!b.contains([v[4], v[5]])) return;
        var isV = /VOR|TACAN/.test(v[2]), fq = isV || v[2] === 'DME' ? (v[3] / 1000).toFixed(2) + ' MHz' : v[3] + ' kHz';
        var mk = L.circleMarker([v[4], v[5]], { renderer: rnd, radius: 4, color: isV ? '#4cc9f0' : '#b388ff', weight: 2, fillOpacity: 0.2 });
        mk.bindPopup('<h5>' + esc(v[0]) + ' ' + esc(v[1]) + ' ' + esc(v[2]) + '</h5>' + fq + (v[8] ? ' · ch ' + esc(v[8]) : '') + '<br>Elev ' + (v[6] != null ? v[6] + ' ft' : '—') + (v[9] ? ' · ' + esc(v[9]) : '') + siteLinks(v[4], v[5], v[0] + ' ' + v[2], isV ? v[3] / 1000 : null, v[6] != null ? 10 : 10));
        G.navaids.addLayer(mk);
      });
    }
    drawExt(); drawARTCC();
  }
  function siteLinks(lat, lon, name, fMHz, h) {
    var nm = esc(String(name).replace(/'/g, ''));
    return '<div class="row" style="margin-top:6px"><a class="lnk" onclick="LAY.useAs(\'tx\',' + lat + ',' + lon + ',\'' + nm + '\',' + (fMHz || 'null') + ',' + (h || 'null') + ')">Set as Tx</a> · <a class="lnk" onclick="LAY.useAs(\'rx\',' + lat + ',' + lon + ',\'' + nm + '\',' + (fMHz || 'null') + ',null)">Set as Rx</a> · <a class="lnk" onclick="LAY.useAs(\'cov\',' + lat + ',' + lon + ',\'' + nm + '\',' + (fMHz || 'null') + ',' + (h || 'null') + ')">Coverage from here</a> · <a class="lnk" onclick="TP.add(' + lat + ',' + lon + ',\'' + nm + '\')">+Test pt</a></div>';
  }
  function useAs(k, lat, lon, name, f, h) {
    map.closePopup();
    if (f) { S.f = +f; }
    if (k === 'cov') { if (h) S.tx.h = h; setSite('tx', lat, lon, name); rerender(); COV.run(); return; }
    if (h && k === 'tx') S.tx.h = h;
    setSite(k, lat, lon, name); rerender();
    if (f) log('Frequency set to ' + f + ' MHz from ' + name);
  }
  function openAirport(a) {
    var groups = {};
    a[9].forEach(function (f) { var t = f[0]; (groups[t] = groups[t] || []).push(f); });
    var keys = Object.keys(groups).sort(function (x, y) { var i = FREQ_ORDER.indexOf(x), j = FREQ_ORDER.indexOf(y); return (i < 0 ? 99 : i) - (j < 0 ? 99 : j); });
    var h = '<h5>' + esc(a[0]) + (a[1] ? ' / ' + esc(a[1]) : '') + ' — ' + esc(a[3]) + '</h5><div class="mini">' + esc(a[8]) + ' ' + esc(a[7]) + ' · elev ' + (a[6] != null ? a[6] + ' ft' : '—') + ' · ' + fx(a[4], 4) + ', ' + fx(a[5], 4) + ' · ' + { L: 'large', M: 'medium', S: 'small', W: 'seaplane' }[a[2]] + '</div>';
    if (keys.length) {
      h += '<table style="margin-top:6px">';
      keys.forEach(function (k) { groups[k].forEach(function (f) { h += '<tr><td><b>' + esc(FREQ_NAMES[k] || k) + '</b></td><td>' + esc(f[1]) + '</td><td style="text-align:right;font-family:var(--mono)"><a class="lnk" title="Use this frequency" onclick="S.f=' + f[2] + ';saveState();rerender();log(\'f = ' + f[2] + ' MHz (' + esc(a[0]) + ' ' + esc(f[1]) + ')\')">' + fx(f[2], 3) + '</a></td></tr>'; }); });
      h += '</table><div class="note">Click a frequency to load it. Data: OurAirports — verify with the current Chart Supplement/AIP.</div>';
    } else h += '<div class="note">No frequencies on file.</div>';
    var twr = (groups.TWR || [])[0];
    h += siteLinks(a[4], a[5], a[0] + (twr ? ' TWR' : ''), twr ? twr[2] : (groups.CTAF || groups.UNIC || [[0, 0, null]])[0][2], 20);
    L.popup({ maxWidth: 420 }).setLatLng([a[4], a[5]]).setContent(h).openOn(map);
  }
  function findAirport(q) {
    if (!DATA.airports) return null; q = q.trim().toUpperCase();
    return DATA.airports.find(function (a) { return a[0] === q || a[1] === q || a[0] === 'K' + q; }) || null;
  }
  function drawARTCC() {
    G.artcc.clearLayers(); if (!S.layers.artcc || map.getZoom() < 5) return;
    STATIC.artcc.forEach(function (c) {
      var m = L.marker([c[2], c[3]], { icon: L.divIcon({ className: '', iconSize: [38, 18], iconAnchor: [19, 9], html: '<div class="mk artcc" style="width:38px;height:18px;font-size:10px">' + c[0] + '</div>' }) });
      m.bindPopup('<h5>' + c[0] + ' — ' + esc(c[1]) + '</h5><div class="mini">Air Route Traffic Control Center (approx. facility location). En-route sectors are served by remote RCAG sites — load NASR data via Layers → Import to plot them.</div>' + siteLinks(c[2], c[3], c[0], null, 30));
      G.artcc.addLayer(m);
    });
  }
  function drawGnssAreas() {
    G.gnssAreas.clearLayers(); if (!S.layers.gnssAreas) return;
    STATIC.gnssAreas.forEach(function (a) {
      var c = L.circle([a[1], a[2]], { radius: a[3] * 1000, color: a[4] === 'test' ? '#ffb703' : '#e5484d', weight: 1.5, dashArray: '6 4', fillOpacity: 0.06 });
      c.bindPopup('<h5>' + esc(a[0]) + '</h5><div class="mini">' + (a[4] === 'test' ? 'Frequent GPS interference-testing NOTAMs. Affected radius varies with altitude (often hundreds of NM at FL400). Check FAA NOTAMs.' : 'Persistent GNSS interference reported publicly (e.g. EASA SIB 2022-02, gpsjam.org). Indicative only.') + '</div>');
      G.gnssAreas.addLayer(c);
    });
  }

  /* ---------- external point sets (ham / DMR / Meshtastic / custom) ---------- */
  function pick(o, keys) { for (var i = 0; i < keys.length; i++) { var k = keys[i]; if (o[k] !== undefined && o[k] !== null && o[k] !== '') return o[k]; } var lk = Object.keys(o); for (i = 0; i < keys.length; i++) { var f = lk.find(function (x) { return x.toLowerCase() === keys[i].toLowerCase(); }); if (f && o[f] !== '' && o[f] != null) return o[f]; } return undefined; }
  function num(v) { var x = parseFloat(v); return isFinite(x) ? x : NaN; }
  function normFreq(v) { var x = num(v); if (!isFinite(x)) return NaN; if (x > 1e6) return x / 1e6; if (x > 1e4) return x / 1e3; return x; }
  function yes(v) { return v === true || /^(yes|y|true|1|on)$/i.test(String(v || '').trim()); }
  function normalize(o, kind) {
    var lat = num(pick(o, ['lat', 'Lat', 'latitude', 'Latitude', 'LAT', 'latitude_deg', 'LAT_DECIMAL', 'lat_dd'])), lon = num(pick(o, ['lon', 'lng', 'Long', 'long', 'longitude', 'Longitude', 'LON', 'longitude_deg', 'LONG_DECIMAL', 'lon_dd']));
    if (o.position && typeof o.position === 'object') { lat = num(o.position.latitude || o.position.lat); lon = num(o.position.longitude || o.position.lon || o.position.lng); }
    if (Math.abs(lat) > 90) { lat /= 1e7; lon /= 1e7; }
    if (!isFinite(lat) || !isFinite(lon) || (lat === 0 && lon === 0)) return null;
    var p = { lat: lat, lon: lon, kind: kind };
    p.name = String(pick(o, ['Callsign', 'callsign', 'long_name', 'longName', 'name', 'Name', 'ident', 'SITE_LOCATION', 'Landmark', 'id']) || '?');
    p.short = pick(o, ['short_name', 'shortName']);
    p.f = normFreq(pick(o, ['Frequency', 'frequency', 'freq', 'tx', 'Output', 'output', 'FREQ', 'FREQUENCY', 'downlink']));
    p.fin = normFreq(pick(o, ['Input Freq', 'input', 'rx', 'Input', 'uplink']));
    p.tone = pick(o, ['PL', 'CTCSS', 'tone', 'Tone', 'encode', 'TSQ']);
    p.city = pick(o, ['Nearest City', 'city', 'City', 'location', 'Location', 'County']);
    p.status = pick(o, ['Operational Status', 'status', 'Status']);
    p.use = pick(o, ['Use', 'use']);
    var modes = [];
    if (yes(o['FM Analog']) || /^(fm|analog|am)$/i.test(o.mode || '')) modes.push('FM');
    if (yes(o['DMR']) || /dmr/i.test(o.mode || '') || kind === 'dmr') modes.push('DMR');
    if (yes(o['D-Star']) || /d-?star/i.test(o.mode || '')) modes.push('D-STAR');
    if (yes(o['System Fusion']) || /fusion|ysf|c4fm/i.test(o.mode || '')) modes.push('Fusion');
    if (yes(o['APCO P-25']) || /p-?25/i.test(o.mode || '')) modes.push('P25');
    if (yes(o['NXDN']) || /nxdn/i.test(o.mode || '')) modes.push('NXDN');
    if (yes(o['M17']) || /m17/i.test(o.mode || '')) modes.push('M17');
    if (yes(o['Tetra'])) modes.push('TETRA');
    if (!modes.length && kind === 'ham') modes.push(o.mode ? String(o.mode).toUpperCase() : 'FM');
    p.modes = modes;
    p.cc = pick(o, ['DMR Color Code', 'colorcode', 'color_code']);
    p.links = ['AllStar Node', 'EchoLink Node', 'IRLP Node', 'Wires Node'].filter(function (k) { return o[k]; }).map(function (k) { return k.split(' ')[0] + ' ' + o[k]; }).join(', ');
    if (kind === 'mesh') {
      p.role = String(pick(o, ['role', 'Role']) || 'CLIENT').toUpperCase();
      p.hw = pick(o, ['hardware_model', 'hwModel', 'hw_model', 'hardware']);
      p.alt = num(pick(o, ['altitude', 'alt']));
      var ls = pick(o, ['updated_at', 'lastHeard', 'last_heard', 'seen', 'lastSeen', 'position_updated_at']);
      p.seen = ls ? (isFinite(+ls) ? (+ls < 1e12 ? +ls * 1000 : +ls) : Date.parse(ls)) : NaN;
      p.id = pick(o, ['node_id', 'id', 'nodeId', 'num']);
      p.neighbours = o.neighbours || o.neighbors || null;
      p.preset = pick(o, ['modem_preset', 'modemPreset']); p.region = pick(o, ['region', 'region_name']);
    }
    if (kind === 'dmr') { p.hw = pick(o, ['hardware']); p.agl = num(pick(o, ['agl'])); p.pep = num(pick(o, ['pep'])); }
    return p;
  }
  function ingest(kind, data, label) {
    var arr = Array.isArray(data) ? data : (data && (data.results || data.nodes || data.data || data.devices)) || (data && typeof data === 'object' ? Object.keys(data).map(function (k) { var o = data[k]; if (o && typeof o === 'object' && o.id === undefined) o.id = k; return o; }) : []);
    var pts = arr.map(function (o) { return o && typeof o === 'object' ? normalize(o, kind) : null; }).filter(Boolean);
    ext[kind] = pts; saveExt(); drawExt();
    log((label || kind) + ': ' + pts.length + ' sites loaded (' + arr.length + ' records)', pts.length ? 'g' : 'w');
    if (pts.length && kind !== 'custom') { var b = L.latLngBounds(pts.map(function (p) { return [p.lat, p.lon]; })); if (!map.getBounds().intersects(b)) map.fitBounds(b, { maxZoom: 9 }); }
    if (curPanel === 'layers') rerender();
    return pts.length;
  }
  function modeColor(p) {
    var m = p.modes || [];
    if (m.indexOf('DMR') >= 0) return '#ff4d6d'; if (m.indexOf('D-STAR') >= 0) return '#4cc9f0'; if (m.indexOf('Fusion') >= 0) return '#b388ff';
    if (m.indexOf('P25') >= 0) return '#06d6a0'; if (m.indexOf('NXDN') >= 0) return '#ffd166'; if (m.indexOf('M17') >= 0) return '#ff9f1c'; return '#f1f1f1';
  }
  function drawExt() {
    ['ham', 'dmr', 'mesh', 'custom', 'meshLinks'].forEach(function (k) { G[k].clearLayers(); });
    var b = map.getBounds().pad(0.2), lyr = S.layers;
    function pop(p, extra) {
      return '<h5>' + esc(p.name) + (p.short ? ' (' + esc(p.short) + ')' : '') + '</h5><table>' +
        (isFinite(p.f) ? '<tr><td>Output</td><td><a class="lnk" onclick="S.f=' + p.f + ';saveState();rerender()">' + fx(p.f, 4) + ' MHz</a></td></tr>' : '') +
        (isFinite(p.fin) ? '<tr><td>Input</td><td>' + fx(p.fin, 4) + ' MHz (' + sgn(p.fin - p.f, 3) + ')</td></tr>' : '') +
        (p.tone ? '<tr><td>Tone/CC</td><td>' + esc(p.tone) + '</td></tr>' : '') + (p.cc ? '<tr><td>Colour code</td><td>' + esc(p.cc) + '</td></tr>' : '') +
        (p.modes && p.modes.length ? '<tr><td>Modes</td><td>' + esc(p.modes.join(', ')) + '</td></tr>' : '') +
        (p.city ? '<tr><td>Location</td><td>' + esc(p.city) + '</td></tr>' : '') + (p.status ? '<tr><td>Status</td><td>' + esc(p.status) + (p.use ? ' / ' + esc(p.use) : '') + '</td></tr>' : '') +
        (p.links ? '<tr><td>Links</td><td>' + esc(p.links) + '</td></tr>' : '') + (extra || '') + '</table>' + siteLinks(p.lat, p.lon, p.name, isFinite(p.f) ? p.f : null, isFinite(p.agl) ? p.agl : 15);
    }
    if (lyr.ham) ext.ham.forEach(function (p) {
      if (!b.contains([p.lat, p.lon])) return;
      var dig = p.modes.some(function (m) { return m !== 'FM'; });
      if (lyr.hamDigitalOnly && !dig || lyr.hamAnalogOnly && dig) return;
      var m = L.circleMarker([p.lat, p.lon], { renderer: rnd, radius: 5, color: '#111', weight: 1, fillColor: modeColor(p), fillOpacity: 0.95 });
      m.bindPopup(pop(p)); m.bindTooltip(p.name + ' ' + (isFinite(p.f) ? fx(p.f, 3) : '') + ' ' + p.modes.join('/'));
      G.ham.addLayer(m);
    });
    if (lyr.dmr) ext.dmr.forEach(function (p) {
      if (!b.contains([p.lat, p.lon])) return;
      var m = L.circleMarker([p.lat, p.lon], { renderer: rnd, radius: 4.5, color: '#ff4d6d', weight: 2, fillColor: '#3a0d15', fillOpacity: 0.9 });
      m.bindPopup(pop(p, p.hw ? '<tr><td>Hardware</td><td>' + esc(p.hw) + '</td></tr>' : '')); G.dmr.addLayer(m);
    });
    if (lyr.mesh) {
      var byId = {};
      ext.mesh.forEach(function (p) { if (p.id != null) byId[p.id] = p; });
      ext.mesh.forEach(function (p) {
        if (!b.contains([p.lat, p.lon])) return;
        var infra = /ROUTER|REPEATER/.test(p.role);
        if (lyr.meshRolesOnly && !infra) return;
        var age = isFinite(p.seen) ? (Date.now() - p.seen) / 3600e3 : NaN;
        var col = !isFinite(age) ? '#999' : age < 2 ? '#2fe07a' : age < 24 ? '#ffd166' : age < 24 * 7 ? '#ff9f1c' : '#777';
        var m = L.circleMarker([p.lat, p.lon], { renderer: rnd, radius: infra ? 6.5 : 4, color: infra ? '#fff' : '#111', weight: infra ? 2 : 1, fillColor: col, fillOpacity: 0.95 });
        m.bindPopup(pop(p, '<tr><td>Role</td><td>' + esc(p.role) + '</td></tr>' + (p.hw ? '<tr><td>Hardware</td><td>' + esc(p.hw) + '</td></tr>' : '') + (isFinite(p.alt) ? '<tr><td>Altitude</td><td>' + fx(p.alt, 0) + ' m</td></tr>' : '') + (isFinite(age) ? '<tr><td>Last heard</td><td>' + (age < 48 ? fx(age, 1) + ' h ago' : fx(age / 24, 0) + ' d ago') + '</td></tr>' : '') + (p.preset ? '<tr><td>Preset</td><td>' + esc(p.preset) + '</td></tr>' : '') + '<tr><td>Path link</td><td><a class="lnk" onclick="LAY.meshPreset();LAY.useAs(\'tx\',' + p.lat + ',' + p.lon + ',\'' + esc(String(p.name).replace(/\'/g, '')) + '\',null,' + (infra ? 6 : 2) + ')">Tx + LongFast preset</a></td></tr>'));
        m.bindTooltip(p.name + ' · ' + p.role);
        G.mesh.addLayer(m);
        if (Array.isArray(p.neighbours)) p.neighbours.forEach(function (nb) { var q = byId[nb.node_id || nb.id || nb.nodeId]; if (q) G.meshLinks.addLayer(L.polyline([[p.lat, p.lon], [q.lat, q.lon]], { color: '#2fe07a', weight: 1, opacity: 0.5, interactive: false })); });
      });
    }
    ext.custom.forEach(function (p) {
      if (!b.contains([p.lat, p.lon])) return;
      var m = L.circleMarker([p.lat, p.lon], { renderer: rnd, radius: 5, color: '#fff', weight: 1.5, fillColor: '#ff6b6b', fillOpacity: 0.9 });
      m.bindPopup(pop(p)); G.custom.addLayer(m);
    });
  }
  function meshPreset() { S.f = 906.875; S.bwKHz = 250; S.pwrW = 0.158; S.txGain = 2.15; S.rxGain = 2.15; S.txLoss = 0.5; S.rxLoss = 0.5; S.rxNF = 6; S.reqSNR = -17.5; S.sensOverride = ''; S.itm.pol = 1; saveState(); log('Meshtastic LongFast preset loaded (US 906.875 MHz, 22 dBm, SF11/BW250, sensitivity ≈ ' + fx(RF.sens(), 1) + ' dBm). Adjust region frequency/power as needed.'); }
  function refreshAll() { refreshDynamic(); drawARTCC(); drawGnssAreas(); }

  /* ---------- live fetchers ---------- */
  function fetchRB() {
    var st = S.rbState.trim(), us = /^(united states|usa|us)$/i.test(st) || STATES.indexOf(st) >= 0;
    var url = us ? 'https://www.repeaterbook.com/api/export.php?state=' + encodeURIComponent(st) : 'https://www.repeaterbook.com/api/exportROW.php?country=' + encodeURIComponent(st);
    var opt = S.rbToken ? { headers: { 'X-RB-App-Token': S.rbToken } } : {};
    status('RepeaterBook…');
    return fetchJSONorText(url, opt).then(function (j) { status('ready'); ingest('ham', j, 'RepeaterBook ' + st); }).catch(function (e) { status('ready'); log('RepeaterBook: ' + e.message + ' URL: ' + url, 'e'); });
  }
  var STATES = ['Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado', 'Connecticut', 'Delaware', 'District of Columbia', 'Florida', 'Georgia', 'Hawaii', 'Idaho', 'Illinois', 'Indiana', 'Iowa', 'Kansas', 'Kentucky', 'Louisiana', 'Maine', 'Maryland', 'Massachusetts', 'Michigan', 'Minnesota', 'Mississippi', 'Missouri', 'Montana', 'Nebraska', 'Nevada', 'New Hampshire', 'New Jersey', 'New Mexico', 'New York', 'North Carolina', 'North Dakota', 'Ohio', 'Oklahoma', 'Oregon', 'Pennsylvania', 'Rhode Island', 'South Carolina', 'South Dakota', 'Tennessee', 'Texas', 'Utah', 'Vermont', 'Virginia', 'Washington', 'West Virginia', 'Wisconsin', 'Wyoming'];
  function fetchURL(kind, url, label) { status('fetching ' + label + '…'); return fetchJSONorText(url).then(function (j) { status('ready'); ingest(kind, j, label); }).catch(function (e) { status('ready'); log(label + ': ' + e.message, 'e'); }); }
  function importFile(kind) {
    pickFiles('.json,.csv,.txt,.kml,.geojson').then(function (fs) {
      if (!fs.length) return;
      readText(fs[0]).then(function (t) {
        var data;
        if (/^\s*[\[{]/.test(t)) { data = JSON.parse(t); if (data.type === 'FeatureCollection') data = data.features.map(function (f) { return Object.assign({}, f.properties, { lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0] }); }); }
        else if (/<kml/i.test(t)) data = KML.parsePoints(t).map(function (p) { return { name: p.name, lat: p.lat, lon: p.lon }; });
        else data = csvToObjects(t);
        if (kind === 'nasr') data = joinNASR(data);
        ingest(kind === 'nasr' ? 'custom' : kind, data, fs[0].name);
      }).catch(function (e) { log('Import failed: ' + e.message, 'e'); });
    });
  }
  function joinNASR(rows) { // AFF_BASE-like rows: keep RCAG/RCO sites, add facility type to name
    return rows.filter(function (r) { return !r.FACILITY_TYPE || /RCAG|RCO|BUEC|ARSR/i.test(r.FACILITY_TYPE); }).map(function (r) { if (r.ARTCC_ID) r.name = r.ARTCC_ID + ' ' + (r.SITE_LOCATION || '') + ' ' + (r.FACILITY_TYPE || ''); return r; });
  }
  /* gpsjam.org daily H3 aggregates: hex,count_good_aircraft,count_bad_aircraft */
  function gpsjamFromText(t, label) {
    if (gpsjam) map.removeLayer(gpsjam);
    var rows = csvToObjects(t), g = L.layerGroup(), n = 0;
    rows.forEach(function (r) {
      var good = +r.count_good_aircraft || 0, bad = +r.count_bad_aircraft || 0, tot = good + bad; if (!r.hex || tot < 1) return;
      var pct = bad / tot; if (pct < 0.02) return;
      try {
        var bd = h3.cellToBoundary(r.hex);
        var col = pct > 0.1 ? '#e5484d' : pct > 0.02 ? '#ffd166' : '#2fe07a';
        g.addLayer(L.polygon(bd, { color: col, weight: 0.5, fillColor: col, fillOpacity: 0.35, renderer: rnd }).bindTooltip(fx(pct * 100, 1) + '% of ' + tot + ' aircraft reported degraded GNSS'));
        n++;
      } catch (e) { }
    });
    gpsjam = g.addTo(map);
    log('GPS interference (' + label + '): ' + n + ' hexes with ≥2% degraded aircraft.', 'g');
  }
  function fetchGpsjam(date) {
    var url = 'https://gpsjam.org/data/' + date + '-h3_4.csv';
    status('gpsjam…');
    return fetchJSONorText(url, null, true).then(function (t) { status('ready'); gpsjamFromText(t, date); }).catch(function (e) { status('ready'); log('gpsjam: ' + e.message + ' (' + url + ')', 'e'); });
  }

  /* ---------- panels ---------- */
  function renderLayers() {
    var h = '<h3>Map layers & live data</h3>';
    h += '<h4>Aviation</h4>' + CK('Large airports', 'layers.airportsL') + CK('Medium airports', 'layers.airportsM') + CK('Small airports with frequencies (zoom ≥ 8)', 'layers.airportsS') + CK('Control towers (TWR) — click for all freqs', 'layers.towers') + CK('ARTCC centers', 'layers.artcc') + CK('RCO / Center remote outlets (from airport data)', 'layers.rco') + CK('VOR / TACAN / NDB navaids (zoom ≥ 7)', 'layers.navaids');
    h += '<div class="row"><button class="btn sm" id="impNasr">Import FAA NASR AFF / RCAG CSV</button></div>';
    h += '<h4>Amateur radio repeaters</h4>' + CK('Show repeaters (' + ext.ham.length + ')', 'layers.ham') + CK('Digital only', 'layers.hamDigitalOnly') + CK('Analog only', 'layers.hamAnalogOnly') +
      '<div class="note">Colours: <span style="color:#f1f1f1">●FM</span> <span style="color:#ff4d6d">●DMR</span> <span style="color:#4cc9f0">●D-STAR</span> <span style="color:#b388ff">●Fusion</span> <span style="color:#06d6a0">●P25</span> <span style="color:#ffd166">●NXDN</span> <span style="color:#ff9f1c">●M17</span></div>' +
      F('State / country', 'rbState', { text: 1 }) + F('RepeaterBook token', 'rbToken', { text: 1, title: 'RepeaterBook API app token if your access requires one' }) +
      '<div class="row"><button class="btn sm" id="fRB">Fetch RepeaterBook</button><button class="btn sm" id="iHam">Import JSON/CSV</button><button class="btn sm" id="cHam">Clear</button></div>';
    h += '<h4>DMR (BrandMeister)</h4>' + CK('Show DMR repeaters (' + ext.dmr.length + ')', 'layers.dmr') + '<div class="row"><button class="btn sm" id="fBM">Fetch BrandMeister devices</button><button class="btn sm" id="iDmr">Import</button><button class="btn sm" id="cDmr">Clear</button></div>';
    h += '<h4>Meshtastic</h4>' + CK('Show nodes (' + ext.mesh.length + ')', 'layers.mesh') + CK('Routers / repeaters only', 'layers.meshRolesOnly') +
      '<div class="note">Fill: <span style="color:#2fe07a">● &lt;2 h</span> <span style="color:#ffd166">● &lt;24 h</span> <span style="color:#ff9f1c">● &lt;7 d</span> <span style="color:#777">● older</span>; white ring = ROUTER/REPEATER. Neighbour links drawn when the source provides them.</div>' +
      '<div class="row"><button class="btn sm" id="fMM">Fetch meshmap.net</button><button class="btn sm" id="fLC">Fetch Liam Cottle map</button><button class="btn sm" id="iMesh">Import</button><button class="btn sm" id="cMesh">Clear</button></div>' +
      '<div class="row"><button class="btn sm" onclick="LAY.meshPreset();rerender()">Load LongFast link preset</button></div>';
    h += '<h4>GNSS interference</h4>' + CK('Known test / chronic interference areas', 'layers.gnssAreas') +
      '<div class="row"><input type="date" id="gjDate" class="inp" style="width:150px" value="' + new Date(Date.now() - 864e5).toISOString().slice(0, 10) + '"><button class="btn sm" id="fGJ">Fetch gpsjam.org</button><button class="btn sm" id="iGJ">Import CSV</button><button class="btn sm" id="cGJ">Clear</button></div>';
    h += '<h4>Basemap</h4>' + F('Map style', 'mapStyle', { sel: [['esritopo', 'Esri World Topo'], ['voyager', 'CARTO Voyager'], ['topo', 'OpenTopoMap'], ['osm', 'OpenStreetMap (needs referrer)']] }) +
      F('Contrast theme', 'flatTheme', { sel: [['gray', 'Grey terrain, dark ocean'], ['light', 'Light grey']] }) + CK('Satellite labels overlay', 'satLabels') + CK('Contrast map: city labels', 'layers.cities') + CK('Contrast map: coast/borders/states', 'layers.vectors') +
      F('Custom tile URL', 'customTiles', { text: 1, title: 'e.g. your licensed imagery or a local tile server: https://host/{z}/{x}/{y}.png' }) + (S.customTiles ? '<div class="row"><button class="btn sm" onclick="setBase(\'custom\')">Use custom tiles</button></div>' : '');
    h += '<h4>Other</h4><div class="row"><button class="btn sm" id="iCus">Import points (CSV/JSON/KML)</button><button class="btn sm" id="cCus">Clear custom (' + ext.custom.length + ')</button></div>';
    h += '<div class="note">Live sources are fetched directly by your browser. If a service blocks cross-origin requests from a local file, open the URL in a tab, save the response and use Import — the parser accepts RepeaterBook, BrandMeister, meshmap.net / Meshtastic map JSON and generic CSV with lat/lon columns.</div>';
    return h;
  }
  function afterLayers() {
    $('fRB').onclick = fetchRB; $('iHam').onclick = function () { importFile('ham'); }; $('cHam').onclick = function () { ext.ham = []; saveExt(); drawExt(); rerender(); };
    $('fBM').onclick = function () { fetchURL('dmr', 'https://api.brandmeister.network/v2/device', 'BrandMeister'); }; $('iDmr').onclick = function () { importFile('dmr'); }; $('cDmr').onclick = function () { ext.dmr = []; saveExt(); drawExt(); rerender(); };
    $('fMM').onclick = function () { fetchURL('mesh', 'https://meshmap.net/nodes.json', 'meshmap.net'); }; $('fLC').onclick = function () { fetchURL('mesh', 'https://meshtastic.liamcottle.net/api/v1/nodes', 'Meshtastic map'); };
    $('iMesh').onclick = function () { importFile('mesh'); }; $('cMesh').onclick = function () { ext.mesh = []; saveExt(); drawExt(); rerender(); };
    $('fGJ').onclick = function () { fetchGpsjam($('gjDate').value); };
    $('iGJ').onclick = function () { pickFiles('.csv').then(function (fs) { if (fs.length) readText(fs[0]).then(function (t) { gpsjamFromText(t, fs[0].name); }); }); };
    $('cGJ').onclick = function () { if (gpsjam) map.removeLayer(gpsjam); gpsjam = null; };
    $('impNasr').onclick = function () { importFile('nasr'); };
    $('iCus').onclick = function () { importFile('custom'); }; $('cCus').onclick = function () { ext.custom = []; saveExt(); drawExt(); rerender(); };
  }
  watch('layers.', function (k) { if (k === 'layers.artcc') drawARTCC(); else if (k === 'layers.gnssAreas') drawGnssAreas(); else if (k === 'layers.cities') refreshCities(); else if (k === 'layers.vectors') refreshVectors(); else refreshDynamic(); });
  watch('mapStyle', function () { buildBaseLayers(); setBase('map'); });
  watch('satLabels', function () { buildBaseLayers(); setBase(S.base); });
  watch('customTiles', function () { buildBaseLayers(); rerender(); });
  watch('flatTheme', function () { buildBaseLayers(); setBase('flat'); });

  /* ---------- Airband / ATC panel ---------- */
  function renderAir() {
    var h = '<h3>Airband & ATC</h3><div class="note">Airport frequencies (OurAirports, ' + (DATA.airports ? DATA.airports.length : 0) + ' airports) — community data; verify against the FAA Chart Supplement / national AIP.</div>';
    h += '<div class="row"><input id="apQ" class="inp" placeholder="ICAO / IATA (e.g. KLAX, SFO)" style="flex:1"><button class="btn sm" id="apGo">Lookup</button></div><div id="apOut"></div>';
    h += '<h4>Towered airports near…</h4><div class="row"><select id="nearRef" class="inp" style="width:110px"><option value="map">Map centre</option><option value="tx">Tx</option><option value="rx">Rx</option></select><input id="nearKm" class="inp" type="number" value="150" style="width:80px"> km<select id="nearType" class="inp" style="width:90px"><option>TWR</option><option>APP</option><option>CNTR</option><option>ATIS</option><option>GND</option><option>CTAF</option><option>RCO</option><option value="">any</option></select><button class="btn sm" id="nearGo">List</button></div><div id="nearOut" class="scrollbox"></div>';
    h += '<h4>Frequency finder</h4><div class="row"><input id="fqQ" class="inp" type="number" step="0.005" placeholder="MHz e.g. 124.3" style="width:130px"><button class="btn sm" id="fqGo">Who uses this?</button></div><div id="fqOut" class="scrollbox"></div>';
    h += '<h4>Air-ground coverage helper</h4><div class="note">For ATC/RCAG coverage, set Output → Rx height reference = MSL altitude and enter the flight level (e.g. 10,000 ft). ITM is valid to 3 km terminal height; above that the tool uses LOS + ITU-R P.526 diffraction.</div><div class="row"><button class="btn sm" id="agPreset">Preset: VHF air-ground @ 10,000 ft MSL</button></div>';
    return h;
  }
  function afterAir() {
    function show(a) { if (!a) { $('apOut').innerHTML = '<span class="tag bad">not found</span>'; return; } map.setView([a[4], a[5]], 11); openAirport(a); $('apOut').innerHTML = '<div class="card">' + esc(a[0] + ' ' + a[3]) + ' — ' + a[9].length + ' frequencies (see popup)</div>'; }
    $('apGo').onclick = function () { show(findAirport($('apQ').value)); };
    $('apQ').addEventListener('keydown', function (e) { if (e.key === 'Enter') show(findAirport(this.value)); });
    $('nearGo').onclick = function () {
      var ref = $('nearRef').value, c = ref === 'tx' ? [S.tx.lat, S.tx.lon] : ref === 'rx' ? [S.rx.lat, S.rx.lon] : [map.getCenter().lat, map.getCenter().lng];
      var km = +$('nearKm').value || 100, ty = $('nearType').value;
      var list = DATA.airports.map(function (a) { return [a, PC.dist(c[0], c[1], a[4], a[5])]; }).filter(function (x) { return x[1] <= km * 1000 && (!ty || x[0][9].some(function (f) { return f[0] === ty || ty === 'RCO' && /RCO/.test(f[1]); })); }).sort(function (a, b) { return a[1] - b[1]; }).slice(0, 80);
      $('nearOut').innerHTML = '<table class="t"><tr><th>ID</th><th>Name</th><th>km</th><th>' + (ty || 'Freqs') + '</th></tr>' + list.map(function (x) { var a = x[0], fs = a[9].filter(function (f) { return !ty || f[0] === ty || ty === 'RCO' && /RCO/.test(f[1]); }).map(function (f) { return fx(f[2], 3); }).slice(0, 4).join(' '); return '<tr><td><a class="lnk" onclick="LAY.openAirportById(\'' + a[0] + '\')">' + esc(a[0]) + '</a></td><td>' + esc(a[3].slice(0, 26)) + '</td><td class="n">' + fx(x[1] / 1000, 0) + '</td><td>' + fs + '</td></tr>'; }).join('') + '</table>';
    };
    $('fqGo').onclick = function () {
      var q = +$('fqQ').value; if (!q) return;
      var c = map.getCenter(), out = [];
      DATA.airports.forEach(function (a) { a[9].forEach(function (f) { if (Math.abs(f[2] - q) < 0.0026) out.push([a, f, PC.dist(c.lat, c.lng, a[4], a[5])]); }); });
      out.sort(function (a, b) { return a[2] - b[2]; });
      $('fqOut').innerHTML = out.length ? '<table class="t"><tr><th>ID</th><th>Use</th><th>km from view</th></tr>' + out.slice(0, 100).map(function (x) { return '<tr><td><a class="lnk" onclick="LAY.openAirportById(\'' + x[0][0] + '\')">' + esc(x[0][0]) + '</a></td><td>' + esc(x[1][0] + ' ' + x[1][1]) + '</td><td class="n">' + fx(x[2] / 1000, 0) + '</td></tr>'; }).join('') + '</table>' : '<div class="note">No airport assignments found.</div>';
    };
    $('agPreset').onclick = function () { var p = STATIC.freqPresets[0]; S.f = p[1]; S.bwKHz = p[2]; S.pwrW = p[3]; S.txGain = p[4]; S.sensOverride = String(p[5]); S.itm.pol = 1; S.cov.rxMode = 'msl'; S.cov.rxH = 3048; S.cov.radius = 250; S.rx.mode = 'msl'; S.rx.h = 3048; S.cov.display = 'dbm'; S.cov.maxSteps = 400; saveState(); log('VHF air-ground preset: 127 MHz, 25 W, Rx at 10,000 ft MSL, 250 km radius.'); rerender(); };
  }
  function openAirportById(id) { var a = findAirport(id); if (a) { map.setView([a[4], a[5]], Math.max(map.getZoom(), 10)); openAirport(a); } }

  return { initLayers: initLayers, refreshAll: refreshAll, renderLayers: renderLayers, afterLayers: afterLayers, renderAir: renderAir, afterAir: afterAir, findAirport: findAirport, openAirport: openAirport, openAirportById: openAirportById, useAs: useAs, meshPreset: meshPreset, ingest: ingest, ext: function () { return ext; }, gpsjamFromText: gpsjamFromText };
})();
