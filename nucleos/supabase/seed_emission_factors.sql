-- =============================================================================
-- NUCLEOS CBAM — EMISSION FACTOR SEED DATA
-- Source: EU Commission Implementing Regulation 2023/1773 Annex VI
-- All values in tCO2e per tonne of goods (direct + indirect)
-- Run AFTER migration.sql
-- =============================================================================

-- Truncate before re-seeding so this script is idempotent
TRUNCATE cbam.cbam_emission_factors RESTART IDENTITY CASCADE;
TRUNCATE cbam.cbam_electricity_factors RESTART IDENTITY CASCADE;

-- =============================================================================
-- SECTOR: CEMENT (CN chapters 25, 2523)
-- Annex VI Table A — Default SEE for cement clinker and cement products
-- =============================================================================
INSERT INTO cbam.cbam_emission_factors
  (cn8_prefix, sector, production_route, direct_tco2e, indirect_tco2e, table_version, effective_from, source_ref)
VALUES
  -- Cement clinker (2523 10)
  ('25231000', 'cement', 'default',        0.7648, 0.0236, '2023', '2024-01-01', 'EU 2023/1773 Annex VI Table A'),
  -- Portland cement (2523 21, 2523 29)
  ('25232100', 'cement', 'default',        0.6781, 0.0213, '2023', '2024-01-01', 'EU 2023/1773 Annex VI Table A'),
  ('25232900', 'cement', 'default',        0.6781, 0.0213, '2023', '2024-01-01', 'EU 2023/1773 Annex VI Table A'),
  -- Aluminous cement (2523 30)
  ('25233000', 'cement', 'default',        0.7200, 0.0220, '2023', '2024-01-01', 'EU 2023/1773 Annex VI Table A'),
  -- Other hydraulic cements (2523 90)
  ('25239000', 'cement', 'default',        0.6500, 0.0200, '2023', '2024-01-01', 'EU 2023/1773 Annex VI Table A'),
  -- Lime (2522) — used in cement sector as precursor
  ('25221000', 'cement', 'quicklime',      0.7854, 0.0187, '2023', '2024-01-01', 'EU 2023/1773 Annex VI Table A'),
  ('25222000', 'cement', 'slaked_lime',    0.5960, 0.0151, '2023', '2024-01-01', 'EU 2023/1773 Annex VI Table A');

-- =============================================================================
-- SECTOR: IRON & STEEL (CN chapters 72, 73)
-- Annex VI Table B — Default SEE by production route
-- =============================================================================
INSERT INTO cbam.cbam_emission_factors
  (cn8_prefix, sector, production_route, direct_tco2e, indirect_tco2e, table_version, effective_from, source_ref)
