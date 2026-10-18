/* ===================== Signal Monkee — core: state, utilities, map, panels ===================== */
'use strict';
var $ = function (id) { return document.getElementById(id); };
var D2R = Math.PI / 180, R2D = 180 / Math.PI, C_LIGHT = 299792458;
var VERSION = '1.0';

/* ---------- persistent state ---------- */
var DEFAULTS = {
  tx: { name: 'Tx site', lat: 36.019035, lon: -120.943929, h: 30, placed: true },
  rx: { name: 'Rx site', lat: 36.1410, lon: -120.3600, h: 2, mode: 'agl', placed: true },
  f: 446.0, pwrW: 25, bwKHz: 12.5, txLoss: 2, rxLoss: 1, txGain: 6, rxGain: 2.15, rxNF: 7, reqSNR: 12, sensOverride: '',
  ant: { type: 'omni', az: 0, tilt: 0, hbw: 65, vbw: 0, fb: 25, sla: 20, azTab: null, elTab: null, rot: 0, mtilt: 0, mtiltDir: 0, file: '' },
  model: 'itm', hataEnv: 1, clutterDb: 0,
  itm: { climate: 5, N0: 301, pol: 1, eps: 15, sigma: 0.005, mdvar: 12, time: 50, loc: 50, sit: 50, ground: 0 },
  kOverride: '', p2pZ: 12,
  cov: { radius: 30, maxSteps: 500, rays: 0, display: 'dbm', top: -20, bottom: -112, step: 4, palette: 'rainbow', opacity: 0.7, rxH: 2, rxMode: 'agl', showBelow: false, maxTiles: 250 },
  units: { h: 'm' },
  base: 'map', mapStyle: 'esritopo', flatTheme: 'outline', flatRelief: true, reqMargin: 10, satLabels: true, customTiles: '',
  gnss: { mask: 5, terrain: true, horizonKm: 15, when: '', grid: 36 },
  layers: { airportsL: true, airportsM: true, airportsS: false, towers: true, artcc: true, rco: false, navaids: false, cities: true, vectors: true, gnssAreas: false, ham: true, dmr: true, mesh: true, meshRolesOnly: false, hamDigitalOnly: false, hamAnalogOnly: false },
  rbToken: '', rbState: 'California',
  mode: 'engineer', satSrc: 'esri',
  los: { earth: 'std', radius: 30, rxMode: 'agl', rxH: 2, showHidden: true },
  offline: { area: 'view', radius: 60, tz: 12, img: 'none', iz: 13, tle: true, extra: true, applySettings: false },
  op: { minRssi: -100, earth: 'std', covDisplay: 'dbm' }
};
var S = loadState();
function THEMES_OK(t) { return ['outline', 'gray', 'night', 'hivis'].indexOf(t) >= 0; }
/* Operator mode = simplified geometric line-of-sight + free-space RSSI with isotropic antennas */
function OPM() { return S.mode === 'operator'; }
if ((S.themeV || 0) < 4) { S.flatTheme = 'outline'; S.themeV = 4; }
if (!THEMES_OK(S.flatTheme)) S.flatTheme = 'outline';
delete S.datalink; delete S.dlPreset; delete S.minTput; delete S.mcsActive; delete S.uiMode; delete S.autoP2P;
if (S.cov.display === 'mcs' || S.cov.display === 'js') S.cov.display = 'dbm';
delete S.cov.jsThr; delete S.cov.gnssSig;
if (S.tx.placed === undefined) S.tx.placed = true; if (S.rx.placed === undefined) S.rx.placed = true;
function deepMerge(a, b) { for (var k in b) { if (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && a[k] && typeof a[k] === 'object' && !Array.isArray(a[k])) deepMerge(a[k], b[k]); else if (b[k] !== undefined) a[k] = b[k]; } return a; }
function loadState() {
  var s = JSON.parse(JSON.stringify(DEFAULTS));
  try { var j = localStorage.getItem('pathlink.state'); if (j) deepMerge(s, JSON.parse(j)); } catch (e) { }
  return s;
}
var saveT = 0;
function saveState() { clearTimeout(saveT); saveT = setTimeout(function () { try { localStorage.setItem('pathlink.state', JSON.stringify(S)); } catch (e) { } }, 300); }

/* ---------- small utils ---------- */
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function fx(v, d) { return v == null || !isFinite(v) ? '—' : Number(v).toFixed(d == null ? 1 : d); }
function sgn(v, d) { return !isFinite(v) ? '—' : (v >= 0 ? '+' : '') + Number(v).toFixed(d == null ? 1 : d); }
function dBm2W(d) { return Math.pow(10, (d - 30) / 10); }
function W2dBm(w) { return 10 * Math.log10(Math.max(w, 1e-15) * 1000); }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function hU(m) { return S.units.h === 'ft' ? m / 0.3048 : m; }
/* Units: metres → km for distances; feet → nautical miles (aviation convention). The other unit follows in brackets. */
function IMP() { return S.units.h === 'ft'; }
function hStr(m, d) { return IMP() ? fx(m / 0.3048, 0) + ' ft (' + fx(m, d == null ? 1 : d) + ' m)' : fx(m, d == null ? 1 : d) + ' m (' + fx(m / 0.3048, 0) + ' ft)'; }
function hDual(m) { return IMP() ? fx(m / 0.3048, 0) + ' ft (' + fx(m, 0) + ' m)' : fx(m, 0) + ' m (' + fx(m / 0.3048, 0) + ' ft)'; }   // heights in reports
function hShort(m) { return S.units.h === 'ft' ? fx(m / 0.3048, 0) + ' ft' : fx(m, 1) + ' m'; }
function dStr(m) { return IMP() ? fx(m / 1852, 2) + ' NM (' + fx(m / 1000, 2) + ' km, ' + fx(m / 1609.344, 2) + ' mi)' : fx(m / 1000, 2) + ' km (' + fx(m / 1852, 2) + ' NM, ' + fx(m / 1609.344, 2) + ' mi)'; }
function dU(m, d) { d = d == null ? 1 : d; return IMP() ? fx(m / 1852, d) + ' NM' : fx(m / 1000, d) + ' km'; }            // distance, display unit only
function dDual(m, d) { d = d == null ? 1 : d; return IMP() ? fx(m / 1852, d) + ' NM (' + fx(m / 1000, d) + ' km)' : fx(m / 1000, d) + ' km (' + fx(m / 1852, d) + ' NM)'; }
function dms(v, pos, neg) { var s = v < 0 ? neg : pos; v = Math.abs(v); var d = Math.floor(v), mm = (v - d) * 60, m = Math.floor(mm), sec = (mm - m) * 60; if (sec >= 59.995) { sec = 0; m++; } if (m === 60) { m = 0; d++; } return d + '° ' + String(m).padStart(2, '0') + '\' ' + sec.toFixed(1).padStart(4, '0') + '" ' + s; }
function llStr(lat, lon) { return fx(lat, 6) + ', ' + fx(lon, 6) + '  (' + dms(lat, 'N', 'S') + ', ' + dms(lon, 'E', 'W') + ')'; }
function nowISO() { return new Date().toISOString().replace('T', ' ').slice(0, 19) + 'Z'; }
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function raf() { return new Promise(function (r) { requestAnimationFrame(function () { r(); }); }); }

