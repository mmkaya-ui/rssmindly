/**
 * Step 4: Self-Evaluating Groundedness & Source Attribution
 * Deterministic entity & number verification pipeline.
 */

// Common English words capitalized at sentence start or commonly found in summaries
const STOPWORDS = new Set([
  'The', 'A', 'An', 'This', 'That', 'These', 'Those', 'In', 'On', 'At', 'By', 'For',
  'With', 'About', 'Against', 'Between', 'Into', 'Through', 'During', 'Before', 'After',
  'Above', 'Below', 'To', 'From', 'Up', 'Down', 'In', 'Out', 'Over', 'Under', 'Again',
  'Further', 'Then', 'Once', 'Here', 'There', 'When', 'Where', 'Why', 'How', 'All',
  'Any', 'Both', 'Each', 'Few', 'More', 'Most', 'Other', 'Some', 'Such', 'No', 'Nor',
  'Not', 'Only', 'Own', 'Same', 'So', 'Than', 'Too', 'Very', 'Can', 'Will', 'Just',
  'Don', 'Should', 'Now', 'According', 'Additionally', 'Meanwhile', 'Furthermore',
  'However', 'Therefore', 'Overall', 'Summary', 'Key', 'Takeaways', 'Points', 'First',
  'Second', 'Third', 'Last', 'Next', 'Report', 'Reports', 'Company', 'Firm', 'New',
  'Pricing', 'Price', 'Prices', 'Availability', 'Details', 'Launch', 'Features', 'Updates', 'Expected',
  'Capital', 'Clean', 'Recent', 'Official', 'Officials', 'Authorities', 'Initial',
  'Several', 'Major', 'Multiple', 'Various', 'Numerous', 'Retail', 'Global', 'National',
  'Fine', 'Fines', 'Penalty', 'Penalties', 'Cost', 'Costs', 'Total', 'Value', 'Rate', 'Rates',
  'Sales', 'Revenue', 'Profit', 'Loss', 'Market', 'Device', 'Product', 'Products', 'Model', 'Models'
]);

/**
 * Strips HTML tags and unescapes standard HTML entities
 */
