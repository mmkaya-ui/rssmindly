/**
 * Central Gemini model configuration + fallback.
 *
 * Why this exists: the original code hard-coded gemini-1.5-flash and
 * text-embedding-004. Both were retired, which broke every AI feature (verified
 * 2026-10-15: HTTP 404 on both). Model names now live in one place, can be
 * overridden with env vars, and generation falls back to the next model on
 * "model gone / overloaded / rate-limited" errors instead of failing outright.
 *
 * Choices (measured 2026-10-15 with a free AI Studio key, 3 calls each, see README):
 *   gemini-3.5-flash-lite  607-965 ms, no thinking tokens   -> primary
 *   gemini-3.1-flash-lite  1189-2246 ms                     -> fallback
 *   gemini-3.5-flash / 3.8-flash: 503s and 3-18 s responses -> not used
 */

export const GENERATION_MODELS = (process.env.GEMINI_MODELS || 'gemini-3.5-flash-lite,gemini-3.1-flash-lite')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

export const EMBEDDING_MODEL = process.env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-001';

// Must match VECTOR(768) in the Supabase schema. gemini-embedding-001 defaults
// to 3072 dims; outputDimensionality truncates it (Matryoshka representation).
export const EMBEDDING_DIMENSIONS = 768;

/**
 * Cosine threshold for reusing another outlet's summary. It is calibrated PER
 * EMBEDDING MODEL: score distributions differ between models.
 *
 * 0.92 was chosen for text-embedding-004 but never measured. With
 * gemini-embedding-001 (measured 2026-10-15, see evals/RESULTS.md and
 * evals/LIVE_RESULTS.md):
 *   - 60 headline pairs: highest different-story score 0.7821; 0.79-0.81 is the
 *     lowest region with 0 false merges; 0.92 caught 1/30 duplicates.
 *   - live fingerprints (headline + body): duplicates 0.825-0.922, unrelated
 *     stories <= 0.676; 0.92 caught 3 of 9 duplicate articles.
 * 0.80 = smallest round value above every observed different-story score.
 */
export const SEMANTIC_MATCH_THRESHOLD = Number(process.env.SEMANTIC_MATCH_THRESHOLD || 0.80);

// Errors where trying a different model can help.
const RETRYABLE_STATUS = new Set([404, 429, 500, 503]);

export function isRetryableModelError(err) {
  if (RETRYABLE_STATUS.has(err?.status)) return true;
  return /\[(404|429|500|503)[^\]]*\]/.test(String(err?.message || ''));
}

/**
 * Generates text with the first model that answers.
 * @returns {{ text: string, model: string, usage: { promptTokens: number, outputTokens: number, thoughtTokens: number }, attempts: string[] }}
 */
export async function generateWithFallback(genAI, prompt, generationConfig = {}, models = GENERATION_MODELS) {
  const attempts = [];
  let lastErr = null;
  for (const model of models) {
    try {
      const m = genAI.getGenerativeModel({ model, generationConfig });
      const result = await m.generateContent(prompt);
      const u = result.response.usageMetadata || {};
      attempts.push(`${model}:ok`);
      return {
        text: result.response.text().replace(/```html|```/g, '').trim(),
        model,
        usage: {
          promptTokens: u.promptTokenCount || 0,
          outputTokens: u.candidatesTokenCount || 0,
          thoughtTokens: u.thoughtsTokenCount || 0
        },
        attempts
      };
    } catch (err) {
      attempts.push(`${model}:${err?.status || 'error'}`);
      lastErr = err;
      if (!isRetryableModelError(err)) break;
    }
  }
  const e = new Error(`All generation models failed (${attempts.join(', ')}): ${lastErr?.message || 'unknown error'}`);
  e.attempts = attempts;
  throw e;
}

export function addUsage(total, usage) {
  if (!usage) return total;
  return {
    promptTokens: total.promptTokens + usage.promptTokens,
    outputTokens: total.outputTokens + usage.outputTokens,
    thoughtTokens: total.thoughtTokens + usage.thoughtTokens
  };
}

export const EMPTY_USAGE = Object.freeze({ promptTokens: 0, outputTokens: 0, thoughtTokens: 0 });
