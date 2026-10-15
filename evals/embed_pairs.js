// ==============================================================================
// RSSMindly — One-off: embed every headline in evals/data/pairs.jsonl with the
// real production model (Gemini text-embedding-004) and cache the vectors to
// evals/data/pair_embeddings.json.
//
// This is the ONLY eval step that needs network + a key. Once the fixture is
// committed, `npm run eval` uses it and stays fully offline.
//
//   GOOGLE_GEMINI_API_KEY=... node evals/embed_pairs.js
//
// Note: production embeds getFingerprintText(title, body) (headline + first 150
// body words). The pairs dataset only has headlines, so this measures the
// headline-only case. That limitation is stated in RESULTS.md.
// ==============================================================================

import fs from 'fs';
import path from 'path';
import { generateHeadlineEmbedding } from '../api/lib/embedding.js';

const MODEL = 'text-embedding-004';
const PAIRS_PATH = path.resolve('evals/data/pairs.jsonl');
export const PAIR_EMBEDDINGS_PATH = path.resolve('evals/data/pair_embeddings.json');

async function main() {
  const apiKey = process.env.GOOGLE_GEMINI_API_KEY;
  if (!apiKey) {
    console.error('GOOGLE_GEMINI_API_KEY is not set. Nothing was written.');
    process.exit(1);
  }

  const pairs = fs.readFileSync(PAIRS_PATH, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
  const headlines = [...new Set(pairs.flatMap(p => [p.headline_a, p.headline_b]))];

  const vectors = {};
  for (const [i, text] of headlines.entries()) {
    const values = await generateHeadlineEmbedding(text, apiKey);
    // 6 decimals keeps the fixture small; cosine error from rounding is < 1e-5
    vectors[text] = values.map(v => Number(v.toFixed(6)));
    process.stdout.write(`\rEmbedded ${i + 1}/${headlines.length}`);
    // Stay well under free-tier rate limits
    await new Promise(r => setTimeout(r, 120));
  }

  const fixture = {
    model: MODEL,
    input: 'headline only (no body text)',
    generated_at: new Date().toISOString(),
    dimensions: Object.values(vectors)[0]?.length || 0,
    count: headlines.length,
    vectors
  };

  fs.writeFileSync(PAIR_EMBEDDINGS_PATH, JSON.stringify(fixture));
  console.log(`\nWrote ${headlines.length} vectors (${fixture.dimensions}-dim) to ${PAIR_EMBEDDINGS_PATH}`);
}

if (process.argv[1]?.endsWith('embed_pairs.js')) {
  main().catch(err => {
    // Never echo the key: only print the message
    console.error('Embedding failed:', err.message);
    process.exit(1);
  });
}