function log(msg, cls) {
  var L = $('log'), d = document.createElement('div');
  if (cls) d.className = cls;
  d.textContent = msg; L.appendChild(d);
  while (L.childNodes.length > 300) L.removeChild(L.firstChild);
  L.scrollTop = L.scrollHeight;
}
function status(t) { $('statusTxt').textContent = t; }
function prog(on, txt, frac) {
  var p = $('prog'); p.style.display = on ? 'block' : 'none';
  var lg = document.querySelector('.logo'); if (lg) lg.classList.toggle('busy', !!on);
  if (txt != null) $('progTxt').textContent = txt;
  if (frac != null) $('progBar').style.width = (clamp(frac, 0, 1) * 100).toFixed(1) + '%';
}
function download(name, data, mime) {
  var blob = data instanceof Blob ? data : new Blob([data], { type: mime || 'text/plain' });
  var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}
function pickFiles(accept, multiple) {
  return new Promise(function (res) {
    var fi = $('fileIn'); fi.value = ''; fi.accept = accept || ''; fi.multiple = !!multiple;
    fi.onchange = function () { res(Array.prototype.slice.call(fi.files)); };
    fi.click();
  });
}
function readText(f) { return f.text ? f.text() : new Response(f).text(); }
function readBuf(f) { return f.arrayBuffer ? f.arrayBuffer() : new Response(f).arrayBuffer(); }
function parseCSV(text) {
  var rows = [], row = [], cur = '', q = false, i = 0, c;
  text = text.replace(/^﻿/, '');
  for (; i < text.length; i++) {
    c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',' || c === '\t' && false) { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += c;
  }
  if (cur.length || row.length) { row.push(cur); rows.push(row); }
  return rows.filter(function (r) { return r.length > 1 || (r[0] && r[0].trim()); });
}
function csvToObjects(text) {
  var rows = parseCSV(text); if (!rows.length) return [];
  var h = rows[0].map(function (x) { return x.trim(); });
  return rows.slice(1).map(function (r) { var o = {}; h.forEach(function (k, i) { o[k] = r[i]; }); return o; });
}
function csvCell(v) { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
function toCSV(rows) { return rows.map(function (r) { return r.map(csvCell).join(','); }).join('\n'); }
/* tolerant fetch with helpful CORS message */
function fetchJSONorText(url, opts, asText) {
  return fetch(url, opts || {}).then(function (r) {
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return asText ? r.text() : r.json();
  }).catch(function (e) {
    var m = String(e && e.message || e);
    if (/Failed to fetch|NetworkError|Load failed|CORS/i.test(m)) m = 'blocked (offline or the server does not allow cross-origin requests from a local file). Open the URL in your browser, save the file, then use Import.';
    throw new Error(m);
  });
}


/* ---------- minimalist inline icons (24×24, 1.8 stroke, currentColor — same style as the rail) ---------- */
var ICO = {
  pin: '<path d="M12 21s-6.5-5.8-6.5-10.5a6.5 6.5 0 0 1 13 0C18.5 15.2 12 21 12 21z"/><circle cx="12" cy="10.5" r="2.3"/>',
  signal: '<path d="M4 20v-3M9 20v-7M14 20v-11M19 20V5"/>',
  feeder: '<path d="M12 3v18M8 7l4-4 4 4M8 17l4 4 4-4"/>',
  antenna: '<path d="M12 10v11M8.5 21h7M12 10l-3.5 11M12 10l3.5 11"/><path d="M7 4.5a7 7 0 0 0 0 9M17 4.5a7 7 0 0 1 0 9"/>',
  rx: '<rect x="7" y="3" width="10" height="18" rx="2"/><path d="M11 17.5h2"/>',
  model: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z"/>',
  output: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 15l5-5 4 4 3-3 6 6"/><circle cx="16" cy="8" r="1.5"/>',
  save: '<path d="M5 3h11l3 3v13a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z"/><path d="M8 3v5h7V3M8 21v-6h8v6"/>',
  open: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  play: '<path d="M8 5.5v13l10-6.5z"/>',
  download: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19h14"/>',
  clear: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  sat: '<path d="m13 7 4 4-6 6-4-4z"/><path d="m15 5 2-2 4 4-2 2M9 19l-2 2-4-4 2-2M4 20l3-3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  swap: '<path d="M4 8h14M14 4l4 4-4 4M20 16H6M10 12l-4 4 4 4"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  zoom: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>',
  eye: '<path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  layers: '<path d="M12 3 2 8l10 5 10-5-10-5z"/><path d="m2 13 10 5 10-5"/>',
  map: '<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/>',
  png: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 16 5-5 4 4 3-3 6 6"/>',
  check: '<path d="M5 12.5 10 17l9-10"/>'
};
function ico(name, cls) { return '<svg class="ico' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICO[name] || '') + '</svg>'; }
/* elements written in index.html as <button data-ico="pin">Tx</button> get their icon at boot */
function applyIcons(root) { (root || document).querySelectorAll('[data-ico]').forEach(function (el) { if (!el.querySelector(':scope > svg.ico')) el.insertAdjacentHTML('afterbegin', ico(el.dataset.ico)); }); }

/* ---------- embedded data (gzip+base64) ---------- */
var DATA = {};
function gunzipB64(b64) {
  var bin = atob(b64), u = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return new Response(new Blob([u]).stream().pipeThrough(new DecompressionStream('gzip'))).text().then(JSON.parse);
}
function loadEmbedded() {
  var keys = Object.keys(window.__EMB || {});
  return Promise.all(keys.map(function (k) { return gunzipB64(window.__EMB[k]).then(function (v) { DATA[k] = v; }); }));
}

