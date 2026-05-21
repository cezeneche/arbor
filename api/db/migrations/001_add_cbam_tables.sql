CREATE SCHEMA IF NOT EXISTS cbam;
SET search_path TO cbam;

-- CBAM Quarter-Based Model

CREATE TABLE cbam.cbam_cases (
    id UUID PRIMARY KEY,
    importer_name TEXT NOT NULL,
    importer_eori TEXT NOT NULL,
    reporting_year INTEGER NOT NULL,
    reporting_quarter INTEGER NOT NULL CHECK (reporting_quarter BETWEEN 1 AND 4),
    status TEXT NOT NULL DEFAULT 'draft',
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_cbam_cases_eori
ON cbam.cbam_cases(importer_eori);


CREATE TABLE cbam.cbam_shipments (
    id UUID PRIMARY KEY,
    case_id UUID NOT NULL REFERENCES cbam_cases(id) ON DELETE CASCADE,
    import_date DATE NOT NULL,
    entry_reference TEXT,
    incoterm TEXT,
    origin_country TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_cbam_shipments_case
ON cbam.cbam_shipments(case_id);


CREATE TABLE cbam.cbam_goods_lines (
    id UUID PRIMARY KEY,
    shipment_id UUID NOT NULL REFERENCES cbam_shipments(id) ON DELETE CASCADE,
    cn_code TEXT NOT NULL,
    sector TEXT NOT NULL CHECK (
        sector IN (
            'cement',
            'iron_steel',
            'aluminium',
            'fertilisers',
            'electricity',
            'hydrogen'
        )
    ),
    description TEXT,
    quantity NUMERIC NOT NULL,
    quantity_unit TEXT NOT NULL,
    installation_name TEXT,
    installation_id TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_cbam_goods_lines_shipment
ON cbam.cbam_goods_lines(shipment_id);

CREATE INDEX idx_cbam_goods_lines_cn
ON cbam.cbam_goods_lines(cn_code);


CREATE TABLE cbam.cbam_emissions (
    id UUID PRIMARY KEY,
    goods_line_id UUID NOT NULL REFERENCES cbam_goods_lines(id) ON DELETE CASCADE,
    method TEXT NOT NULL CHECK (method IN ('actual', 'default', 'estimated')),
    direct_embedded_kgco2e NUMERIC NOT NULL,
    indirect_embedded_kgco2e NUMERIC,
    data_quality_score NUMERIC,
    notes TEXT,
    version INTEGER NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_cbam_emissions_line
ON cbam.cbam_emissions(goods_line_id);
