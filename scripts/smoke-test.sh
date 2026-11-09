#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${1:?usage: smoke-test.sh <base_url> <expected_sha>}"
EXPECTED_SHA="${2:?}"

echo "▶ smoke test → $BASE_URL (expect sha=$EXPECTED_SHA)"

HEALTH=$(curl -fsS "$BASE_URL/health")
echo "  health: $HEALTH"
echo "$HEALTH" | grep -q "\"sha\":\"$EXPECTED_SHA\"" || { echo "❌ sha mismatch"; exit 1; }
echo "✅ /health sha matches"

CODE=$(curl -s -o /dev/null -w '%{http_code}' "$BASE_URL/whoami")
[ "$CODE" = "401" ] || { echo "❌ /whoami expected 401, got $CODE"; exit 1; }
echo "✅ /whoami unauthenticated → 401"

CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE_URL/mpesa/validation" \
  -H 'content-type: application/json' -d '{"nope":true}')
[ "$CODE" = "400" ] || { echo "❌ /mpesa/validation bad-json expected 400, got $CODE"; exit 1; }
echo "✅ /mpesa/validation rejects malformed payload"

echo "✅ ALL SMOKE TESTS PASSED"