VALUES
  -- Pig iron (7201) — Blast Furnace
  ('72011000', 'iron_steel', 'BF',         1.5940, 0.0284, '2023', '2024-01-01', 'EU 2023/1773 Annex VI Table B'),
  ('72019000', 'iron_steel', 'BF',         1.5940, 0.0284, '2023', '2024-01-01', 'EU 2023/1773 Annex VI Table B'),
  -- Ferro-alloys (7202)
  ('72021100', 'iron_steel', 'default',    2.7500, 0.0850, '2023', '2024-01-01', 'EU 2023/1773 Annex VI Table B'),
  ('72021900', 'iron_steel', 'default',    2.7500, 0.0850, '2023', '2024-01-01', 'EU 2023/1773 Annex VI Table B'),
  ('72022100', 'iron_steel', 'default',    1.9800, 0.0620, '2023', '2024-01-01', 'EU 2023/1773 Annex VI Table B'),
  ('72022900', 'iron_steel', 'default',    1.9800, 0.0620, '2023', '2024-01-01', 'EU 2023/1773 Annex VI Table B'),
  -- Direct Reduced Iron (7203) — DRI route
  ('72031000', 'iron_steel', 'DRI',        0.4460, 0.1320, '2023', '2024-01-01', 'EU 2023/1773 Annex VI Table B'),
  ('72039000', 'iron_steel', 'DRI',        0.4460, 0.1320, '2023', '2024-01-01', 'EU 2023/1773 Annex VI Table B'),
  -- Iron and non-alloy steel in ingots (7206)
  ('72060000', 'iron_steel', 'BF-BOF',    1.8520, 0.0356, '2023', '2024-01-01', 'EU 2023/1773 Annex VI Table B'),
  ('72060000', 'iron_steel', 'EAF',        0.3280, 0.1560, '2023', '2024-01-01', 'EU 2023/1773 Annex VI Table B'),
  -- Semi-finished products (7207)
  ('72071100', 'iron_steel', 'BF-BOF',    1.9100, 0.0381, '2023', '2024-01-01', 'EU 2023/1773 Annex VI Table B'),
  ('72071100', 'iron_steel', 'EAF',        0.3490, 0.1620, '2023', '2024-01-01', 'EU 2023/1773 Annex VI Table B'),
  ('72071200', 'iron_steel', 'BF-BOF',    1.9100, 0.0381, '2023', '2024-01-01', 'EU 2023/1773 Annex VI Table B'),
  ('72071900', 'iron_steel', 'BF-BOF',    1.9100, 0.0381, '2023', '2024-01-01', 'EU 2023/1773 Annex VI Table B'),
  ('72072000', 'iron_steel', 'BF-BOF',    1.9100, 0.0381, '2023', '2024-01-01', 'EU 2023/1773 Annex VI Table B'),
  -- Flat-rolled products — hot-rolled (7208, 7211)
  ('72081000', 'iron_steel', 'BF-BOF',    1.9740, 0.0398, '2023', '2024-01-01', 'EU 2023/1773 Annex VI Table B'),
  ('72081000', 'iron_steel', 'EAF',        0.3620, 0.1680, '2023', '2024-01-01', 'EU 2023/1773 Annex VI Table B'),
  -- Flat-rolled products — cold-rolled (7209, 7212)
  ('72091500', 'iron_steel', 'BF-BOF',    2.0380, 0.0411, '2023', '2024-01-01', 'EU 2023/1773 Annex VI Table B'),
  ('72091500', 'iron_steel', 'EAF',        0.3780, 0.1740, '2023', '2024-01-01', 'EU 2023/1773 Annex VI Table B'),
  -- Bars and rods (7213, 7214, 7215)
  ('72131000', 'iron_steel', 'EAF',        0.3950, 0.1810, '2023', '2024-01-01', 'EU 2023/1773 Annex VI Table B'),
  ('72141000', 'iron_steel', 'EAF',        0.3950, 0.1810, '2023', '2024-01-01', 'EU 2023/1773 Annex VI Table B'),
  -- Stainless steel (7219, 7220)
  ('72191100', 'iron_steel', 'AOD',        2.4680, 0.2740, '2023', '2024-01-01', 'EU 2023/1773 Annex VI Table B'),
  ('72201100', 'iron_steel', 'AOD',        2.4680, 0.2740, '2023', '2024-01-01', 'EU 2023/1773 Annex VI Table B');

-- =============================================================================
-- SECTOR: ALUMINIUM (CN chapters 76)
-- Annex VI Table C
-- =============================================================================
INSERT INTO cbam.cbam_emission_factors
  (cn8_prefix, sector, production_route, direct_tco2e, indirect_tco2e, table_version, effective_from, source_ref)
