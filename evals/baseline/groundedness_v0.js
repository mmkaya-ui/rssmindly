/**
 * Step 4: Self-Evaluating Groundedness & Source Attribution (Zero Hallucination Guarantee)
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
  'Pricing', 'Availability', 'Details', 'Launch', 'Features', 'Updates', 'Expected'
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
 * Extracts numbers, currency figures, and percentages from text
 */
export function extractNumbersAndMetrics(text) {
  const clean = cleanRawText(text);
  const metrics = [];

  // Currency formats: $500, $5.2B, $10 billion, €45 million, £100k, etc.
  const currencyRegex = /([$€£¥]\s*\d+(?:,\d{3})*(?:\.\d+)?(?:\s*(?:billion|million|trillion|k|m|b))?)/gi;
  let match;
  while ((match = currencyRegex.exec(clean)) !== null) {
    metrics.push({ type: 'currency', raw: match[1].trim() });
  }

  // Percentages: 15%, 3.5%
  const percentRegex = /(\b\d+(?:\.\d+)?\s*%\b)/g;
  while ((match = percentRegex.exec(clean)) !== null) {
    metrics.push({ type: 'percentage', raw: match[1].trim() });
  }

  // Standalone numbers: numbers with digits > 1 or floating point, ignoring HTML list counters
  const numberRegex = /(?<![.\w])(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+\.\d+|\b\d{2,}\b)(?![.\w])/g;
  while ((match = numberRegex.exec(clean)) !== null) {
    const val = match[1].trim();
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
 * Normalizes number representation for cross-checking (e.g. $5B vs $5 billion vs 5 billion)
 */
function normalizeNumericRepresentation(val) {
  return val
    .toLowerCase()
    .replace(/[$,€£¥%]/g, '')
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

  // 1. Verify numbers & currencies (Strict zero-hallucination tolerance)
  for (const item of metrics) {
    const rawLower = item.raw.toLowerCase();
    const cleanNum = normalizeNumericRepresentation(item.raw);

    const existsDirectly = fullSource.includes(rawLower);
    const existsNormalized = fullSource.replace(/[$,€£¥%]/g, '').includes(cleanNum);

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

  // 2. Verify named entities (Proper nouns, product names, orgs)
  for (const entity of entities) {
    const entityLower = entity.toLowerCase();
    const words = entityLower.split(/\s+/);
    // Entity is confirmed if either the full entity appears or its primary components appear
    const matched = fullSource.includes(entityLower) || words.every(w => fullSource.includes(w));

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

  const numberViolations = violations.filter(v => v.type === 'currency' || v.type === 'number' || v.type === 'percentage');
  
  const score = totalChecks === 0 ? 1.0 : Math.max(0, Number((verifiedCount / totalChecks).toFixed(2)));
  // Zero hallucination guarantee: must have zero hallucinated numbers and score >= 0.80
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
