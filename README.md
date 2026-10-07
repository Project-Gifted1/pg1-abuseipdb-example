# PG1 + AbuseIPDB example

Look up an IP address in [AbuseIPDB](https://www.abuseipdb.com) through
**PG1's `check_ip_abuse` tool**, using **your own AbuseIPDB API key**.

PG1 is a threat-intelligence service for AI agents. It exposes tools over
[MCP](https://modelcontextprotocol.io) and [A2A](https://a2a-protocol.org).
`check_ip_abuse` is "bring your own key": PG1 has no AbuseIPDB key of its own.
It passes your lookup to AbuseIPDB with your key and returns the result to you
in a consistent, agent-friendly shape.

This repo holds small, standalone examples: a `curl` script and a
zero-dependency Node.js script. It contains no PG1 server code.

## 1. Get a free AbuseIPDB key

Create an account and an API key at **https://www.abuseipdb.com/account/api**.
The free plan is enough. Lookups count against your own AbuseIPDB quota, and
PG1 doesn't charge for this tool.

## 2. Send the key in the `X-AbuseIPDB-Key` header

| Protocol | Endpoint |
| --- | --- |
| MCP (JSON-RPC `tools/call`) | `https://pg1-ai-agent.vercel.app/api/mcp` |
| A2A (JSON-RPC `SendMessage`) | `https://pg1-ai-agent.vercel.app/api/a2a` |

The key goes **only** in the `X-AbuseIPDB-Key` HTTP request header. **Never
pass it as a tool argument.** The tool's arguments are just:

- `ip`: one public IPv4 or IPv6 address. Private, reserved and malformed
  input is rejected with `invalid_ip` without contacting AbuseIPDB.
- `max_age_in_days`: optional, 1 to 365, default 90.

Without the header, the call returns the error `abuseipdb_key_required` and
AbuseIPDB isn't contacted.

## 3. Run the examples

```bash
export ABUSEIPDB_KEY=your-key-here   # or: cp .env.example .env and edit it

# curl: one MCP call and one A2A call
bash examples/curl.sh 8.8.8.8

# Node 18+ (built-in fetch, no npm install)
ABUSEIPDB_KEY=your-key-here node examples/check-ip.mjs 8.8.8.8
node examples/check-ip.mjs 8.8.8.8 --max-age 30   # with ABUSEIPDB_KEY exported
node examples/check-ip.mjs 8.8.8.8 --a2a          # use the A2A endpoint
node examples/check-ip.mjs 8.8.8.8 --json         # full JSON result

# Node 20.6+ can read the key from .env directly
node --env-file=.env examples/check-ip.mjs 8.8.8.8
```

`check-ip.mjs` prints the status, score, reasons and attribution. It exits
with `0` on success, `1` if the lookup failed (for example
`invalid_abuseipdb_key` or `abuseipdb_rate_limited`), and `2` for a usage
error such as a missing key or a bad IP.

### Raw requests

MCP:

```bash
curl -X POST https://pg1-ai-agent.vercel.app/api/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "X-AbuseIPDB-Key: $ABUSEIPDB_KEY" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"check_ip_abuse","arguments":{"ip":"8.8.8.8","max_age_in_days":90}}}'
```

A2A:

```bash
curl -X POST "https://pg1-ai-agent.vercel.app/api/a2a?A2A-Version=1.0" \
  -H "Content-Type: application/json" \
  -H "X-AbuseIPDB-Key: $ABUSEIPDB_KEY" \
  -d '{"jsonrpc":"2.0","id":1,"method":"SendMessage","params":{"message":{"messageId":"example-1","role":"ROLE_USER","parts":[{"data":{"skill":"check_ip_abuse","arguments":{"ip":"8.8.8.8"}}}]}}}'
```

On MCP, the result is in `result.structuredContent` (and as JSON text in
`result.content[0].text`). On A2A, it's in the completed task's
`artifacts[0].parts[0].data`.

## How `status` works

Each result has a `status` plus `reasons` (machine-readable codes with a
message):

1. **Whitelisted by AbuseIPDB → `no_flags`** with reason `IP_WHITELISTED`,
   even if it has reports. AbuseIPDB doesn't count those reports against it.
2. **Otherwise, `abuse_confidence_score` above 0 → `flagged`** with reason
   `IP_ABUSE_REPORTED` (score, report count, distinct reporters).
3. **Otherwise → `no_flags`.** If there are reports but AbuseIPDB scores
   them 0, the reason `IP_REPORTS_SCORED_ZERO` explains that.
4. **`unknown`** when the score or report count is missing, so the check
   didn't complete. `unknown` is never shown as `no_flags`.

`IP_TOR_EXIT_NODE` is informational and doesn't change the status by itself.

The result is **never "safe" or "clean"**. `abuse_confidence_score` is
AbuseIPDB's 0–100 confidence that an address is abusive. A score of 0 isn't
proof the address is harmless; `no_flags` only means nothing was flagged.

## Example responses

Real results from live MCP `tools/call` requests (the same request as
`examples/curl.sh`, with `max_age_in_days` 90), **snapshot from 7 Oct 2026;
values change as new reports arrive.** Trimmed to the main fields: the full
result also has `ip_version`, `max_age_in_days`, `cached`, `checks` and
`request_id`.

**8.8.8.8: whitelisted, score 0 → `no_flags`**

```json
{
  "ip": "8.8.8.8",
  "status": "no_flags",
  "abuse_confidence_score": 0,
  "total_reports": 226,
  "distinct_reporters": 90,
  "last_reported_at": "2026-10-06T21:32:34.000Z",
  "country_code": "US",
  "usage_type": "Content Delivery Network",
  "isp": "Google LLC",
  "domain": "google.com",
  "is_tor": false,
  "is_whitelisted": true,
  "reasons": [
    {
      "code": "IP_WHITELISTED",
      "message": "AbuseIPDB marks this address as whitelisted; it has 226 report(s) in the last 90 day(s), which AbuseIPDB does not count against it."
    }
  ],
  "note": "abuse_confidence_score is AbuseIPDB's 0-100 confidence that the address is abusive. A score of 0 is not proof the address is harmless.",
  "attribution": {
    "text": "Data from AbuseIPDB",
    "url": "https://www.abuseipdb.com/check/8.8.8.8"
  }
}
```

**116.179.32.142: score 95 → `flagged`**

```json
{
  "ip": "116.179.32.142",
  "status": "flagged",
  "abuse_confidence_score": 95,
  "total_reports": 239,
  "distinct_reporters": 32,
  "last_reported_at": "2026-10-07T11:46:06.000Z",
  "country_code": "CN",
  "usage_type": "Fixed Line ISP",
  "isp": "China United Network Communications Corporation Limited",
  "domain": "chinaunicom.cn",
  "is_tor": false,
  "is_whitelisted": false,
  "reasons": [
    {
      "code": "IP_ABUSE_REPORTED",
      "message": "IP address has an abuse confidence score of 95, from 239 abuse report(s) by 32 distinct reporter(s) in the last 90 day(s)."
    }
  ],
  "note": "abuse_confidence_score is AbuseIPDB's 0-100 confidence that the address is abusive. A score of 0 is not proof the address is harmless.",
  "attribution": {
    "text": "Data from AbuseIPDB",
    "url": "https://www.abuseipdb.com/check/116.179.32.142"
  }
}
```

For the 8.8.8.8 snapshot above, `node examples/check-ip.mjs 8.8.8.8` prints:

```text
IP:       8.8.8.8
Status:   no_flags
Score:    0 / 100
Reports:  226 from 90 reporter(s) in the last 90 day(s)
Reasons:
  - IP_WHITELISTED: AbuseIPDB marks this address as whitelisted; it has 226 report(s) in the last 90 day(s), which AbuseIPDB does not count against it.
Note:     abuse_confidence_score is AbuseIPDB's 0-100 confidence that the address is abusive. A score of 0 is not proof the address is harmless.
Data from AbuseIPDB: https://www.abuseipdb.com/check/8.8.8.8
```

### Errors

On MCP, errors come back as a tool error (`isError: true`) whose JSON has a
`code` and a `message`. On A2A, they come back as a JSON-RPC error with the
code in `error.data.code`.

| Code | Meaning |
| --- | --- |
| `abuseipdb_key_required` | No `X-AbuseIPDB-Key` header was sent |
| `invalid_abuseipdb_key` | AbuseIPDB rejected the key (401/403) |
| `abuseipdb_rate_limited` | Your AbuseIPDB quota is used up (`retry_after` is passed through) |
| `upstream_unavailable` | AbuseIPDB returned an error or timed out |
| `invalid_ip` | Not exactly one public IP address |

## Privacy

- PG1 **doesn't store or share your key or your results.** Results go only to
  the caller whose key was used. They're held in memory for up to 15 minutes
  per key to save your quota, and are never stored or added to
  PG1's own feeds.
- Keep your key out of git: `.env` is in `.gitignore`, and `.env.example`
  holds only a placeholder.

## Attribution

**Data from AbuseIPDB.** Every result includes
`attribution: { "text": "Data from AbuseIPDB", "url": "https://www.abuseipdb.com/check/<ip>" }`.
Please show it, with the link, wherever you display the data.

## Tests

`.github/workflows/check.yml` runs `node --test test/check-ip.test.mjs` on
Node 18, 20 and 22. It only tests the script's argument parsing and key
handling. It runs with no key and no network, and never calls AbuseIPDB or
PG1.

## More about PG1

- About: https://pg1-ai-agent.vercel.app/about
- Machine-readable overview for agents: https://pg1-ai-agent.vercel.app/llms.txt

## How this was made

Built with AI coding tooling. The MCP request in examples/curl.sh was tested live against PG1 on 7 October 2026. The Node script is tested offline against stubbed responses in CI.

## License

[MIT](LICENSE) © 2026 Gift Ikewun