/* ---------- binding of inputs to state ---------- */
function getK(p) { return p.split('.').reduce(function (o, k) { return o == null ? undefined : o[k]; }, S); }
function setK(p, v) { var ks = p.split('.'), o = S; for (var i = 0; i < ks.length - 1; i++) o = o[ks[i]]; o[ks[ks.length - 1]] = v; }
var onKey = [];
function watch(prefix, fn) { onKey.push([prefix, fn]); }
function bind(root) {
  root.querySelectorAll('[data-k]').forEach(function (inp) {
    var k = inp.dataset.k, u = inp.dataset.u, v = getK(k);
    if (inp.type === 'checkbox') inp.checked = !!v;
    else if (u === 'h' && typeof v === 'number') inp.value = +hU(v).toFixed(2);
    else inp.value = v == null ? '' : v;
    inp.addEventListener('change', function () {
      var nv;
      if (inp.type === 'checkbox') nv = inp.checked;
      else if (inp.type === 'number' || inp.dataset.num) { nv = parseFloat(inp.value); if (!isFinite(nv)) { inp.value = getK(k); return; } if (u === 'h' && S.units.h === 'ft') nv *= 0.3048; }
      else nv = inp.value;
      if (inp.tagName === 'SELECT' && inp.dataset.num) nv = parseFloat(inp.value);
      setK(k, nv); saveState();
      onKey.forEach(function (w) { if (k.indexOf(w[0]) === 0) w[1](k, nv); });
    });
  });
}
function F(label, key, opt) { // field html
  opt = opt || {};
  var u = opt.u ? ' data-u="' + opt.u + '"' : '', unit = opt.unit || (opt.u === 'h' ? (S.units.h === 'ft' ? 'ft' : 'm') : '');
  var inp;
  if (opt.sel) inp = '<select data-k="' + key + '"' + (opt.num ? ' data-num="1"' : '') + '>' + opt.sel.map(function (o) { return '<option value="' + esc(o[0]) + '">' + esc(o[1]) + '</option>'; }).join('') + '</select>';
  else inp = '<input data-k="' + key + '"' + u + ' type="' + (opt.text ? 'text' : 'number') + '"' + (opt.step ? ' step="' + opt.step + '"' : ' step="any"') + (opt.id ? ' id="' + opt.id + '"' : '') + '>';
  return '<div class="f"><label' + (opt.title ? ' title="' + esc(opt.title) + '"' : '') + '>' + label + (unit ? ' <span class="unit">(' + unit + ')</span>' : '') + '</label>' + inp + '</div>';
}
function CK(label, key, title) { return '<label class="chk"' + (title ? ' title="' + esc(title) + '"' : '') + '><input type="checkbox" data-k="' + key + '"> ' + label + '</label>'; }
function acc(icon, title, body, open) { return '<details class="acc"' + (open ? ' open' : '') + '><summary><span class="ic">' + icon + '</span>' + title + '</summary><div class="in">' + body + '</div></details>'; }

/* ---------- map ---------- */
var map, baseLayers = {}, curBase = null, rnd = null;
var markers = { tx: null, rx: null, gn: null, path: null, pathHover: null };
var pickMode = null;

function initMap() {
  map = L.map('map', { zoomControl: true, worldCopyJump: true, preferCanvas: false, attributionControl: true }).setView([S.tx.lat, S.tx.lon], 9);
  map.zoomControl.setPosition('bottomright');
  rnd = L.canvas({ padding: 0.3 });
  L.control.scale({ position: 'bottomright', imperial: true }).addTo(map);
  map.createPane('landPane'); map.getPane('landPane').style.zIndex = 150; map.getPane('landPane').style.pointerEvents = 'none';
  map.createPane('reliefPane'); map.getPane('reliefPane').style.zIndex = 160; map.getPane('reliefPane').style.pointerEvents = 'none';
  map.createPane('covPane'); map.getPane('covPane').style.zIndex = 380;
  map.createPane('vecPane'); map.getPane('vecPane').style.zIndex = 390; map.getPane('vecPane').style.pointerEvents = 'none';
  buildBaseLayers();
  setBase(S.base);
  map.on('zoomend', function () { if (S.base === 'flat' && vecDemCoast !== null && vecDemCoast !== demCoastOn()) refreshVectors(); });
  map.on('click', onMapClick);
  map.on('mousemove', onMapMove);
  map.on('contextmenu', function (e) {
    L.popup().setLatLng(e.latlng).setContent(ctxMenu(e.latlng)).openOn(map);
  });
  placeMarkers();
}
function ctxMenu(ll) {
  var z = DEM.elev(ll.lat, ll.lng);
  return '<h5>' + fx(ll.lat, 5) + ', ' + fx(ll.lng, 5) + '</h5><div class="mini">' + dms(ll.lat, 'N', 'S') + ' ' + dms(ll.lng, 'E', 'W') + '<br>Ground: ' + (isFinite(z) ? hStr(z, 0) : 'not loaded') + '</div>' +
    '<div class="row"><a class="lnk" onclick="setSite(\'tx\',' + ll.lat + ',' + ll.lng + ');map.closePopup()">Set Tx here</a> · <a class="lnk" onclick="setSite(\'rx\',' + ll.lat + ',' + ll.lng + ');map.closePopup()">Set Rx here</a> · <a class="lnk" onclick="TP.add(' + ll.lat + ',' + ll.lng + ');map.closePopup()">Add test point</a> · <a class="lnk" onclick="SAT.setPoint(' + ll.lat + ',' + ll.lng + ');map.closePopup()">GNSS/SATCOM here</a></div>';
}
var TILE = {
  osm: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png', '© OpenStreetMap contributors (tile servers may refuse requests without a web referrer)', 19],
  topo: ['https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', '© OpenTopoMap (CC-BY-SA), © OpenStreetMap', 17],
  esritopo: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', 'Tiles © Esri', 19],
  voyager: ['https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', '© OpenStreetMap, © CARTO', 19],
  sat: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', 'Imagery © Esri, Maxar, Earthstar Geographics', 19],
  satlbl: ['https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', '', 19]
};
function tl(def, extra) { return L.tileLayer(def[0], Object.assign({ attribution: def[1], maxZoom: 20, maxNativeZoom: def[2] }, extra || {})); }
var vecLayer = null, cityLayer = null, shadeLayer = null;
function buildBaseLayers() {
  baseLayers.map = S.mapStyle === 'usgstopo' ? OFFLINE.layer('usgstopo') : tl(TILE[S.mapStyle] || TILE.osm);
  baseLayers.sat = L.layerGroup([S.satSrc === 'usgsimg' ? OFFLINE.layer('usgsimg') : tl(TILE.sat)]);
  if (S.satLabels) baseLayers.sat.addLayer(tl(TILE.satlbl, { pane: 'overlayPane', opacity: 0.9 }));
  var th = TH();
  shadeLayer = th.fill ? (S.flatRelief ? makeShadeLayer(true) : null) : makeShadeLayer(false);
  baseLayers.flat = L.layerGroup(th.fill ? [landLayer()].concat(shadeLayer ? [shadeLayer] : []) : [shadeLayer]);
  if (S.customTiles) baseLayers.custom = L.tileLayer(S.customTiles, { maxZoom: 20, attribution: 'custom' });
}
function setBase(b) {
  if (!baseLayers[b]) b = 'map';
  S.base = b; saveState();
  if (curBase) map.removeLayer(curBase);
  curBase = baseLayers[b]; curBase.addTo(map);
  if (curBase.bringToBack) curBase.bringToBack();
  document.querySelectorAll('#baseSeg button').forEach(function (x) { x.classList.toggle('on', x.dataset.b === b); });
  $('map').style.background = b === 'flat' ? TH().bg : '#0b0d0f';
  refreshVectors(); refreshCities();
}
function cycleBase() { var order = ['map', 'sat', 'flat']; setBase(order[(order.indexOf(S.base) + 1) % 3]); }

