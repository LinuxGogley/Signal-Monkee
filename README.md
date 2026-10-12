# Signal Monkee

<img width="1777" height="1003" alt="Example_Plot" src="https://github.com/user-attachments/assets/e17d8593-74f3-406e-a42c-dd16f57880a6" />

A terrain-aware RF path-link and coverage tool that runs entirely in a web browser, in the spirit of [SPLAT!](https://www.qsl.net/kd2bd/splat.html). It does:

- **Point-to-point path analysis:** terrain profile with earth curvature, Fresnel zones, obstructions, required antenna heights, link budget, and a pass/fail verdict.
- **Area coverage maps:** Longley-Rice ITM, ITU-R P.526, Hata or free space, computed in parallel Web Workers.
- **Aviation, repeater and Meshtastic layers.**
- **GNSS and SATCOM visibility:** SGP4, DOP and terrain masking.
- **Exports:** Google Earth KMZ, CSV, and PDF and text reports.
- **Two modes:** *Engineer* (full RF analysis) and *Operator* (a one-page line-of-sight check for pilots and field users).
- **LOS planning:** a terrain-only line-of-sight check and viewshed map with no radio settings, in both modes.
- **Offline data packages:** build a .zip of terrain, public-domain imagery and satellite orbits while online, then import it on a computer with no internet.

The shipped product is **one self-contained HTML file** (`dist/Signal_Monkee.html`). This repository holds the readable source that produces it.

---

## Quick start

```bash
python3 build.py                 # -> dist/Signal_Monkee.html   (Python 3.8+, standard library only)
```

Open `dist/Signal_Monkee.html` in Chrome, Edge, Firefox or Safari. It runs straight from disk (`file://`) and needs no server.

### Desktop executable (optional)

`desktop/` wraps the same HTML in [Electron](https://www.electronjs.org/):

```bash
python3 build.py
cd desktop
npm install
npm start                        # run as a desktop app
npm run dist:win                 # portable .exe      (build on Windows, or Linux with Wine)
npm run dist:linux               # .AppImage
npm run dist:mac                 # .dmg               (build on macOS)
```

Installers land in `desktop/dist/`. The wrapper (`desktop/main.js`) is about 25 lines. It opens the HTML in a sandboxed window and exposes no Node APIs to the page.

---

## Repository layout

```
build.py            bundles src/ + vendor/ + data/ into dist/Signal_Monkee.html
src/
  index.html        page skeleton; /*MARKERS*/ are replaced by build.py
  style.css         all app styling (dark UI, CSS variables at the top)
  itm.js            Longley-Rice ITM v1.4 — line-for-line port of the NTIA/ITS C++ reference
  propcore.js       geodesy, Deygout knife-edge (P.526), Okumura-Hata, antenna patterns, pathLoss()
  worker.js         coverage Web Worker (one radial at a time; bundled with itm.js + propcore.js)
  dem.js            terrain: AWS Terrain Tiles (Terrarium PNG) + SRTM .hgt/.zip, IndexedDB cache
  static.js         reference data: ARTCC centres, GEO slots, constellations, ground presets, templates
  app_core.js       state (S) + persistence, utilities, input binding, map & base layers, panels, drawer
  app_rf.js         link budget, analyze() (SPLAT!-style path analysis), profile canvas, text report, RF panel
  app_cov.js        coverage run (workers), polar→raster rendering, palette/legend, stats, KMZ export
  app_layers.js     airports/ATC/navaids, repeaters, DMR, Meshtastic, gpsjam, imports, Airband panel
  app_sat.js        TLE handling, SGP4 look angles, sky plot, DOP, horizon masks, GEO footprints, LEO availability
  app_tp.js         test points, ZIP writer, KML builder/parser, CSV, project save/load
  app_ops.js        pass/fail verdict, Summary card, Clear, PDF report (jsPDF)
  app_opmode.js     Operator mode panel and the Operator/Engineer switch
  app_los.js        LOS planning panel: terrain-only check + viewshed (RF.runP2P / COV.run with {losOnly:true})
  app_offline.js    offline packages: build (ZIP of tiles + orbits + layers), import (into IndexedDB), cached tile layer
  app_main.js       Terrain & Help panels, panel registration, boot()
vendor/             third-party libraries (unmodified dist builds) + licenses/
data/               compact JSON datasets + mascot images (regenerate with tools/make_data.py)
tools/
  make_data.py      re-download & compact OurAirports / Natural Earth data
  build_itm_ref.sh  fetch + compile the NTIA C++ ITM as a CLI
  validate_itm.js   fuzz-compare src/itm.js against the C++ reference (3000 random paths)
tests/              headless browser tests (Playwright) with synthetic terrain/TLE fixtures — no network needed
desktop/            Electron wrapper for .exe / .AppImage / .dmg
```

There's no framework and no bundler. Each `src/app_*.js` file is a plain script that defines one global module object (`RF`, `COV`, `LAY`, `SAT`, `TP`, `OPS`, …). `build.py` concatenates them in the order listed in `APP_MODULES`, so a module may only use globals from files listed before it at load time. At run time (inside functions) any module can call any other.

---

## How it works

### Data flow for a path analysis (`RF.runP2P` → `RF.analyze`)

1. **Terrain.** `RF.ensureFor()` picks a Terrarium zoom (default z12, about 30 m) whose tile count stays bounded, then `DEM.ensure()` downloads only the tiles that are missing. Tiles are cached in memory and in IndexedDB. Loaded SRTM `.hgt` tiles take priority wherever they cover the path.
2. **Profile.** `buildProfile()` samples the great circle between Tx and Rx at roughly the terrain resolution (32–4000 points) and reads elevations with `DEM.elev()` (bilinear).
3. **Geometry.**
   - The effective earth radius is derived the same way ITM does it: Nₛ = N₀·e^(−h/9460), γₑ = 157e−9·(1 − 0.04665·e^(Nₛ/179.3)), k = aₑ / 6370 km.
   - For every sample the code computes the earth bulge d₁d₂/(2aₑ), the LOS height, the first-Fresnel radius √(λd₁d₂/D), and the clearance.
   - Obstructions are contiguous runs of negative clearance.
   - The required Tx/Rx heights for 0, 60 and 100 % F1 clearance are solved in closed form per sample.
4. **Loss.** `PC.pathLoss()` runs ITM, P.526 (Deygout, three edges) and Hata on the same profile. ITM is valid for 0.5–3000 m terminal heights. Outside that range (for example aircraft), the code falls back to geometric LOS plus P.526, and the report says so.
5. **Budget.** EIRP plus antenna pattern toward Rx (from azimuth and elevation angle), minus loss and clutter, plus Rx gain, minus Rx feeder loss, gives Prx. From that come field strength, SNR (noise = −174 + 10·log B + NF), margin against sensitivity, and the verdict (`OPS.verdict`: PASS / MARGINAL / FAIL against the required fade margin).

### Operator mode (`app_opmode.js`, `S.mode = 'operator'`)

Operator mode reuses the same engine but changes four things, all via `OPM()` checks:

| | Engineer | Operator |
|---|---|---|
| Path loss | ITM / P.526 / Hata / free space | free space only |
| Line of sight | Fresnel zones, ITM regimes | geometric LOS over the terrain profile |
| Antennas | pattern files, feeder losses | isotropic, Tx + Rx gain only |
| Pass/fail | margin ≥ required fade margin over sensitivity | LOS clear **and** RSSI ≥ minimum RSSI |

- **Earth curvature:** standard radio horizon (k = 4/3) or geometric/visual (k = 1). `RF.effEarth()` returns 4/3·6371 km or 6371 km.
- **Altitude needed:** the result card reports the receiver altitude (MSL) needed for line of sight (`A.rxAltNeed`), and the transmitter height that would also work.
- **Coverage:** runs the worker with `model: 'los'`, so blocked points are left blank. The colour scale starts at the minimum RSSI (`COV.CC()`).
- **Switching modes** clears results, because the two modes calculate differently.

### LOS planning (`app_los.js`)

`RF.runP2P({ losOnly: true })` and `COV.run({ losOnly: true })` reuse the path and coverage engines, but ignore every radio parameter.
- **Earth curvature:** set separately in `S.los.earth`, either standard (4/3) or geometric (k = 1).
- **Results:** `A.losOnly` switches the result card and PDF to **CLEAR / BLOCKED**, with the highest blocking terrain and the altitude needed for line of sight.
- **Viewshed map:** colours the area visible from point A green, and optionally shades hidden areas red.

### Contrast-map themes (`THEMES` in `app_core.js`)

Most themes fill the Natural Earth land polygons (`basemap.json → land`), so the Contrast map works offline everywhere. A transparent relief overlay, computed from terrain tiles, is drawn on top where terrain is available. **Grey relief** instead draws the opaque hillshade. To add a theme, add an entry with these keys:

| Key | Meaning |
|---|---|
| `bg` | sea / background colour |
| `fill` | land colour |
| `lake` | lake colour |
| `coast`, `borders`, `states` | line colours |
| `relief` | `[shadowAlpha, highlightAlpha, highlightRGB]` |
| `label`, `halo` | city label text and outline colours |
| `w` | optional line widths `[coast, country borders, states]` in px |
| `heavy` | `true` draws thicker lines (when `w` is not set) |

### Offline packages (`app_offline.js`)

`OFFLINE.build()`:
1. Enumerates tiles for the area: the map view, or a radius around both the Tx and Rx so the whole path is covered.
2. Reads each tile from the IndexedDB cache or downloads it (8 at a time).
3. Writes a store-only ZIP: `manifest.json`, `terrain/z/x/y.png`, `imagery/<id>/z/x/y.jpg`, `tle/<group>.txt`, and optionally `layers.json`, `testpoints.json` and `project.json`.

`OFFLINE.importPkg()`:
1. Unzips the package.
2. Writes every tile to IndexedDB **under the exact URL the app would request online** (`DEM.tileURL()`, or the USGS template), so nothing else needs to know it is offline.
3. Stores the TLEs, then merges layers and test points.

The `tests/offline_test.py` round trip shows identical path and coverage results with zero network requests.

Only public-domain imagery (USGS The National Map: `USGSImageryOnly`, `USGSTopo`; U.S. coverage) is packaged. Esri, CARTO and OpenStreetMap tiles are online-only because their terms restrict bulk offline copies. Offline, the **Contrast** basemap is rendered from the packaged terrain.

### Coverage (`COV.run`)

SPLAT!-style **radial sweep**:
1. The main thread samples elevations on `rays × (L+1)` polar points around the Tx and splits the radials across `navigator.hardwareConcurrency − 1` workers.
2. Each worker walks outward along its radials. At every step k it evaluates the model on the profile prefix `[0..k]` (zero-copy: ITM reads `pfl[0]` as the point count). It also records the elevation angle and a running-horizon LOS flag.
3. The results are kept as polar arrays (`loss`, `elAng`, `los`).
4. `renderCanvas()` maps every output pixel back to (azimuth, distance). It uses Web-Mercator rows for the Leaflet overlay, or equirectangular rows for the KML GroundOverlay. It bilinearly interpolates the loss and colours it.

Changing power, gains, display mode or palette **only re-renders**. Only geometry, frequency, model or Rx-height changes need a new run.

### ITM port and validation

`src/itm.js` follows the NTIA/ITS reference function by function (`QuickPfl`, `FindHorizons`, `ComputeDeltaH`, `LongleyRice`, `Variability`, …). Two details matter for exact agreement:
- **`MAX`/`MIN` behave like the C macros, not `Math.max`.** They differ when a value is NaN, and the reference relies on the macro behaviour.
- **`ComputeDeltaH` reproduces `std::nth_element` with a quickselect** on the same order statistics.

To check the port against the C++ reference:

```bash
tools/build_itm_ref.sh && node tools/validate_itm.js     # expect: bad 0, maxdiff ~1e-10 dB
```

### Terrain sources (`dem.js`)

| Source | Notes |
|---|---|
| AWS Terrain Tiles (Terrarium PNG) | Global SRTM / USGS NED / GMTED / ETOPO mosaic. elevation = R·256 + G + B/256 − 32768. Configurable URL, so you can point it at a local tile server for air-gapped use. |
| SRTM `.hgt` / `.hgt.zip` | 1″ (3601²) or 3″ (1201²) big-endian int16; file name must be like `N36W121.hgt`. A minimal ZIP reader uses `DecompressionStream('deflate-raw')`. |

### Persistence

- **Settings** (object `S`) live in `localStorage['pathlink.state']`, with defaults in `DEFAULTS` in `app_core.js`.
- **Terrain tiles, TLEs and imported layers** live in IndexedDB `pathlink-rf`.
- **Test points** live in `localStorage['pathlink.tp']`.
- **Project files** (💾 Save / 📂 Load) are plain JSON holding `S` and the test points.
- **Offline packages** are stored in the same IndexedDB (`tiles` store; `kv` keys `tle:<group>` and `offline:packages`).
- **Mode:** `S.mode` is `'engineer'` or `'operator'`, and Operator-only values live in `S.op` (`minRssi`, `earth`, `covDisplay`).

### Embedded datasets (row formats, see `tools/make_data.py`)

- `airports.json`: `[ident, iata, type L/M/S/W, name, lat, lon, elev_ft, country, municipality, [[type, desc, MHz], …]]`
- `navaids.json`: `[ident, name, type, freq_kHz, lat, lon, elev_ft, country, dme_channel, power, airport]`
- `cities.json`: `[name, lat, lon, pop_max, scalerank, adm0_a3, is_capital]`
- `basemap.json`: `{land, coast, states, borders, lakes}`. `land` is a list of polygons, each a list of rings (outer first, then holes). The others are lists of lines. All coordinates are flat `[lon, lat, lon, lat, …]` arrays.

---

## Common changes

- **Add a propagation model:**
  1. Add a branch in `PC.pathLoss()` (`propcore.js`).
  2. Add it to the Model `<select>` in `RF.render()` and to `RF.modelName()`.
  3. If it should take part in coverage, nothing else is needed: the worker calls `pathLoss()`.
- **Add a radio template:** add a row to `STATIC.freqPresets` in `static.js`: `[name, MHz, bandwidth_kHz, Tx_W, Tx_dBi, Rx_sensitivity_dBm, pol 0/1, note]`.
- **Add a data layer:**
  1. Create a group in `LAY.initLayers()` and draw it in `refreshDynamic()` or `drawExt()`.
  2. Add a checkbox with `CK(label, 'layers.yourKey')`. The `watch('layers.', …)` hook redraws it.
- **Add a coverage display mode:**
  1. Add a case in `displayValue()` and `colorFor()` (`app_cov.js`) and a legend entry in `legend()`.
  2. Add an option in the Output accordion in `RF.render()`.
- **Input binding:** any element with `data-k="path.in.S"` is two-way bound by `bind()`. Add `data-u="h"` for heights so the m/ft toggle converts them. React to changes with `watch('prefix', fn)`.

---

## Tests

```bash
pip install playwright numpy pillow && playwright install chromium
python3 build.py
python3 tests/run.py            # P2P, coverage, basemaps, airband, GNSS, SATCOM, test points/KMZ, layers
python3 tests/run.py extra      # aircraft path, field-strength map, KMZ with overlay, SRTM .hgt import
python3 tests/place_test.py     # placement without data pulls, stale-result bar, Clear menu
python3 tests/op_test.py        # Operator mode: blocked/clear LOS, altitude needed, RSSI check, coverage, PDF
python3 tests/offline_test.py   # build a package online, import into a fresh offline profile, compare results
python3 tests/los_test.py       # LOS planning: clear/blocked, altitude needed, viewshed, PDF, both modes
```

The tests intercept all network requests. Terrain tiles come from a synthetic mountain model (`tests/fixtures.py`), and CelesTrak is answered with generated GPS / Galileo / GLONASS / Iridium / Starlink-like TLEs. They run offline and give the same results every time. Screenshots go to `tests/out/`.

---

## Known limitations

- **Bare-earth terrain:** no buildings or vegetation. Use the clutter-loss field to account for them.
- **Operator mode is deliberately simple:** geometric line of sight plus free-space loss with isotropic antennas. It does not model diffraction, fading or real antenna patterns, so use Engineer mode for marginal links.
- **Offline imagery is U.S.-only:** it uses USGS. The imagery export depends on the USGS server allowing browser downloads; terrain and orbits don't.
- **ITM validity:** 20 MHz–20 GHz and 0.5–3000 m terminal heights. Outside that, the tool falls back to P.526 as described above.
- **Live fetches:** these are made by the browser. Some services (RepeaterBook, BrandMeister, meshmap.net, gpsjam.org, CelesTrak) may block cross-origin requests from `file://`. Every fetcher has an **Import** fallback for a saved response.
- **Frequencies and satellite data are informational.** Airport frequencies come from the community-maintained OurAirports, and GEO slots are nominal. Verify against official sources before operational use.

## Credits & licences

- Libraries, in `vendor/licenses/`:
  - Leaflet 1.9.4 (BSD-2-Clause)
  - satellite.js 5.0.0 (MIT)
  - h3-js 4.5.0 (Apache-2.0)
  - jsPDF 2.5.2 (MIT)
- Data:
  - OurAirports (public domain)
  - Natural Earth (public domain)
  - AWS Terrain Tiles (see their attribution requirements)
  - Basemap tiles by Esri, CARTO, OpenTopoMap and OpenStreetMap, each under its own terms
- Algorithms:
  - ITM: NTIA/ITS reference implementation (github.com/NTIA/itm)
  - Knife-edge: ITU-R P.526
  - SGP4: via satellite.js
