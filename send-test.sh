#!/bin/sh
# Posts a sample intake to the local n8n webhook. Requires a real image/PDF URL in the payload
# and a working Anthropic credential in n8n to actually extract anything end to end.
# Usage: ./send-test.sh [payloads/new-invoice.json]
cd "$(dirname "$0")" && . ./.env
curl -sS -w ' HTTP %{http_code}\n' -X POST -H 'Content-Type: application/json' \
  -H "X-Intake-Secret: $INTAKE_SECRET" --data @"${1:-payloads/new-invoice.json}" \
  http://localhost:5678/webhook/new-invoice-doc