/* Contrast-map themes. Themes with `fill` draw Natural Earth land polygons (works offline everywhere) with an
   optional relief overlay computed from the terrain tiles; `gray` draws the opaque hillshade instead. */
var THEMES = {
  outline: { name: 'Outline (dark slate, orange edges)', bg: '#091119', fill: '#1A2633', lake: '#0B1520', coast: '#FF6B2C', borders: '#FF6B2C', states: '#9A5A38', w: [1.4, 1.4, 1], relief: [0.38, 0.10, [255, 255, 255]], label: '#E0E8EF', halo: '#091119', dot: '#3CC6E6' },
  gray: { name: 'Grey relief (bold orange edges)', bg: '#04060c', ocean: [4, 6, 14], fill: null, lake: null, coast: '#E8590C', borders: '#E8590C', states: '#C8C8C8', w: [2.6, 2.2, 1], label: '#ffffff', halo: '#000000', dot: '#ffd166' },
  night: { name: 'Night (amber, dark-adapted)', bg: '#000000', fill: '#140904', lake: '#000000', coast: '#FF8F2A', borders: '#FFB04D', states: '#7A4A1A', relief: [0.45, 0.22, [255, 150, 40]], label: '#FFB04D', halo: '#000000', dot: '#FF8F2A' },
  hivis: { name: 'High visibility (yellow on black)', bg: '#001A4D', fill: '#000000', lake: '#001A4D', coast: '#FFFF00', borders: '#FFFFFF', states: '#FFFF00', relief: [0.0, 0.18, [255, 255, 255]], label: '#FFFF00', halo: '#000000', dot: '#FFFF00', heavy: true }
};
function TH() { return THEMES[S.flatTheme] || THEMES.outline; }
function hexRGB(h) { h = h.replace('#', ''); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; }
/* Contrast basemap: hillshade computed in-browser from the same DEM tiles used for propagation.
   overlay = true → transparent relief (shadows/highlights over the land fill); false → opaque grey hillshade.
   From zoom COASTZ up, the coastline is traced from the terrain itself (land/sea from the DEM) so it lines up with
   the relief: the generalized Natural Earth outline is only trusted well inland (CORE_M from its coast), where it
   protects below-sea-level land (Death Valley, Salton basin) from being painted as sea. */
var COASTZ = 8, CORE_M = 15000;
var mercLand = null, mercLakes = null, maskCv = null;
function mercPolys(polys) {
  return polys.map(function (poly) {
    var bb = [1, 1, 0, 0];
    var rings = poly.map(function (r) {
      var a = new Float64Array(r.length);
      for (var i = 0; i < r.length; i += 2) {
        var lat = clamp(r[i + 1], -85, 85), x = (r[i] + 180) / 360, y = (1 - Math.log(Math.tan(Math.PI / 4 + lat * D2R / 2)) / Math.PI) / 2;
        a[i] = x; a[i + 1] = y;
        if (x < bb[0]) bb[0] = x; if (y < bb[1]) bb[1] = y; if (x > bb[2]) bb[2] = x; if (y > bb[3]) bb[3] = y;
      }
      return a;
    });
    return { bb: bb, rings: rings };
  });
}
function coastData() {
  if (!DATA.basemap || !DATA.basemap.land) return false;
  if (!mercLand) { mercLand = mercPolys(DATA.basemap.land); mercLakes = mercPolys((DATA.basemap.lakes || []).map(function (r) { return [r]; })); }
  return true;
}
/* trace the polygons that touch this tile (plus `padPx`) onto ctx g as one even-odd path */
function tilePath(g, polys, c, padPx) {
  var S2 = 256 * Math.pow(2, c.z), x0 = c.x * 256, y0 = c.y * 256, pad = padPx / S2, n = 0;
  var tb = [c.x * 256 / S2 - pad, c.y * 256 / S2 - pad, (c.x + 1) * 256 / S2 + pad, (c.y + 1) * 256 / S2 + pad];
  g.beginPath();
  polys.forEach(function (p) {
    if (p.bb[2] < tb[0] || p.bb[0] > tb[2] || p.bb[3] < tb[1] || p.bb[1] > tb[3]) return;
    n++;
    p.rings.forEach(function (a) { g.moveTo(a[0] * S2 - x0, a[1] * S2 - y0); for (var i = 2; i < a.length; i += 2) g.lineTo(a[i] * S2 - x0, a[i + 1] * S2 - y0); g.closePath(); });
  });
  return n;
}
/* rasterize land (and its inland core) and lakes for one tile → {land, core, lake} byte masks */
function tileMasks(c, corePx) {
  if (!maskCv) { maskCv = document.createElement('canvas'); maskCv.width = maskCv.height = 256; }
  var g = maskCv.getContext('2d', { willReadFrequently: true }), out = {};
  function grab() { var d = g.getImageData(0, 0, 256, 256).data, m = new Uint8Array(65536); for (var i = 0; i < 65536; i++) m[i] = d[i * 4 + 3] > 127 ? 1 : 0; return m; }
  g.globalCompositeOperation = 'source-over'; g.clearRect(0, 0, 256, 256); g.fillStyle = '#000';
  if (tilePath(g, mercLand, c, corePx)) {
    g.fill('evenodd'); out.land = grab();
    g.globalCompositeOperation = 'destination-out'; g.lineWidth = 2 * corePx; g.lineJoin = 'round'; g.stroke(); g.globalCompositeOperation = 'source-over';
    out.core = grab();
  } else { out.land = new Uint8Array(65536); out.core = out.land; }
  g.clearRect(0, 0, 256, 256);
  out.lake = tilePath(g, mercLakes, c, 0) ? (g.fill('evenodd'), grab()) : null;
  return out;
}
/* Land/sea for one tile, keeping only the contiguous landmass:
   • the Natural Earth land polygon is the starting shape (islands included);
   • the sea is flooded in from outside that polygon through terrain at or below sea level, so bays and beaches the
     outline wrongly covers are trimmed back to the terrain, while inland low spots (not connected to the sea) stay land;
   • nothing is added outside the polygon, so near-zero noise in coastal bathymetry can't create offshore blobs;
   • small, low land fragments the trimming leaves offshore (shoreline noise) are dropped; islands with relief stay. */