VALUES
  -- Primary aluminium (7601 10) — Hall-Héroult smelting
  ('76011000', 'aluminium', 'primary',     1.4840, 7.0200, '2023', '2024-01-01', 'EU 2023/1773 Annex VI Table C'),
  -- Secondary (recycled) aluminium (7601 20)
  ('76012000', 'aluminium', 'secondary',   0.0360, 0.5100, '2023', '2024-01-01', 'EU 2023/1773 Annex VI Table C'),
  -- Aluminium alloys (7601 20 xx)
  ('76012010', 'aluminium', 'secondary',   0.0360, 0.5100, '2023', '2024-01-01', 'EU 2023/1773 Annex VI Table C'),
  ('76012090', 'aluminium', 'primary',     1.4840, 7.0200, '2023', '2024-01-01', 'EU 2023/1773 Annex VI Table C'),
  -- Aluminium bars and rods (7604)
  ('76041000', 'aluminium', 'primary',     1.6270, 7.4900, '2023', '2024-01-01', 'EU 2023/1773 Annex VI Table C'),
  ('76042100', 'aluminium', 'primary',     1.6270, 7.4900, '2023', '2024-01-01', 'EU 2023/1773 Annex VI Table C'),
  -- Aluminium wire (7605)
  ('76051100', 'aluminium', 'primary',     1.6980, 7.7200, '2023', '2024-01-01', 'EU 2023/1773 Annex VI Table C'),
  -- Aluminium plates and sheets (7606)
  ('76061100', 'aluminium', 'primary',     1.7440, 7.9100, '2023', '2024-01-01', 'EU 2023/1773 Annex VI Table C'),
  -- Aluminium foil (7607)
  ('76071100', 'aluminium', 'primary',     1.9200, 8.5400, '2023', '2024-01-01', 'EU 2023/1773 Annex VI Table C'),
  -- Aluminium tubes and pipes (7608)
  ('76081000', 'aluminium', 'primary',     2.0110, 8.9700, '2023', '2024-01-01', 'EU 2023/1773 Annex VI Table C');

-- =============================================================================
-- SECTOR: FERTILISERS (CN chapters 28, 31)
-- Annex VI Table E
-- =============================================================================
INSERT INTO cbam.cbam_emission_factors
  (cn8_prefix, sector, production_route, direct_tco2e, indirect_tco2e, table_version, effective_from, source_ref)
VALUES
  -- Ammonia (2814 10, 2814 20)
  ('28141000', 'fertilisers', 'SMR',       1.6940, 0.0854, '2023', '2024-01-01', 'EU 2023/1773 Annex VI Table E'),
  ('28142000', 'fertilisers', 'SMR',       0.5620, 0.0284, '2023', '2024-01-01', 'EU 2023/1773 Annex VI Table E'),
  -- Nitric acid (2808 00)
  ('28080010', 'fertilisers', 'Ostwald',   0.4260, 0.0162, '2023', '2024-01-01', 'EU 2023/1773 Annex VI Table E'),
  -- Urea (3102 10)
  ('31021010', 'fertilisers', 'urea_synth',0.7330, 0.0370, '2023', '2024-01-01', 'EU 2023/1773 Annex VI Table E'),
  ('31021090', 'fertilisers', 'urea_synth',0.7330, 0.0370, '2023', '2024-01-01', 'EU 2023/1773 Annex VI Table E'),
  -- Ammonium nitrate (3102 30)
  ('31023010', 'fertilisers', 'AN_synth',  1.1320, 0.0530, '2023', '2024-01-01', 'EU 2023/1773 Annex VI Table E'),
  ('31023090', 'fertilisers', 'AN_synth',  1.1320, 0.0530, '2023', '2024-01-01', 'EU 2023/1773 Annex VI Table E'),
  -- Mixed nitrogen fertilisers (3102 40, 3102 50)
  ('31024010', 'fertilisers', 'default',   0.9840, 0.0462, '2023', '2024-01-01', 'EU 2023/1773 Annex VI Table E'),
  ('31025000', 'fertilisers', 'default',   0.9840, 0.0462, '2023', '2024-01-01', 'EU 2023/1773 Annex VI Table E'),
  -- Urea-ammonium nitrate (UAN) solution (3102 80)
  ('31028000', 'fertilisers', 'UAN_synth', 0.8620, 0.0421, '2023', '2024-01-01', 'EU 2023/1773 Annex VI Table E'),
  -- NPK fertilisers (3105)
  ('31051000', 'fertilisers', 'default',   0.6780, 0.0340, '2023', '2024-01-01', 'EU 2023/1773 Annex VI Table E'),
  ('31052000', 'fertilisers', 'default',   0.6780, 0.0340, '2023', '2024-01-01', 'EU 2023/1773 Annex VI Table E');

