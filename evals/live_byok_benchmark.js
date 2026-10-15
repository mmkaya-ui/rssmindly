// ==============================================================================
// RSSMindly — LIVE BYOK benchmark (needs a key; costs a few thousand tokens)
//
// Runs the real pipeline the way a BYOK user hits it:
//   - real embeddings (EMBEDDING_MODEL on getFingerprintText(title, body), exactly
//     what production stores), compared with the real cosineSimilarity at the
//     production threshold, against an in-memory stand-in for Supabase
//   - on a cache miss: the real api/summarize.js handler with clientApiKey and NO
//     server key, so Tier 2 generation, the groundedness check and any strict
//     re-generation all run for real
//   - one Tier 3 brief to measure the long path
//
// Only the database is simulated. Results go to evals/data/live_byok_results.json
// and evals/LIVE_RESULTS.md. The key is read from the environment, never written.
//
//   GOOGLE_GEMINI_API_KEY=... node evals/live_byok_benchmark.js
// ==============================================================================

import fs from 'fs';
import path from 'path';
import { getFingerprintText, generateHeadlineEmbedding, cosineSimilarity } from '../api/lib/embedding.js';
import { generateExtractiveMicroSummary } from '../api/lib/extractive.js';
import { EMBEDDING_MODEL, GENERATION_MODELS, SEMANTIC_MATCH_THRESHOLD } from '../api/lib/models.js';

const THRESHOLD = SEMANTIC_MATCH_THRESHOLD;
const key = process.env.GOOGLE_GEMINI_API_KEY;
if (!key) {
  console.error('GOOGLE_GEMINI_API_KEY is not set. Nothing was run.');
  process.exit(1);
}
const scrub = (s) => String(s ?? '').split(key).join('[KEY]');

// Exercise the BYOK path: the key must arrive in the request body, not the server env.
delete process.env.GOOGLE_GEMINI_API_KEY;
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_KEY;
const { default: handler } = await import('../api/summarize.js');