function classify(CL, EL, M, minPx, r) {
  var N = 65536, i, k, ws = new Uint8Array(N), sea = new Uint8Array(N), Q = new Int32Array(N), qh = 0, qt = 0, x, y;
  for (i = 0; i < N; i++) ws[i] = EL[i] <= 2 ? 1 : 0;           // ≤ 2 m: sea surface plus the noise terrain tiles carry at the shoreline
  var wsm = new Uint8Array(N);                                    // 3×3 majority filter: smooth single-pixel noise
  for (y = 0; y < 256; y++) for (x = 0; x < 256; x++) {
    var cnt = 0, tot = 0;
    for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) { var X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X > 255 || Y > 255) continue; tot++; cnt += ws[Y * 256 + X]; }
    wsm[y * 256 + x] = cnt * 2 > tot ? 1 : 0;
  }
  function pass(j) { return !M.land[j] || (wsm[j] && !M.core[j]); }
  for (i = 0; i < N; i++) {
    x = i & 255; y = i >> 8;
    var border = x === 0 || y === 0 || x === 255 || y === 255;
    if (!M.land[i] || (border && wsm[i] && !M.core[i])) { sea[i] = 1; Q[qt++] = i; }
  }
  while (qh < qt) {
    i = Q[qh++]; x = i & 255; y = i >> 8;
    var nb = [x > 0 ? i - 1 : -1, x < 255 ? i + 1 : -1, y > 0 ? i - 256 : -1, y < 255 ? i + 256 : -1];
    for (k = 0; k < 4; k++) { var j = nb[k]; if (j >= 0 && !sea[j] && pass(j)) { sea[j] = 1; Q[qt++] = j; } }
  }
  // smooth the shoreline: opening (removes thin spurs) then closing (fills narrow notches), radius r px
  var L1 = new Uint8Array(N); for (i = 0; i < N; i++) L1[i] = sea[i] ? 0 : 1;
  function morph(m, grow) {
    var o = new Uint8Array(N);
    for (y = 0; y < 256; y++) for (x = 0; x < 256; x++) {
      var v = m[y * 256 + x];
      for (var dy = -1; dy <= 1 && v !== (grow ? 1 : 0); dy++) for (var dx = -1; dx <= 1; dx++) {
        var X = clamp(x + dx, 0, 255), Y = clamp(y + dy, 0, 255), q = m[Y * 256 + X];
        if (grow ? q : !q) { v = grow ? 1 : 0; break; }
      }
      o[y * 256 + x] = v;
    }
    return o;
  }
  var t; for (t = 0; t < r; t++) L1 = morph(L1, false); for (t = 0; t < r; t++) L1 = morph(L1, true);
  for (t = 0; t < r; t++) L1 = morph(L1, true); for (t = 0; t < r; t++) L1 = morph(L1, false);
  for (i = 0; i < N; i++) { if (M.core[i]) L1[i] = 1; if (!M.land[i]) L1[i] = 0; }   // never past the outline, never inside the core
  for (i = 0; i < N; i++) CL[i] = M.lake && M.lake[i] ? 2 : L1[i] ? 1 : 0;
  // drop small land fragments that don't reach the tile edge
  var seen = new Uint8Array(N);
  for (i = 0; i < N; i++) {
    if (CL[i] !== 1 || seen[i]) continue;
    qh = qt = 0; Q[qt++] = i; seen[i] = 1; var edge = false, top = -1e9;
    while (qh < qt) {
      var a = Q[qh++]; x = a & 255; y = a >> 8; if (x === 0 || y === 0 || x === 255 || y === 255) edge = true; if (EL[a] > top) top = EL[a];
      var nb2 = [x > 0 ? a - 1 : -1, x < 255 ? a + 1 : -1, y > 0 ? a - 256 : -1, y < 255 ? a + 256 : -1];
      for (k = 0; k < 4; k++) { var b = nb2[k]; if (b >= 0 && !seen[b] && CL[b] === 1) { seen[b] = 1; Q[qt++] = b; } }
    }
    if (!edge && qt < minPx && top < 15) for (k = 0; k < qt; k++) CL[Q[k]] = 0;   // low flat specks = shoreline noise; real islands have relief
  }
}
function coastW() { var th = TH(), hw = th.heavy ? 1.7 : 1; return (th.w || [1.1 * hw])[0]; }
function strokeCoast(g, c) { // no terrain for this tile: fall back to the vector outline, drawn into the tile
  if (!S.layers.vectors || !coastData()) return;
  if (tilePath(g, mercLand, c, 4)) { g.strokeStyle = TH().coast; g.lineWidth = coastW(); g.lineJoin = 'round'; g.stroke(); }
}
function makeShadeLayer(overlay) {
  var Shade = L.GridLayer.extend({
    createTile: function (c, done) {
      var cv = document.createElement('canvas'); cv.width = cv.height = 256;
      var z = c.z, zd = Math.min(z, 12), sc = Math.pow(2, z - zd);
      var tx = Math.floor(c.x / sc), ty = Math.floor(c.y / sc);
      var th = TH(), ocean = th.ocean || hexRGB(th.bg);
      var g = cv.getContext('2d'), demCoast = z >= COASTZ && coastData();
      if (!overlay) { g.fillStyle = th.bg; g.fillRect(0, 0, 256, 256); }
      if (zd < 2 || !DEM.cfg.useTiles && !overlay) { if (demCoast) strokeCoast(g, c); setTimeout(function () { done(null, cv); }, 0); return cv; }
      DEM.loadTile(zd, tx, ty).then(function (arr) {
        if (!arr) { if (demCoast) strokeCoast(g, c); done(null, cv); return; }
        var img = g.createImageData(256, 256), d = img.data;
        var ox = (c.x * 256) / sc - tx * 256, oy = (c.y * 256) / sc - ty * 256;
        var n2 = Math.pow(2, z), lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * (c.y + 0.5) / n2))) * R2D;
        var cell = 156543.03 * Math.cos(lat * D2R) / n2, zf = z < 7 ? 6 : z < 10 ? 3 : 1.6;
        function E(px, py) { var x = clamp(Math.floor(ox + px / sc), 0, 255), y = clamp(Math.floor(oy + py / sc), 0, 255); return arr[y * 256 + x]; }
        var az = 315 * D2R, alt = 45 * D2R, rl = th.relief || [0, 0, [255, 255, 255]];
        var px, py, i, e, dzdx, dzdy;
        // pass 1: hillshade value and land/sea class per pixel (0 sea, 1 land, 2 lake)
        var HS = new Float32Array(65536), CL = new Uint8Array(65536), EL = new Float32Array(65536);
        var M = demCoast ? tileMasks(c, Math.max(3, CORE_M / cell)) : null;
        for (py = 0; py < 256; py++) for (px = 0; px < 256; px++) {
          i = py * 256 + px; e = E(px, py);
          dzdx = (E(px + 1, py) - E(px - 1, py)) / (2 * cell) * zf; dzdy = (E(px, py + 1) - E(px, py - 1)) / (2 * cell) * zf;
          var slope = Math.atan(Math.hypot(dzdx, dzdy)), aspect = Math.atan2(dzdy, -dzdx);
          HS[i] = clamp(Math.cos(alt) * Math.cos(slope) + Math.sin(alt) * Math.sin(slope) * Math.cos(az - Math.PI / 2 - aspect), 0, 1); EL[i] = e;
          if (!M) CL[i] = e <= 0 && Math.abs(dzdx) + Math.abs(dzdy) < 0.02 * zf || e < -5 ? 0 : 1;
        }
        if (M) classify(CL, EL, M, Math.max(12, Math.round(5e6 / (cell * cell))), clamp(Math.round(250 / cell), 1, 4));
        // pass 2: coastline pixels — land pixels within ~line-width of the sea (lakes don't count)
        var edge = null;
        if (M && S.layers.vectors) {
          edge = new Uint8Array(65536); var r = Math.max(1, Math.round(coastW() * 0.75));
          for (py = 0; py < 256; py++) for (px = 0; px < 256; px++) {
            i = py * 256 + px; if (CL[i] !== 1) continue;
            search: for (var dy = -r; dy <= r; dy++) for (var dx = -r; dx <= r; dx++) {
              var qx = px + dx, qy = py + dy; if (qx < 0 || qy < 0 || qx > 255 || qy > 255 || dx * dx + dy * dy > r * r) continue;
              if (CL[qy * 256 + qx] === 0) { edge[i] = 1; break search; }
            }
          }
        }
        var fill = th.fill ? hexRGB(th.fill) : null, cst = hexRGB(th.coast);
        // pass 3: colour
        for (i = 0; i < 65536; i++) {
          var j = i * 4, hs = HS[i], cl = CL[i];
          if (edge && edge[i]) { d[j] = cst[0]; d[j + 1] = cst[1]; d[j + 2] = cst[2]; d[j + 3] = 255; continue; }
          if (overlay) {
            var inLand = !M || M.land[i];
            if (cl === 2) continue;                                                   // lake: vector lake fill shows through
            if (cl === 0) { if (M) { d[j] = ocean[0]; d[j + 1] = ocean[1]; d[j + 2] = ocean[2]; d[j + 3] = 255; } continue; } // sea the outline wrongly calls land
            var a = 0.707 - hs, base = inLand ? null : fill;                         // land the outline missed gets the land fill
            if (!base) {
              if (a > 0) { d[j] = d[j + 1] = d[j + 2] = 0; d[j + 3] = clamp(a / 0.707 * rl[0] * 255, 0, 255); }
              else { d[j] = rl[2][0]; d[j + 1] = rl[2][1]; d[j + 2] = rl[2][2]; d[j + 3] = clamp(-a / 0.293 * rl[1] * 255, 0, 255); }
            } else {
              var t = a > 0 ? a / 0.707 * rl[0] : -a / 0.293 * rl[1], tc = a > 0 ? [0, 0, 0] : rl[2];
              d[j] = base[0] * (1 - t) + tc[0] * t; d[j + 1] = base[1] * (1 - t) + tc[1] * t; d[j + 2] = base[2] * (1 - t) + tc[2] * t; d[j + 3] = 255;
            }
            continue;
          }
          if (cl !== 1) { d[j] = ocean[0]; d[j + 1] = ocean[1]; d[j + 2] = ocean[2]; d[j + 3] = 255; continue; }
          var v = 18 + hs * 175 + Math.min(EL[i] / 4000, 1) * 40;
          d[j] = d[j + 1] = d[j + 2] = clamp(v, 0, 255); d[j + 3] = 255;
        }
        g.putImageData(img, 0, 0);
        done(null, cv);
      });
      return cv;
    }
  });
  return new Shade({ maxZoom: 20, pane: overlay ? 'reliefPane' : 'tilePane', attribution: 'Relief from AWS Terrain Tiles (SRTM/NED/GMTED); land, boundaries & places © Natural Earth' });
}
var landLL = null;
function landLayer() {
  var th = TH(), rnd2 = L.canvas({ pane: 'landPane', padding: 0.2 }), g = L.layerGroup();
  if (!DATA.basemap || !DATA.basemap.land) return g;
  if (!landLL) landLL = DATA.basemap.land.map(function (poly) { return poly.map(function (r) { var o = []; for (var i = 0; i < r.length; i += 2) o.push([r[i + 1], r[i]]); return o; }); });
  g.addLayer(L.polygon(landLL, { renderer: rnd2, pane: 'landPane', stroke: false, fillColor: th.fill, fillOpacity: 1, interactive: false, smoothFactor: 1 }));
  if (th.lake && DATA.basemap.lakes) g.addLayer(L.polygon(DATA.basemap.lakes.map(function (r) { var o = []; for (var i = 0; i < r.length; i += 2) o.push([r[i + 1], r[i]]); return [o]; }), { renderer: rnd2, pane: 'landPane', stroke: false, fillColor: th.lake, fillOpacity: 1, interactive: false }));
  return g;
}
var vecDemCoast = null;
function demCoastOn() { return !!shadeLayer && map.getZoom() >= COASTZ; }
function refreshVectors() {
  if (vecLayer) { map.removeLayer(vecLayer); vecLayer = null; }
  if (!DATA.basemap || S.base !== 'flat' || !S.layers.vectors) return;
  var th = TH(), g = L.layerGroup();
  function mk(arrs, color, w, dash) {
    var lines = arrs.map(function (a) { var o = []; for (var i = 0; i < a.length; i += 2) o.push([a[i + 1], a[i]]); return o; });
    g.addLayer(L.polyline(lines, { color: color, weight: w, dashArray: dash, renderer: L.canvas({ pane: 'vecPane' }), interactive: false, smoothFactor: 1.5, pane: 'vecPane' }));
  }
  var hw = th.heavy ? 1.7 : 1, w = th.w || [1.1 * hw, 1.3 * hw, 1 * hw];   // line weights: [coast, country borders, states]
  vecDemCoast = demCoastOn();
  if (!vecDemCoast) mk(DATA.basemap.coast, th.coast, w[0]);              // zoomed in, the relief tiles trace the coast from the terrain
  if (!th.fill) mk(DATA.basemap.lakes, th.coast, Math.max(0.8, w[0] * 0.6));
  mk(DATA.basemap.borders, th.borders, w[1]);
  mk(DATA.basemap.states, th.states, w[2], '4 3');
  vecLayer = g.addTo(map);
}
function refreshCities() {
  if (!cityLayer) { cityLayer = L.layerGroup().addTo(map); map.on('moveend', refreshCities); }
  cityLayer.clearLayers();
  if (!DATA.cities || !S.layers.cities || S.base !== 'flat') return;
  var b = map.getBounds().pad(0.05), z = map.getZoom(), lim = z < 5 ? 25 : z < 7 ? 60 : z < 9 ? 110 : 160, n = 0, th = TH();
  for (var i = 0; i < DATA.cities.length && n < lim; i++) {
    var c = DATA.cities[i];
    if (!b.contains([c[1], c[2]])) continue;
    n++;
    var fs = c[3] > 3e6 ? 13 : c[3] > 5e5 ? 12 : 11;
    cityLayer.addLayer(L.marker([c[1], c[2]], { interactive: false, keyboard: false, icon: L.divIcon({ className: '', iconSize: [0, 0], html: '<div class="citylbl" style="font-size:' + fs + 'px;transform:translate(-3px,-7px);color:' + th.label + ';text-shadow:0 0 3px ' + th.halo + ',0 0 3px ' + th.halo + ',0 0 2px ' + th.halo + '"><span style="display:inline-block;width:5px;height:5px;border-radius:50%;background:' + th.dot + ';margin-right:4px;vertical-align:middle"></span>' + esc(c[0]) + '</div>' }) }));
  }
}

