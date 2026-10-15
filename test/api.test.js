// ==============================================================================
// RSSMindly — api/summarize.js request-guard tests (no network, no keys)
// Every request here is rejected before any Gemini/Supabase call is made.
// ==============================================================================

import handler, { redactSecrets } from '../api/summarize.js';

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log(`  ✅ [PASS] ${msg}`); } else { failed++; console.error(`  ❌ [FAIL] ${msg}`); }
}

function mockRes() {
  return {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(obj) { this.body = obj; return this; }
  };
}

async function call(body, ip = '203.0.113.1', method = 'POST') {
  const res = mockRes();
  await handler({ method, headers: { 'x-forwarded-for': ip }, body }, res);
  return res;
}

console.log('===============================================================');
console.log('🧪 api/summarize.js REQUEST GUARD TESTS');
console.log('===============================================================');

console.log('\n--- Method and type validation ---');
assert((await call({}, '203.0.113.1', 'GET')).statusCode === 405, 'GET is rejected with 405');
assert((await call({ articleUrl: 'https://x.test/a', title: ['array'] })).statusCode === 400, 'Array title is rejected with 400 (previously passed .length check)');
assert((await call({ articleUrl: 'https://x.test/a', title: null })).statusCode === 400, 'null title is rejected with 400 (previously crashed on .length)');
assert((await call({ articleUrl: { href: 'x' }, title: 'T' })).statusCode === 400, 'Object articleUrl is rejected with 400');
assert((await call({ articleUrl: 'https://x.test/a', title: 'T', clientApiKey: 12345 })).statusCode === 400, 'Non-string clientApiKey is rejected with 400');
assert((await call({ title: 'T' })).statusCode === 400, 'Missing articleUrl is rejected with 400');

console.log('\n--- Size limits ---');
assert((await call({ articleUrl: 'https://x.test/' + 'a'.repeat(2100), title: 'T' })).statusCode === 413, 'URL > 2048 chars is rejected with 413');
assert((await call({ articleUrl: 'https://x.test/a', title: 'T'.repeat(501) })).statusCode === 413, 'Title > 500 chars is rejected with 413');
assert((await call({ articleUrl: 'https://x.test/a', title: 'T', content: 'c'.repeat(50001) })).statusCode === 413, 'Content > 50,000 chars is rejected with 413');

console.log('\n--- Rate limiting (60 requests / minute / IP) ---');
const ip = '198.51.100.7';
const statuses = [];
for (let i = 0; i < 61; i++) statuses.push((await call({ title: 'T' }, ip)).statusCode);
assert(statuses.slice(0, 60).every(s => s === 400), 'First 60 requests reach validation');
assert(statuses[60] === 429, '61st request from same IP gets 429');
assert((await call({ title: 'T' }, '198.51.100.8')).statusCode === 400, 'A different IP is not affected');

console.log('\n--- Secret redaction ---');
const key = 'AIzaSyFAKE-key_with.regex*chars+';
assert(redactSecrets(`failed with key=${key} at ${key}`, [key]) === 'failed with key=[REDACTED_KEY] at [REDACTED_KEY]', 'All occurrences redacted, regex metacharacters handled literally');
assert(redactSecrets('plain message', [null, undefined, '']) === 'plain message', 'Empty/missing secrets are ignored');
assert(redactSecrets(undefined, [key]) === '', 'Undefined message becomes empty string');

console.log('\n===============================================================');
console.log(`🎉 API GUARD RESULTS: ${passed} passed, ${failed} failed`);
console.log('===============================================================');
if (failed > 0) process.exit(1);