const pct = (arr, p) => {
  if (arr.length === 0) return null;
  const s = [...arr].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]);
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function callHandler(body) {
  const res = { statusCode: 0, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  const logs = [];
  const ow = console.warn; const oe = console.error;
  console.warn = (...a) => logs.push(a.join(' '));
  console.error = (...a) => logs.push(a.join(' '));
  const t0 = performance.now();
  try {
    await handler({ method: 'POST', headers: { 'x-forwarded-for': '192.0.2.50' }, body: { ...body, clientApiKey: key } }, res);
  } finally {
    console.warn = ow; console.error = oe;
  }
  return { res, ms: performance.now() - t0, logs };
}

const articles = JSON.parse(fs.readFileSync(path.resolve('evals/data/feed_fixture.json'), 'utf8'));
const cache = []; // { url, source, title, embedding }
const rows = [];
let keyLeaked = false;

console.log('===============================================================');
console.log(`🔴 LIVE BYOK BENCHMARK: ${articles.length} articles, models ${GENERATION_MODELS.join(' -> ')}, embeddings ${EMBEDDING_MODEL}`);
console.log('===============================================================');

for (const [i, art] of articles.entries()) {
  const row = { n: i + 1, source: art.source, title: art.title, url: art.url };

  const t1 = performance.now();
  generateExtractiveMicroSummary(art.title, art.content);
  row.tier1Ms = performance.now() - t1;

  // Exact URL hit (production checks this first)
  const exact = cache.find(c => c.url === art.url);
  if (exact) {
    row.outcome = 'exact_hit';
    rows.push(row);
    console.log(`[#${String(row.n).padStart(2)}] ⚡ EXACT HIT  ${art.source}: ${art.title.slice(0, 60)}`);
    continue;
  }

  // Real embedding of the same fingerprint production stores
  const te = performance.now();
  let embedding;
  try {
    embedding = await generateHeadlineEmbedding(getFingerprintText(art.title, art.content), key);
  } catch (e) {
    row.outcome = 'embedding_error';
    row.error = scrub(e.message).slice(0, 200);
    rows.push(row);
    console.log(`[#${String(row.n).padStart(2)}] ⚠️ EMBEDDING ERROR ${row.error}`);
    continue;
  }
  row.embedMs = performance.now() - te;

  let best = null;
  for (const c of cache) {
    const sim = cosineSimilarity(embedding, c.embedding);
    if (!best || sim > best.sim) best = { sim, c };
  }
  row.bestSimilarity = best ? Number(best.sim.toFixed(4)) : null;
  row.bestMatch = best ? `${best.c.source}: ${best.c.title}` : null;

  if (best && best.sim >= THRESHOLD) {
    row.outcome = 'semantic_hit';
    rows.push(row);
    console.log(`[#${String(row.n).padStart(2)}] 🧠 SEMANTIC HIT sim=${best.sim.toFixed(3)}  ${art.source}: ${art.title.slice(0, 50)}\n        ↳ reuses ${row.bestMatch.slice(0, 80)}`);
    continue;
  }

  // Miss: real handler, BYOK path
  const { res, ms, logs } = await callHandler({ articleUrl: art.url, title: art.title, content: art.content, source: art.source });
  const blob = JSON.stringify(res.body) + logs.join('');
  if (blob.includes(key)) keyLeaked = true;
  row.httpStatus = res.statusCode;
  row.generateMs = ms;
  if (res.statusCode !== 200 || res.body?.source !== 'ai') {
    row.outcome = 'generation_error';
    row.error = scrub(res.body?.details || res.body?.error || res.body?.warning).slice(0, 200);
    rows.push(row);
    console.log(`[#${String(row.n).padStart(2)}] ❌ ERROR HTTP ${res.statusCode} ${row.error}`);
    continue;
  }
  const b = res.body;
  Object.assign(row, {
    outcome: 'miss_generated',
    models: b.models,
    usage: b.usage,
    regenerated: b.regenerated,
    initialScore: b.initialGroundednessScore,
    finalScore: b.groundednessScore,
    isGrounded: b.isGrounded,
    violations: (b.groundednessReport?.violations || []).map(v => `${v.type}:${v.value}`),
    summary: b.tier2
  });
  cache.push({ url: art.url, source: art.source, title: art.title, embedding });
  rows.push(row);
  console.log(`[#${String(row.n).padStart(2)}] ❌ MISS → generated ${Math.round(ms)} ms, ${b.usage.promptTokens}+${b.usage.outputTokens} tok, ${b.models.join('+')}${b.regenerated ? ', RE-GENERATED' : ''}, grounded=${b.isGrounded} (${b.groundednessScore})  best sim=${row.bestSimilarity ?? '-'}`);
  await sleep(300); // stay polite with free-tier rate limits
}

// One Tier 3 brief on the first article
const t3 = await callHandler({ articleUrl: articles[0].url + '#tier3', title: articles[0].title, content: articles[0].content, source: articles[0].source, mode: 'tier3' });
const tier3 = {
  httpStatus: t3.res.statusCode,
  ms: Math.round(t3.ms),
  usage: t3.res.body?.usage || null,
  models: t3.res.body?.models || null,
  chars: (t3.res.body?.tier3 || '').length
};
if ((JSON.stringify(t3.res.body) + t3.logs.join('')).includes(key)) keyLeaked = true;

// Aggregate
const gen = rows.filter(r => r.outcome === 'miss_generated');
const semantic = rows.filter(r => r.outcome === 'semantic_hit');
const exactHits = rows.filter(r => r.outcome === 'exact_hit');
const errors = rows.filter(r => /error/.test(r.outcome));
const summary = {
  generatedAt: new Date().toISOString(),
  threshold: THRESHOLD,
  embeddingModel: EMBEDDING_MODEL,
  generationModels: GENERATION_MODELS,
  articles: rows.length,
  generated: gen.length,
  semanticHits: semantic.length,
  exactHits: exactHits.length,
  errors: errors.length,
  generateMs: { p50: pct(gen.map(r => r.generateMs), 50), p95: pct(gen.map(r => r.generateMs), 95), max: pct(gen.map(r => r.generateMs), 100) },
  embedMs: { p50: pct(rows.filter(r => r.embedMs).map(r => r.embedMs), 50), p95: pct(rows.filter(r => r.embedMs).map(r => r.embedMs), 95) },
  tier1MsAvg: Number((rows.reduce((a, r) => a + r.tier1Ms, 0) / rows.length).toFixed(3)),
  tokensPerSummary: gen.length ? {
    prompt: Math.round(gen.reduce((a, r) => a + r.usage.promptTokens, 0) / gen.length),
    output: Math.round(gen.reduce((a, r) => a + r.usage.outputTokens, 0) / gen.length),
    thought: Math.round(gen.reduce((a, r) => a + r.usage.thoughtTokens, 0) / gen.length)
  } : null,
  regenerated: gen.filter(r => r.regenerated).length,
  firstPassFlagged: gen.filter(r => r.initialScore !== undefined && (r.regenerated)).length,
  finalGrounded: gen.filter(r => r.isGrounded).length,
  fallbackUsed: gen.filter(r => r.models.some(m => m !== GENERATION_MODELS[0])).length,
  tier3,
  keyLeakedIntoLogsOrResponses: keyLeaked
};

fs.writeFileSync(path.resolve('evals/data/live_byok_results.json'), JSON.stringify({ summary, rows }, null, 2));

const md = `# RSSMindly — Live BYOK Results

*Generated by \`evals/live_byok_benchmark.js\` on ${summary.generatedAt} with a free Google AI Studio key passed as \`clientApiKey\` (no server key). Real Gemini calls; only the database is an in-memory stand-in. Single run from one machine: latencies include network and vary between runs.*

Models: generation \`${GENERATION_MODELS.join('` → fallback `')}\`, embeddings \`${EMBEDDING_MODEL}\` (768 dims), threshold ${THRESHOLD}. Articles: \`evals/data/feed_fixture.json\` (${rows.length}, AI-authored).

| Metric | Value |
|---|---|
| Summaries generated (cache misses) | ${summary.generated} |
| Semantic cache hits (real embeddings) | ${summary.semanticHits} |
| Exact URL hits | ${summary.exactHits} |
| Errors | ${summary.errors} |
| Tier 2 end-to-end latency (handler, incl. check + any re-generation) | p50 ${summary.generateMs.p50} ms, p95 ${summary.generateMs.p95} ms, max ${summary.generateMs.max} ms |
| Embedding call latency | p50 ${summary.embedMs.p50} ms, p95 ${summary.embedMs.p95} ms |
| Tier 1 extractive (local) | ${summary.tier1MsAvg} ms avg |
| Tokens per generated summary (real \`usageMetadata\`) | ${summary.tokensPerSummary ? `${summary.tokensPerSummary.prompt} prompt + ${summary.tokensPerSummary.output} output + ${summary.tokensPerSummary.thought} thinking` : 'n/a'} |
| Summaries re-generated after failing the check | ${summary.regenerated} / ${summary.generated} |
| Final summaries passing the check | ${summary.finalGrounded} / ${summary.generated} |
| Fallback model used | ${summary.fallbackUsed} |
| Tier 3 brief | HTTP ${tier3.httpStatus}, ${tier3.ms} ms, ${tier3.usage ? `${tier3.usage.promptTokens}+${tier3.usage.outputTokens} tokens` : 'n/a'}, ${tier3.chars} chars |
| Key found in any log or response body | **${keyLeaked ? 'YES' : 'no'}** |

## Every article

| # | Source | Outcome | Best cosine vs cache | Notes |
|---|---|---|---|---|
${rows.map(r => `| ${r.n} | ${r.source} | ${r.outcome} | ${r.bestSimilarity ?? '-'} | ${r.outcome === 'semantic_hit' ? `reuses **${r.bestMatch}**` : r.outcome === 'miss_generated' ? `${Math.round(r.generateMs)} ms${r.regenerated ? ', re-generated' : ''}${r.violations.length ? `, flags: ${r.violations.join('; ')}` : ''}` : (r.error || '')} |`).join('\n')}

## Generated summaries (for manual review of the check's verdicts)

${gen.map(r => `**#${r.n} ${r.source}: ${r.title}** (check score ${r.finalScore}${r.violations.length ? `, flagged: ${r.violations.join('; ')}` : ''})\n\n${r.summary}\n`).join('\n')}
`;
fs.writeFileSync(path.resolve('evals/LIVE_RESULTS.md'), md);

console.log('\n' + JSON.stringify(summary, null, 2));
console.log('\nWrote evals/LIVE_RESULTS.md and evals/data/live_byok_results.json');