/* ---------- Tx/Rx markers ---------- */
function mkIcon(cls, txt, w) { w = w || 28; return L.divIcon({ className: '', iconSize: [w, 20], iconAnchor: [w / 2, 24], html: '<div class="mk ' + cls + '" style="width:' + w + 'px;height:20px">' + txt + '</div><div style="width:0;height:0;margin:-1px auto 0;border-left:5px solid transparent;border-right:5px solid transparent;border-top:6px solid #111"></div>' }); }
function placeMarkers() {
  ['tx', 'rx'].forEach(function (k) {
    var s = S[k];
    if (!s.placed) { if (markers[k]) { map.removeLayer(markers[k]); markers[k] = null; } return; }
    if (!markers[k]) {
      markers[k] = L.marker([s.lat, s.lon], { draggable: true, icon: mkIcon(k, k === 'tx' ? 'Tx' : 'Rx'), zIndexOffset: 1000 }).addTo(map);
      markers[k].on('dragend', function (e) { var ll = e.target.getLatLng(); setSite(k, ll.lat, ll.lng); });
      markers[k].bindTooltip('', { direction: 'top', offset: [0, -22] });
    }
    markers[k].setLatLng([s.lat, s.lon]);
    markers[k].setTooltipContent(esc(s.name) + '<br>' + fx(s.lat, 5) + ', ' + fx(s.lon, 5));
  });
  drawPathLine();
}
function drawPathLine() {
  if (markers.path) { map.removeLayer(markers.path); markers.path = null; }
  if (!S.tx.placed || !S.rx.placed) return;
  markers.path = L.polyline(gcLine(S.tx.lat, S.tx.lon, S.rx.lat, S.rx.lon, 64), { color: '#f0a020', weight: 2, dashArray: '6 5', interactive: false }).addTo(map);
}
function gcLine(a, b, c, d, n) { var o = []; for (var i = 0; i <= n; i++) o.push(PC.interp(a, b, c, d, i / n)); return o; }
function setSite(k, lat, lon, name) {
  S[k].lat = +(+lat).toFixed(6); S[k].lon = +(+lon).toFixed(6); S[k].placed = true; if (name) S[k].name = name; saveState();
  placeMarkers(); syncSiteInputs();
  // placement never fetches terrain or recomputes — results are only refreshed when the user presses Path / Coverage
  if (RF.last || COV.cur) OPS.markStale(true);
}
function clearSites() {
  S.tx.placed = false; S.rx.placed = false; saveState(); placeMarkers();
  if (RF.last || COV.cur) OPS.markStale(true);
  log('Tx/Rx markers cleared — place new sites with the Tx / Rx map buttons (no terrain is loaded until you run an analysis).');
}
function syncSiteInputs() {
  document.querySelectorAll('[data-k^="tx."],[data-k^="rx."]').forEach(function (inp) { var v = getK(inp.dataset.k); if (inp.type === 'checkbox') return; inp.value = inp.dataset.u === 'h' ? +hU(v).toFixed(2) : v; });
}
function setPick(m) {
  pickMode = pickMode === m ? null : m;
  ['Tx', 'Rx', 'Tp', 'Gn'].forEach(function (x) { $('pick' + x).classList.toggle('on', pickMode === x.toLowerCase()); });
  $('map').style.cursor = pickMode ? 'crosshair' : '';
}
function onMapClick(e) {
  if (!pickMode) return;
  var ll = e.latlng;
  if (pickMode === 'tx' || pickMode === 'rx') { var pm = pickMode; setSite(pm, ll.lat, ll.lng); setPick(pm); if (pm === 'tx' && !S.rx.placed) { setPick('rx'); log('Tx placed — now click the map to place Rx.'); } }
  else if (pickMode === 'tp') TP.add(ll.lat, ll.lng);
  else if (pickMode === 'gn') { SAT.setPoint(ll.lat, ll.lng); setPick('gn'); }
}
function onMapMove(e) {
  var ll = e.latlng, z = DEM.elev(ll.lat, ll.lng), t = fx(ll.lat, 5) + ', ' + fx(ll.lng, 5) + (isFinite(z) ? '  elev ' + hShort(z) : '');
  var d = PC.dist(S.tx.lat, S.tx.lon, ll.lat, ll.lng), b = PC.bearing(S.tx.lat, S.tx.lon, ll.lat, ll.lng);
  t += '\nfrom Tx ' + fx(d / 1000, 2) + ' km / ' + fx(d / 1852, 2) + ' NM @ ' + fx(b, 1) + '°';
  var cv = COV.valueAt(ll.lat, ll.lng);
  if (cv) t += '\n' + cv;
  $('hud').textContent = t;
}