-- =============================================================================
-- SECTOR: HYDROGEN (CN 2804 10)
-- Annex VI Table F
-- =============================================================================
INSERT INTO cbam.cbam_emission_factors
  (cn8_prefix, sector, production_route, direct_tco2e, indirect_tco2e, table_version, effective_from, source_ref)
VALUES
  -- Grey hydrogen — Steam Methane Reforming (no CCS)
  ('28041000', 'hydrogen', 'SMR',          9.0500, 0.5700, '2023', '2024-01-01', 'EU 2023/1773 Annex VI Table F'),
  -- Blue hydrogen — SMR with CCS
  ('28041000', 'hydrogen', 'SMR-CCS',      1.4800, 0.5700, '2023', '2024-01-01', 'EU 2023/1773 Annex VI Table F'),
  -- Green hydrogen — electrolysis (renewable electricity; indirect near-zero)
  ('28041000', 'hydrogen', 'electrolysis', 0.0000, 0.4200, '2023', '2024-01-01', 'EU 2023/1773 Annex VI Table F'),
  -- Coal gasification hydrogen
  ('28041000', 'hydrogen', 'coal_gasif',  18.2100, 0.5700, '2023', '2024-01-01', 'EU 2023/1773 Annex VI Table F');

-- =============================================================================
-- SECTOR: ELECTRICITY (CN 2716 00)
-- Annex VI Table G — default SEE for electricity imports
-- =============================================================================
INSERT INTO cbam.cbam_emission_factors
  (cn8_prefix, sector, production_route, direct_tco2e, indirect_tco2e, table_version, effective_from, source_ref)
VALUES
  -- Default SEE for electricity (tCO2e per MWh expressed as tCO2e per tonne equivalent)
  -- For electricity the primary metric is tCO2e/MWh; stored here for completeness
  ('27160000', 'electricity', 'default',   0.4940, 0.0000, '2023', '2024-01-01', 'EU 2023/1773 Annex VI Table G');

-- =============================================================================
-- ELECTRICITY GRID EMISSION FACTORS by country (Annex VI Table D)
-- Unit: tCO2e per MWh
-- =============================================================================
INSERT INTO cbam.cbam_electricity_factors
  (country_iso2, tco2e_per_mwh, table_version, effective_from, source_ref)