export function cleanRawText(htmlOrText) {
  if (!htmlOrText) return '';
  return htmlOrText
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extracts numbers, currency figures, and percentages from text.
 * Uses explicit Unicode escape sequences to prevent character encoding issues (mojibake).
 *   $ = \u0024, € = \u20AC, £ = \u00A3, ¥ = \u00A5
 */
export function extractNumbersAndMetrics(text) {
  const clean = cleanRawText(text);
  const metrics = [];

  // Currency formats: $500, €45 million, £100k, 500 million euros, $5.2B, etc.
  // Uses Unicode escape sequences [$ \u20AC \u00A3 \u00A5] to be encoding-safe
  const symbolCurrencyRegex = /([$\u20AC\u00A3\u00A5]\s*\d+(?:,\d{3})*(?:\.\d+)?(?:\s*(?:billion|million|trillion|k|m|b))?)/gi;
  let match;
  while ((match = symbolCurrencyRegex.exec(clean)) !== null) {
    metrics.push({ type: 'currency', raw: match[1].trim() });
  }

  // Word-based currencies: "500 million euros", "30 billion dollars", "1500 USD", etc.
  const wordCurrencyRegex = /(\b\d+(?:,\d{3})*(?:\.\d+)?(?:\s*(?:billion|million|trillion|k|m|b))?\s*(?:dollars?|euros?|pounds?|yen|usd|eur|gbp|jpy)\b)/gi;
  while ((match = wordCurrencyRegex.exec(clean)) !== null) {
    const val = match[1].trim();
    if (!metrics.some(m => m.raw.includes(val))) {
      metrics.push({ type: 'currency', raw: val });
    }
  }

  // Percentages: 15%, 3.5%, 42 percent
  const percentRegex = /(\b\d+(?:\.\d+)?\s*(?:%|percent\b))/gi;
  while ((match = percentRegex.exec(clean)) !== null) {
    metrics.push({ type: 'percentage', raw: match[1].trim() });
  }

  // Multipliers: 3.5x, 10x
  const multiplierRegex = /(\b\d+(?:\.\d+)?\s*x\b)/gi;
  while ((match = multiplierRegex.exec(clean)) !== null) {
    metrics.push({ type: 'multiplier', raw: match[1].trim() });
  }

  // Standalone numbers: numbers with digits >= 1, avoiding list counters like "1." at sentence start
  const numberRegex = /(?<![.\w])(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+\.\d+|\b\d+\b)(?![.\w])/g;
  while ((match = numberRegex.exec(clean)) !== null) {
    const val = match[1].trim();
    // Ignore standalone numbers if already captured inside a currency, percentage, or multiplier
    if (!metrics.some(m => m.raw.includes(val))) {
      metrics.push({ type: 'number', raw: val });
    }
  }

  return metrics;
}

/**
 * Extracts candidate proper nouns / named entities (e.g., Apple, M5, Google, Sundar Pichai)
 */
export function extractProperNouns(text) {
  const clean = cleanRawText(text);
  const entityRegex = /\b([A-Z][a-z0-9]+(?:\s+[A-Z][a-z0-9]+)*|[A-Z]{2,}[0-9]*|[A-Z][0-9]+)\b/g;
  const entities = new Set();
  let match;

  while ((match = entityRegex.exec(clean)) !== null) {
    const candidate = match[1].trim();
    if (candidate.length > 1 && !STOPWORDS.has(candidate)) {
      entities.add(candidate);
    }
  }

  return Array.from(entities);
}

/**
 * Normalizes number and currency representation for cross-checking:
 * Strips symbols ($ € £ ¥ %), currency words (dollars, euros), and formatting commas
 */
export function normalizeNumericRepresentation(val) {
  return val
    .toLowerCase()
    .replace(/[$\u20AC\u00A3\u00A5%,]/g, '')
    .replace(/\b(?:dollars?|euros?|pounds?|yen|usd|eur|gbp|jpy|percent)\b/g, '')
    .replace(/\s+/g, '')
    .trim();
}

/**
 * Deterministically checks if a generated summary is grounded in the source text.
 * Verifies every number, currency metric, and named entity.
 */
export function evaluateGroundedness(summaryHtml, sourceArticleText, title = '') {
  const fullSource = `${title} ${sourceArticleText}`.toLowerCase();
  const summaryText = cleanRawText(summaryHtml);

  const metrics = extractNumbersAndMetrics(summaryText);
  const entities = extractProperNouns(summaryText);

  const violations = [];
  const verifiedFacts = [];

  // Pre-normalize source text for resilient metric cross-checking
  const normalizedSource = fullSource
    .replace(/[$\u20AC\u00A3\u00A5%,]/g, ' ')
    .replace(/\b(?:dollars?|euros?|pounds?|yen|usd|eur|gbp|jpy|percent)\b/g, ' ')
    .replace(/\s+/g, ' ');

  const condensedSource = fullSource
    .replace(/[$\u20AC\u00A3\u00A5%,]/g, '')
    .replace(/\b(?:dollars?|euros?|pounds?|yen|usd|eur|gbp|jpy|percent)\b/g, '')
    .replace(/\s+/g, '');

  // 1. Verify numbers & currencies
  for (const item of metrics) {
    const rawLower = item.raw.toLowerCase();
    const cleanNum = normalizeNumericRepresentation(item.raw);

    const existsDirectly = fullSource.includes(rawLower);
    const existsNormalized = cleanNum.length > 0 && (
      normalizedSource.includes(` ${cleanNum} `) ||
      normalizedSource.includes(cleanNum) ||
      condensedSource.includes(cleanNum)
    );

    if (existsDirectly || existsNormalized) {
      verifiedFacts.push({ type: item.type, value: item.raw });
    } else {
      violations.push({
        type: item.type,
        value: item.raw,
        reason: `Metric "${item.raw}" appears in summary but is not present in original article`
      });
    }
  }

  // 2. Verify named entities
  for (const entity of entities) {
    const entityLower = entity.toLowerCase();
    // Require contiguous multi-word entity or exact match to avoid false split-name recombination
    const words = entityLower.split(/\s+/);
    const matched = words.length > 1
      ? fullSource.includes(entityLower)
      : fullSource.includes(entityLower);

    if (matched) {
      verifiedFacts.push({ type: 'entity', value: entity });
    } else {
      violations.push({
        type: 'entity',
        value: entity,
        reason: `Entity "${entity}" is not mentioned in source article`
      });
    }
  }

  const totalChecks = metrics.length + entities.length;
  const verifiedCount = verifiedFacts.length;

  const numberViolations = violations.filter(v => 
    v.type === 'currency' || v.type === 'number' || v.type === 'percentage' || v.type === 'multiplier'
  );
  
  const score = totalChecks === 0 ? 1.0 : Math.max(0, Number((verifiedCount / totalChecks).toFixed(2)));
  // Grounded criteria: zero metric violations AND (all checks passed or score >= 0.80)
  const isGrounded = numberViolations.length === 0 && (totalChecks === 0 || score >= 0.80);

  return {
    isGrounded,
    score,
    totalChecks,
    verifiedCount,
    numberViolationsCount: numberViolations.length,
    violations,
    verifiedFacts: verifiedFacts.slice(0, 10),
    verifiedTimestamp: new Date().toISOString()
  };
}