/* ---------- panels ---------- */
var PANELS = [], curPanel = null;
var ICONS = {
  rf: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 10v11M8 21h8M12 10l-3 11M12 10l3 11"/><path d="M7 5a7 7 0 0 0 0 9M17 5a7 7 0 0 1 0 9M9.5 7.5a3.5 3.5 0 0 0 0 4M14.5 7.5a3.5 3.5 0 0 1 0 4"/></svg>',
  layers: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M12 3 2 8l10 5 10-5-10-5z"/><path d="m2 13 10 5 10-5M2 17.5l10 5 10-5"/></svg>',
  air: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M21 15.5v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V8.5l-8 5v2l8-2.5V18l-2 1.5V21l3.5-1 3.5 1v-1.5L13 18v-5z"/></svg>',
  gnss: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M12 3v18M3 12h18"/><circle cx="12" cy="12" r="3"/></svg>',
  sat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="m13 7 4 4-6 6-4-4z"/><path d="m15 5 2-2 4 4-2 2M9 19l-2 2-4-4 2-2M4 20l3-3"/></svg>',
  _mcs: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M3 14h18M9 4v16M15 4v16"/></svg>',
  tp: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>',
  terrain: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="m2 20 7-12 4 6 3-4 6 10z"/></svg>',
  offline: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5"/><path d="M12 4v11M7.5 10.5 12 15l4.5-4.5"/></svg>',
  los: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  help: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17h.01"/></svg>'
};
function panel(id, title, render, after) { PANELS.push({ id: id, title: title, render: render, after: after }); }
function buildRail() {
  $('rail').innerHTML = PANELS.map(function (p) { return '<button data-p="' + p.id + '" title="' + esc(p.title) + '">' + (ICONS[p.id] || '') + '<span>' + esc(p.title.split(' ')[0]) + '</span></button>'; }).join('');
  $('rail').addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) showPanel(b.dataset.p); });
}
function showPanel(id) {
  var p = PANELS.find(function (x) { return x.id === id; }) || PANELS[0];
  curPanel = p.id;
  document.querySelectorAll('#rail button').forEach(function (b) { b.classList.toggle('on', b.dataset.p === p.id); });
  var openSet = {};
  document.querySelectorAll('#pbody details.acc').forEach(function (d, i) { openSet[i] = d.open; });
  $('pbody').innerHTML = p.render();
  bind($('pbody'));
  if (p.after) p.after($('pbody'));
  applyIcons($('pbody'));
  runButtons();
}
function runPath() { return curPanel === 'los' ? RF.runP2P({ losOnly: true }) : RF.runP2P(); }
function runCoverage() { return curPanel === 'los' ? COV.run({ losOnly: true }) : COV.run(); }
function runButtons() {   // Save / Load / Path / Coverage live on the RF and LOS panels only
  var bar = $('runbtns'), los = curPanel === 'los'; if (!bar) return;
  bar.classList.toggle('hidden', curPanel !== 'rf' && curPanel !== 'los');
  $('bP2P').title = los ? 'Line-of-sight check between A and B — terrain only (P)' : 'Run point-to-point path analysis (P)';
  $('bCov').title = los ? 'Viewshed map from A — terrain only (C)' : 'Run area coverage (C)';
}
function rerender() { if (curPanel) { var st = $('pbody').scrollTop; var opens = Array.prototype.map.call(document.querySelectorAll('#pbody details.acc'), function (d) { return d.open; }); showPanel(curPanel); document.querySelectorAll('#pbody details.acc').forEach(function (d, i) { if (opens[i] !== undefined) d.open = opens[i]; }); $('pbody').scrollTop = st; } }

