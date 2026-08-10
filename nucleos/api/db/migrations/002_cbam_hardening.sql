CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

DO $$
BEGIN
    IF to_regclass('cbam.cbam_cases') IS NOT NULL
       AND EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'cbam'
              AND table_name = 'cbam_cases'
              AND column_name = 'updated_at'
       )
       AND NOT EXISTS (
            SELECT 1
            FROM pg_trigger
            WHERE tgname = 'trg_set_updated_at_cbam_cases'
              AND tgrelid = 'cbam.cbam_cases'::regclass
              AND NOT tgisinternal
       ) THEN
        CREATE TRIGGER trg_set_updated_at_cbam_cases
        BEFORE UPDATE ON cbam.cbam_cases
        FOR EACH ROW
        EXECUTE FUNCTION public.set_updated_at();
    END IF;

    IF to_regclass('cbam.cbam_shipments') IS NOT NULL
       AND EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'cbam'
              AND table_name = 'cbam_shipments'
              AND column_name = 'updated_at'
       )
       AND NOT EXISTS (
            SELECT 1
            FROM pg_trigger
            WHERE tgname = 'trg_set_updated_at_cbam_shipments'
              AND tgrelid = 'cbam.cbam_shipments'::regclass
              AND NOT tgisinternal
       ) THEN
        CREATE TRIGGER trg_set_updated_at_cbam_shipments
        BEFORE UPDATE ON cbam.cbam_shipments
        FOR EACH ROW
        EXECUTE FUNCTION public.set_updated_at();
    END IF;

    IF to_regclass('cbam.cbam_goods_lines') IS NOT NULL
       AND EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'cbam'
              AND table_name = 'cbam_goods_lines'
              AND column_name = 'updated_at'
       )
       AND NOT EXISTS (
            SELECT 1
            FROM pg_trigger
            WHERE tgname = 'trg_set_updated_at_cbam_goods_lines'
              AND tgrelid = 'cbam.cbam_goods_lines'::regclass
              AND NOT tgisinternal
       ) THEN
        CREATE TRIGGER trg_set_updated_at_cbam_goods_lines
        BEFORE UPDATE ON cbam.cbam_goods_lines
        FOR EACH ROW
        EXECUTE FUNCTION public.set_updated_at();
    END IF;

    IF to_regclass('cbam.cbam_emissions') IS NOT NULL
       AND EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'cbam'
              AND table_name = 'cbam_emissions'
              AND column_name = 'updated_at'
       )
       AND NOT EXISTS (
            SELECT 1
            FROM pg_trigger
            WHERE tgname = 'trg_set_updated_at_cbam_emissions'
              AND tgrelid = 'cbam.cbam_emissions'::regclass
              AND NOT tgisinternal
       ) THEN
        CREATE TRIGGER trg_set_updated_at_cbam_emissions
        BEFORE UPDATE ON cbam.cbam_emissions
        FOR EACH ROW
        EXECUTE FUNCTION public.set_updated_at();
    END IF;
END;
$$;

DO $$
BEGIN
    IF to_regclass('cbam.cbam_cases') IS NOT NULL
       AND NOT EXISTS (
            SELECT 1
            FROM pg_constraint
            WHERE conname = 'uq_cbam_cases_importer_eori_year_quarter'
              AND conrelid = 'cbam.cbam_cases'::regclass
       ) THEN
        ALTER TABLE cbam.cbam_cases
        ADD CONSTRAINT uq_cbam_cases_importer_eori_year_quarter
        UNIQUE (importer_eori, reporting_year, reporting_quarter);
    END IF;

    IF to_regclass('cbam.cbam_emissions') IS NOT NULL
       AND NOT EXISTS (
            SELECT 1
            FROM pg_constraint
            WHERE conname = 'uq_cbam_emissions_goods_line_id_version'
              AND conrelid = 'cbam.cbam_emissions'::regclass
       ) THEN
        ALTER TABLE cbam.cbam_emissions
        ADD CONSTRAINT uq_cbam_emissions_goods_line_id_version
        UNIQUE (goods_line_id, version);
    END IF;
END;
$$;


DO $$
BEGIN
    -- cbam_shipments: index the FK back to cbam_cases (column name may differ between migrations)
    IF to_regclass('cbam.cbam_shipments') IS NOT NULL THEN
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema='cbam' AND table_name='cbam_shipments' AND column_name='cbam_case_id'
        ) THEN
            EXECUTE 'CREATE INDEX IF NOT EXISTS idx_cbam_shipments_cbam_case_id ON cbam.cbam_shipments (cbam_case_id)';
        ELSIF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema='cbam' AND table_name='cbam_shipments' AND column_name='case_id'
        ) THEN
            EXECUTE 'CREATE INDEX IF NOT EXISTS idx_cbam_shipments_case_id ON cbam.cbam_shipments (case_id)';
        ELSIF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema='cbam' AND table_name='cbam_shipments' AND column_name='cbam_case_uuid'
        ) THEN
            EXECUTE 'CREATE INDEX IF NOT EXISTS idx_cbam_shipments_cbam_case_uuid ON cbam.cbam_shipments (cbam_case_uuid)';
        END IF;
    END IF;

    -- cbam_goods_lines: index shipment FK (column name may differ)
    IF to_regclass('cbam.cbam_goods_lines') IS NOT NULL THEN
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema='cbam' AND table_name='cbam_goods_lines' AND column_name='shipment_id'
        ) THEN
            EXECUTE 'CREATE INDEX IF NOT EXISTS idx_cbam_goods_lines_shipment_id ON cbam.cbam_goods_lines (shipment_id)';
        ELSIF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema='cbam' AND table_name='cbam_goods_lines' AND column_name='cbam_shipment_id'
        ) THEN
            EXECUTE 'CREATE INDEX IF NOT EXISTS idx_cbam_goods_lines_cbam_shipment_id ON cbam.cbam_goods_lines (cbam_shipment_id)';
        END IF;
    END IF;

    -- cbam_emissions: index goods_line + created_at desc if those columns exist
    IF to_regclass('cbam.cbam_emissions') IS NOT NULL THEN
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema='cbam' AND table_name='cbam_emissions' AND column_name='goods_line_id'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema='cbam' AND table_name='cbam_emissions' AND column_name='created_at'
        ) THEN
            EXECUTE 'CREATE INDEX IF NOT EXISTS idx_cbam_emissions_goods_line_id_created_at_desc ON cbam.cbam_emissions (goods_line_id, created_at DESC)';
        END IF;
    END IF;
END;
$$;
