/**
 * Step 2: Predictive Pre-Warming via Trend Clustering
 * Groups multi-feed stories and detects viral/trending events (>= 3 sources).
 */

const NOISE_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of',
  'with', 'by', 'as', 'is', 'are', 'was', 'were', 'it', 'its', 'from', 'that',
  'this', 'these', 'those', 'after', 'before', 'new', 'says', 'said', 'how', 'why',
  'what', 'who', 'when', 'will', 'could', 'may', 'update', 'live', 'breaking',
  'here', 'with', 'line', 'starts', 'starting', 'start'
]);

/**
 * Extracts salient tokens and bigrams from a headline
 */
function extractHeadlineSignatures(title) {
  if (!title) return { tokens: new Set(), bigrams: new Set() };

  const words = title
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 1 && !NOISE_WORDS.has(w));

  const tokens = new Set(words);
  const bigrams = new Set();

  for (let i = 0; i < words.length - 1; i++) {
    bigrams.add(`${words[i]}_${words[i + 1]}`);
  }

  return { tokens, bigrams };
}

/**
 * Calculates headline similarity score between two articles (0.0 to 1.0)
 * Uses a blend of Dice coefficient, bigram overlap, and key entity intersection.
 */
function computeHeadlineSimilarity(sigA, sigB) {
  if (sigA.tokens.size === 0 || sigB.tokens.size === 0) return 0;

  // 1. Bigram overlap
  let bigramMatches = 0;
  for (const bg of sigA.bigrams) {
    if (sigB.bigrams.has(bg)) bigramMatches++;
  }

  // 2. Token overlap
  let tokenMatches = 0;
  for (const t of sigA.tokens) {
    if (sigB.tokens.has(t)) tokenMatches++;
  }

  // Dice coefficient
  const dice = (2 * tokenMatches) / (sigA.tokens.size + sigB.tokens.size);
  // Overlap coefficient (handles headlines of differing lengths)
  const overlap = tokenMatches / Math.min(sigA.tokens.size, sigB.tokens.size);

  const bigramBonus = bigramMatches > 0 ? 0.25 : 0;
  // If at least 2 distinct significant tokens match (e.g. "apple" + "m5"), strong bonus
  const multiEntityBonus = tokenMatches >= 2 ? 0.15 : 0;

  return Math.min(1.0, Math.max(dice, overlap * 0.7) + bigramBonus + multiEntityBonus);
}

/**
 * Clusters an incoming batch of RSS articles into trend topics.
 * Returns sorted clusters with trending flags (>= 3 distinct publisher feeds).
 */
export function clusterTrendingStories(articles = [], options = {}) {
  const {
    similarityThreshold = 0.28,
    minSourcesForTrend = 3,
    maxTimeWindowHours = 4
  } = options;

  const clusters = [];

  // Sort articles by recency (newest first)
  const sortedArticles = [...articles].sort((a, b) => {
    const timeA = new Date(a.pubDate || a.isoDate || Date.now()).getTime();
    const timeB = new Date(b.pubDate || b.isoDate || Date.now()).getTime();
    return timeB - timeA;
  });

  for (const article of sortedArticles) {
    const sig = extractHeadlineSignatures(article.title);
    let matchedCluster = null;
    let maxSim = -1;

    for (const cluster of clusters) {
      // Check time window compatibility
      const clusterTime = cluster.latestTime;
      const articleTime = new Date(article.pubDate || Date.now()).getTime();
      const diffHours = Math.abs(clusterTime - articleTime) / (1000 * 60 * 60);

      if (diffHours > maxTimeWindowHours) continue;

      // Check similarity against cluster centroid/articles
      for (const member of cluster.articles) {
        const sim = computeHeadlineSimilarity(sig, member.signature);
        if (sim >= similarityThreshold && sim > maxSim) {
          maxSim = sim;
          matchedCluster = cluster;
        }
      }
    }

    if (matchedCluster) {
      matchedCluster.articles.push({ ...article, signature: sig });
      matchedCluster.sources.add(article.source || 'Unknown');
      matchedCluster.latestTime = Math.max(matchedCluster.latestTime, new Date(article.pubDate || Date.now()).getTime());
    } else {
      const newCluster = {
        id: `trend_${Math.abs(Date.now() + clusters.length).toString(36)}`,
        leadArticle: article,
        articles: [{ ...article, signature: sig }],
        sources: new Set([article.source || 'Unknown']),
        latestTime: new Date(article.pubDate || Date.now()).getTime(),
      };
      clusters.push(newCluster);
    }
  }

  // Format clusters & compute trending scores
  const results = clusters.map(c => {
    const uniqueSources = Array.from(c.sources);
    const sourceCount = uniqueSources.length;
    const articleCount = c.articles.length;
    const isTrending = sourceCount >= minSourcesForTrend || articleCount >= 3;

    // Pick lead article: longest description
    const bestArticle = [...c.articles].sort((a, b) => (b.content?.length || b.description?.length || 0) - (a.content?.length || a.description?.length || 0))[0];

    return {
      clusterId: c.id,
      topic: bestArticle.title,
      leadArticle: bestArticle,
      articleCount,
      uniqueSourcesCount: sourceCount,
      sources: uniqueSources,
      isTrending,
      trendScore: Number((sourceCount * 3.0 + articleCount * 1.5).toFixed(2)),
      articles: c.articles.map(({ signature, ...rest }) => rest)
    };
  });

  return results.sort((a, b) => b.trendScore - a.trendScore);
}