/* ---------- drawer ---------- */
function openDrawer(tab) {
  $('drawer').classList.add('open');
  if (tab) selectTab(tab);
  setTimeout(function () { map.invalidateSize(); RF.drawProfile(); }, 30);
}
function selectTab(t) {
  document.querySelectorAll('#dtabs button').forEach(function (b) { b.classList.toggle('on', b.dataset.t === t); });
  document.querySelectorAll('#drawer .tab').forEach(function (d) { d.classList.toggle('on', d.dataset.t === t); });
  if (t === 'profile') RF.drawProfile();
  if (t === 'tp') TP.renderTable();
  if (t === 'summary') OPS.refreshSummary();
}
function initDrawer() {
  $('dtabs').addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) selectTab(b.dataset.t); });
  $('dClose').onclick = function () { $('drawer').classList.remove('open'); setTimeout(function () { map.invalidateSize(); }, 30); };
  var h = $('dhandle'), dr = $('drawer'), y0 = 0, h0 = 0, drag = false;
  h.addEventListener('mousedown', function (e) { if (e.target.closest('button,input,label,select,option,a')) return; drag = true; y0 = e.clientY; h0 = dr.offsetHeight; e.preventDefault(); });
  window.addEventListener('mousemove', function (e) { if (!drag) return; dr.style.height = clamp(h0 - (e.clientY - y0), 120, window.innerHeight - 160) + 'px'; });
  window.addEventListener('mouseup', function () { if (drag) { drag = false; map.invalidateSize(); RF.drawProfile(); } });
  window.addEventListener('resize', function () { RF.drawProfile(); });
}

/* ---------- search ---------- */
function initSearch() {
  $('search').addEventListener('keydown', function (e) {
    if (e.key !== 'Enter') return;
    var q = this.value.trim(); if (!q) return;
    var m = /^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$/.exec(q);
    if (m) { map.setView([+m[1], +m[2]], 12); L.popup().setLatLng([+m[1], +m[2]]).setContent(ctxMenu(L.latLng(+m[1], +m[2]))).openOn(map); return; }
    if (/^tx$/i.test(q)) return map.setView([S.tx.lat, S.tx.lon], 12);
    if (/^rx$/i.test(q)) return map.setView([S.rx.lat, S.rx.lon], 12);
    var ap = LAY.findAirport(q);
    if (ap) { map.setView([ap[4], ap[5]], 12); LAY.openAirport(ap); return; }
    status('searching…');
    fetchJSONorText('https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(q)).then(function (r) {
      status('ready');
      if (!r.length) { log('No result for "' + q + '"', 'w'); return; }
      var b = r[0].boundingbox; map.fitBounds([[+b[0], +b[2]], [+b[1], +b[3]]], { maxZoom: 13 });
      log('Found: ' + r[0].display_name);
    }).catch(function (e) {
      status('ready');
      var c = (DATA.cities || []).find(function (c) { return c[0].toLowerCase() === q.toLowerCase(); });
      if (c) { map.setView([c[1], c[2]], 11); log('Offline city match: ' + c[0]); }
      else log('Search failed: ' + e.message, 'e');
    });
  });
}

/* ---------- workers ---------- */
var workerURL = null;
function makeWorker() {
  if (!workerURL) workerURL = URL.createObjectURL(new Blob([$('workerSrc').textContent], { type: 'text/javascript' }));
  return new Worker(workerURL);
}
