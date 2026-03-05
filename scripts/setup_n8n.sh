#!/usr/bin/env bash
# setup_n8n.sh — Import CBAM workflow definitions into n8n.
#
# Run this once after `docker compose up` completes, or whenever you add
# a new workflow JSON file to n8n/workflows/.
#
# Usage:
#   ./scripts/setup_n8n.sh
#
# What it does:
#   1. Waits for the n8n container to be healthy
#   2. Imports all workflow JSON files from n8n/workflows/
#   3. Prints the n8n UI URL and setup instructions

set -euo pipefail

COMPOSE_SERVICE="n8n"
WORKFLOWS_DIR="./n8n/workflows"
N8N_UI_URL="${N8N_WEBHOOK_URL:-http://localhost:5678}"

echo "==> Waiting for n8n to be ready..."
max_attempts=30
attempt=0
until docker compose exec -T "$COMPOSE_SERVICE" n8n --version >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge "$max_attempts" ]; then
    echo "ERROR: n8n container did not become ready in time."
    echo "       Is the stack running?  docker compose up -d"
    exit 1
  fi
  sleep 2
done

echo "==> Importing workflows from ${WORKFLOWS_DIR}/ ..."
imported=0
failed=0
for f in "$WORKFLOWS_DIR"/*.json; do
  [ -f "$f" ] || continue
  name="$(basename "$f")"
  if docker compose exec -T "$COMPOSE_SERVICE" \
      n8n import:workflow --separate --input="/workflows/${name}" 2>/dev/null; then
    echo "    ✓ ${name}"
    imported=$((imported + 1))
  else
    echo "    ✗ ${name} (import failed — workflow may already exist)"
    failed=$((failed + 1))
  fi
done

echo ""
echo "==> Import complete: ${imported} succeeded, ${failed} skipped/failed."
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  n8n UI:  ${N8N_UI_URL}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Next steps:"
echo ""
echo "  1. Open the n8n UI and log in with the credentials from .env"
echo "     (N8N_ADMIN_USER / N8N_ADMIN_PASSWORD)"
echo ""
echo "  2. Create a 'Header Auth' credential named exactly:"
echo "       CBAM Service Token"
echo "     Set the header name to:  Authorization"
echo "     Set the header value to: Bearer <your-jwt-token>"
echo ""
echo "     To get a dev token (AUTH_DEV_TOKEN_ENDPOINT=true required):"
echo "       curl -s -X POST http://localhost:8000/api/auth/token \\"
echo "         -H 'Content-Type: application/json' \\"
echo "         -d '{\"sub\":\"n8n-orchestrator\",\"scopes\":[\"cbam:write\",\"cbam:read\",\"narrative:run\",\"review:write\"]}' \\"
echo "         | jq -r .access_token"
echo ""
echo "  3. Open the 'CBAM Pipeline Orchestrator' workflow and activate it."
echo ""
echo "  4. Trigger the pipeline by posting to the webhook:"
echo "       curl -s -X POST ${N8N_UI_URL}/webhook/cbam-pipeline \\"
echo "         -H 'Content-Type: application/json' \\"
echo "         -d '{\"case_id\": \"<uuid>\", \"packet_kind\": \"cbam\"}'"
echo ""
echo "  5. On completion, a Slack notification is sent to SLACK_WEBHOOK_URL."
echo "     If human_review_required=true, a reviewer must POST to:"
echo "       /api/cases/<uuid>/review/approve  (scope: review:write)"
echo "       /api/cases/<uuid>/review/reject   (scope: review:write)"
echo ""