VALUES
  -- EU member states
  ('AT', 0.1078, '2023', '2024-01-01', 'EU 2023/1773 Annex VI Table D'),
  ('BE', 0.1672, '2023', '2024-01-01', 'EU 2023/1773 Annex VI Table D'),
  ('BG', 0.3999, '2023', '2024-01-01', 'EU 2023/1773 Annex VI Table D'),
  ('CY', 0.6289, '2023', '2024-01-01', 'EU 2023/1773 Annex VI Table D'),
  ('CZ', 0.4109, '2023', '2024-01-01', 'EU 2023/1773 Annex VI Table D'),
  ('DE', 0.3660, '2023', '2024-01-01', 'EU 2023/1773 Annex VI Table D'),
  ('DK', 0.1231, '2023', '2024-01-01', 'EU 2023/1773 Annex VI Table D'),
  ('EE', 0.5918, '2023', '2024-01-01', 'EU 2023/1773 Annex VI Table D'),
  ('ES', 0.1695, '2023', '2024-01-01', 'EU 2023/1773 Annex VI Table D'),
  ('FI', 0.0756, '2023', '2024-01-01', 'EU 2023/1773 Annex VI Table D'),
  ('FR', 0.0513, '2023', '2024-01-01', 'EU 2023/1773 Annex VI Table D'),
  ('GR', 0.3881, '2023', '2024-01-01', 'EU 2023/1773 Annex VI Table D'),
  ('HR', 0.2002, '2023', '2024-01-01', 'EU 2023/1773 Annex VI Table D'),
  ('HU', 0.2117, '2023', '2024-01-01', 'EU 2023/1773 Annex VI Table D'),
  ('IE', 0.2952, '2023', '2024-01-01', 'EU 2023/1773 Annex VI Table D'),
  ('IT', 0.2331, '2023', '2024-01-01', 'EU 2023/1773 Annex VI Table D'),
  ('LT', 0.1403, '2023', '2024-01-01', 'EU 2023/1773 Annex VI Table D'),
  ('LU', 0.0848, '2023', '2024-01-01', 'EU 2023/1773 Annex VI Table D'),
  ('LV', 0.1071, '2023', '2024-01-01', 'EU 2023/1773 Annex VI Table D'),
  ('MT', 0.5122, '2023', '2024-01-01', 'EU 2023/1773 Annex VI Table D'),
  ('NL', 0.2706, '2023', '2024-01-01', 'EU 2023/1773 Annex VI Table D'),
  ('PL', 0.7199, '2023', '2024-01-01', 'EU 2023/1773 Annex VI Table D'),
  ('PT', 0.1787, '2023', '2024-01-01', 'EU 2023/1773 Annex VI Table D'),
  ('RO', 0.2638, '2023', '2024-01-01', 'EU 2023/1773 Annex VI Table D'),
  ('SE', 0.0152, '2023', '2024-01-01', 'EU 2023/1773 Annex VI Table D'),
  ('SI', 0.2522, '2023', '2024-01-01', 'EU 2023/1773 Annex VI Table D'),
  ('SK', 0.1556, '2023', '2024-01-01', 'EU 2023/1773 Annex VI Table D'),
  -- Key third countries (exporter nations)
  ('CN', 0.5810, '2023', '2024-01-01', 'EU 2023/1773 Annex VI Table D'),
  ('IN', 0.7082, '2023', '2024-01-01', 'EU 2023/1773 Annex VI Table D'),
  ('RU', 0.3220, '2023', '2024-01-01', 'EU 2023/1773 Annex VI Table D'),
  ('TR', 0.4522, '2023', '2024-01-01', 'EU 2023/1773 Annex VI Table D'),
  ('UA', 0.3512, '2023', '2024-01-01', 'EU 2023/1773 Annex VI Table D'),
  ('GB', 0.2330, '2023', '2024-01-01', 'EU 2023/1773 Annex VI Table D'),
  ('NO', 0.0187, '2023', '2024-01-01', 'EU 2023/1773 Annex VI Table D'),
  ('CH', 0.0286, '2023', '2024-01-01', 'EU 2023/1773 Annex VI Table D'),
  ('US', 0.3868, '2023', '2024-01-01', 'EU 2023/1773 Annex VI Table D'),
  ('KR', 0.4589, '2023', '2024-01-01', 'EU 2023/1773 Annex VI Table D'),
  ('JP', 0.4716, '2023', '2024-01-01', 'EU 2023/1773 Annex VI Table D'),
  ('EG', 0.4637, '2023', '2024-01-01', 'EU 2023/1773 Annex VI Table D'),
  ('ZA', 0.8418, '2023', '2024-01-01', 'EU 2023/1773 Annex VI Table D'),
  ('MA', 0.6312, '2023', '2024-01-01', 'EU 2023/1773 Annex VI Table D'),
  -- Default fallback (used when country not found)
  ('XX', 0.4940, '2023', '2024-01-01', 'EU 2023/1773 Annex VI Table D default');
