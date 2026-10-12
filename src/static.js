/* Static reference data bundled with the tool. Locations marked approx are facility-level approximations (±few km). */
var STATIC = {
  artcc: [
    ['ZAB', 'Albuquerque Center', 35.1733, -106.5675], ['ZAU', 'Chicago Center (Aurora, IL)', 41.7825, -88.3315],
    ['ZBW', 'Boston Center (Nashua, NH)', 42.7356, -71.4807], ['ZDC', 'Washington Center (Leesburg, VA)', 39.1015, -77.5427],
    ['ZDV', 'Denver Center (Longmont, CO)', 40.1873, -105.1270], ['ZFW', 'Fort Worth Center', 32.8306, -97.0664],
    ['ZHU', 'Houston Center', 29.9617, -95.3317], ['ZID', 'Indianapolis Center', 39.7375, -86.2803],
    ['ZJX', 'Jacksonville Center (Hilliard, FL)', 30.6986, -81.9081], ['ZKC', 'Kansas City Center (Olathe, KS)', 38.8800, -94.7908],
    ['ZLA', 'Los Angeles Center (Palmdale, CA)', 34.6031, -118.0836], ['ZLC', 'Salt Lake City Center', 40.7860, -111.9520],
    ['ZMA', 'Miami Center', 25.8247, -80.3192], ['ZME', 'Memphis Center', 35.0672, -89.9553],
    ['ZMP', 'Minneapolis Center (Farmington, MN)', 44.6372, -93.1522], ['ZNY', 'New York Center (Ronkonkoma, NY)', 40.7845, -73.0975],
    ['ZOA', 'Oakland Center (Fremont, CA)', 37.5428, -122.0161], ['ZOB', 'Cleveland Center (Oberlin, OH)', 41.2972, -82.2064],
    ['ZSE', 'Seattle Center (Auburn, WA)', 47.2869, -122.1886], ['ZTL', 'Atlanta Center (Hampton, GA)', 33.3797, -84.2967],
    ['ZAN', 'Anchorage Center', 61.2292, -149.7808], ['ZHN', 'Honolulu Control Facility', 21.3270, -157.9253],
    ['ZSU', 'San Juan CERAP', 18.4310, -66.0060], ['ZUA', 'Guam CERAP', 13.4790, 144.8020]
  ],
  // GEO satellites — nominal orbital slots (deg E). Verify against operator data for precise pointing.
  geo: [
    ['Inmarsat I-4 F1 (APAC)', 143.5, 'L'], ['Inmarsat I-4 F2 (MEAS)', 64.0, 'L'], ['Inmarsat I-4 F3 (AMER)', -98.0, 'L'],
    ['Inmarsat Alphasat (EMEA)', 25.0, 'L'], ['Inmarsat-6 F1', 84.0, 'L/Ka'], ['Inmarsat-5 F1 GX (IOR)', 62.6, 'Ka'],
    ['Inmarsat-5 F2 GX (AOR)', -55.0, 'Ka'], ['Inmarsat-5 F3 GX (POR)', 179.6, 'Ka'], ['ViaSat-2', -69.9, 'Ka'],
    ['ViaSat-3 F1 (Americas)', -88.9, 'Ka'], ['EchoStar XIX (Jupiter 2)', -97.1, 'Ka'], ['Thuraya-2', 44.0, 'L'], ['Thuraya-3', 98.5, 'L'],
    ['Ligado SkyTerra-1', -101.3, 'L']
  ],
  // LEO/MEO constellations via CelesTrak GP groups
  constellations: {
    gnss: [['GPS', 'gps-ops', '#4cc9f0'], ['GLONASS', 'glo-ops', '#f72585'], ['Galileo', 'galileo', '#ffd166'], ['BeiDou', 'beidou', '#ef476f'], ['SBAS', 'sbas', '#9b9b9b']],
    satcom: [['Iridium NEXT', 'iridium-NEXT', '#06d6a0', 8.2, 780], ['Starlink', 'starlink', '#a0c4ff', 25, 550], ['OneWeb', 'oneweb', '#ffadad', 15, 1200], ['Globalstar', 'globalstar', '#fdffb6', 10, 1414], ['ORBCOMM', 'orbcomm', '#caffbf', 5, 750]]
  },
  // Commonly NOTAM'd GNSS test/interference areas (approximate centres). Always verify with current NOTAMs / FAA GPS anomaly reports.
  gnssAreas: [
    ['NAWS China Lake, CA (frequent GPS test NOTAMs)', 35.69, -117.69, 120, 'test'], ['Edwards AFB, CA', 34.905, -117.884, 80, 'test'],
    ['NTC Fort Irwin, CA', 35.26, -116.68, 80, 'test'], ['MCAGCC Twentynine Palms, CA', 34.30, -116.16, 80, 'test'],
    ['Yuma Proving Ground, AZ', 32.86, -114.39, 100, 'test'], ['White Sands Missile Range, NM', 32.38, -106.48, 150, 'test'],
    ['Nevada Test & Training Range', 37.30, -116.20, 150, 'test'], ['NAS Fallon, NV', 39.42, -118.70, 80, 'test'], ['Eglin AFB, FL', 30.48, -86.53, 100, 'test'],
    ['Baltic / Kaliningrad region (public reporting)', 54.70, 20.50, 350, 'chronic'], ['Eastern Mediterranean (public reporting)', 34.0, 34.5, 400, 'chronic'],
    ['Black Sea region (public reporting)', 44.5, 33.5, 450, 'chronic'], ['Iraq / Syria (public reporting)', 34.5, 41.0, 450, 'chronic'],
    ['Finnmark / Kola border (public reporting)', 69.5, 30.0, 250, 'chronic']
  ],
  // SPLAT!/ITM ground parameter presets: name, epsilon, sigma (S/m)
  ground: [
    ['Average ground', 15, 0.005], ['Poor ground', 4, 0.001], ['Good ground', 25, 0.020], ['Fresh water', 80, 0.010],
    ['Salt water', 80, 5.0], ['Marshy / forested flat', 12, 0.007], ['Farmland / forest', 15, 0.005], ['Mountain / sandy', 13, 0.002], ['City / industrial', 5, 0.001]
  ],
  climates: ['', 'Equatorial', 'Continental Subtropical', 'Maritime Subtropical', 'Desert', 'Continental Temperate', 'Maritime Temperate (land)', 'Maritime Temperate (sea)'],
  // name, MHz, bandwidth kHz, typical Tx W, Tx gain dBi, Rx sens dBm, pol(0H/1V), note
  freqPresets: [
    ['Airband VHF voice (AM, 8.33/25 kHz)', 127.0, 25, 25, 2.15, -101, 1, 'VHF AM air-ground 118–137 MHz'],
    ['Airband UHF mil (AM)', 300.0, 25, 10, 2.15, -101, 1, '225–400 MHz'],
    ['VOR / ILS LOC', 113.0, 50, 100, 2.15, -95, 0, '108–118 MHz nav'],
    ['ADS-B 1090ES', 1090.0, 2600, 250, 3, -84, 1, 'Mode S / 1090ES'],
    ['Ham 2 m FM repeater', 146.94, 12.5, 50, 6, -120, 1, '144–148 MHz'],
    ['Ham 1.25 m FM', 224.5, 12.5, 50, 6, -120, 1, '222–225 MHz'],
    ['Ham 70 cm FM / DMR', 445.0, 12.5, 40, 6, -120, 1, '420–450 MHz'],
    ['Meshtastic US LongFast', 906.875, 250, 0.158, 2.15, -136, 1, 'SF11 BW250 CR4/5, 22 dBm'],
    ['Meshtastic EU LongFast', 869.525, 250, 0.025, 2.15, -136, 1, 'SF11 BW250, 14 dBm (ERP limits)'],
    ['LoRaWAN US915 SF10', 915.0, 125, 0.1, 2.15, -132, 1, ''],
    ['GPS L1 C/A (jammer study)', 1575.42, 2046, 1, 0, -130, 1, 'GPS L1 signal ≈ −128.5 dBm min'],
    ['S-band telemetry / C2', 2250.0, 5000, 5, 6, -100, 1, '2200–2290 MHz'],
    ['2.4 GHz datalink (20 MHz)', 2437.0, 20000, 1, 3, -82, 1, 'ISM'],
    ['5.8 GHz datalink (20 MHz)', 5800.0, 20000, 1, 5, -82, 1, 'ISM/UNII-3'],
    ['L-band UAS C2 (5030–5091)', 5060.0, 1000, 2, 3, -100, 1, ''],
    ['Iridium L-band', 1621.0, 41.67, 1.6, 3, -118, 1, '1616–1626.5 MHz'],
    ['Inmarsat L-band', 1545.0, 200, 10, 12, -125, 1, '1525–1559 / 1626.5–1660.5 MHz'],
    ['Starlink Ku downlink', 11700.0, 250000, 1, 33, -85, 1, '10.7–12.7 GHz']
  ]
};
if (typeof module !== 'undefined') module.exports = STATIC;
