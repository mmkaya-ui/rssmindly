// ==============================================================================
// RSSMindly — api/lib/models.js fallback tests (mock client, no network)
// ==============================================================================

import { generateWithFallback, isRetryableModelError, addUsage, EMPTY_USAGE, EMBEDDING_DIMENSIONS } from '../api/lib/models.js';

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log(`  ✅ [PASS] ${msg}`); } else { failed++; console.error(`  ❌ [FAIL] ${msg}`); }
}

// Mock GoogleGenerativeAI: behaviour[model] = 'ok' | HTTP status number
function mockGenAI(behaviour) {
  const calls = [];
  return {
    calls,
    getGenerativeModel({ model }) {
      return {
        async generateContent() {
          calls.push(model);
          const b = behaviour[model];
          if (b === 'ok') {
            return { response: { text: () => '```html\n<ul><li>ok</li></ul>\n```', usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } } };
          }
          const err = new Error(`[GoogleGenerativeAI Error]: [${b} Error] simulated`);
          err.status = b;
          throw err;
        }
      };
    }
  };
}

console.log('===============================================================');
console.log('🧪 api/lib/models.js FALLBACK TESTS');
console.log('===============================================================');

{
  const g = mockGenAI({ a: 'ok', b: 'ok' });
  const r = await generateWithFallback(g, 'p', {}, ['a', 'b']);
  assert(r.model === 'a' && g.calls.join() === 'a', 'Primary model answers: no fallback call');
  assert(r.text === '<ul><li>ok</li></ul>', 'Markdown code fences are stripped');
  assert(r.usage.promptTokens === 10 && r.usage.outputTokens === 5 && r.usage.thoughtTokens === 0, 'Token usage is read from usageMetadata');
}
for (const status of [404, 429, 503]) {
  const g = mockGenAI({ a: status, b: 'ok' });
  const r = await generateWithFallback(g, 'p', {}, ['a', 'b']);
  assert(r.model === 'b' && r.attempts.join() === `a:${status},b:ok`, `HTTP ${status} on primary falls back to secondary`);
}
{
  const g = mockGenAI({ a: 400, b: 'ok' });
  let threw = null;
  try { await generateWithFallback(g, 'p', {}, ['a', 'b']); } catch (e) { threw = e; }
  assert(threw && g.calls.join() === 'a', 'HTTP 400 (e.g. bad key or request) does NOT fall back');
}
{
  const g = mockGenAI({ a: 503, b: 404 });
  let threw = null;
  try { await generateWithFallback(g, 'p', {}, ['a', 'b']); } catch (e) { threw = e; }
  assert(threw && /All generation models failed \(a:503, b:404\)/.test(threw.message), 'All models failing reports every attempt');
}
assert(isRetryableModelError({ message: '[503 Service Unavailable] overloaded' }), 'Retryable status detected from message when .status is missing');
assert(!isRetryableModelError({ status: 401 }), '401 is not retryable');
const sum = addUsage(addUsage(EMPTY_USAGE, { promptTokens: 1, outputTokens: 2, thoughtTokens: 3 }), { promptTokens: 4, outputTokens: 5, thoughtTokens: 6 });
assert(sum.promptTokens === 5 && sum.outputTokens === 7 && sum.thoughtTokens === 9, 'Usage accumulates across calls');
assert(EMBEDDING_DIMENSIONS === 768, 'Embedding size matches the VECTOR(768) schema');

console.log('\n===============================================================');
console.log(`🎉 MODEL FALLBACK RESULTS: ${passed} passed, ${failed} failed`);
console.log('===============================================================');
if (failed > 0) process.exit(1);
