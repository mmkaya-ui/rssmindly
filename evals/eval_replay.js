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

export async function runReplayEval() {
  const fixturePath = path.resolve('evals/data/feed_fixture.json');
  if (!fs.existsSync(fixturePath)) {
    throw new Error(`Feed fixture missing at ${fixturePath}`);
  }

  const articles = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  const db = new MockSupabaseDB();

  console.log('===============================================================');
  console.log(`⏱️ REPLAYING FEED FIXTURE (${articles.length} ARTICLES)`);
  console.log('===============================================================\n');

  let exactHits = 0;
  let semanticHits = 0;
  let cacheMisses = 0;

  const tier1Latencies = [];
  const tier2MissLatencies = [];
  const tier2SemanticHitLatencies = [];
  const tier2ExactHitLatencies = [];
  const tier3Latencies = [];

  let tokensConsumed = 0;
  let tokensSaved = 0;

  for (let i = 0; i < articles.length; i++) {
    const art = articles[i];
    const itemStart = performance.now();

    // --------------------------------------------------------------------------
    // TIER 1: Extractive Micro-Summarizer (< 1ms, 0 tokens)
    // --------------------------------------------------------------------------
    const t1Start = performance.now();
    const microSummary = generateExtractiveMicroSummary(art.title, art.content);
    const t1Duration = performance.now() - t1Start;
    tier1Latencies.push(t1Duration);

    // --------------------------------------------------------------------------
    // STEP 1: Exact URL Check
    // --------------------------------------------------------------------------
    const exactMatch = await db.findByUrl(art.url);
    if (exactMatch) {
      const exactDuration = performance.now() - itemStart;
      tier2ExactHitLatencies.push(exactDuration);
      exactHits++;
      tokensSaved += 380; // Saved full Tier 2 generation
      console.log(`[#${String(i + 1).padStart(2)}] ⚡ EXACT CACHE HIT: [${art.source}] "${art.title.slice(0, 42)}..." (${exactDuration.toFixed(2)}ms, 0 tokens)`);
      continue;
    }

    // --------------------------------------------------------------------------
    // STEP 2: Semantic Cache Lookup via Embedding
    // --------------------------------------------------------------------------
    const embedding = embedHeadline(art.title);
    const semanticMatches = await db.matchSummaries(embedding, 0.92, 48);

    if (semanticMatches.length > 0) {
      const hit = semanticMatches[0];
      // Simulated DB network roundtrip for vector RPC (~42ms)
      await sleep(42);
      const semDuration = performance.now() - itemStart;
      tier2SemanticHitLatencies.push(semDuration);
      semanticHits++;
      tokensSaved += 380; // Saved Gemini 1.5 Flash call
      tokensConsumed += 40; // Only small embedding cost

      console.log(`[#${String(i + 1).padStart(2)}] 🧠 SEMANTIC HIT (${(hit.similarity * 100).toFixed(1)}% match with ${hit.source}): [${art.source}] "${art.title.slice(0, 36)}..." (${semDuration.toFixed(1)}ms, 0 LLM tokens)`);
      continue;
    }

    // --------------------------------------------------------------------------
    // STEP 3: Cache Miss — Gemini 1.5 Flash Generation
    // --------------------------------------------------------------------------
    // Simulate Gemini generation latency (~240ms)
    await sleep(240);
    const summaryHtml = `<ul><li>${art.title}</li><li>Key development reported by ${art.source}.</li></ul>`;
    const groundedness = evaluateGroundedness(summaryHtml, art.content, art.title);

    // Persist to Mock Supabase
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
    tokensConsumed += 380 + 40; // Generation + Embedding

    console.log(`[#${String(i + 1).padStart(2)}] ❌ CACHE MISS: [${art.source}] "${art.title.slice(0, 42)}..." (${missDuration.toFixed(1)}ms, 420 tokens)`);

    // Simulate Tier 3 deep dive for every 4th article
    if (i % 4 === 0) {
      const t3Start = performance.now();
      await sleep(420); // Deep dive generation
      const t3Duration = performance.now() - t3Start;
      tier3Latencies.push(t3Duration);
      tokensConsumed += 850;
    }
  }

  // Calculate Metrics
  const totalArticles = articles.length;
  const totalHits = exactHits + semanticHits;
  const cacheHitRate = Number(((totalHits / totalArticles) * 100).toFixed(1));
  const semanticHitRate = Number(((semanticHits / totalArticles) * 100).toFixed(1));

  const avgTier1 = Number((tier1Latencies.reduce((a, b) => a + b, 0) / tier1Latencies.length).toFixed(3));
  const avgMiss = Number((tier2MissLatencies.reduce((a, b) => a + b, 0) / (tier2MissLatencies.length || 1)).toFixed(1));
  const avgSemHit = Number((tier2SemanticHitLatencies.reduce((a, b) => a + b, 0) / (tier2SemanticHitLatencies.length || 1)).toFixed(1));
  const avgExactHit = Number((tier2ExactHitLatencies.reduce((a, b) => a + b, 0) / (tier2ExactHitLatencies.length || 1)).toFixed(2));
  const avgTier3 = Number((tier3Latencies.reduce((a, b) => a + b, 0) / (tier3Latencies.length || 1)).toFixed(1));

  const tokenEfficiency = Number(((tokensSaved / (tokensConsumed + tokensSaved)) * 100).toFixed(1));
  const simulatedCostPer1k = Number(((tokensConsumed / totalArticles) * 1000 * 0.00000015).toFixed(4)); // Flash pricing ~$0.15 / 1M tokens

  console.log('\n===============================================================');
  console.log('📊 REPLAY EVALUATION BENCHMARK RESULTS');
  console.log('===============================================================');
  console.log(`- Total Articles Replayed:  ${totalArticles}`);
  console.log(`- Overall Cache Hit Rate:   ${cacheHitRate}% (${totalHits}/${totalArticles})`);
  console.log(`  ↳ Cross-Publisher Semantic Hits: ${semanticHits} (${semanticHitRate}%)`);
  console.log(`  ↳ Exact URL Hits:                ${exactHits} (${((exactHits / totalArticles) * 100).toFixed(1)}%)`);
  console.log(`  ↳ Cache Misses (LLM generated):  ${cacheMisses} (${((cacheMisses / totalArticles) * 100).toFixed(1)}%)`);
  console.log(`- Token Efficiency:         ${tokenEfficiency}% of tokens saved via deduplication`);
  console.log(`- Tokens Consumed:          ${tokensConsumed} tokens`);
  console.log(`- Tokens Saved:             ${tokensSaved} tokens`);
  console.log('\n--- Latency Breakdown by Tier ---');
  console.log(`- Tier 1 (Extractive Compressor):  ${avgTier1} ms (0 tokens, client-side)`);
  console.log(`- Tier 2 Exact Cache Hit:          ${avgExactHit} ms (0 tokens, O(1) hash)`);
  console.log(`- Tier 2 Semantic Cache Hit:       ${avgSemHit} ms (0 LLM tokens, pgvector HNSW match)`);
  console.log(`- Tier 2 Cache Miss (LLM Call):    ${avgMiss} ms (Full generation + DB write)`);
  console.log(`- Tier 3 Deep Dive Brief:          ${avgTier3} ms (4-part strategic analysis)`);
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
    tokenEfficiency,
    simulatedCostPer1k
  };
}

if (process.argv[1]?.endsWith('eval_replay.js')) {
  runReplayEval();
}
