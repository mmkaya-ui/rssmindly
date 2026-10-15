// ==============================================================================
// RSSMindly — Cost per 1,000 summaries, estimated from the real Tier 2 prompt.
//
// What is measured: character length of the exact prompt api/summarize.js sends
// (via buildTier2Prompt) for each fixture article, plus the hard upper bound set
// by the 4,000-char content cap.
// What is estimated: tokens = chars / 4 (Google's documented rule of thumb for
// Gemini; real counts vary by language and content).
// What you must supply: prices and output length. Nothing is assumed:
//
//   PRICE_IN_PER_M=<usd per 1M input tokens> PRICE_OUT_PER_M=<usd per 1M output tokens> \
//   OUTPUT_TOKENS=<avg output tokens> CACHE_HIT_RATE=<0..1> node evals/estimate_cost.js
//
// Get current prices from https://ai.google.dev/pricing. For exact token counts,
// log response.usageMetadata from real Gemini calls.
// ==============================================================================

import fs from 'fs';
import path from 'path';
import { buildTier2Prompt, TIER2_CONTENT_CHAR_LIMIT } from '../api/summarize.js';

const CHARS_PER_TOKEN = 4;

export function estimateCost() {
  const articles = JSON.parse(fs.readFileSync(path.resolve('evals/data/feed_fixture.json'), 'utf8'));
  const promptChars = articles.map(a => buildTier2Prompt(a).length);
  const avgChars = promptChars.reduce((x, y) => x + y, 0) / promptChars.length;
  const maxChars = buildTier2Prompt({ title: 'x'.repeat(500), source: 'Source', content: 'x'.repeat(TIER2_CONTENT_CHAR_LIMIT) }).length;

  const result = {
    fixtureAvgPromptChars: Math.round(avgChars),
    fixtureAvgInputTokensEst: Math.round(avgChars / CHARS_PER_TOKEN),
    upperBoundPromptChars: maxChars,
    upperBoundInputTokensEst: Math.round(maxChars / CHARS_PER_TOKEN),
    costPer1k: null
  };

  console.log('===============================================================');
  console.log('💰 TIER 2 COST ESTIMATE (input side from real prompt text)');
  console.log('===============================================================');
  console.log(`- Fixture prompts: avg ${result.fixtureAvgPromptChars} chars ≈ ${result.fixtureAvgInputTokensEst} input tokens (chars/4 estimate; fixture articles are short)`);
  console.log(`- Upper bound (500-char title + ${TIER2_CONTENT_CHAR_LIMIT}-char content cap): ${maxChars} chars ≈ ${result.upperBoundInputTokensEst} input tokens`);

  const pIn = Number(process.env.PRICE_IN_PER_M);
  const pOut = Number(process.env.PRICE_OUT_PER_M);
  const outTok = Number(process.env.OUTPUT_TOKENS);
  const hit = process.env.CACHE_HIT_RATE === undefined ? 0 : Number(process.env.CACHE_HIT_RATE);

  console.log('- Formula: cost_per_1k = 1000 × (1 − hit_rate) × (in_tokens × price_in + out_tokens × price_out) / 1e6');
  if ([pIn, pOut, outTok, hit].every(Number.isFinite)) {
    const perCall = (inTok) => (inTok * pIn + outTok * pOut) / 1e6;
    result.costPer1k = {
      inputs: { pIn, pOut, outTok, hit },
      fixtureAvg: Number((1000 * (1 - hit) * perCall(result.fixtureAvgInputTokensEst)).toFixed(4)),
      upperBound: Number((1000 * (1 - hit) * perCall(result.upperBoundInputTokensEst)).toFixed(4))
    };
    console.log(`- With your inputs: $${result.costPer1k.fixtureAvg} (fixture-sized) to $${result.costPer1k.upperBound} (max-size articles) per 1,000 summaries`);
  } else {
    console.log('- Prices/output length not supplied: no dollar figure printed (see header for env vars).');
  }
  console.log('');
  return result;
}

if (process.argv[1]?.endsWith('estimate_cost.js')) {
  estimateCost();
}
