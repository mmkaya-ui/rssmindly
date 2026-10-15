// ==============================================================================
// RSSMindly — Enterprise Semantic Summarization Pipeline
// Step 1: Semantic Deduping via Embedding Fingerprints (Cross-Publisher Cache)
// Step 2: Predictive Pre-Warming via Trend Clustering
// Step 3: Cascading Multi-Tier Speculative Summarization (Tier 1, Tier 2, Tier 3)
// Step 4: Deterministic Groundedness Check & Source Attribution
// ==============================================================================

import { GoogleGenerativeAI } from '@google/generative-ai';
import { createClient } from '@supabase/supabase-js';
import { getFingerprintText, generateHeadlineEmbedding } from './lib/embedding.js';
import { evaluateGroundedness } from './lib/groundedness.js';
import { generateExtractiveMicroSummary } from './lib/extractive.js';

const GOOGLE_API_KEY = process.env.GOOGLE_GEMINI_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

// Semantic deduplication threshold: 0.92 cosine similarity
const SEMANTIC_MATCH_THRESHOLD = 0.92;
const MAX_CACHE_AGE_HOURS = 48;

// Input size bounds to prevent resource exhaustion / DoS
const MAX_TITLE_LENGTH = 500;
const MAX_CONTENT_LENGTH = 50000;
const MAX_URL_LENGTH = 2048;

// In-memory sliding-window rate limiter (60 req/min per IP)
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 60;
const requestHistoryMap = new Map();

function checkRateLimit(clientIp) {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;

  // Periodic cleanup if map grows large (> 5000 entries)
  if (requestHistoryMap.size > 5000) {
    for (const [ip, timestamps] of requestHistoryMap.entries()) {
      const active = timestamps.filter(t => t > windowStart);
      if (active.length === 0) requestHistoryMap.delete(ip);
      else requestHistoryMap.set(ip, active);
    }
  }

  const timestamps = (requestHistoryMap.get(clientIp) || []).filter(t => t > windowStart);
  if (timestamps.length >= MAX_REQUESTS_PER_WINDOW) {
    return false;
  }
  timestamps.push(now);
  requestHistoryMap.set(clientIp, timestamps);
  return true;
}

/**
 * Creates clients safely
 */
function getClients() {
  const genAI = GOOGLE_API_KEY ? new GoogleGenerativeAI(GOOGLE_API_KEY) : null;
  const supabase = (SUPABASE_URL && SUPABASE_KEY) ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;
  return { genAI, supabase };
}

/**
 * Removes any occurrence of the given secrets from a message before it is logged
 * or returned. Uses split/join, so key characters are never interpreted as regex.
 */
export function redactSecrets(message, secrets = []) {
  let out = String(message ?? '');
  for (const s of secrets) {
    if (typeof s === 'string' && s.length >= 8) out = out.split(s).join('[REDACTED_KEY]');
  }
  return out;
}

export const TIER2_CONTENT_CHAR_LIMIT = 4000;

/**
 * Builds the Tier 2 (3-bullet) prompt. Exported so evals/estimate_cost.js can
 * measure the exact prompt size instead of a copy that could drift.
 */
export function buildTier2Prompt({ title = '', source = 'RSS Feed', content = '' }) {
  return `You are an elite, fact-focused financial and tech journalist.
Summarize this news article in 2-3 high-impact, factual bullet points.
Output valid HTML using <ul> and <li> tags only. Do not wrap in markdown code blocks.
CRITICAL: Only use numbers, dates, company names, and claims directly supported by the article.

Title: ${title}
Source: ${source}
Article Content:
${content.slice(0, TIER2_CONTENT_CHAR_LIMIT)}`;
}

