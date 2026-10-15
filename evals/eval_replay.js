// ==============================================================================
// RSSMindly — Replay Feed Latency & Cache Hit Rate Benchmark (Offline / Mocked)
// Replays evals/data/feed_fixture.json to measure per-tier latency & deduplication.
// Fully self-contained; mocks Gemini and Supabase to run deterministically with zero keys.
// ==============================================================================

import fs from 'fs';
import path from 'path';
import { generateExtractiveMicroSummary } from '../api/lib/extractive.js';
import { evaluateGroundedness } from '../api/lib/groundedness.js';
import { cosineSimilarity } from '../api/lib/embedding.js';
import { embedHeadline } from './lib/semantic_embedder.js';

// Sleep helper for simulating realistic remote API round-trip times
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ------------------------------------------------------------------------------
// SIMULATION CONSTANTS — these are assumptions, NOT measurements.
// Network latencies are injected with sleep(); token counts are fixed per call.
// Anything derived only from these (Tier 2/3 latency, token totals) is modelled.
// Measured for real: Tier 1 extractive latency (runs the production code).
// Hit/miss decisions use the simulated embedder, so the hit rate is only as
// meaningful as that embedder (i.e. a harness check, not a production figure).
// ------------------------------------------------------------------------------
export const SIMULATED_LATENCY_MS = { semanticHitRpc: 42, geminiGeneration: 240, tier3Generation: 420 };
export const MODELLED_TOKENS = { tier2Generation: 380, embedding: 40, tier3: 850 };

class MockSupabaseDB {
  constructor() {
    this.table = new Map(); // url -> record
  }

  async findByUrl(url) {
    // Exact URL lookup O(1)
    return this.table.get(url) || null;
  }

  async matchSummaries(queryEmbedding, threshold = 0.92, maxAgeHours = 48) {
    let bestMatch = null;
    let highestSim = -1;
    const now = Date.now();

    for (const record of this.table.values()) {
      // Check 48h TTL
      const ageHours = (now - new Date(record.created_at).getTime()) / (1000 * 60 * 60);
      if (ageHours > maxAgeHours) continue;

      const sim = cosineSimilarity(queryEmbedding, record.headline_embedding);
      if (sim >= threshold && sim > highestSim) {
        highestSim = sim;
        bestMatch = { ...record, similarity: Number(sim.toFixed(4)) };
      }
    }

    return bestMatch ? [bestMatch] : [];
  }

  async upsert(record) {
    this.table.set(record.url, {
      ...record,
      created_at: record.created_at || new Date().toISOString()
    });
  }
}

const avg = (arr, digits) => Number((arr.reduce((a, b) => a + b, 0) / (arr.length || 1)).toFixed(digits));

