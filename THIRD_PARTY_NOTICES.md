# Third-party notices

Signal Monkee's own code is released under the MIT License (see `LICENSE`).
The components below are bundled with it (in `vendor/`, `data/`, or as derived source)
and remain under their own terms. Full license texts are in `vendor/licenses/`.

## Libraries (bundled in `vendor/` and in the built HTML)

| Component | Version | License | Copyright |
|---|---|---|---|
| [Leaflet](https://leafletjs.com/) | 1.9.4 | BSD-2-Clause | © 2010–2023 Volodymyr Agafonkin, © 2010–2011 CloudMade |
| [satellite.js](https://github.com/shashwatak/satellite-js) | 5.0.0 | MIT | © 2013 Shashwat Kandadai and UCSC Jack Baskin School of Engineering |
| [h3-js](https://github.com/uber/h3-js) | 4.5.0 | Apache-2.0 | © 2017–2021 Uber Technologies, Inc. — see `vendor/licenses/h3-js-4.5.0-NOTICE` |
| [jsPDF](https://github.com/parallax/jsPDF) | 2.5.2 | MIT | © 2010–2021 James Hall, © 2015–2021 yWorks GmbH |

## Derived source

### Longley-Rice Irregular Terrain Model (`src/itm.js`)

`src/itm.js` is a JavaScript translation of the ITS Irregular Terrain Model
reference implementation, https://github.com/NTIA/itm (v1.4, C++).

> This software was developed by employees of the National Telecommunications and
> Information Administration (NTIA), an agency of the Federal Government and is
> provided to you as a public service. Pursuant to Title 15 United States Code
> Section 105, works of NTIA employees are not subject to copyright protection
> within the United States.
>
> The software is provided by NTIA "AS IS." NTIA MAKES NO WARRANTY OF ANY KIND,
> EXPRESS, IMPLIED OR STATUTORY, INCLUDING, WITHOUT LIMITATION, THE IMPLIED
> WARRANTY OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, NON-INFRINGEMENT
> AND DATA ACCURACY. NTIA does not warrant or make any representations regarding
> the use of the software or the results thereof, including but not limited to
> the correctness, accuracy, reliability or usefulness of the software.

**Changes made (October 2026):** translated from C++ to JavaScript; complex arithmetic
reimplemented with helper functions; `std::nth_element` replaced by an equivalent
quickselect and per-call arrays replaced by reusable buffers (performance only); the
point-to-point entry point exposes intermediate values. Results were verified against
the original C++ on 3,000 randomized paths (maximum difference ≈ 5×10⁻¹¹ dB).
Acknowledgment: the ITM algorithm and reference code are the work of NTIA/ITS.

## Data (bundled in `data/`)

| Dataset | Source | Terms |
|---|---|---|
| Airports, airport frequencies, navaids | [OurAirports](https://ourairports.com/data/) | Public domain |
| Populated places, coastlines, borders, lakes | [Natural Earth](https://www.naturalearthdata.com/) | Public domain |
| Mascot artwork (`data/mascot*.png`) | Liam Gogley | Covered by `LICENSE` unless stated otherwise |

## Online services (not bundled)

Map tiles, imagery, terrain tiles and live data are fetched at run time from third-party
services. Their terms apply to the end user's use of those services; they are not
redistributed with this software:

- Esri World Imagery / World Topo Map, CARTO basemaps, OpenTopoMap, OpenStreetMap tiles
- AWS Terrain Tiles (Mapzen/Tilezen terrain; SRTM, USGS NED/3DEP, GMTED2010, ETOPO1 and others)
- CelesTrak (orbital elements), RepeaterBook, BrandMeister, meshmap.net / Meshtastic map, gpsjam.org, Nominatim

"SPLAT!" is referenced only to describe the style of analysis; Signal Monkee is not
affiliated with or derived from the SPLAT! source code.
