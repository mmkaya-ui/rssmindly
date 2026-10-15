// ==============================================================================
// RSSMindly — Comprehensive Unit Tests
// Tests cosineSimilarity, clustering, extractNumbersAndMetrics edge cases,
// encoding-safe currency regexes (\u escapes), and groundedness verification.
// ==============================================================================

import { cosineSimilarity } from '../api/lib/embedding.js';
import { clusterTrendingStories } from '../api/lib/clustering.js';
import { extractNumbersAndMetrics, normalizeNumericRepresentation, evaluateGroundedness } from '../api/lib/groundedness.js';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ [PASS] ${message}`);
    passed++;
  } else {
    console.error(`  ❌ [FAIL] ${message}`);
    failed++;
    process.exitCode = 1;
  }
}

console.log('===============================================================');
console.log('🧪 RUNNING RSSMINDLY COMPREHENSIVE UNIT TEST SUITE');
console.log('===============================================================\n');

// ----------------------------------------------------------------------------
// 1. COSINE SIMILARITY EDGE CASES
// ----------------------------------------------------------------------------
console.log('--- 1. Testing cosineSimilarity Edge Cases ---');

// Identical vectors
const v1 = [1, 2, 3, 4];
assert(Math.abs(cosineSimilarity(v1, v1) - 1.0) < 1e-6, 'Identical vectors yield exactly 1.0');

// Orthogonal vectors
const vOrthA = [1, 0, 0];
const vOrthB = [0, 1, 0];
assert(Math.abs(cosineSimilarity(vOrthA, vOrthB)) < 1e-6, 'Orthogonal vectors yield exactly 0.0');

// Opposite vectors
const vOppA = [1, 2, 3];
const vOppB = [-1, -2, -3];
assert(Math.abs(cosineSimilarity(vOppA, vOppB) - (-1.0)) < 1e-6, 'Opposite vectors yield exactly -1.0');

// Zero vectors
assert(cosineSimilarity([0, 0, 0], [1, 2, 3]) === 0, 'Zero vector yields 0.0 without division by zero');

// Mismatched lengths
assert(cosineSimilarity([1, 2], [1, 2, 3]) === 0, 'Mismatched vector lengths yield 0.0');

// Null, undefined, empty
assert(cosineSimilarity(null, [1, 2]) === 0, 'Null vector yields 0.0');
assert(cosineSimilarity([1, 2], undefined) === 0, 'Undefined vector yields 0.0');
assert(cosineSimilarity([], []) === 0, 'Empty vectors yield 0.0');

// Non-finite values
assert(cosineSimilarity([NaN, 1], [1, 2]) === 0, 'NaN input handled gracefully');
assert(cosineSimilarity([Infinity, 1], [1, 2]) === 0, 'Infinity input handled gracefully');

// Clamping: check result never exceeds 1.0 or -1.0 even with rounding artifacts
const vOverA = [1.0000000000000002, 1.0000000000000002];
const vOverB = [1.0000000000000002, 1.0000000000000002];
const simClamped = cosineSimilarity(vOverA, vOverB);
assert(simClamped <= 1.0 && simClamped >= -1.0, `Clamped within [-1.0, 1.0]: ${simClamped}`);


// ----------------------------------------------------------------------------
// 2. CLUSTERING AND DATE / NAN EDGE CASES
// ----------------------------------------------------------------------------
console.log('\n--- 2. Testing clusterTrendingStories & Date Resiliency ---');

// Empty input
assert(clusterTrendingStories([]).length === 0, 'Empty input array returns empty cluster list');

// Invalid date strings do not corrupt latestTime with NaN
const articlesWithBadDates = [
  { title: 'Apple launches M5 MacBook', source: 'Reuters', pubDate: 'not-a-valid-date' },
  { title: 'Apple announces M5 laptop lineup', source: 'CNBC', pubDate: undefined },
  { title: 'New M5 MacBook Pro unveiled', source: 'The Verge', pubDate: null }
];
const badDateClusters = clusterTrendingStories(articlesWithBadDates);
assert(badDateClusters.length > 0, 'Clusters articles with missing/invalid pubDate');
assert(!Number.isNaN(badDateClusters[0].latestTime), 'Cluster latestTime is finite timestamp, not NaN');

// Trending detection: >= 3 distinct publishers
assert(badDateClusters[0].isTrending === true, 'Cluster with 3 distinct sources marked isTrending === true');
assert(badDateClusters[0].uniqueSourcesCount === 3, 'Counts 3 unique sources accurately');

// Time window isolation: article older than maxTimeWindowHours not clustered with new story
const now = Date.now();
const timeSeparatedArticles = [
  { title: 'Tesla releases Full Self Driving v13 update', source: 'Electrek', pubDate: new Date(now).toISOString() },
  { title: 'Tesla Full Self Driving v13 rolls out to customers', source: 'CleanTechnica', pubDate: new Date(now - 10 * 3600 * 1000).toISOString() } // 10h old
];
const timeClusters = clusterTrendingStories(timeSeparatedArticles, { maxTimeWindowHours: 4 });
assert(timeClusters.length === 2, 'Articles outside 4-hour window remain in separate clusters');


// ----------------------------------------------------------------------------
// 3. EXTRACT NUMBERS & METRICS EDGE CASES & ENCODING-SAFE CURRENCY REGEXES
// ----------------------------------------------------------------------------
console.log('\n--- 3. Testing extractNumbersAndMetrics & Currency Encoding ---');

// Currency symbols written as \u escapes in source so the regex does not depend on file encoding
const unicodeCurrencyText = 'Prices: $1,599 in US, \u20AC500 in EU, \u00A3450 in UK, \u00A560,000 in Japan.';
const extractedCurrencies = extractNumbersAndMetrics(unicodeCurrencyText);
assert(extractedCurrencies.some(m => m.raw.includes('1,599') && m.raw.includes('$')), 'Extracted USD ($) correctly');
assert(extractedCurrencies.some(m => m.raw.includes('500') && m.raw.includes('\u20AC')), 'Extracted Euro (\u20AC) correctly');
assert(extractedCurrencies.some(m => m.raw.includes('450') && m.raw.includes('\u00A3')), 'Extracted Pound (\u00A3) correctly');
assert(extractedCurrencies.some(m => m.raw.includes('60,000') && m.raw.includes('\u00A5')), 'Extracted Yen (\u00A5) correctly');

// Word-based currency variations
const wordCurrenciesText = 'Fined 798 million euros and raised 30 billion dollars with 1500 USD in revenue.';
const wordMetrics = extractNumbersAndMetrics(wordCurrenciesText);
assert(wordMetrics.some(m => m.raw.toLowerCase().includes('798 million euros')), 'Extracted "798 million euros"');
assert(wordMetrics.some(m => m.raw.toLowerCase().includes('30 billion dollars')), 'Extracted "30 billion dollars"');
assert(wordMetrics.some(m => m.raw.toLowerCase().includes('1500 usd')), 'Extracted "1500 USD"');

// Multipliers and percentages
const mathText = 'Speedup is 3.5x with a 54% margin and 42 percent renewable output.';
const mathMetrics = extractNumbersAndMetrics(mathText);
assert(mathMetrics.some(m => m.type === 'multiplier' && m.raw.includes('3.5x')), 'Extracted multiplier "3.5x"');
assert(mathMetrics.some(m => m.type === 'percentage' && m.raw.includes('54%')), 'Extracted percentage "54%"');
assert(mathMetrics.some(m => m.type === 'percentage' && m.raw.includes('42 percent')), 'Extracted percentage "42 percent"');

// Single-digit standalone numbers
const singleDigitText = 'City approved 2 new transit routes and 8 stations.';
const singleDigitMetrics = extractNumbersAndMetrics(singleDigitText);
assert(singleDigitMetrics.some(m => m.raw === '2'), 'Extracted single-digit "2"');
assert(singleDigitMetrics.some(m => m.raw === '8'), 'Extracted single-digit "8"');

// Normalization with and without commas
assert(normalizeNumericRepresentation('$1,599') === '1599', 'Normalizes "$1,599" -> "1599" (commas removed)');
assert(normalizeNumericRepresentation('1599 dollars') === '1599', 'Normalizes "1599 dollars" -> "1599"');
assert(normalizeNumericRepresentation('\u20AC500 million') === '500million', 'Normalizes "\u20AC500 million" -> "500million"');


// ----------------------------------------------------------------------------
// 4. GROUNDEDNESS VERIFICATION REFINED CHECKS
// ----------------------------------------------------------------------------
console.log('\n--- 4. Testing Groundedness Normalization & Entity Checks ---');

// Number matching across formatting differences (comma in summary, no comma in source)
const reportComma = evaluateGroundedness(
  '<ul><li>Price is $1,599.</li></ul>',
  'Device retails for 1599 dollars nationwide.',
  'Hardware Launch'
);
assert(reportComma.isGrounded === true, 'Grounded check passes when summary has "$1,599" and source has "1599 dollars"');

// Currency symbol in summary, word in source
const reportEuro = evaluateGroundedness(
  '<ul><li>Penalty was \u20AC500 million.</li></ul>',
  'Authorities issued a fine of 500 million euros yesterday.',
  'Antitrust Sanction'
);
assert(reportEuro.isGrounded === true, 'Grounded check passes when summary has "\u20AC500 million" and source has "500 million euros"');

// Sentence-initial capitalized stopword (e.g. "Clean", "Capital")
const reportCapital = evaluateGroundedness(
  '<ul><li>Capital will be deployed to build infrastructure.</li></ul>',
  'The fund will build infrastructure for computing.',
  'Investment Announcement'
);
assert(reportCapital.isGrounded === true, 'Capital at sentence start is not falsely flagged as a missing entity');

// Multi-word entity recombination rejection (detecting fake composite names)
const reportComposite = evaluateGroundedness(
  '<ul><li>Appointed John Smith to executive board.</li></ul>',
  'Welcomed John Higgins and advisor Michael Smith to the meeting.',
  'Corporate Update'
);
assert(reportComposite.isGrounded === false, 'Correctly flags recombined fake entity "John Smith"');


console.log('\n===============================================================');
console.log(`🎉 TEST RESULTS: ${passed} passed, ${failed} failed`);
console.log('===============================================================\n');

if (failed > 0) {
  process.exit(1);
}
