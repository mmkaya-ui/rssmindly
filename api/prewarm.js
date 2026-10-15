// ==============================================================================
// RSSMindly — Step 2: Predictive Pre-Warming via Trend Clustering Worker
// Background cron / on-demand worker that inspects multi-feed stories,
// detects viral topics (>= 3 sources), and proactively caches them.
// ==============================================================================

import { GoogleGenerativeAI } from '@google/generative-ai';
import { createClient } from '@supabase/supabase-js';
import { clusterTrendingStories } from './lib/clustering.js';
import { getFingerprintText, generateHeadlineEmbedding } from './lib/embedding.js';
import { evaluateGroundedness } from './lib/groundedness.js';
import { generateExtractiveMicroSummary } from './lib/extractive.js';
import { generateWithFallback, SEMANTIC_MATCH_THRESHOLD } from './lib/models.js';

const GOOGLE_API_KEY = process.env.GOOGLE_GEMINI_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

// High-signal default feeds if none are passed in request
const DEFAULT_FEEDS = [
  'https://feeds.bbci.co.uk/news/technology/rss.xml',
  'https://techcrunch.com/feed/',
  'https://news.ycombinator.com/rss'
];

/**
 * Fetch and parse simple RSS items when running in standalone cron mode
 */
async function fetchRssItemsFromFeed(feedUrl) {
  try {
    const res = await fetch(feedUrl, { headers: { 'User-Agent': 'RSSMindly-Prewarmer/1.0' } });
    if (!res.ok) return [];
    const text = await res.text();
    const items = [];
    
    // Fast regex extraction for XML items
    const itemMatches = text.match(/<item[\s\S]*?<\/item>/gi) || [];
    for (const itemXml of itemMatches.slice(0, 10)) {
      const titleMatch = itemXml.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i);
      const linkMatch = itemXml.match(/<link>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/link>/i);
      const descMatch = itemXml.match(/<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/i);
      const dateMatch = itemXml.match(/<pubDate>([\s\S]*?)<\/pubDate>/i);

      if (titleMatch && linkMatch) {
        items.push({
          title: titleMatch[1].trim(),
          link: linkMatch[1].trim(),
          description: descMatch ? descMatch[1].trim() : '',
          pubDate: dateMatch ? dateMatch[1].trim() : new Date().toISOString(),
          source: new URL(feedUrl).hostname.replace('www.', '')
        });
      }
    }
    return items;
  } catch (err) {
    console.warn(`Failed to fetch feed ${feedUrl}:`, err.message);
    return [];
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed. Use POST or GET.' });
  }

  // 1. TOKEN SAFETY GUARD: Optional disable flag
  if (process.env.ENABLE_PREWARMING === 'false') {
    return res.status(200).json({
      message: 'Pre-warming is paused via ENABLE_PREWARMING=false. 0 tokens consumed.',
      prewarmedCount: 0
    });
  }

  // 2. CRON SECURITY: Protect against unauthorized public trigger if secret is set
  const authHeader = req.headers?.authorization || req.headers?.Authorization;
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized: Invalid or missing CRON_SECRET' });
  }

  const startTime = Date.now();
  const apiKey = req.body?.apiKey || GOOGLE_API_KEY;

  if (!apiKey || !SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(200).json({
      message: 'Pre-warming is in dry-run mode (requires GOOGLE_GEMINI_API_KEY and SUPABASE credentials). 0 tokens spent.',
      prewarmedCount: 0
    });
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  try {
    let candidateArticles = req.body?.articles || [];

    // If no articles provided, fetch from default high-traffic feeds
    if (candidateArticles.length === 0) {
      const feedPromises = DEFAULT_FEEDS.map(f => fetchRssItemsFromFeed(f));
      const feedResults = await Promise.all(feedPromises);
      candidateArticles = feedResults.flat();
    }

    if (candidateArticles.length === 0) {
      return res.status(200).json({
        message: 'No articles available to cluster',
        prewarmedCount: 0
      });
    }

    // 1. Run Trend Clustering heuristic (Detect stories across >= 3 sources or high density)
    const clusters = clusterTrendingStories(candidateArticles, {
      similarityThreshold: 0.38,
      minSourcesForTrend: 2 // Allow 2+ for aggressive prewarming, 3+ is high-confidence trend
    });

    const trendingClusters = clusters.slice(0, 10);
    const prewarmedStories = [];

    // 2. Proactively process top trending clusters
    for (const cluster of trendingClusters) {
      const lead = cluster.leadArticle;
      if (!lead || !lead.link) continue;

      // Check if already in cache (exact URL)
      const { data: existing } = await supabase
        .from('summaries')
        .select('id, url')
        .eq('url', lead.link)
        .maybeSingle();

      if (existing) {
        prewarmedStories.push({
          topic: cluster.topic,
          url: lead.link,
          status: 'already_cached',
          sources: cluster.sources
        });
        continue;
      }

      // Check semantic deduplication against existing cache
      const fingerprintText = getFingerprintText(lead.title, lead.description);
      const embedding = await generateHeadlineEmbedding(fingerprintText, apiKey);

      const { data: semanticMatches } = await supabase.rpc('match_summaries', {
        query_embedding: embedding,
        match_threshold: SEMANTIC_MATCH_THRESHOLD,
        match_count: 1,
        max_age_hours: 48
      });

      if (semanticMatches && semanticMatches.length > 0) {
        prewarmedStories.push({
          topic: cluster.topic,
          url: lead.link,
          status: 'semantic_hit_already_present',
          similarity: semanticMatches[0].similarity,
          sources: cluster.sources
        });
        continue;
      }

      // Generate Tier 1 & Tier 2 for pre-warming
      const tier1Micro = generateExtractiveMicroSummary(lead.title, lead.description);

      const prompt = `Summarize this trending story into 2-3 concise, fact-checked bullet points.
Output HTML with <ul> and <li> tags only.
Title: ${lead.title}
Content: ${lead.description.slice(0, 3000)}`;

      const result = await generateWithFallback(genAI, prompt, { temperature: 0.2 });
      let summaryHtml = result.text;

      // Deterministic Groundedness Check
      const groundedness = evaluateGroundedness(summaryHtml, lead.description, lead.title);

      // Save to Supabase as pre-warmed
      await supabase.from('summaries').upsert({
        url: lead.link,
        title: lead.title,
        source: lead.source,
        text: summaryHtml,
        tier1_micro: tier1Micro,
        tier2_bullets: summaryHtml,
        headline_embedding: embedding,
        groundedness_score: groundedness.score,
        groundedness_report: groundedness,
        cluster_id: cluster.clusterId,
        is_prewarmed: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }, { onConflict: 'url' });

      prewarmedStories.push({
        topic: cluster.topic,
        url: lead.link,
        status: 'proactively_cached',
        sources: cluster.sources,
        groundednessScore: groundedness.score
      });
    }

    return res.status(200).json({
      success: true,
      totalArticlesProcessed: candidateArticles.length,
      clustersFound: clusters.length,
      prewarmedCount: prewarmedStories.filter(s => s.status === 'proactively_cached').length,
      prewarmedStories,
      latencyMs: Date.now() - startTime
    });

  } catch (error) {
    console.error('Pre-warming failure:', error);
    return res.status(500).json({ error: 'Pre-warming failed', details: error.message });
  }
}
