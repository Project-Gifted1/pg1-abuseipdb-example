#!/usr/bin/env node
// Look up one IP with PG1's check_ip_abuse tool, using YOUR OWN AbuseIPDB key.
// Zero dependencies: Node 18+ (built-in fetch).
//
//   ABUSEIPDB_KEY=... node examples/check-ip.mjs 8.8.8.8
//   ABUSEIPDB_KEY=... node examples/check-ip.mjs 8.8.8.8 --max-age 30 --a2a
//
// The key is sent only in the X-AbuseIPDB-Key header, never as a tool
// argument, and is never printed.

import { isIP } from 'node:net';
import { pathToFileURL } from 'node:url';

const DEFAULT_BASE_URL = 'https://pg1-ai-agent.vercel.app';
const PLACEHOLDER_KEY = 'your-abuseipdb-api-key';

export const USAGE = `usage: ABUSEIPDB_KEY=<your key> node examples/check-ip.mjs <ip> [options]

options:
  --max-age <days>   only count reports from the last 1-365 days (default 90)
  --a2a              call the A2A endpoint instead of MCP
  --json             print the full JSON result
  -h, --help         show this help

Get a free AbuseIPDB key at https://www.abuseipdb.com/account/api`;

export class UsageError extends Error {}

// Parses command-line arguments. Throws UsageError on bad input.
export function parseArgs(argv) {
  const opts = { ip: null, maxAge: 90, protocol: 'mcp', json: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') {
      opts.help = true;
    } else if (arg === '--a2a') {
      opts.protocol = 'a2a';
    } else if (arg === '--json') {
      opts.json = true;
    } else if (arg === '--max-age' || arg.startsWith('--max-age=')) {
      const value = arg === '--max-age' ? argv[++i] : arg.slice('--max-age='.length);
      if (value === undefined || !/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 365) {
        throw new UsageError('--max-age must be a whole number from 1 to 365');
      }
      opts.maxAge = Number(value);
    } else if (arg.startsWith('-')) {
      throw new UsageError(`unknown option: ${arg}`);
    } else if (opts.ip !== null) {
      throw new UsageError('give exactly one IP address');
    } else {
      opts.ip = arg.trim();
    }
  }
  if (opts.help) return opts;
  if (!opts.ip) throw new UsageError('missing IP address');
  // A quick local check; PG1 also rejects private and reserved addresses.
  if (isIP(opts.ip) === 0) throw new UsageError('not a valid IPv4 or IPv6 address');
  return opts;
}

// Returns the key from the environment, or null when it is missing or still
// the .env.example placeholder.
export function readKey(env) {
  const key = (env.ABUSEIPDB_KEY || '').trim();
  return key && key !== PLACEHOLDER_KEY ? key : null;
}

export function buildRequest(opts, key, baseUrl = DEFAULT_BASE_URL) {
  const args = { ip: opts.ip, max_age_in_days: opts.maxAge };
  const headers = { 'Content-Type': 'application/json', 'X-AbuseIPDB-Key': key };
  if (opts.protocol === 'a2a') {
    return {
      url: `${baseUrl}/api/a2a?A2A-Version=1.0`,
      init: {
        method: 'POST',
        headers,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'SendMessage',
          params: { message: { messageId: `check-ip-${Date.now()}`, role: 'ROLE_USER', parts: [{ data: { skill: 'check_ip_abuse', arguments: args } }] } }
        })
      }
    };
  }
  return {
    url: `${baseUrl}/api/mcp`,
    init: {
      method: 'POST',
      headers: { ...headers, Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'check_ip_abuse', arguments: args } })
    }
  };
}

// An MCP server may answer as a server-sent event stream; take the last
// JSON-RPC message from its data lines.
function parseBody(text, contentType) {
  if ((contentType || '').includes('text/event-stream')) {
    const data = text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).filter(Boolean);
    return JSON.parse(data[data.length - 1]);
  }
  return JSON.parse(text);
}

// Turns a JSON-RPC reply into { result } or { error: { code, message } }.
export function extractResult(body, protocol) {
  if (body.error) {
    return { error: { code: body.error.data?.code || String(body.error.code), message: body.error.message } };
  }
  if (protocol === 'a2a') {
    const task = body.result?.task || body.result;
    const data = task?.artifacts?.[0]?.parts?.find((p) => p.data)?.data;
    return data ? { result: data } : { error: { code: 'unexpected_response', message: 'no result in the A2A reply' } };
  }
  const r = body.result;
  const payload = r?.structuredContent || (r?.content?.[0]?.text ? JSON.parse(r.content[0].text) : null);
  if (r?.isError) return { error: { code: payload?.code || 'tool_error', message: payload?.message || 'tool error' } };
  return payload ? { result: payload } : { error: { code: 'unexpected_response', message: 'no result in the MCP reply' } };
}

export function formatResult(r) {
  const lines = [
    `IP:       ${r.ip}`,
    `Status:   ${r.status}`,
    `Score:    ${r.abuse_confidence_score ?? 'unknown'} / 100`,
    `Reports:  ${r.total_reports ?? 'unknown'} from ${r.distinct_reporters ?? 'unknown'} reporter(s) in the last ${r.max_age_in_days} day(s)`,
    `Reasons:${r.reasons?.length ? '' : ' none'}`
  ];
  for (const reason of r.reasons || []) lines.push(`  - ${reason.code}: ${reason.message}`);
  if (r.note) lines.push(`Note:     ${r.note}`);
  lines.push(`${r.attribution?.text || 'Data from AbuseIPDB'}: ${r.attribution?.url || `https://www.abuseipdb.com/check/${r.ip}`}`);
  return lines.join('\n');
}

// Returns the process exit code: 0 ok, 1 lookup failed, 2 usage error.
export async function run(argv, env, { fetch = globalThis.fetch, out = console.log, err = console.error } = {}) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    err(`error: ${e.message}\n\n${USAGE}`);
    return 2;
  }
  if (opts.help) {
    out(USAGE);
    return 0;
  }
  const key = readKey(env);
  if (!key) {
    err(`error: set ABUSEIPDB_KEY to your own AbuseIPDB API key\n\n${USAGE}`);
    return 2;
  }

  const { url, init } = buildRequest(opts, key, env.PG1_BASE_URL || DEFAULT_BASE_URL);
  let body;
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(20000) });
    body = parseBody(await res.text(), res.headers.get('content-type'));
  } catch (e) {
    err(`error: request to PG1 failed (${e.name}: ${e.message})`);
    return 1;
  }

  const { result, error } = extractResult(body, opts.protocol);
  if (error) {
    err(`error: ${error.code}: ${error.message}`);
    return 1;
  }
  out(opts.json ? JSON.stringify(result, null, 2) : formatResult(result));
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await run(process.argv.slice(2), process.env);
}
