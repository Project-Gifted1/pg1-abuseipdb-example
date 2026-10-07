#!/usr/bin/env bash
# Look up one IP with PG1's check_ip_abuse tool, using YOUR OWN AbuseIPDB key.
#
#   export ABUSEIPDB_KEY=...        # https://www.abuseipdb.com/account/api
#   bash examples/curl.sh 8.8.8.8
#
# The key goes only in the X-AbuseIPDB-Key header, never in the request body.
set -euo pipefail

BASE_URL="${PG1_BASE_URL:-https://pg1-ai-agent.vercel.app}"
IP="${1:-8.8.8.8}"
MAX_AGE="${2:-90}"

if [ -z "${ABUSEIPDB_KEY:-}" ]; then
  echo "ABUSEIPDB_KEY is not set. Get a free key at https://www.abuseipdb.com/account/api" >&2
  exit 2
fi

# Only characters that can appear in an IPv4/IPv6 address, so the value is
# safe to put inside the JSON below. PG1 does the real validation.
if ! [[ "$IP" =~ ^[0-9A-Fa-f:.]+$ ]]; then
  echo "usage: $0 <ip> [max_age_in_days]" >&2
  exit 2
fi
if ! [[ "$MAX_AGE" =~ ^[0-9]+$ ]]; then
  echo "max_age_in_days must be a whole number from 1 to 365" >&2
  exit 2
fi

# Pretty-print with jq when it is installed.
pretty() { if command -v jq >/dev/null 2>&1; then jq .; else cat; echo; fi; }

echo "== MCP: tools/call check_ip_abuse =="
curl -sS -X POST "$BASE_URL/api/mcp" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "X-AbuseIPDB-Key: $ABUSEIPDB_KEY" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"check_ip_abuse\",\"arguments\":{\"ip\":\"$IP\",\"max_age_in_days\":$MAX_AGE}}}" \
  | pretty

echo "== A2A: SendMessage, skill check_ip_abuse =="
curl -sS -X POST "$BASE_URL/api/a2a?A2A-Version=1.0" \
  -H "Content-Type: application/json" \
  -H "X-AbuseIPDB-Key: $ABUSEIPDB_KEY" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"SendMessage\",\"params\":{\"message\":{\"messageId\":\"curl-example-1\",\"role\":\"ROLE_USER\",\"parts\":[{\"data\":{\"skill\":\"check_ip_abuse\",\"arguments\":{\"ip\":\"$IP\",\"max_age_in_days\":$MAX_AGE}}}]}}}" \
  | pretty