export default async function handler(req, res) {
  // 1. HTTP Method validation
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  // 2. Rate limiting check
  const clientIp = (
    req.headers['x-forwarded-for']?.split(',')[0] ||
    req.headers['x-real-ip'] ||
    req.socket?.remoteAddress ||
    '127.0.0.1'
  ).trim();

  if (!checkRateLimit(clientIp)) {
    return res.status(429).json({
      error: 'Rate limit exceeded. Maximum 60 requests per minute.',
      retryAfterSeconds: 60
    });
  }

  const {
    articleUrl,
    title = '',
    content = '',
    source = 'RSS Feed',
    mode = 'tier2', // 'tier1' (instant micro), 'tier2' (3 bullets), 'tier3' (deep-dive)
    includeDeepDive = false,
    clientApiKey = null
  } = req.body || {};

  // 3. Input validation & size constraints
  const stringFields = { articleUrl, title, content, source, mode };
  const badType = Object.entries(stringFields).find(([, v]) => v !== undefined && typeof v !== 'string');
  if (badType || (clientApiKey !== null && typeof clientApiKey !== 'string')) {
    return res.status(400).json({ error: `Invalid field type: ${badType ? badType[0] : 'clientApiKey'} must be a string` });
  }

  if (!articleUrl || (!content && !title)) {
    return res.status(400).json({ error: 'Missing required fields: articleUrl and (title or content)' });
  }

  if (articleUrl.length > MAX_URL_LENGTH || title.length > MAX_TITLE_LENGTH || content.length > MAX_CONTENT_LENGTH) {
    return res.status(413).json({
      error: 'Payload size exceeded allowed limits',
      limits: { maxUrlLength: MAX_URL_LENGTH, maxTitleLength: MAX_TITLE_LENGTH, maxContentLength: MAX_CONTENT_LENGTH }
    });
  }

  // 4. Client API key security: strictly used in memory for generative call; never saved to database or logged
  const apiKeyToUse = clientApiKey || GOOGLE_API_KEY;
  const secrets = [clientApiKey, GOOGLE_API_KEY, SUPABASE_KEY];
  const { genAI: defaultGenAI, supabase } = getClients();
  const genAI = apiKeyToUse ? new GoogleGenerativeAI(apiKeyToUse) : defaultGenAI;

  const startTime = Date.now();

  try {
    // --------------------------------------------------------------------------
    // STEP 3 (Tier 1): Instant 0ms Extractive Micro-Summary
    // --------------------------------------------------------------------------
    const tier1Micro = generateExtractiveMicroSummary(title, content);

    if (mode === 'tier1') {
      return res.status(200).json({
        tier: 1,
        tier1Micro,
        source: 'extractive_engine',
        latencyMs: Date.now() - startTime
      });
    }

    // --------------------------------------------------------------------------
    // STEP 1: EXACT URL CACHE LOOKUP (O(1) with 48h TTL verification)
    // --------------------------------------------------------------------------
    const isLongMode = mode === 'tier3' || mode === 'detailed' || mode === 'long' || includeDeepDive;

    if (supabase) {
      const { data: exactMatch } = await supabase
        .from('summaries')
        .select('*')
        .eq('url', articleUrl)
        .maybeSingle();

      if (exactMatch) {
        // Enforce 48-hour cache age invalidation
        const cacheAgeHours = (Date.now() - new Date(exactMatch.created_at).getTime()) / (1000 * 60 * 60);
        if (cacheAgeHours <= MAX_CACHE_AGE_HOURS) {
          // If user requested long/detailed summary and it's already cached
          if (isLongMode && exactMatch.tier3_deepdive) {
            return res.status(200).json({
              summary: exactMatch.tier3_deepdive,
              tier1: exactMatch.tier1_micro || tier1Micro,
              tier2: exactMatch.tier2_bullets || exactMatch.text,
              tier3: exactMatch.tier3_deepdive,
              source: 'cache',
              matchType: 'exact',
              isLong: true,
              groundednessScore: exactMatch.groundedness_score ?? 1.0,
              groundednessReport: exactMatch.groundedness_report ?? {},
              latencyMs: Date.now() - startTime
            });
          }

          // Return exact cache hit for standard summary
          if (!isLongMode) {
            supabase.rpc('increment_summary_hit', { summary_id: exactMatch.id }).catch(() => {});

            return res.status(200).json({
              summary: exactMatch.text || exactMatch.tier2_bullets,
              tier1: exactMatch.tier1_micro || tier1Micro,
              tier2: exactMatch.tier2_bullets || exactMatch.text,
              tier3: exactMatch.tier3_deepdive || null,
              source: 'cache',
              matchType: 'exact',
              groundednessScore: exactMatch.groundedness_score ?? 1.0,
              groundednessReport: exactMatch.groundedness_report ?? {},
              latencyMs: Date.now() - startTime
            });
          }
        }
      }
    }

    // --------------------------------------------------------------------------
    // STEP 1: SEMANTIC DEDUPING VIA EMBEDDING FINGERPRINTS (CROSS-PUBLISHER CACHE)
    // --------------------------------------------------------------------------
    let embedding = null;
    const fingerprintText = getFingerprintText(title, content);

    if (apiKeyToUse && supabase) {
      try {
        embedding = await generateHeadlineEmbedding(fingerprintText, apiKeyToUse);

        // Vector cosine search in Supabase with pgvector match_summaries function
        const { data: matches, error: rpcError } = await supabase.rpc('match_summaries', {
          query_embedding: embedding,
          match_threshold: SEMANTIC_MATCH_THRESHOLD,
          match_count: 1,
          max_age_hours: MAX_CACHE_AGE_HOURS
        });

        if (!rpcError && matches && matches.length > 0) {
          const semanticHit = matches[0];
          const similarityScore = Number((semanticHit.similarity || 0).toFixed(4));

          supabase.rpc('increment_summary_hit', { summary_id: semanticHit.id }).catch(() => {});

          if (!isLongMode || semanticHit.tier3_deepdive) {
            return res.status(200).json({
              summary: isLongMode && semanticHit.tier3_deepdive ? semanticHit.tier3_deepdive : (semanticHit.text || semanticHit.tier2_bullets),
              tier1: semanticHit.tier1_micro || tier1Micro,
              tier2: semanticHit.tier2_bullets || semanticHit.text,
              tier3: semanticHit.tier3_deepdive || null,
              source: 'cache',
              matchType: 'semantic',
              isLong: isLongMode,
              similarity: similarityScore,
              matchedTitle: semanticHit.title,
              matchedSource: semanticHit.source,
              originalUrl: semanticHit.url,
              groundednessScore: semanticHit.groundedness_score ?? 1.0,
              groundednessReport: semanticHit.groundedness_report ?? {},
              latencyMs: Date.now() - startTime
            });
          }
        }
      } catch (embErr) {
        console.warn('Semantic embedding lookup skipped or failed:', redactSecrets(embErr.message, secrets));
      }
    }

    // --------------------------------------------------------------------------
    // STEP 3 (Tier 2): CACHE MISS — GENERATE 3-BULLET TAKEAWAY VIA GEMINI FLASH
    // --------------------------------------------------------------------------
    if (!genAI) {
      return res.status(200).json({
        summary: `<ul><li>${tier1Micro}</li></ul>`,
        tier1: tier1Micro,
        source: 'extractive_fallback',
        warning: 'Gemini API Key missing; returned Tier 1 extractive summary',
        latencyMs: Date.now() - startTime
      });
    }

    const flashModel = genAI.getGenerativeModel({
      model: 'gemini-1.5-flash',
      generationConfig: { temperature: 0.2 }
    });

    const tier2Prompt = buildTier2Prompt({ title, source, content });

    let tier2Result = await flashModel.generateContent(tier2Prompt);
    let summaryHtml = tier2Result.response.text().replace(/```html|```/g, '').trim();

    // --------------------------------------------------------------------------
    // STEP 4: DETERMINISTIC GROUNDEDNESS CHECK & STRICT RE-GENERATION
    // --------------------------------------------------------------------------
    let groundedness = evaluateGroundedness(summaryHtml, content, title);

    // If ungrounded (number violations or score < 0.80), trigger strict regeneration with temperature 0.0
    if (!groundedness.isGrounded) {
      const strictModel = genAI.getGenerativeModel({
        model: 'gemini-1.5-flash',
        generationConfig: { temperature: 0.0 }
      });

      const strictPrompt = `ZERO HALLUCINATION RE-GENERATION:
The previous summary contained ungrounded or unverified metrics/entities:
${groundedness.violations.map(v => `- ${v.reason}`).join('\n')}

Re-summarize this article into 2-3 concise bullet points.
Output valid HTML with <ul> and <li> tags only.
MANDATORY: Every number, dollar amount, percentage, and company entity MUST appear verbatim in the source text below.

Title: ${title}
Content:
${content.slice(0, 4000)}`;

      const strictResult = await strictModel.generateContent(strictPrompt);
      const regeneratedHtml = strictResult.response.text().replace(/```html|```/g, '').trim();

      const recheckedGroundedness = evaluateGroundedness(regeneratedHtml, content, title);
      if (recheckedGroundedness.numberViolationsCount === 0 || recheckedGroundedness.score > groundedness.score) {
        summaryHtml = regeneratedHtml;
        groundedness = recheckedGroundedness;
      }
    }

    // --------------------------------------------------------------------------
    // STEP 3: LONG-FORM DETAILED BRIEF & STRATEGIC DEEP DIVE (ON USER REQUEST)
    // --------------------------------------------------------------------------
    let tier3DeepDive = null;
    if (isLongMode) {
      try {
        const deepModel = genAI.getGenerativeModel({
          model: 'gemini-1.5-flash',
          generationConfig: { temperature: 0.25 }
        });

        const deepPrompt = `You are an elite, comprehensive investigative intelligence analyst.
Provide an extensive, long-form detailed intelligence summary of this news story.
Structure with four clean HTML sections using <h4>, <p>, and <ul>:
1. <h4>Executive Overview & Key Developments</h4>
<p>A comprehensive 2-paragraph narrative detailing what took place and the primary catalyst.</p>
2. <h4>Detailed Background, Context & Key Statements</h4>
<p>Context, named executives/officials, direct quotes, and precedents.</p>
3. <h4>Key Metrics & Confirmed Figures</h4>
<ul><li>List every confirmed number, dollar amount, percentage, and date verbatim.</li></ul>
4. <h4>Strategic Industry & Future Outlook</h4>
<p>Analysis of winners, losers, policy ramifications, and what to watch next.</p>
Output clean HTML only. Do not use markdown code blocks.

Title: ${title}
Source: ${source}
Content:
${content.slice(0, 5000)}`;

        const deepResult = await deepModel.generateContent(deepPrompt);
        tier3DeepDive = deepResult.response.text().replace(/```html|```/g, '').trim();
      } catch (deepErr) {
        console.warn('Long summary generation failed:', redactSecrets(deepErr.message, secrets));
      }
    }

    // --------------------------------------------------------------------------
    // WRITE TO SUPABASE CACHE WITH PGVECTOR EMBEDDING (clientApiKey NEVER stored)
    // --------------------------------------------------------------------------
    if (supabase) {
      try {
        if (!embedding && apiKeyToUse) {
          embedding = await generateHeadlineEmbedding(fingerprintText, apiKeyToUse);
        }

        const cacheRecord = {
          url: articleUrl,
          title,
          source,
          text: summaryHtml,
          tier1_micro: tier1Micro,
          tier2_bullets: summaryHtml,
          tier3_deepdive: tier3DeepDive,
          groundedness_score: groundedness.score,
          groundedness_report: groundedness,
          headline_embedding: embedding,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };

        await supabase.from('summaries').upsert(cacheRecord, { onConflict: 'url' });
      } catch (cacheErr) {
        console.warn('Failed to persist summary into Supabase cache:', redactSecrets(cacheErr.message, secrets));
      }
    }

    // --------------------------------------------------------------------------
    // FINAL RESPONSE
    // --------------------------------------------------------------------------
    return res.status(200).json({
      summary: isLongMode && tier3DeepDive ? tier3DeepDive : summaryHtml,
      tier1: tier1Micro,
      tier2: summaryHtml,
      tier3: tier3DeepDive,
      source: 'ai',
      groundednessScore: groundedness.score,
      groundednessReport: groundedness,
      isGrounded: groundedness.isGrounded,
      latencyMs: Date.now() - startTime
    });

  } catch (error) {
    // Sanitize error logging to ensure clientApiKey is never leaked into server logs
    const sanitizedMsg = redactSecrets(error.message, secrets);
    console.error('Summarization pipeline failure:', sanitizedMsg);

    return res.status(500).json({
      error: 'Failed to generate summary',
      details: sanitizedMsg
    });
  }
}
