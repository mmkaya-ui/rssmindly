// ==============================================================================
// RSSMindly — Comprehensive Test Suite for Steps 1, 2, 3 & 4
// ==============================================================================

import { getFingerprintText, cosineSimilarity } from '../api/lib/embedding.js';
import { evaluateGroundedness } from '../api/lib/groundedness.js';
import { generateExtractiveMicroSummary } from '../api/lib/extractive.js';
import { clusterTrendingStories } from '../api/lib/clustering.js';

console.log('===============================================================');
console.log('🧪 TESTING RSSMINDLY ADVANCED ARCHITECTURE');
console.log('===============================================================\n');

let passedTests = 0;
let totalTests = 0;

function assert(condition, message) {
  totalTests++;
  if (condition) {
    console.log(`✅ [PASS] ${message}`);
    passedTests++;
  } else {
    console.error(`❌ [FAIL] ${message}`);
    process.exitCode = 1;
  }
}

// --------------------------------------------------------------------------
// TEST 1: Tier 1 Instant Extractive Compressor (Step 3)
// --------------------------------------------------------------------------
console.log('--- Step 3: Tier 1 Extractive Micro-Summarizer (0ms) ---');
const rawTitle = 'Apple Unveils New M5 MacBook Pro with Major AI Performance Gains';
const rawBody = `Apple on Tuesday announced its next-generation M5 MacBook Pro lineup, featuring up to 3.5x faster neural processing for local AI models. The new machines start at $1,599 and will begin shipping next Friday across 30 countries. The launch comes amidst intensifying competition in AI-accelerated laptop computing.`;

const t0 = performance.now();
const microSummary = generateExtractiveMicroSummary(rawTitle, rawBody);
const t1 = performance.now();

assert(microSummary && microSummary.length > 20, `Generated micro-summary: "${microSummary}"`);
assert((t1 - t0) < 5, `Executed in ${(t1 - t0).toFixed(2)}ms (< 5ms instant execution)`);
assert(microSummary.includes('Apple') && (microSummary.includes('M5') || microSummary.includes('MacBook')), 'Extracted key lead entity');

// --------------------------------------------------------------------------
// TEST 2: Deterministic Groundedness & Zero Hallucination Guarantee (Step 4)
// --------------------------------------------------------------------------
console.log('\n--- Step 4: Groundedness & Zero Hallucination Verifier ---');

// Case A: Factual summary directly supported by text
const groundedSummaryHtml = `<ul>
  <li>Apple announced M5 MacBook Pro with 3.5x faster neural processing.</li>
  <li>Pricing begins at $1,599 with availability in 30 countries.</li>
</ul>`;

const groundedReport = evaluateGroundedness(groundedSummaryHtml, rawBody, rawTitle);
assert(groundedReport.isGrounded === true, `Grounded check passed for verified summary (Score: ${groundedReport.score})`);
assert(groundedReport.numberViolationsCount === 0, `Zero number violations for grounded facts`);
assert(groundedReport.verifiedFacts.some(f => f.value.includes('$1,599') || f.value.includes('1599')), 'Verified metric $1,599');

// Case B: Hallucinated summary (AI invented numbers: $4,999 and 500 countries)
const hallucinatedSummaryHtml = `<ul>
  <li>Apple announced M5 MacBook Pro starting at $4,999.</li>
  <li>Shipping next week to 500 countries globally.</li>
</ul>`;

const hallucinatedReport = evaluateGroundedness(hallucinatedSummaryHtml, rawBody, rawTitle);
assert(hallucinatedReport.isGrounded === false, `Correctly detected hallucinated summary (Score: ${hallucinatedReport.score})`);
assert(hallucinatedReport.numberViolationsCount > 0, `Flagged ${hallucinatedReport.numberViolationsCount} hallucinated numbers`);
assert(hallucinatedReport.violations.some(v => v.value.includes('4,999') || v.value.includes('4999')), 'Caught fake price $4,999');

// --------------------------------------------------------------------------
// TEST 3: Predictive Pre-Warming via Trend Clustering (Step 2)
// --------------------------------------------------------------------------
console.log('\n--- Step 2: Predictive Trend Clustering ---');

const sampleFeedArticles = [
  // Cluster 1: Apple M5 Announcement (Covered by 3 different publishers -> TRENDING!)
  { title: 'Apple unveils M5 MacBook Pro with custom AI chip', source: 'Reuters', pubDate: new Date().toISOString(), description: 'Apple revealed its M5 laptop lineup today.' },
  { title: 'Apple announces new M5 laptop line starting at $1,599', source: 'CNBC', pubDate: new Date().toISOString(), description: 'CNBC report on the latest M5 MacBooks.' },
  { title: 'The new M5 MacBook Pro is here with major Neural Engine upgrades', source: 'The Verge', pubDate: new Date().toISOString(), description: 'Hands-on with the M5 MacBook Pro.' },
  
  // Cluster 2: SpaceX Starship Launch (2 sources)
  { title: 'SpaceX completes Starship orbital test flight', source: 'Ars Technica', pubDate: new Date().toISOString(), description: 'SpaceX successfully launched Starship.' },
  { title: 'Starship reaches orbit in milestone SpaceX mission', source: 'BBC News', pubDate: new Date().toISOString(), description: 'Starship achieved orbit today.' },
  
  // Cluster 3: Solo story
  { title: 'Local coffee festival opens this weekend in Seattle', source: 'Local News', pubDate: new Date().toISOString(), description: 'Annual coffee festival kicks off.' }
];

const clusters = clusterTrendingStories(sampleFeedArticles, { minSourcesForTrend: 3 });
assert(clusters.length > 0, `Formed ${clusters.length} clusters`);

const topTrend = clusters[0];
assert(topTrend.isTrending === true, `Top cluster marked as trending (${topTrend.uniqueSourcesCount} sources: ${topTrend.sources.join(', ')})`);
assert(topTrend.uniqueSourcesCount >= 3, `Grouped 3 distinct publishers: Reuters, CNBC, The Verge`);
assert(topTrend.topic.toLowerCase().includes('m5') || topTrend.topic.toLowerCase().includes('apple'), `Accurately clustered around topic "${topTrend.topic}"`);

// --------------------------------------------------------------------------
// TEST 4: Semantic Embedding Cosine Deduplication (Step 1)
// --------------------------------------------------------------------------
console.log('\n--- Step 1: Semantic Embedding Similarity Math ---');

// Mock embeddings representing high semantic alignment
const generateMockEmbedding = (seed) => {
  const vec = [];
  for (let i = 0; i < 768; i++) {
    vec.push(Math.sin(seed * (i + 1)));
  }
  return vec;
};

// Two nearly identical vector representations (simulating same news story from 2 publishers)
const vecReuters = generateMockEmbedding(42.0);
const vecCNBC = vecReuters.map(v => v + (Math.random() - 0.5) * 0.05); // slight noise
const vecDifferentStory = generateMockEmbedding(137.5);

const simCrossPublisher = cosineSimilarity(vecReuters, vecCNBC);
const simDifferent = cosineSimilarity(vecReuters, vecDifferentStory);

assert(simCrossPublisher > 0.95, `Cross-publisher cosine similarity: ${(simCrossPublisher * 100).toFixed(2)}% (> 95% threshold)`);
assert(simDifferent < 0.3, `Different story similarity is low: ${(simDifferent * 100).toFixed(2)}%`);

console.log('\n===============================================================');
console.log(`🎉 TEST SUMMARY: ${passedTests}/${totalTests} tests passed successfully!`);
console.log('===============================================================\n');