export async function runReplayEval() {
  const fixturePath = path.resolve('evals/data/feed_fixture.json');
  if (!fs.existsSync(fixturePath)) {
    throw new Error(`Feed fixture missing at ${fixturePath}`);
  }

  const articles = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  const db = new MockSupabaseDB();

  console.log('===============================================================');
  console.log(`⏱️ REPLAYING FEED FIXTURE (${articles.length} ARTICLES, mocked Gemini + Supabase)`);
  console.log('===============================================================\n');

  let exactHits = 0;
  let semanticHits = 0;
  let cacheMisses = 0;

  const tier1Latencies = [];
  const tier2MissLatencies = [];
  const tier2SemanticHitLatencies = [];
  const tier2ExactHitLatencies = [];
  const tier3Latencies = [];

  let tier2TokensConsumed = 0;
  let tier3TokensConsumed = 0;
  let tokensSaved = 0;

  for (let i = 0; i < articles.length; i++) {
    const art = articles[i];
    const itemStart = performance.now();

    // --------------------------------------------------------------------------
    // TIER 1: Extractive Micro-Summarizer (real production code, timed)
    // --------------------------------------------------------------------------
    const t1Start = performance.now();
    const microSummary = generateExtractiveMicroSummary(art.title, art.content);
    const t1Duration = performance.now() - t1Start;
    tier1Latencies.push(t1Duration);

    // --------------------------------------------------------------------------
    // STEP 1: Exact URL Check (in-memory Map standing in for Supabase)
    // --------------------------------------------------------------------------
    const exactMatch = await db.findByUrl(art.url);
    if (exactMatch) {
      const exactDuration = performance.now() - itemStart;
      tier2ExactHitLatencies.push(exactDuration);
      exactHits++;
      tokensSaved += MODELLED_TOKENS.tier2Generation;
      console.log(`[#${String(i + 1).padStart(2)}] ⚡ EXACT HIT: [${art.source}] "${art.title.slice(0, 42)}..." (${exactDuration.toFixed(2)}ms in-memory)`);
      continue;
    }

    // --------------------------------------------------------------------------
    // STEP 2: Semantic Cache Lookup via (simulated) Embedding
    // --------------------------------------------------------------------------
    const embedding = embedHeadline(art.title);
    const semanticMatches = await db.matchSummaries(embedding, 0.92, 48);

    if (semanticMatches.length > 0) {
      const hit = semanticMatches[0];
      await sleep(SIMULATED_LATENCY_MS.semanticHitRpc);
      const semDuration = performance.now() - itemStart;
      tier2SemanticHitLatencies.push(semDuration);
      semanticHits++;
      tokensSaved += MODELLED_TOKENS.tier2Generation;
      tier2TokensConsumed += MODELLED_TOKENS.embedding;
      console.log(`[#${String(i + 1).padStart(2)}] 🧠 SEMANTIC HIT (sim ${hit.similarity.toFixed(3)} vs ${hit.source}): [${art.source}] "${art.title.slice(0, 36)}..." (${semDuration.toFixed(1)}ms simulated)`);
      continue;
    }

    // --------------------------------------------------------------------------
    // STEP 3: Cache Miss — mocked Gemini generation
    // --------------------------------------------------------------------------
    await sleep(SIMULATED_LATENCY_MS.geminiGeneration);
    const summaryHtml = `<ul><li>${art.title}</li><li>Key development reported by ${art.source}.</li></ul>`;
    const groundedness = evaluateGroundedness(summaryHtml, art.content, art.title);

    await db.upsert({
      url: art.url,
      title: art.title,
      source: art.source,
      text: summaryHtml,
      tier1_micro: microSummary,
      tier2_bullets: summaryHtml,
      headline_embedding: embedding,
      groundedness_score: groundedness.score,
      created_at: new Date().toISOString()
    });

    const missDuration = performance.now() - itemStart;
    tier2MissLatencies.push(missDuration);
    cacheMisses++;
    const missTokens = MODELLED_TOKENS.tier2Generation + MODELLED_TOKENS.embedding;
    tier2TokensConsumed += missTokens;
    console.log(`[#${String(i + 1).padStart(2)}] ❌ MISS: [${art.source}] "${art.title.slice(0, 42)}..." (${missDuration.toFixed(1)}ms simulated, ${missTokens} modelled tokens)`);

    // Arbitrary usage assumption: a user opens Tier 3 on every 4th article
    if (i % 4 === 0) {
      const t3Start = performance.now();
      await sleep(SIMULATED_LATENCY_MS.tier3Generation);
      tier3Latencies.push(performance.now() - t3Start);
      tier3TokensConsumed += MODELLED_TOKENS.tier3;
    }
  }

  const totalArticles = articles.length;
  const totalHits = exactHits + semanticHits;
  const cacheHitRate = Number(((totalHits / totalArticles) * 100).toFixed(1));
  const semanticHitRate = Number(((semanticHits / totalArticles) * 100).toFixed(1));

  const avgTier1 = avg(tier1Latencies, 3);
  const avgExactHit = avg(tier2ExactHitLatencies, 2);
  const avgSemHit = avg(tier2SemanticHitLatencies, 1);
  const avgMiss = avg(tier2MissLatencies, 1);
  const avgTier3 = avg(tier3Latencies, 1);

  // Dedup savings are a Tier 2 property; Tier 3 usage is an assumption, so it is excluded.
  const tokensConsumed = tier2TokensConsumed;
  const tokenEfficiency = Number(((tokensSaved / (tokensConsumed + tokensSaved)) * 100).toFixed(1));

  console.log('\n===============================================================');
  console.log('📊 REPLAY RESULTS');
  console.log('===============================================================');
  console.log('- Hit/miss decided by: SIMULATED embedder (evals/lib/semantic_embedder.js)');
  console.log(`- Articles replayed:   ${totalArticles}`);
  console.log(`- Cache hit rate:      ${cacheHitRate}% (${totalHits}/${totalArticles}): ${semanticHits} semantic, ${exactHits} exact, ${cacheMisses} misses`);
  console.log(`- Tier 2 tokens saved: ${tokenEfficiency}% (MODELLED at ${MODELLED_TOKENS.tier2Generation} gen + ${MODELLED_TOKENS.embedding} emb per call; consumed ${tokensConsumed}, saved ${tokensSaved})`);
  console.log('\n--- Latency by tier ---');
  console.log(`- Tier 1 extractive: ${avgTier1} ms   MEASURED (production code, Node, this machine)`);
  console.log(`- Exact hit:         ${avgExactHit} ms   in-memory Map, not Supabase`);
  console.log(`- Semantic hit:      ${avgSemHit} ms   SIMULATED (sleep ${SIMULATED_LATENCY_MS.semanticHitRpc} ms)`);
  console.log(`- Miss:              ${avgMiss} ms   SIMULATED (sleep ${SIMULATED_LATENCY_MS.geminiGeneration} ms)`);
  console.log(`- Tier 3:            ${avgTier3} ms   SIMULATED (sleep ${SIMULATED_LATENCY_MS.tier3Generation} ms)`);
  console.log('===============================================================\n');

  return {
    totalArticles,
    totalHits,
    exactHits,
    semanticHits,
    cacheMisses,
    cacheHitRate,
    semanticHitRate,
    avgTier1,
    avgExactHit,
    avgSemHit,
    avgMiss,
    avgTier3,
    tokensConsumed,
    tokensSaved,
    tier3TokensConsumed,
    tokenEfficiency,
    simulatedLatencyMs: SIMULATED_LATENCY_MS,
    modelledTokens: MODELLED_TOKENS
  };
}

if (process.argv[1]?.endsWith('eval_replay.js')) {
  runReplayEval();
}
