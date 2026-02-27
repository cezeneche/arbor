#!/usr/bin/env bash
set -euo pipefail

API="http://127.0.0.1:8000"

# Unique importer to avoid uq_cbam_cases_importer_eori_year_quarter collisions
EORI="GB$(date +%s)"
YEAR=2025
QTR=1

echo "Using importer_eori=$EORI year=$YEAR quarter=$QTR"

CASE_ID=$(curl -s -X POST "$API/api/cbam/cases" \
  -H "Content-Type: application/json" \
  -d "{\"importer_name\":\"Alpha Steel Ltd\",\"importer_eori\":\"$EORI\",\"reporting_year\":$YEAR,\"reporting_quarter\":$QTR}" \
| python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")

echo "CASE_ID=$CASE_ID"

SHIPMENT_ID=$(curl -s -X POST "$API/api/cbam/shipments" \
  -H "Content-Type: application/json" \
  -d "{\"cbam_case_id\":\"$CASE_ID\",\"supplier_name\":\"Supplier A\",\"origin_country\":\"TR\",\"arrival_date\":\"2025-01-15\"}" \
| python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")

echo "SHIPMENT_ID=$SHIPMENT_ID"

GOODS_LINE_ID=$(curl -s -X POST "$API/api/cbam/goods-lines" \
  -H "Content-Type: application/json" \
  -d "{\"shipment_id\":\"$SHIPMENT_ID\",\"cn_code\":\"720711\",\"net_mass_kg\":10000}" \
| python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")

echo "GOODS_LINE_ID=$GOODS_LINE_ID"

EMISSIONS_ID=$(curl -s -X POST "$API/api/cbam/emissions" \
  -H "Content-Type: application/json" \
  -d "{\"goods_line_id\":\"$GOODS_LINE_ID\",\"direct_emissions_kgco2e\":50000,\"indirect_emissions_kgco2e\":10000,\"calculation_method\":\"actual\",\"version\":1}" \
| python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")

echo "EMISSIONS_ID=$EMISSIONS_ID"

echo "SUMMARY:"
curl -s "$API/api/cbam/cases/$CASE_ID/summary" | python3 -m json.tool

echo "REPORT PACKAGE:"
curl -s "$API/api/cbam/cases/$CASE_ID/report-package" | python3 -m json.tool
