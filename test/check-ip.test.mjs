// Offline tests for examples/check-ip.mjs: argument parsing and key handling.
// No AbuseIPDB key and no network: every fetch here is a stub that fails the
// test if called, so nothing ever reaches AbuseIPDB or PG1.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs, readKey, run, UsageError } from '../examples/check-ip.mjs';

const SCRIPT = fileURLToPath(new URL('../examples/check-ip.mjs', import.meta.url));
const noFetch = () => { throw new Error('network must not be used in tests'); };
const quiet = { fetch: noFetch, out: () => {}, err: () => {} };

test('parses an IPv4 or IPv6 address with defaults', () => {
  assert.deepEqual(parseArgs(['8.8.8.8']), { ip: '8.8.8.8', maxAge: 90, protocol: 'mcp', json: false, help: false });
  assert.equal(parseArgs(['2001:4860:4860::8888']).ip, '2001:4860:4860::8888');
});

test('parses --max-age, --a2a and --json in any order', () => {
  const opts = parseArgs(['--a2a', '1.1.1.1', '--max-age', '30', '--json']);
  assert.deepEqual(opts, { ip: '1.1.1.1', maxAge: 30, protocol: 'a2a', json: true, help: false });
  assert.equal(parseArgs(['1.1.1.1', '--max-age=365']).maxAge, 365);
});

test('rejects bad input with a UsageError', () => {
  const bad = [
    [], ['not-an-ip'], ['8.8.8'], ['8.8.8.8/24'], ['8.8.8.8', '1.1.1.1'], ['8.8.8.8', '--nope'],
    ['8.8.8.8', '--max-age'], ['8.8.8.8', '--max-age', '0'], ['8.8.8.8', '--max-age', '366'], ['8.8.8.8', '--max-age=abc']
  ];
  for (const argv of bad) assert.throws(() => parseArgs(argv), UsageError, JSON.stringify(argv));
});

test('--help needs no IP', () => {
  assert.equal(parseArgs(['--help']).help, true);
});

test('the key is read from ABUSEIPDB_KEY; missing, blank or placeholder means none', () => {
  assert.equal(readKey({ ABUSEIPDB_KEY: ' abc123 ' }), 'abc123');
  assert.equal(readKey({}), null);
  assert.equal(readKey({ ABUSEIPDB_KEY: '   ' }), null);
  assert.equal(readKey({ ABUSEIPDB_KEY: 'your-abuseipdb-api-key' }), null);
});

test('run: no key exits 2 before any request', async () => {
  assert.equal(await run(['8.8.8.8'], {}, quiet), 2);
});

test('run: bad arguments exit 2 before any request, even with a key', async () => {
  assert.equal(await run(['nope'], { ABUSEIPDB_KEY: 'dummy' }, quiet), 2);
});

test('run: --help exits 0', async () => {
  assert.equal(await run(['--help'], {}, quiet), 0);
});

test('CLI: no key prints usage to stderr and exits 2', () => {
  const env = { ...process.env };
  delete env.ABUSEIPDB_KEY;
  const r = spawnSync(process.execPath, [SCRIPT, '8.8.8.8'], { env, encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /ABUSEIPDB_KEY/);
  assert.equal(r.stdout, '');
});
