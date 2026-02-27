#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LEDGER_URL="${LEDGER_URL:-http://127.0.0.1:8000}"
NARRATIVE_URL="${NARRATIVE_URL:-http://127.0.0.1:8001}"
EORI="${EORI:-GBDEMO$RANDOM$RANDOM}"
INVOICE="${INVOICE:-INV-DEMO-$RANDOM}"
YEAR="${YEAR:-2026}"
QUARTER="${QUARTER:-1}"
RUN_TAG="${RUN_TAG:-$(date +%Y%m%d_%H%M%S)}"

REPORT_OUT="$ROOT_DIR/fixtures/ledger/cbam_report_package_TEST-$RUN_TAG.json"
NARRATIVE_OUT="$ROOT_DIR/fixtures/narrative/cbam_final_narrative_TEST-$RUN_TAG.json"
COMPLIANCE_OUT="$ROOT_DIR/fixtures/ledger/cbam_compliance_pack_TEST-$RUN_TAG.json"

mkdir -p "$(dirname "$REPORT_OUT")" "$(dirname "$NARRATIVE_OUT")" "$(dirname "$COMPLIANCE_OUT")"

TMP_CREATE="$(mktemp)"
TMP_PIPELINE="$(mktemp)"
TMP_PAYLOAD="$(mktemp)"
trap 'rm -f "$TMP_CREATE" "$TMP_PIPELINE" "$TMP_PAYLOAD"' EXIT

TODAY="$(date +%F)"

cat > "$TMP_PAYLOAD" <<JSON
{
  "importer": {
    "name": "Demo Importer Ltd",
    "eori": "$EORI"
  },
  "invoice": {
    "invoice_number": "$INVOICE",
    "invoice_date": "$TODAY",
    "origin_country": "TR",
    "incoterm": "FOB"
  },
  "lines": [
    {
      "cn_code": "720711",
      "description": "Steel billets",
      "quantity": 10000,
      "quantity_unit": "kg",
      "net_mass_kg": 10000
    },
    {
      "cn_code": "730890",
      "description": "Steel structures",
      "quantity": 5000,
      "quantity_unit": "kg",
      "net_mass_kg": 5000
    }
  ],
  "emissions": {
    "method": "actual",
    "direct_embedded_kgco2e": 70000,
    "indirect_embedded_kgco2e": 14000
  }
}
JSON

echo "1) Creating CBAM draft from parsed invoice..."
CREATE_CODE="$(curl -sS -o "$TMP_CREATE" -w "%{http_code}" \
  -X POST "$LEDGER_URL/api/cbam/drafts/from-parsed-invoice" \
  -H "Content-Type: application/json" \
  --data-binary "@$TMP_PAYLOAD")"
if [[ "$CREATE_CODE" != "201" ]]; then
  echo "Draft creation failed (HTTP $CREATE_CODE)" >&2
  cat "$TMP_CREATE" >&2
  exit 1
fi

CASE_ID="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["case_id"])' "$TMP_CREATE")"
SHIPMENT_ID="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["shipment_id"])' "$TMP_CREATE")"
GOODS_LINE_IDS="$(python3 -c 'import json,sys; print(",".join(json.load(open(sys.argv[1]))["goods_line_ids"]))' "$TMP_CREATE")"
EMISSIONS_IDS="$(python3 -c 'import json,sys; print(",".join(json.load(open(sys.argv[1]))["emissions_ids"]))' "$TMP_CREATE")"
GOODS_LINE_COUNT="$(python3 -c 'import json,sys; print(len(json.load(open(sys.argv[1]))["goods_line_ids"]))' "$TMP_CREATE")"
EMISSIONS_COUNT="$(python3 -c 'import json,sys; print(len(json.load(open(sys.argv[1]))["emissions_ids"]))' "$TMP_CREATE")"

echo "EORI=$EORI"
echo "INVOICE=$INVOICE"
echo "YEAR=$YEAR"
echo "QUARTER=$QUARTER"
echo "CASE_ID=$CASE_ID"
echo "SHIPMENT_ID=$SHIPMENT_ID"
echo "GOODS_LINE_IDS=$GOODS_LINE_IDS"
echo "EMISSIONS_IDS=$EMISSIONS_IDS"
echo "GOODS_LINE_COUNT=$GOODS_LINE_COUNT"
echo "EMISSIONS_COUNT=$EMISSIONS_COUNT"

if [[ -z "$EMISSIONS_IDS" ]]; then
  echo "Expected EMISSIONS_IDS to be populated for demo input." >&2
  exit 1
fi
if (( GOODS_LINE_COUNT < 2 || EMISSIONS_COUNT < 2 )); then
  echo "Expected at least 2 goods lines and 2 emissions for demo input." >&2
  exit 1
fi

echo "2) Fetching CBAM report-package..."
REPORT_CODE="$(curl -sS -o "$REPORT_OUT" -w "%{http_code}" \
  "$LEDGER_URL/api/cbam/cases/$CASE_ID/report-package")"
if [[ "$REPORT_CODE" != "200" ]]; then
  echo "Report-package fetch failed (HTTP $REPORT_CODE)" >&2
  cat "$REPORT_OUT" >&2
  exit 1
fi

echo "3) Running narrative pipeline..."
PIPELINE_CODE="$(curl -sS -o "$TMP_PIPELINE" -w "%{http_code}" \
  -X POST "$NARRATIVE_URL/api/cases/$CASE_ID/narrative/pipeline?packet_kind=cbam")"
if [[ "$PIPELINE_CODE" != "200" ]]; then
  echo "Narrative pipeline failed (HTTP $PIPELINE_CODE)" >&2
  cat "$TMP_PIPELINE" >&2
  exit 1
fi

python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); fn=d.get("final_narrative_json"); \
  (fn is not None) or (_ for _ in ()).throw(SystemExit("final_narrative_json missing in pipeline response")); \
  json.dump(fn, open(sys.argv[2], "w"), indent=2)' "$TMP_PIPELINE" "$NARRATIVE_OUT"

echo "4) Generating compliance pack..."
COMPLIANCE_CODE="$(curl -sS -o "$COMPLIANCE_OUT" -w "%{http_code}" \
  -X POST "$NARRATIVE_URL/api/cbam/cases/$CASE_ID/compliance-pack")"
if [[ "$COMPLIANCE_CODE" != "200" ]]; then
  echo "Compliance pack generation failed (HTTP $COMPLIANCE_CODE)" >&2
  cat "$COMPLIANCE_OUT" >&2
  exit 1
fi

echo "Done."
echo "Report package: $REPORT_OUT"
echo "Final narrative: $NARRATIVE_OUT"
echo "Compliance pack: $COMPLIANCE_OUT"
